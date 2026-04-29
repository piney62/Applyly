"""AI invocation: Gemini primary â†’ Groq fallback, plus JSON response parsing."""
import json
import logging
import re
from typing import Any

from .rtconfig import GEMINI_MODELS, Groq, genai, genai_types


log = logging.getLogger(__name__)


# Output-token reservation for both providers. Groq's free-tier TPM limit is
# 12,000 tokens per minute and the limit counts (input + this reservation),
# so keeping this conservative is what makes a single resume rewrite actually
# fit. 5000 comfortably covers ~18 bullet rewrites with explanations.
_MAX_OUTPUT_TOKENS = 5000

# Substrings that indicate a provider rejected the call due to free-tier quota
# or rate limiting. Matched case-insensitively against str(exception).
# Kept as a single source of truth so the GUI's "Test connection" button uses
# the exact same heuristic as the runtime fallback path.
_QUOTA_KEYWORDS = ("quota", "exhausted", "rate")

# Substrings that indicate the request itself was too big for the provider
# (e.g. Groq HTTP 413). Distinct from quota â€” fixable by reducing tokens,
# not by waiting.
_TOO_BIG_KEYWORDS = ("too large", "reduce your message", "context length", "413")


class QuotaError(Exception):
    """A provider rejected the call due to free-tier quota or rate limiting.

    Carries the provider name, the model that hit the limit, and the original
    SDK exception so callers can decide whether to retry, fall back, or surface
    a tailored message to the user.
    """

    def __init__(self, provider: str, model: str, original: Exception):
        self.provider = provider
        self.model    = model
        self.original = original
        super().__init__(f"{provider} quota exceeded ({model}): {original}")


def is_request_too_big(exc: Exception) -> bool:
    """Return True if `exc` indicates the request payload exceeded provider limits.

    Distinct from quota: this is fixable by reducing input/output token budgets,
    not by waiting. Groq returns HTTP 413 for this; OpenAI-compatible APIs
    typically include "context length" or "too large" in the message.
    """
    s = str(exc).lower()
    return any(k in s for k in _TOO_BIG_KEYWORDS)


def is_quota_error(exc: Exception) -> bool:
    """Return True if `exc` looks like a provider quota / rate-limit error.

    Excludes "request too big" errors â€” those are diagnosed separately so the
    user sees a different message and we don't burn the second provider too.
    """
    if is_request_too_big(exc):
        return False
    s = str(exc).lower()
    if "429" in s:
        return True
    return any(k in s for k in _QUOTA_KEYWORDS)


def _try_gemini(system_prompt: str, user_content: str, gkey: str) -> str | None:
    """Try each Gemini model in turn.

    Returns the response text on success, or None if every model failed for
    non-quota reasons (caller should fall through to Groq).

    Raises QuotaError on the first model that hits quota â€” caller catches it
    and skips remaining Gemini models, since the same key won't fare better
    on the next model.
    """
    client = genai.Client(api_key=gkey)
    config = genai_types.GenerateContentConfig(
        system_instruction=system_prompt,   # rules go in system layer
        temperature=0.1,
        max_output_tokens=_MAX_OUTPUT_TOKENS,
    )
    for mn in GEMINI_MODELS:
        try:
            log.info(f"     ðŸ”µ Calling Gemini [{mn}]â€¦")
            resp = client.models.generate_content(
                model=mn,
                contents=user_content,           # only data in user message
                config=config,
            )
            log.info(f"     âœ… Gemini [{mn}] succeeded")
            return resp.text
        except Exception as e:
            if is_request_too_big(e):
                # Don't fall through to Groq â€” Groq has the same problem.
                log.warning(f"     âš ï¸  Gemini [{mn}] request too large: {e}")
                raise
            if is_quota_error(e):
                # Surface the actual SDK message so the user can see whether it
                # was per-minute (waitable) or per-day (waits till reset).
                log.warning(f"     âš ï¸  Gemini [{mn}] quota/rate limit: {e}")
                raise QuotaError("Gemini", mn, e) from e
            log.warning(f"     âš ï¸  Gemini [{mn}]: {e}")
    return None


def _try_groq(system_prompt: str, user_content: str, qkey: str) -> str:
    """Single Groq call. Raises QuotaError on quota, propagates other errors."""
    log.info("     ðŸŸ  Calling Groq [llama-3.3-70b-versatile]â€¦")
    client = Groq(api_key=qkey)
    try:
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},  # rules / role
                {"role": "user",   "content": user_content},   # resume + JD data
            ],
            max_tokens=_MAX_OUTPUT_TOKENS,
            temperature=0.1,
        )
    except Exception as e:
        if is_request_too_big(e):
            # Surface the actual size info so user knows what hit the limit.
            log.warning(f"     âš ï¸  Groq request too large: {e}")
            raise
        if is_quota_error(e):
            log.warning(f"     âš ï¸  Groq quota/rate limit: {e}")
            raise QuotaError("Groq", "llama-3.3-70b-versatile", e) from e
        raise
    log.info("     âœ… Groq succeeded")
    return resp.choices[0].message.content


def ai_call(system_prompt: str, user_content: str, gkey: str, qkey: str) -> tuple[str, str]:
    """Try Gemini first (if key set), falling back to Groq on quota or no-key.

    system_prompt: rules and role definition (AI behavior instructions)
    user_content:  actual data (resume + JD)

    Groq:   messages=[{role:system},{role:user}]  â€” OpenAI-compatible API
    Gemini: system_instruction + user message      â€” Gemini-native parameter
    """
    if gkey:
        try:
            text = _try_gemini(system_prompt, user_content, gkey)
            if text is not None:
                return text, "Gemini"
            # Every model failed with non-quota errors â†’ fall through to Groq
        except QuotaError as qe:
            log.warning(f"     â†’  Falling back to Groq ({qe.provider} {qe.model} blocked)")
    else:
        log.info("     â„¹ï¸  No Gemini key â†’ using Groq")

    if qkey:
        return _try_groq(system_prompt, user_content, qkey), "Groq"

    raise RuntimeError("No API key available. Please enter a Gemini or Groq API key.")


def parse_json(raw: str) -> Any:
    """Strip markdown code fences and parse the AI's JSON response.

    Falls back to extracting the first {â€¦} block if the raw text isn't valid
    JSON on its own. JSONDecodeError on the fallback propagates to the caller.
    """
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*",     "", raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group())
        raise

