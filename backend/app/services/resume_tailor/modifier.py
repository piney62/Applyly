"""Apply AI-generated modifications to the document with formatting preserved."""
import logging
import re
from typing import Any

from .types import ApplyStats, Modification, Sections


log = logging.getLogger(__name__)


# Styles that must never be modified — Word Heading-style paragraphs
PROTECTED_STYLES: set[str] = {"heading 1", "heading 2", "heading 3", "heading 4",
                              "title", "subtitle", "heading1", "heading2", "heading3"}

# Contact info pattern — paragraphs with email/URL/phone are never edited
CONTACT_PATTERN = re.compile(
    r'@[a-zA-Z]|https?://|linkedin\.com|github\.com|'
    r'\+\d[\d\s\-()]{6,}|\(\d{3}\)|\d{3}[-.\s]\d{3}[-.\s]\d{4}',
    re.I
)


def is_contact_paragraph(text: str) -> bool:
    """Returns True if the paragraph contains contact info (email, URL, phone)."""
    return bool(CONTACT_PATTERN.search(text))


def clean_text(text: str) -> str:
    """
    Sanitize AI-returned text before writing to the document.
    Replaces \\n with spaces to prevent Word's style-inheritance bug
    (where a soft line break causes new lines to inherit the prior paragraph's style).
    """
    text = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
    text = re.sub(r' {2,}', ' ', text)
    return text.strip()


def rewrite_para(para: Any, new_text: str) -> None:
    """
    Replace paragraph text while preserving all formatting.
    Preserves: paragraph style / indentation / line spacing / run-level character formatting.
    No \\n: prevents Word's style-inheritance bug on soft line breaks.

    Smart run-split for Skills paragraphs:
      Original: runs[0]="Frontend: "(bold) + runs[1]="HTML, CSS..."(normal)
      Naive approach: puts everything in runs[0] → entire line becomes bold (WRONG)
      This fix: detects the label-only runs[0] and keeps the bold/normal split.
    """
    new_text = clean_text(new_text)
    runs = para.runs
    if not runs:
        para.add_run(new_text)
        return

    # Detect label-run pattern: runs[0] is a short label ending with ":"
    # e.g. "Frontend:", "Backend & APIs:", "Cloud & DevOps:"
    if len(runs) >= 2:
        r0 = runs[0].text.strip()
        is_label = (r0.endswith(':') and ',' not in r0 and len(r0) <= 50)
        if is_label:
            sep = new_text.find(': ')
            if sep != -1:
                runs[0].text = new_text[:sep + 2]   # label part — keeps bold
                runs[1].text = new_text[sep + 2:]   # content — keeps normal weight
                for run in runs[2:]:
                    run.text = ""
                return

    # Default: all text in runs[0] (preserves first-run character style)
    runs[0].text = new_text
    for run in runs[1:]:
        run.text = ""


def skills_label_guard(old_text: str, new_text: str) -> str:
    """
    Preserves the category label (e.g. 'Frontend:', 'Languages & .NET:') in Skills paragraphs.
    Auto-restores the original label if AI removed or changed it.
    """
    # Check whether the original paragraph has a 'Label:' prefix
    label_match = re.match(r'^([^:]{2,40}):\s*', old_text)
    if not label_match:
        return new_text  # no label in this paragraph — use as-is

    original_label = label_match.group(0)                       # e.g. "Frontend: "
    original_label_key = label_match.group(1).strip().lower()   # e.g. "frontend"

    # Check whether the new text also has the same label
    new_label_match = re.match(r'^([^:]{2,40}):\s*', new_text)
    if new_label_match:
        new_label_key = new_label_match.group(1).strip().lower()
        if new_label_key == original_label_key:
            return new_text  # label correctly preserved
        # Label was changed — restore original label
        rest = new_text[new_label_match.end():]
        return original_label + rest
    else:
        # Label was removed entirely — prepend original label
        return original_label + new_text


def _split_skill_tokens(body: str) -> list[str]:
    """Split a skills line body by top-level commas (parens-aware).

    "Node.js (Express, NestJS), Python (Flask/Django/FastAPI), Spring Boot (Java)"
    → ["Node.js (Express, NestJS)", "Python (Flask/Django/FastAPI)", "Spring Boot (Java)"]
    """
    tokens: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in body:
        if ch == '(':
            depth += 1
            buf.append(ch)
        elif ch == ')':
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch == ',' and depth == 0:
            t = ''.join(buf).strip()
            if t:
                tokens.append(t)
            buf = []
        else:
            buf.append(ch)
    tail = ''.join(buf).strip()
    if tail:
        tokens.append(tail)
    return tokens


