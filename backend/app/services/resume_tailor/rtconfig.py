"""Stripped config for backend integration — no INI file, no GUI dependencies."""
from pathlib import Path

GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
HISTORY_FILE  = Path(__file__).parent.parent.parent.parent / "logs" / "tailor_history.json"

try:
    from docx import Document
except ImportError:
    Document = None

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None

try:
    from groq import Groq
except ImportError:
    Groq = None
