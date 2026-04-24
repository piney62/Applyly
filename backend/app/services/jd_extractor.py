import json
import logging
import re
from typing import Any

from app.services.ai_service import AIService

logger = logging.getLogger(__name__)

JD_EXTRACT_PROMPT = """You are a job description keyword extractor.
Analyze the job description below and extract keywords into 4 categories.
Return ONLY valid JSON — no markdown, no explanation.

Categories:
- must_have: skills/requirements from "Required", "Must have", "Minimum qualifications" sections, or clearly mandatory ones
- nice_to_have: skills from "Preferred", "Nice to have", "Bonus", "Plus" sections
- responsibility: action/role keywords from job duties (e.g., "design", "lead", "deploy", "build")
- soft_skill: interpersonal skills (e.g., "communication", "leadership", "teamwork", "collaboration")

Output schema:
{{
  "must_have":     [{{"keyword": "string", "mentions": <int>}}],
  "nice_to_have":  [{{"keyword": "string", "mentions": <int>}}],
  "responsibility":[{{"keyword": "string", "mentions": <int>}}],
  "soft_skill":    [{{"keyword": "string", "mentions": <int>}}]
}}

Rules:
- Extract 5–15 keywords per category; omit a category if genuinely empty
- For JDs with no clear section headers, infer category from context
- mentions = number of times that keyword/concept appears in the JD
- Keywords must be atomic (e.g., "Python" not "Python programming language")
- Do NOT include the same keyword in multiple categories

Job Description:
{jd_text}
"""

# Patterns that indicate pass/fail eligibility requirements (not skills)
_KNOCKOUT_PATTERNS = re.compile(
    r"citizenship|citizen|visa|work authorization|authorized to work"
    r"|security clearance|clearance|green card|permanent resident"
    r"|eligible to work|right to work|work permit",
    re.IGNORECASE,
)

_EMPTY: dict[str, list] = {
    "must_have": [],
    "nice_to_have": [],
    "responsibility": [],
    "soft_skill": [],
    "knockout": [],
}


def _clean_keywords(raw: dict[str, Any]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    seen: set[str] = set()   # global dedup across all categories

    for category in ("must_have", "nice_to_have", "responsibility", "soft_skill"):
        items = raw.get(category, [])
        cleaned = []
        for item in items:
            if not isinstance(item, dict) or "keyword" not in item:
                continue
            kw = str(item["keyword"]).strip()
            kw_lower = kw.lower()
            if kw_lower in seen:
                continue
            seen.add(kw_lower)
            cleaned.append({
                "keyword": kw,
                "mentions": int(item.get("mentions", 1)),
            })
        result[category] = cleaned

    return result


def _split_knockouts(keywords: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Move citizenship/visa-type items from must_have into knockout list."""
    knockout: list[dict] = []
    remaining: list[dict] = []

    for item in keywords.get("must_have", []):
        if _KNOCKOUT_PATTERNS.search(item["keyword"]):
            knockout.append(item)
        else:
            remaining.append(item)

    return {**keywords, "must_have": remaining, "knockout": knockout}


async def extract_jd_keywords(
    jd_text: str,
    ai_service: AIService,
) -> dict[str, list[dict]]:
    """
    Extract and categorize keywords from a job description.

    Returns:
        {
            "must_have":      [{"keyword": "Python", "mentions": 3}, ...],
            "nice_to_have":   [...],
            "responsibility": [...],
            "soft_skill":     [...],
            "knockout":       [{"keyword": "U.S. citizenship", "mentions": 1}],
        }
    """
    if not jd_text or not jd_text.strip():
        return _EMPTY.copy()

    prompt = JD_EXTRACT_PROMPT.format(jd_text=jd_text)
    try:
        raw_json = await ai_service.generate(prompt, temperature=0.0)
        raw_json = raw_json.strip()
        if raw_json.startswith("```"):
            raw_json = raw_json.split("\n", 1)[-1].rsplit("```", 1)[0]

        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError:
            logger.warning("JD extraction returned invalid JSON, retrying")
            retry = await ai_service.generate(
                f"Fix this JSON and return only valid JSON:\n{raw_json}",
                temperature=0.0,
            )
            data = json.loads(retry.strip().strip("```json").strip("```"))

        cleaned = _clean_keywords(data)
        return _split_knockouts(cleaned)

    except Exception as exc:
        logger.warning("JD keyword extraction failed (%s), returning empty", exc)
        return _EMPTY.copy()