def _token_core(tok: str) -> str:
    """Lower-case core name with parenthetical detail stripped.

    "AWS (Lambda/ECS/RDS/S3)" → "aws"
    "Spring Boot (Java)"      → "spring boot"
    """
    return re.sub(r'\s*\([^)]*\)\s*', ' ', tok).strip().lower()


# Build / test / lint / dev tooling — these are SUPPORTING tools, not core
# stack. Within a Skills category line, they should appear AFTER the
# stacks/frameworks/languages so the line reads "stacks first, tooling at end".
# A Frontend line should be "React, Vue, Angular, Webpack, Jest" — never
# "React, Vue, Webpack, Jest, Angular" with tools sandwiched between stacks.
TOOL_TOKENS: set[str] = {
    # Build / bundle
    "webpack", "vite", "rollup", "parcel", "babel", "esbuild", "swc", "snowpack",
    # Lint / format
    "eslint", "prettier", "stylelint", "tslint", "editorconfig",
    # Test runners / frameworks
    "jest", "mocha", "chai", "jasmine", "karma", "cypress", "selenium",
    "playwright", "puppeteer", "vitest", "enzyme", "react testing library", "rtl",
    "junit", "testng", "nunit", "xunit", "moq", "pytest", "unittest",
    "rspec", "phpunit", "googletest", "gtest",
    # Component / story
    "storybook", "chromatic",
    # Hooks / pre-commit
    "husky", "lint-staged", "commitlint",
    # Package mgmt
    "npm", "yarn", "pnpm", "bun",
    # Task runners / monorepo
    "gulp", "grunt", "lerna", "nx", "turborepo", "rush",
    # Build systems
    "maven", "gradle", "make", "cmake", "bazel", "ant", "msbuild",
    # API testing / docs
    "postman", "insomnia", "swagger ui",
}


def _is_tool_token(tok: str) -> bool:
    """Returns True if tok represents a build / test / dev support tool."""
    return _token_core(tok) in TOOL_TOKENS


def skills_preserve_tokens(old_text: str, new_text: str) -> str:
    """Merge AI's reordered/expanded Skills line with the original token set.

    Rules (applied in order):
      1. AI's token order is preserved — it reflects JD-priority reordering.
      2. JD-relevant skills the AI added are kept at the front.
      3. Tokens the AI dropped are appended at the end.
      4. If the AI stripped parenthetical detail
         (e.g. "AWS (Lambda/ECS/RDS/S3)" → "AWS"), the detail is restored.
      5. Duplicate tokens (same core name) are removed.

    Example:
      old: "AWS (Lambda/ECS/RDS/S3), Docker, Kubernetes"
      new: "Azure, AWS, GCP, Docker, Kubernetes, Azure"   (AI also duplicated)
      out: "Azure, AWS (Lambda/ECS/RDS/S3), GCP, Docker, Kubernetes"
    """
    # ── Split label / body for both inputs (label_guard runs first, so the
    #    label is usually already correct; we still tolerate either shape) ──
    label_match = re.match(r'^([^:]{2,40}):\s*', old_text)
    if not label_match:
        return new_text   # not a labeled skills line — leave it alone
    label = label_match.group(0)
    label_key = label_match.group(1).strip().lower()
    old_body = old_text[len(label):]

    new_label_match = re.match(r'^([^:]{2,40}):\s*', new_text)
    if new_label_match and new_label_match.group(1).strip().lower() == label_key:
        new_body = new_text[len(new_label_match.group(0)):]
    else:
        new_body = new_text  # no matching label — treat whole thing as body

    old_tokens = _split_skill_tokens(old_body)
    new_tokens = _split_skill_tokens(new_body)

    # Index original tokens by core name to look up parens detail later
    old_by_core: dict[str, str] = {_token_core(t): t for t in old_tokens}

    merged: list[str] = []
    seen_cores: set[str] = set()

    # Pass 1: walk AI's tokens (preserves JD-priority ordering)
    for nt in new_tokens:
        nt_core = _token_core(nt)
        if not nt_core or nt_core in seen_cores:
            continue   # empty or duplicate → drop
        seen_cores.add(nt_core)

        # If the original had richer parenthetical detail and AI stripped it,
        # restore the original form
        old_match = old_by_core.get(nt_core)
        if old_match:
            old_has_parens = '(' in old_match
            new_has_parens = '(' in nt
            if old_has_parens and not new_has_parens:
                merged.append(old_match)
                continue
        merged.append(nt)

    # Pass 2: append any original token the AI dropped entirely
    for ot in old_tokens:
        if _token_core(ot) not in seen_cores:
            merged.append(ot)
            seen_cores.add(_token_core(ot))

    # Pass 3: re-order so build / test / dev tools appear AFTER stacks within
    # the line. Relative order within each group is preserved so JD-priority
    # ordering survives. Fixes the failure pattern where AI emits something
    # like "React, Vue, Webpack, Jest, Angular" with tools wedged between stacks.
    stacks = [t for t in merged if not _is_tool_token(t)]
    tools  = [t for t in merged if     _is_tool_token(t)]

    return label + ", ".join(stacks + tools)


