import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.application import Application, VALID_STATUSES
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


class AddApplicationIn(BaseModel):
    company: str
    job_title: str
    job_url: str | None = None
    resume_id: str | None = None
    resume_type: str = "uploaded"
    cover_letter: str | None = None
    status: str = "applied"


class UpdateStatusIn(BaseModel):
    status: str


def _serialize(app: Application) -> dict:
    return {
        "id": str(app.id),
        "company": app.company,
        "job_title": app.job_title,
        "job_url": app.job_url,
        "resume_id": str(app.resume_id) if app.resume_id else None,
        "resume_type": app.resume_type,
        "status": app.status,
        "cover_letter": app.cover_letter,
        "applied_at": app.applied_at.isoformat() if app.applied_at else None,
    }


@router.get("/list")
async def list_applications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Application)
        .where(Application.user_id == current_user.id)
        .order_by(Application.applied_at.desc())
    )
    apps = result.scalars().all()
    return {"applications": [_serialize(a) for a in apps]}


@router.post("/add", status_code=201)
async def add_application(
    body: AddApplicationIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Choose from {VALID_STATUSES}")

    app = Application(
        user_id=current_user.id,
        company=body.company,
        job_title=body.job_title,
        job_url=body.job_url,
        resume_id=uuid.UUID(body.resume_id) if body.resume_id else None,
        resume_type=body.resume_type,
        cover_letter=body.cover_letter,
        status=body.status,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return {"application_id": str(app.id)}


@router.patch("/{app_id}/status")
async def update_status(
    app_id: str,
    body: UpdateStatusIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Choose from {VALID_STATUSES}")

    result = await db.execute(
        select(Application).where(
            Application.id == uuid.UUID(app_id),
            Application.user_id == current_user.id,
        )
    )
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    app.status = body.status
    await db.commit()
    return {"updated": True}
