import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.resume import Resume
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.ai_service import AIService, get_ai_service
from app.services.jd_extractor import extract_jd_keywords
from app.services.matcher import match_resume_to_jd

router = APIRouter()
logger = logging.getLogger(__name__)


class AnalyzeIn(BaseModel):
    job_url: str | None = None
    job_description_text: str


@router.post("/analyze")
async def analyze_job(
    body: AnalyzeIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_ai_service),
):
    result = await db.execute(
        select(Resume)
        .where(Resume.user_id == current_user.id)
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="No resume found. Please upload a resume first.")

    try:
        jd_keywords = await extract_jd_keywords(body.job_description_text, ai_service)
        match = await match_resume_to_jd(resume.parsed_data or {}, jd_keywords, ai_service)
        return {
            "match_score":     match["match_score"],
            "category_scores": match["category_scores"],
            "keywords":        match["keywords"],
            "knockouts":       match.get("knockouts", []),
        }
    except Exception as exc:
        logger.warning("Analysis pipeline failed (%s), returning empty result", exc)
        return {"match_score": 0, "category_scores": {}, "keywords": []}
