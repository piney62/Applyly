"""Shared type aliases and TypedDicts used by core modules.

Centralizes the shape of resume sections, AI responses, history records, etc.
so individual modules don't need to redefine them.
"""
from typing import Any, Callable, TypedDict


# ── Callbacks ─────────────────────────────────────────────────────
# Log messages flow through the standard `logging` module, not callbacks —
# core modules call `logging.getLogger(__name__).info(…)` etc. The GUI
# attaches a TkTextHandler to the "core" logger to display them.
StatusFn = Callable[[str], None]   # update the bottom status bar (UI-only)


# ── Resume parser output ──────────────────────────────────────────
class _ParagraphItemBase(TypedDict):
    """Always-present keys for a paragraph extracted from the resume."""
    id:      str
    text:    str
    para:    Any   # docx.text.paragraph.Paragraph — left untyped to avoid
                   # a hard dependency on python-docx internals
    style:   str
    section: str


class ParagraphItem(_ParagraphItemBase, total=False):
    """A single paragraph; in_table is only set for table-cell paragraphs."""
    in_table: bool


class Sections(TypedDict):
    """Structured view of a resume after parse_document().

    Every key is always present (built unconditionally).
    """
    all:            list[ParagraphItem]
    id_map:         dict[str, ParagraphItem]
    summary:        list[ParagraphItem]
    experience:     list[ParagraphItem]
    skills:         list[ParagraphItem]
    education:      list[ParagraphItem]
    projects:       list[ParagraphItem]
    certifications: list[ParagraphItem]
    publications:   list[ParagraphItem]
    awards:         list[ParagraphItem]
    other:          list[ParagraphItem]
    header:         list[ParagraphItem]
    protected_ids:  set[str]
    contact_ids:    set[str]
    modifiable_ids: set[str]


# ── AI response ───────────────────────────────────────────────────
class Modification(TypedDict, total=False):
    """One AI-suggested change. AI may omit any field — handle defensively.

    Note: `old_text` and `reason` are intentionally absent from the schema —
    the prompt instructs the AI not to emit them. We already have the original
    text via the paragraph id, and the explanation field is unused; dropping
    them shaves ~1,350 output tokens on a typical 18-bullet rewrite, leaving
    enough headroom to actually reach the Skills section before the model
    hits its output cap.
    """
    id:             str
    section:        str
    new_text:       str
    keywords_added: list[str]


class AIResponse(TypedDict, total=False):
    """The full AI response after JSON parsing. AI may omit fields."""
    ats_score_before:      int
    ats_score_after:       int
    required_skills_found: list[str]
    modifications:         list[Modification]
    ats_tips:              list[str]


# ── Apply / save ──────────────────────────────────────────────────
class ApplyStats(TypedDict):
    """Counts produced by apply_all()."""
    applied: int
    skipped: int
    blocked: int


class SaveResult(TypedDict, total=False):
    """Paths of files actually written by save_outputs()."""
    docx: str
    pdf:  str


# ── History / settings ────────────────────────────────────────────
class HistoryRecord(TypedDict, total=False):
    """One row in generation_history.json — older records may lack fields."""
    date:        str
    time:        str
    keywords:    list[str]
    api_used:    str
    resume_file: str
    ats_before:  int
    ats_after:   int


class AppConfig(TypedDict):
    """Persisted user settings — load_config() always provides every key."""
    gemini_key: str
    groq_key:   str
    output_dir: str
    save_docx:  bool
    save_pdf:   bool
