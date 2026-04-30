"""FastAPI-friendly async wrapper around the resume-tailor pipeline."""
import asyncio
import logging
import os
from pathlib import Path
import tempfile

from .ai_client import QuotaError
from .pipeline import run_pipeline

# Suppress the pipeline's verbose step-by-step INFO logs in the backend context.
# Warnings (quota errors, fallbacks) and errors still show.
for _name in (
    'app.services.resume_tailor.pipeline',
    'app.services.resume_tailor.ai_client',
    'app.services.resume_tailor.modifier',
    'google_genai',
    'google_genai.models',
):
    logging.getLogger(_name).setLevel(logging.WARNING)


async def tailor_resume(docx_bytes: bytes, jd_text: str) -> tuple[bytes, bytes | None, int, int]:
    """Tailor a resume DOCX to a job description.

    Takes the original DOCX as raw bytes and the JD as plain text.
    Returns (tailored_docx_bytes, tailored_pdf_bytes_or_None, ats_score_before, ats_score_after).
    Runs the blocking pipeline in a thread so the event loop stays free.
    """
    gkey = os.environ.get("GEMINI_API_KEY", "")
    # Mirror ai_service.py key rotation: GROQ_API_KEYS=key1,key2,... or fallback to GROQ_API_KEY
    _multi = [k.strip() for k in os.environ.get("GROQ_API_KEYS", "").split(",") if k.strip()]
    _single = os.environ.get("GROQ_API_KEY", "").strip()
    groq_keys = _multi or ([_single] if _single else [])
    if not gkey and not groq_keys:
        raise RuntimeError("GEMINI_API_KEY or GROQ_API_KEY environment variable is required")

    _log = logging.getLogger(__name__)

    def _run() -> tuple[bytes, bytes | None, int, int]:
        # docx2pdf uses Word COM automation which requires CoInitialize on each thread
        _com = False
        try:
            import pythoncom  # type: ignore[import-untyped]
            pythoncom.CoInitialize()
            _com = True
        except (ImportError, Exception):
            pass

        try:
            return _run_inner()
        finally:
            if _com:
                try:
                    import pythoncom  # type: ignore[import-untyped]
                    pythoncom.CoUninitialize()
                except Exception:
                    pass

    def _run_inner() -> tuple[bytes, bytes | None, int, int]:
        # Try each Groq key in order; move to next on QuotaError
        last_err: Exception = RuntimeError("No API keys available")
        keys_to_try = groq_keys if groq_keys else [""]
        for qkey in keys_to_try:
            try:
                with tempfile.TemporaryDirectory() as tmpdir:
                    inp = Path(tmpdir) / "resume.docx"
                    inp.write_bytes(docx_bytes)
                    saved, _, before, after, _ = run_pipeline(
                        resume_path=str(inp),
                        jd_text=jd_text,
                        gkey=gkey,
                        qkey=qkey,
                        out_dir=tmpdir,
                        want_docx=True,
                        want_pdf=True,
                        status_fn=lambda _: None,
                    )
                    docx_path = saved.get("docx")
                    if not docx_path or not Path(docx_path).exists():
                        raise RuntimeError("Pipeline did not produce a DOCX file")
                    pdf_path = saved.get("pdf")
                    pdf_bytes = Path(pdf_path).read_bytes() if pdf_path and Path(pdf_path).exists() else None
                    return Path(docx_path).read_bytes(), pdf_bytes, int(before), int(after)
            except QuotaError as e:
                last_err = e
                continue  # try next Groq key
            except Exception as e:
                _log.exception("Pipeline failed with key %s: %s", qkey[:8] + "...", e)
                raise
        raise last_err

    return await asyncio.to_thread(_run)
