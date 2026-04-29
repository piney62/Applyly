"""Save the finished document as DOCX and (optionally) convert to PDF."""
import logging
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from .types import SaveResult


log = logging.getLogger(__name__)


def save_outputs(doc: Any, resume_path: str, out_dir: str,
                 want_docx: bool, want_pdf: bool) -> SaveResult:
    """Save the doc as DOCX, then optionally convert to PDF.

    If want_docx is False, the temporary DOCX is removed after the PDF is built.
    """
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = Path(resume_path).stem
    out  = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    docx_path = out / f"{base}_ATS_{ts}.docx"
    doc.save(str(docx_path))
    log.info(f"  ðŸ’¾ DOCX saved: {docx_path.name}")

    result: SaveResult = {}
    if want_docx:
        result["docx"] = str(docx_path)
    if want_pdf:
        pdf = _to_pdf(str(docx_path), str(out))
        if pdf:
            result["pdf"] = pdf
    if not want_docx and docx_path.exists():
        docx_path.unlink()
    return result


def _to_pdf(docx_path: str, out_dir: str) -> str | None:
    """Try LibreOffice â†’ docx2pdf â†’ Word COM, in that order.

    Each converter logs the reason for its failure so users can diagnose
    why a converter that *is* installed didn't produce output.
    """
    pdf_full = Path(out_dir) / (Path(docx_path).stem + ".pdf")

    # 1) LibreOffice / soffice â€” works cross-platform if installed
    for cmd in ["libreoffice", "soffice"]:
        lo = shutil.which(cmd)
        if not lo:
            continue
        try:
            result = subprocess.run(
                [lo, "--headless", "--convert-to", "pdf",
                 "--outdir", out_dir, docx_path],
                capture_output=True, timeout=60,
            )
            if pdf_full.exists():
                log.info(f"  ðŸ“„ PDF saved: {pdf_full.name}")
                return str(pdf_full)
            stderr = (result.stderr or b"").decode("utf-8", errors="replace").strip()
            log.warning(f"  âš ï¸  {cmd}: ran but no PDF produced"
                        f"{f' â€” {stderr}' if stderr else ''}")
        except subprocess.TimeoutExpired:
            log.warning(f"  âš ï¸  {cmd}: conversion timed out after 60s")
        except OSError as e:
            log.warning(f"  âš ï¸  {cmd}: {e}")

    # 2) docx2pdf â€” uses Word on Windows / Pages on macOS
    try:
        import docx2pdf
        docx2pdf.convert(docx_path, str(pdf_full))
        if pdf_full.exists():
            log.info(f"  ðŸ“„ PDF saved: {pdf_full.name}")
            return str(pdf_full)
        log.warning("  âš ï¸  docx2pdf: ran but no PDF produced")
    except ImportError:
        log.info("  â„¹ï¸  docx2pdf not installed")
    except Exception as e:
        log.warning(f"  âš ï¸  docx2pdf: {e}")

    # 3) Word COM automation (Windows only)
    try:
        import comtypes.client
        word = comtypes.client.CreateObject("Word.Application")
        word.Visible = False
        d = word.Documents.Open(str(Path(docx_path).absolute()))
        d.SaveAs(str(pdf_full.absolute()), FileFormat=17)
        d.Close()
        word.Quit()
        if pdf_full.exists():
            log.info(f"  ðŸ“„ PDF (Word): {pdf_full.name}")
            return str(pdf_full)
        log.warning("  âš ï¸  Word COM: SaveAs returned but no PDF produced")
    except ImportError:
        log.info("  â„¹ï¸  comtypes not installed (Word COM unavailable)")
    except Exception as e:
        log.warning(f"  âš ï¸  Word COM: {e}")

    log.warning("  âš ï¸  PDF conversion failed â€” LibreOffice recommended: https://www.libreoffice.org")
    return None

