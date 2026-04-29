"""FastAPI-friendly async wrapper around the resume-tailor pipeline."""
import asyncio
import os
from pathlib import Path
import tempfile

from .pipeline import run_pipeline


async def tailor_resume(docx_bytes: bytes, jd_text: str) -> tuple[bytes, int, int]:
    """Tailor a resume DOCX to a job description.

    Takes the original DOCX as raw bytes and the JD as plain text.
    Returns (tailored_docx_bytes, ats_score_before, ats_score_after).
    Runs the blocking pipeline in a thread so the event loop stays free.
    """
    gkey = os.environ.get("GEMINI_API_KEY", "")
    qkey = os.environ.get("GROQ_API_KEY", "")
    if not gkey and not qkey:
        raise RuntimeError("GEMINI_API_KEY or GROQ_API_KEY environment variable is required")

    def _run() -> tuple[bytes, int, int]:
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
                want_pdf=False,
                status_fn=lambda _: None,
            )
            docx_path = saved.get("docx")
            if not docx_path or not Path(docx_path).exists():
                raise RuntimeError("Pipeline did not produce a DOCX file")
            return Path(docx_path).read_bytes(), int(before), int(after)

    return await asyncio.to_thread(_run)
