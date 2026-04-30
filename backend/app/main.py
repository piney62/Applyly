import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
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

_ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://localhost:3000",
}
_ext_id = os.getenv("EXTENSION_ID", "").strip()
if _ext_id:
    _ALLOWED_ORIGINS.add(f"chrome-extension://{_ext_id}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Applyly API", version="1.0.0", lifespan=lifespan)


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


# ── CORS wrapper ───────────────────────────────────────────────────────────────
# Pure ASGI wrapper sitting outside FastAPI entirely.
# Handles preflight and injects CORS headers for all allowed origins.

_fastapi = app

_CORS_HEADERS = [
    (b"access-control-allow-credentials", b"true"),
    (b"access-control-allow-methods", b"GET,POST,PUT,PATCH,DELETE,OPTIONS"),
    (b"access-control-allow-headers", b"authorization,content-type,accept,*"),
]


async def app(scope, receive, send):  # noqa: F811 — intentional reassignment
    if scope["type"] != "http":
        await _fastapi(scope, receive, send)
        return

    raw = dict(scope.get("headers", []))
    origin = raw.get(b"origin", b"").decode()
    allowed = origin in _ALLOWED_ORIGINS or origin.startswith("chrome-extension://")

    if not allowed:
        await _fastapi(scope, receive, send)
        return

    origin_b = origin.encode()

    if scope["method"] == "OPTIONS":
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"access-control-allow-origin", origin_b),
                *_CORS_HEADERS,
                (b"content-length", b"0"),
            ],
        })
        await send({"type": "http.response.body", "body": b""})
        return

    async def patched_send(message):
        if message["type"] == "http.response.start":
            headers = list(message.get("headers", []))
            headers.append((b"access-control-allow-origin", origin_b))
            headers.extend(_CORS_HEADERS)
            message = {**message, "headers": headers}
        await send(message)

    await _fastapi(scope, receive, patched_send)
