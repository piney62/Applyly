"""
Resume ↔ JD keyword matcher with deterministic scoring.

Tunable constants are declared at the top of this file.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.ai_service import AIService

_REPORT_PATH = Path(__file__).parent.parent.parent / "logs" / "match_report.txt"


def _save_report(report: str) -> None:
    try:
        _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with _REPORT_PATH.open("w", encoding="utf-8") as f:
            f.write(f"[{ts}]\n\n{report}\n")
    except Exception:
        pass

logger = logging.getLogger(__name__)

# ── Tunable weights ────────────────────────────────────────────────────────────

CATEGORY_WEIGHTS: dict[str, float] = {
    "must_have":      3.0,
    "nice_to_have":   1.5,
    "responsibility": 1.0,
    "soft_skill":     0.5,
}

MATCH_TYPE_MULTIPLIERS: dict[str, float] = {
    "exact":     1.0,
    "variation": 0.8,
    "semantic":  0.7,
    "none":      0.0,
}

SECTION_MULTIPLIERS: dict[str | None, float] = {
    "experience": 1.2,
    "skills":     1.0,
    "summary":    0.9,
    "education":  0.9,
    None:         0.0,
}

CONFIDENCE_THRESHOLD = 0.7   # below this → treated as not matched

# ── Prompt ─────────────────────────────────────────────────────────────────────

MATCH_PROMPT = """You are an ATS keyword matching evaluator.
Do NOT calculate any score.

Resume sections:
{resume_sections}

JD keywords to check:
{keywords_json}

For each JD keyword return exactly this JSON object:
{{
  "keyword":    "<keyword>",
  "matched":    true | false,
  "match_type": "exact" | "variation" | "semantic" | "none",
  "evidence":   "<exact sentence from resume containing the keyword, or null>",
  "section":    "summary" | "experience" | "skills" | "education" | null,
  "confidence": <float 0.0–1.0>
}}

Rules:
- "exact":     identical string match (case-insensitive)
- "variation": abbreviation or stem variant (JS ↔ JavaScript, K8s ↔ Kubernetes)
- "semantic":  different words, same meaning in context (e.g., "led" ↔ "leadership")
- "none":      keyword not found in resume
- Set matched=true only when confidence >= {threshold}
- evidence must be a verbatim sentence from the resume, not paraphrased