def apply_all(sections: Sections, modifications: list[Modification]) -> ApplyStats:
    """
    Apply the AI's modification list to the document.

    ★ Whitelist approach (fundamental safety guarantee) ★
    ───────────────────────────────────────────────────────────────
    Uses the paragraph ID set confirmed by parse_document() as a whitelist.
    Regardless of what IDs the AI returns, the code directly verifies
    whether each ID belongs to an editable section before allowing changes.

    Allowed sections: summary, experience, skills, education, other
    Blocked sections: header (name, contact, portfolio, etc. — all paragraphs
                      before the first section heading)

    → Header paragraphs are never touched no matter how the resume is formatted.
    ───────────────────────────────────────────────────────────────
    Additional protections:
      • Word Heading-style paragraphs (by Word style name)
      • Skills category label auto-restoration (original label recovered if AI deletes it)
    """
    id_map     = sections["id_map"]
    modifiable = sections.get("modifiable_ids", set())  # whitelist
    stats: ApplyStats = {"applied": 0, "skipped": 0, "blocked": 0}

    for mod in modifications:
        pid      = (mod.get("id") or "").strip()
        new_text = (mod.get("new_text") or "").strip()
        keywords = mod.get("keywords_added", [])

        if not pid or not new_text:
            stats["skipped"] += 1
            continue

        item = id_map.get(pid)
        if not item:
            log.warning(f"  ⚠️  {pid} — ID not found (skipping)")
            stats["skipped"] += 1
            continue

        old_text     = item["text"]
        item_section = item.get("section", "")

        # ══ Whitelist check ════════════════════════════════════════
        # Paragraphs not in modifiable_ids = header or section heading → blocked
        if pid not in modifiable:
            log.warning(f"  🚫 {pid} — blocked (not in whitelist) [{item_section}]: "
                        f"'{old_text[:45]}'")
            stats["blocked"] += 1
            continue

        # ══ Extra protection 1: Word Heading style ════════════════
        style_lower = item.get("style", "").lower()
        if any(s in style_lower for s in PROTECTED_STYLES):
            log.warning(f"  🔒 {pid} — Heading style protected: '{old_text[:40]}'")
            stats["blocked"] += 1
            continue

        # ══ Extra protection 2: Skills label + token preservation ═
        # First restore the category label if AI changed/dropped it,
        # then merge tokens so JD additions stay at the front while no
        # original skill or its parenthetical detail is lost.
        if "skill" in item_section:
            new_text = skills_label_guard(old_text, new_text)
            new_text = skills_preserve_tokens(old_text, new_text)

        # ══ No-change check ════════════════════════════════════════
        cleaned_new = clean_text(new_text)
        if clean_text(old_text) == cleaned_new:
            log.info(f"  ℹ️  {pid} — no change")
            stats["skipped"] += 1
            continue

        # ══ Apply modification ═════════════════════════════════════
        rewrite_para(item["para"], cleaned_new)
        item["text"] = cleaned_new

        log.info(f"  ✅ {pid} [{item_section}]")
        if keywords:
            log.info(f"     Keywords: {', '.join(str(k) for k in keywords)}")
        log.info(f"     Before: {old_text[:72]}{'…' if len(old_text) > 72 else ''}")
        log.info(f"     After:  {cleaned_new[:72]}{'…' if len(cleaned_new) > 72 else ''}")
        stats["applied"] += 1

    return stats


def verify_key_facts(modifications: list[Modification], key_facts: list[str]) -> list[str]:
    """
    Check whether key facts are preserved in AI output.
    Returns only the list of missing facts — never modifies text automatically.
    """
    if not key_facts:
        return []
    all_new_text = " ".join(m.get("new_text", "") for m in modifications).lower()
    missing = []
    for fact in key_facts:
        # Check whether the core number/word appears in the new text
        core = re.sub(r'[^\w+]', ' ', fact.lower()).strip()
        if core and core not in all_new_text:
            missing.append(fact)
    return missing

