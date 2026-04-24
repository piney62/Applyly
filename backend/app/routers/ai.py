import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.resume import Resume
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.ai_service import AIService, get_ai_service

router = APIRouter()

COVER_LETTER_PROMPT = """Write a professional cover letter in first person for the following job application.
The applicant is writing this themselves — use "I", "my", "me" throughout.
Use ONLY information present in the resume. Do not invent facts.
Keep it to 3 paragraphs: hook, relevant experience, closing.

Resume (JSON):
{resume_json}

Job Description:
{jd_text}

Return only the cover letter text, no extra commentary.
"""

ANSWER_PROMPT = """You are the job applicant. Answer the following job application question in first person ("I have...", "My experience includes...") using ONLY information from the resume.
Be concise (2-4 sentences). Do not invent facts. Do not refer to yourself in third person.

Question: {question}

Resume (JSON):
{resume_json}

Job Description context:
{jd_text}
"""


class CoverLetterIn(BaseModel):
    job_url: str | None = None
    resume_id: str
    job_description_text: str = ""


class AnswerIn(BaseModel):
    question: str
    resume_id: str
    job_description_text: str = ""


async def _get_resume(resume_id: str, user_id, db: AsyncSession) -> Resume:
    import uuid
    result = await db.execute(
        select(Resume).where(Resume.id == uuid.UUID(resume_id))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume


@router.post("/cover-letter")
async def generate_cover_letter(
    body: CoverLetterIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_ai_service),
):
    resume = await _get_resume(body.resume_id, current_user.id, db)
    resume_json = json.dumps(resume.parsed_data or {}, indent=2)
    prompt = COVER_LETTER_PROMPT.format(resume_json=resume_json, jd_text=body.job_description_text)
    cover_letter_text = await ai_service.generate(prompt)
    return {"cover_letter_text": cover_letter_text.strip()}


@router.post("/answer")
async def generate_answer(
    body: AnswerIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_ai_service),
):
    resume = await _get_resume(body.resume_id, current_user.id, db)
    resume_json = json.dumps(resume.parsed_data or {}, indent=2)
    prompt = ANSWER_PROMPT.format(
        question=body.question,
        resume_json=resume_json,
        jd_text=body.job_description_text,
    )
    answer = await ai_service.generate(prompt)
    return {"answer": answer.strip()}
