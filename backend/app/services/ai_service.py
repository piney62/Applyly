import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

def _extract_json(text: str) -> Optional[Any]:
    """Find and parse the first valid JSON object or array in text."""
    if not text:
        return None
    for m in re.finditer(r"[{\[]", text):
        try:
            obj, _ = json.JSONDecoder().raw_decode(text, m.start())
            return obj
        except (json.JSONDecodeError, ValueError):
            continue
    return None


_LOG_DIR = Path(__file__).parent.parent.parent / "logs"
_LOG_PATH = _LOG_DIR / "ai.jsonl"
_LATEST_PATH = _LOG_DIR / "ai_latest.json"


class _AILogger:
    def __init__(self):
        _LOG_DIR.mkdir(parents=True, exist_ok=True)

    def write(
        self,
        *,
        provider: str,
        prompt: str,
        duration_ms: int,
        response: Optional[str] = None,
        error: Optional[str] = None,
    ):
        ts = datetime.now(timezone.utc).isoformat(timespec="seconds")

        summary = {
            "ts": ts,
            "provider": provider,
            "duration_ms": duration_ms,
            "prompt_chars": len(prompt),
            "prompt_head": prompt[:500].replace("\n", " "),
        }
        if response is not None:
            summary["response_chars"] = len(response)
            summary["response_head"] = response[:500].replace("\n", " ")
        if error is not None:
            summary["error"] = error

        latest = {
            "ts": ts,
            "provider": provider,
            "duration_ms": duration_ms,
            "prompt": prompt,
            "prompt_parsed": _extract_json(prompt),
            "response": response,
            "parsed": _extract_json(response.strip().strip("```json").strip("```").strip()) if response else None,
            "error": error,
        }

        try:
            with _LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps(summary, ensure_ascii=False) + "\n")
            with _LATEST_PATH.open("w", encoding="utf-8") as f:
                json.dump(latest, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


_ai_logger = _AILogger()


class AIService:
    def __init__(self):
        self._gemini_key = os.getenv("GEMINI_API_KEY", "")
        self._openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        self._ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

        # Groq key rotation: GROQ_API_KEYS=key1,key2,key3 or fallback to GROQ_API_KEY
        _multi = [k.strip() for k in os.getenv("GROQ_API_KEYS", "").split(",") if k.strip()]
        _single = os.getenv("GROQ_API_KEY", "").strip()
        self._groq_keys: list[str] = _multi or ([_single] if _single else [])
        self._groq_index = 0

    async def generate(self, prompt: str, temperature: float = 0.7) -> str:
        for provider in [
            self._try_gemini,
            self._try_groq,
            self._try_openrouter,
            self._try_ollama,
        ]:
            t0 = time.monotonic()
            try:
                result = await provider(prompt, temperature)
                elapsed = int((time.monotonic() - t0) * 1000)
                if result:
                    _ai_logger.write(
                        provider=provider.__name__,
                        prompt=prompt,
                        duration_ms=elapsed,
                        response=result,
                    )
                    return result
            except Exception as exc:
                elapsed = int((time.monotonic() - t0) * 1000)
                _ai_logger.write(
                    provider=provider.__name__,
                    prompt=prompt,
                    duration_ms=elapsed,
                    error=str(exc),
                )
        raise RuntimeError("All AI providers exhausted")

    # ---------- providers ----------

    async def _try_gemini(self, prompt: str, temperature: float) -> Optional[str]:
        if not self._gemini_key:
            return None
        import google.generativeai as genai
        genai.configure(api_key=self._gemini_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(temperature=temperature),
        )
        return response.text

    async def _try_groq(self, prompt: str, temperature: float) -> Optional[str]:
        if not self._groq_keys:
            return None
        from groq import AsyncGroq, RateLimitError
        # Try each key in round-robin; skip keys that hit rate limit
        for _ in range(len(self._groq_keys)):
            key = self._groq_keys[self._groq_index]
            self._groq_index = (self._groq_index + 1) % len(self._groq_keys)
            try:
                client = AsyncGroq(api_key=key)
                chat = await client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature,
                )
                return chat.choices[0].message.content
            except RateLimitError:
                continue  # try next key
        return None  # all keys rate-limited

    async def _try_openrouter(self, prompt: str, temperature: float) -> Optional[str]:
        if not self._openrouter_key:
            return None
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._openrouter_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "mistralai/mistral-7b-instruct:free",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    async def _try_ollama(self, prompt: str, temperature: float) -> Optional[str]:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self._ollama_url}/api/generate",
                json={
                    "model": "llama3",
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": temperature},
                },
            )
            resp.raise_for_status()
            return resp.json().get("response", "")


_ai_service_instance: Optional[AIService] = None


def get_ai_service() -> AIService:
    global _ai_service_instance
    if _ai_service_instance is None:
        _ai_service_instance = AIService()
    return _ai_service_instance