Output a JSON array of result objects — nothing else.
"""

# ── Resume formatter ───────────────────────────────────────────────────────────

def _format_resume_sections(resume: dict[str, Any]) -> str:
    lines: list[str] = []

    if resume.get("summary"):
        lines.append(f"Summary:\n  {resume['summary']}\n")

    skills = resume.get("skills", [])
    if skills:
        lines.append(f"Skills:\n  {', '.join(skills)}\n")

    experience = resume.get("experience", [])
    if experience:
        lines.append("Experience:")
        for exp in experience:
            header = f"  {exp.get('company', '')} — {exp.get('title', '')} ({exp.get('start', '')}–{exp.get('end', '')})"
            lines.append(header)
            for bullet in exp.get("bullets", []):
                lines.append(f"    • {bullet}")
        lines.append("")

    education = resume.get("education", [])
    if education:
        lines.append("Education:")
        for edu in education:
            lines.append(f"  {edu.get('school', '')} — {edu.get('degree', '')} ({edu.get('year', '')})")
        lines.append("")

    return "\n".join(lines)


# ── Scoring ────────────────────────────────────────────────────────────────────

def _calculate_score(
    match_results: list[dict],
    keyword_to_category: dict[str, str],
) -> tuple[int, dict[str, int]]:
    category_totals: dict[str, float] = {c: 0.0 for c in CATEGORY_WEIGHTS}
    category_maxes:  dict[str, float] = {c: 0.0 for c in CATEGORY_WEIGHTS}

    for result in match_results:
        kw = result["keyword"].lower()
        category = keyword_to_category.get(kw, "soft_skill")
        cat_weight   = CATEGORY_WEIGHTS[category]
        match_mult   = MATCH_TYPE_MULTIPLIERS.get(result.get("match_type", "none"), 0.0)
        section_mult = SECTION_MULTIPLIERS.get(result.get("section"), 0.0)
        confidence   = float(result.get("confidence", 0.0))

        if not result.get("matched", False) or confidence < CONFIDENCE_THRESHOLD:
            match_mult = 0.0

        keyword_score = cat_weight * match_mult * section_mult * confidence
        # max possible per keyword = weight × exact(1.0) × experience(1.2) × confidence(1.0)
        keyword_max   = cat_weight * 1.0 * 1.2 * 1.0

        category_totals[category] += keyword_score
        category_maxes[category]  += keyword_max

    category_scores: dict[str, int] = {}
    for cat in CATEGORY_WEIGHTS:
        if category_maxes[cat] > 0:
            category_scores[cat] = round(category_totals[cat] / category_maxes[cat] * 100)
        else:
            category_scores[cat] = 0

    total_sum = sum(category_totals.values())
    max_sum   = sum(category_maxes.values())
    overall   = round(total_sum / max_sum * 100) if max_sum > 0 else 0

    return overall, category_scores


# ── Report ─────────────────────────────────────────────────────────────────────

def _build_report(
    match_score: int,
    category_scores: dict[str, int],
    keywords: list[dict],
    jd_keywords: dict[str, list[dict]],
) -> str:
    W = 47
    lines = [
        "═" * W,
        "   Resume ↔ JD Match Report",
        "═" * W,
        f"Overall Match Score: {match_score}%",
        "",
        "Breakdown:",
    ]

    label_map = {
        "must_have":      "Must-have     ",
        "nice_to_have":   "Nice-to-have  ",
        "responsibility": "Responsibility",
        "soft_skill":     "Soft skills   ",
    }
    for cat, label in label_map.items():
        count  = len(jd_keywords.get(cat, []))
        pct    = category_scores.get(cat, 0)
        lines.append(f"  {label} : {pct}% ({count} keywords)")

    for cat, label in label_map.items():
        cat_kws = [k for k in keywords if k.get("category") == cat]
        if not cat_kws:
            continue
        lines.append("")
        lines.append(f"{label.strip()} keywords:")
        for kw in cat_kws:
            word       = kw["word"]
            matched    = kw.get("matched", False)
            match_type = kw.get("match_type", "none")
            section    = kw.get("section") or "—"
            confidence = kw.get("confidence", 0.0)

            # find mentions from jd_keywords
            mentions = next(
                (item["mentions"] for item in jd_keywords.get(cat, [])
                 if item["keyword"].lower() == word.lower()),
                1,
            )

            if matched and match_type == "exact":
                icon = "✅"
            elif matched:
                icon = "⚠ "
            else:
                icon = "❌"

            tag = f"[{match_type}, {section}, {mentions}x]" if matched else "[MISSING]"
            conf_note = f" — confidence {confidence:.0%}" if matched and confidence < 0.85 else ""
            lines.append(f"  {icon} {word:<20} {tag}{conf_note}")

    missing_critical = [
        kw for kw in keywords
        if not kw.get("matched") and kw.get("category") == "must_have"
    ]
    if missing_critical:
        lines.append("")
        lines.append("Missing critical keywords:")
        for kw in missing_critical:
            mentions = next(
                (item["mentions"] for item in jd_keywords.get("must_have", [])
                 if item["keyword"].lower() == kw["word"].lower()),
                1,
            )
            lines.append(f"  - {kw['word']}  (JD mentioned {mentions}x)")

    knockouts = jd_keywords.get("knockout", [])
    if knockouts:
        lines.append("")
        lines.append("⛔ Knockout Requirements (not scored):")
        for item in knockouts:
            lines.append(f"  ❌ {item['keyword']}  — eligibility requirement, verify separately")

    lines.append("")
    if match_score >= 75:
        verdict = "Strong match"
    elif match_score >= 50:
        verdict = "Borderline — Optimization recommended"
    else:
        verdict = "Weak match — significant gaps"
    lines.append(f"Verdict: {verdict}")
    lines.append("═" * W)

    return "\n".join(lines)


# ── Public API ─────────────────────────────────────────────────────────────────

async def match_resume_to_jd(
    resume: dict[str, Any],
    jd_keywords: dict[str, list[dict]],
    ai_service: AIService,
) -> dict[str, Any]:
    """
    Match a structured resume against categorized JD keywords.

    Args:
        resume:       parsed resume dict (from resume_parser.structure_resume)
        jd_keywords:  output of jd_extractor.extract_jd_keywords
        ai_service:   AIService instance

    Returns:
        {
            "match_score": int,
            "category_scores": {"must_have": int, ...},
            "keywords": [
                {
                    "word": "Python",
                    "status": "matched" | "weak" | "missing",
                    "category": "must_have",
                    "match_type": "exact",
                    "evidence": "...",
                    "section": "skills",
                    "confidence": 0.95,
                    "matched": True,
                },
                ...
            ],
            "report": "<formatted text report>",
        }
    """
    # Flatten all keywords (exclude knockout from scoring)
    all_keywords: list[str] = []
    keyword_to_category: dict[str, str] = {}
    for category, items in jd_keywords.items():
        if category == "knockout":
            continue
        for item in items:
            kw = item["keyword"]
            all_keywords.append(kw)
            keyword_to_category[kw.lower()] = category

    if not all_keywords:
        return {"match_score": 0, "category_scores": {}, "keywords": [], "report": "No JD keywords found."}

    resume_sections = _format_resume_sections(resume)
    prompt = MATCH_PROMPT.format(
        resume_sections=resume_sections,
        keywords_json=json.dumps(all_keywords, ensure_ascii=False),
        threshold=CONFIDENCE_THRESHOLD,
    )

    try:
        raw = await ai_service.generate(prompt, temperature=0.0)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]

        try:
            match_results: list[dict] = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Matcher returned invalid JSON, retrying")
            retry = await ai_service.generate(
                f"Fix this JSON array and return only valid JSON:\n{raw}",
                temperature=0.0,
            )
            match_results = json.loads(retry.strip().strip("```json").strip("```"))

    except Exception as exc:
        logger.warning("Keyword matching failed (%s), returning zeros", exc)
        return {"match_score": 0, "category_scores": {}, "keywords": [], "report": "Matching failed."}

    # Calculate deterministic score
    match_score, category_scores = _calculate_score(match_results, keyword_to_category)

    # Build enriched keywords list (backward-compatible status field)
    keywords: list[dict] = []
    for result in match_results:
        matched    = result.get("matched", False)
        match_type = result.get("match_type", "none")
        confidence = float(result.get("confidence", 0.0))

        if matched and match_type == "exact":
            status = "matched"
        elif matched and match_type in ("variation", "semantic"):
            status = "weak"
        else:
            status = "missing"

        kw_lower = result["keyword"].lower()
        keywords.append({
            "word":       result["keyword"],
            "status":     status,
            "category":   keyword_to_category.get(kw_lower, "soft_skill"),
            "match_type": match_type,
            "evidence":   result.get("evidence"),
            "section":    result.get("section"),
            "confidence": confidence,
            "matched":    matched,
        })

    report = _build_report(match_score, category_scores, keywords, jd_keywords)
    _save_report(report)

    return {
        "match_score":     match_score,
        "category_scores": category_scores,
        "keywords":        keywords,
        "knockouts":       jd_keywords.get("knockout", []),
        "report":          report,
    }
