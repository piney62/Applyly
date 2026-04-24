import base64
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.database import get_db
from app.models.resume import Resume
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.ai_service import AIService, get_ai_service
from app.services.resume_parser import extract_text_from_docx, structure_resume

router = APIRouter()


async def _parse_and_save(
    file_bytes: bytes,
    user_id: uuid.UUID | None,
    db: AsyncSession,
    ai_service: AIService,
    original_filename: str | None = None,
) -> Resume:
    raw_text = await extract_text_from_docx(file_bytes)
    parsed_data = await structure_resume(raw_text, ai_service)

    resume = Resume(
        user_id=user_id,
        raw_text=raw_text,
        raw_content=file_bytes,
        original_filename=original_filename,
        parsed_data=parsed_data,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume


@router.post("/upload", status_code=201)
async def upload_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_ai_service),
):
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are accepted")

    file_bytes = await file.read()
    resume = await _parse_and_save(file_bytes, current_user.id, db, ai_service, file.filename)
    skills_count = len(resume.parsed_data.get("skills", [])) if resume.parsed_data else 0

    return {"resume_id": str(resume.id), "skills_count": skills_count}


@router.post("/upload-temp", status_code=201)
async def upload_temp_resume(
    file: UploadFile = File(...),
    save_as_default: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_ai_service),
):
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are accepted")

    file_bytes = await file.read()
    user_id = current_user.id if save_as_default else None
    resume = await _parse_and_save(file_bytes, user_id, db, ai_service, file.filename)

    return {"temp_resume_id": str(resume.id)}


@router.get("/parsed")
async def get_parsed_data(
    resume_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return parsed_data for a specific resume ID (used by content script for form filling)."""
    try:
        rid = uuid.UUID(resume_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid resume_id")

    result = await db.execute(select(Resume).where(Resume.id == rid))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    return {"resume_id": str(resume.id), "parsed_data": resume.parsed_data or {}}


@router.get("/file/{resume_id}")
async def download_resume_file(
    resume_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return raw resume file as base64 for the extension to inject into file inputs."""
    try:
        rid = uuid.UUID(resume_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid resume_id")

    result = await db.execute(select(Resume).where(Resume.id == rid))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if not resume.raw_content:
        raise HTTPException(status_code=404, detail="File not stored for this resume")

    filename = resume.original_filename or f"resume_{resume_id}.docx"
    content_type = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if filename.endswith(".docx") else "application/octet-stream"
    )
    return {
        "filename": filename,
        "content_type": content_type,
        "content_base64": base64.b64encode(resume.raw_content).decode(),
    }


@router.get("/debug")
async def debug_resume(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume)
        .where(Resume.user_id == current_user.id)
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="No resume found")

    return {
        "resume_id": str(resume.id),
        "created_at": resume.created_at.isoformat(),
        "raw_text": resume.raw_text,
        "parsed_data": resume.parsed_data,
    }
