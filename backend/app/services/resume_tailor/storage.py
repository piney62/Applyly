"""Persistence: generation-history JSON (GUI config functions removed for backend use)."""
import json
from datetime import datetime
from pathlib import Path

from .rtconfig import HISTORY_FILE
from .types import HistoryRecord


def load_history() -> list[HistoryRecord]:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeDecodeError):
            return []
    return []


def save_history(records: list[HistoryRecord]) -> None:
    try:
        HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        HISTORY_FILE.write_text(
            json.dumps(records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def add_history(keywords: list[str], api: str, resume: str,
                before: int, after: int) -> None:
    """Prepend a new record and cap history at 100 entries."""
    records = load_history()
    record: HistoryRecord = {
        "date":        datetime.now().strftime("%Y-%m-%d"),
        "time":        datetime.now().strftime("%H:%M:%S"),
        "keywords":    keywords[:6],
        "api_used":    api,
        "resume_file": Path(resume).name,
        "ats_before":  before,
        "ats_after":   after,
    }
    records.insert(0, record)
    save_history(records[:100])
