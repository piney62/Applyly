import asyncio
import io
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from docx import Document

from app.services.ai_service import AIService

logger = logging.getLogger(__name__)

_LOG_PATH = Path(__file__).parent.parent.parent / "logs" / "resume_latest.json"

STRUCTURE_PROMPT = """You are a resume parser. Extract the following fields from the resume text below and return ONLY valid JSON — no markdown, no code blocks, no explanation.

Schema:
{{
  "name": "string",
  "email": "string",
  "phone": "string",
  "linkedin": "string",
  "location": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [
    {{
      "company": "string",
      "title": "string",
      "start": "string",
      "end": "string",
      "bullets": ["string"]
    }}
  ],
  "education": [
    {{
      "school": "string",
      "degree": "string",
      "year": "string"
    }}
  ]
}}

Resume text:
{resume_text}
"""


def _save_resume_log(raw_text: str, structured: dict[str, Any], used_fallback: bool):
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "used_fallback": used_fallback,
        "raw_text": raw_text,
        "structured": structured,
    }
    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LOG_PATH.open("w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.warning("resume log write failed: %s", exc)


def _extract_text_sync(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs)


async def extract_text_from_docx(file_bytes: bytes) -> str:
    return await asyncio.to_thread(_extract_text_sync, file_bytes)


def _regex_fallback(raw_text: str) -> dict[str, Any]:
    email = next(iter(re.findall(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", raw_text)), "")
    phone = next(iter(re.findall(r"[\+\(]?[\d\s\-\(\)]{7,15}", raw_text)), "")
    linkedin = next(iter(re.findall(r"linkedin\.com/in/[\w-]+", raw_text, re.I)), "")
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    name = lines[0] if lines else ""
    skills = [w for l in lines for w in l.split(",") if len(w.strip()) < 30 and w.strip()][:20]
    return {
        "name": name,
        "email": email,
        "phone": phone.strip(),
        "linkedin": linkedin,
        "location": "",
        "summary": "",
        "skills": [s.strip() for s in skills if s.strip()],
        "experience": [],
        "education": [],
    }


async def structure_resume(raw_text: str, ai_service: AIService) -> dict[str, Any]:
    try:
        prompt = STRUCTURE_PROMPT.format(resume_text=raw_text)
        raw_json = await ai_service.generate(prompt)

        raw_json = raw_json.strip()
        if raw_json.startswith("```"):
            raw_json = raw_json.split("\n", 1)[-1]
            raw_json = raw_json.rsplit("```", 1)[0]

        try:
            result = json.loads(raw_json)
        except json.JSONDecodeError:
            logger.warning("Resume structuring returned invalid JSON, retrying once")
            retry_prompt = f"Fix this broken JSON and return only valid JSON:\n{raw_json}"
            raw_json2 = await ai_service.generate(retry_prompt)
            raw_json2 = raw_json2.strip().strip("```json").strip("```")
            result = json.loads(raw_json2)

        _save_resume_log(raw_text, result, used_fallback=False)
        return result

    except Exception as exc:
        logger.warning("AI structuring failed (%s), using regex fallback", exc)
        result = _regex_fallback(raw_text)
        _save_resume_log(raw_text, result, used_fallback=True)
        return result
