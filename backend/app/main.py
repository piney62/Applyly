import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from app.database import engine, Base
import app.models  # noqa: F401 — ensure models are registered before create_all

from app.routers import auth, resume, jobs, ai, tracker


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Applyly API", version="1.0.0", lifespan=lifespan)

_origins = ["http://localhost:5173", "http://localhost:3000"]
_ext_id = os.getenv("EXTENSION_ID", "").strip()
if _ext_id:
    _origins.append(f"chrome-extension://{_ext_id}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if len(errors) == 1:
        err = errors[0]
        field = err["loc"][-1] if err["loc"] else "field"
        msg = err["msg"].replace("Value error, ", "")
        detail = f"{field}: {msg}"
    else:
        parts = []
        for err in errors:
            field = err["loc"][-1] if err["loc"] else "field"
            msg = err["msg"].replace("Value error, ", "")
            parts.append(f"{field}: {msg}")
        detail = " | ".join(parts)
    return JSONResponse(status_code=422, content={"detail": detail})


app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(resume.router, prefix="/resume", tags=["resume"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(tracker.router, prefix="/tracker", tags=["tracker"])


@app.get("/health")
async def health():
    return {"status": "ok"}
