"""End-to-end pipeline: parse → AI rewrite → apply → save."""
import logging
import re
from typing import cast

from .rtconfig import Document
from .ai_client import ai_call, parse_json
from .file_io import save_outputs
from .modifier import apply_all, verify_key_facts
from .parser import extract_key_facts, extract_summary_anchors, parse_document
from .prompts import SKILL_PATTERN, SYSTEM_PROMPT, USER_TEMPLATE
from .storage import add_history
from .types import (AIResponse, Modification, ParagraphItem,
                        SaveResult, StatusFn)


log = logging.getLogger(__name__)


def fmt_section(items: list[ParagraphItem]) -> str:
    return "\n".join(f"[{i['id']}] {i['text']}" for i in items) or "(none)"


def _extract_jd_skills(jd_text: str) -> list[str]:
    """Extract ATS skills from the JD using SKILL_PATTERN."""
    found = SKILL_PATTERN.findall(jd_text)
    # Normalize casing: preserve original capitalization, dedupe by lowercase key
    seen, result = set(), []
    for s in found:
        key = s.lower()
        if key not in seen:
            seen.add(key)
            result.append(s)
    return result


def _call_ai_and_parse(system_p: str, user_p: str, gkey: str, qkey: str,
                       ) -> tuple[AIResponse, str]:
    """AI call + JSON parsing + basic validation."""
    raw, api_used = ai_call(system_p, user_p, gkey, qkey)
    data = parse_json(raw)
    if not isinstance(data, dict) or not isinstance(data.get("modifications"), list):
        raise ValueError("AI response missing 'modifications' array")
    return cast(AIResponse, data), api_used


# ── Per-bullet domain classification for JD-weaving check ─────────────
# A frontend bullet that doesn't include any JD frontend tech (React, Next.js,
# etc.) is a critical failure even if other bullets are fine. Same for backend.
# This catches the failure mode where the AI weaves JD tech into older jobs but
# leaves the most recent job — what recruiters scan first — untouched.
_FRONTEND_BULLET_HINTS = re.compile(
    r'\b(front[-\s]?end|frontend|UI|user[-\s]interface|responsive|'
    r'component|dashboard)\b',
    re.IGNORECASE,
)
_BACKEND_BULLET_HINTS = re.compile(
    r'\b(back[-\s]?end|backend|API|microservice|REST(?:ful)?|endpoint|'
    r'GraphQL|webhook|web[-\s]?service)\b',
    re.IGNORECASE,
)
# Soft-skill bullets are exempt — never inject tech into mentoring/sprint/review.
_SOFT_BULLET_HINTS = re.compile(
    r'\b(mentor(?:ed|ing)?|sprint\s+plann?ing|code\s+review|'
    r'agile|scrum|stand[-\s]?up|estimation|architectural\s+review|'
    r'documentation|leadership)\b',
    re.IGNORECASE,
)
# JD tech grouped by typical resume domain
_JD_FRONTEND_TECH = {
    "react", "react.js", "next.js", "vue", "vue.js", "angular", "svelte",
    "nuxt", "nuxt.js", "react native", "redux", "mobx", "rxjs", "ngrx",
}
_JD_BACKEND_TECH = {
    "node.js", "express", "express.js", "nestjs", "django", "fastapi",
    "flask", "spring", "spring boot", ".net", ".net core", "c#", "asp.net",
    "asp.net core", "java", "go", "python", "ruby", "php", "rust",
    "kotlin", "scala",
}
# Infra/cloud tech satisfies a backend bullet whose action is cloud-deploy
# (e.g. "Integrated backend services with cloud infrastructure using AWS
# and Docker") — even if no language/framework is named, the JD's cloud
# stack appearing is enough to call that bullet covered.
_JD_INFRA_TECH = {
    "aws", "azure", "gcp", "docker", "kubernetes", "k8s",
    "terraform", "jenkins", "github actions", "gitlab ci", "circleci",
    "ci/cd", "ansible", "nginx",
}


# Tech-adjacent words that have no business in soft-skill bullets. These are
# the failure modes from real outputs where the AI keyword-stuffed sprint /
# mentoring bullets to satisfy density targets.
_SOFT_STUFFING_PATTERN = re.compile(
    r'\b(?:'
    r'AI[-\s]powered|AI[-\s]driven|AI/ML|machine\s+learning|LLMs?|'
    r'GitHub\s+Copilot|Copilot|automation\s+tools?|'
    r'React|Next\.?js|Vue|Angular|Node\.?js|Express|TypeScript|JavaScript|'
    r'Python|Java|Go(?:lang)?|\.NET|C#|Spring|FastAPI|Django|Flask|'
    r'Docker|Kubernetes|AWS|Azure|GCP|Terraform|Jenkins|'
    r'GraphQL|REST(?:ful)?|microservices?|'
    r'CI/CD|DevOps\s+practices?|cloud[-\s]native|'
    r'scalability|performance\s+optimization|modular\s+architecture'
    r')\b',
    re.IGNORECASE,
)


def _find_soft_stuffing(
    exp_mods: list[Modification],
) -> list[tuple[str, list[str]]]:
    """Detect soft-skill bullets (mentoring / sprint / code review) that have
    been keyword-stuffed with technologies, AI tools, or tech-adjacent buzzwords.

    Returns: list of (mod_id, stuffed_words) for offending bullets.
    """
    offenders: list[tuple[str, list[str]]] = []
    for m in exp_mods:
        text = m.get("new_text", "") or ""
        if not _SOFT_BULLET_HINTS.search(text):
            continue   # not a soft bullet — different rules apply
        stuffed = _SOFT_STUFFING_PATTERN.findall(text)
        if stuffed:
            # dedupe while preserving order
            seen, dedup = set(), []
            for s in stuffed:
                k = s.lower()
                if k not in seen:
                    seen.add(k)
                    dedup.append(s)
            offenders.append((m.get("id") or "?", dedup))
    return offenders


def _find_misweave_mods(
    exp_mods: list[Modification], jd_skills: list[str],
) -> list[tuple[str, str, list[str]]]:
    """For each Experience bullet, detect if it describes a frontend/backend
    domain action but contains no JD tech for that domain.

    Returns: list of (mod_id, domain, expected_jd_tech) for failing bullets.
    """
    jd_lower = {s.lower() for s in jd_skills}
    jd_fe = sorted(jd_lower & _JD_FRONTEND_TECH)
    jd_be = sorted(jd_lower & _JD_BACKEND_TECH)
    jd_infra = sorted(jd_lower & _JD_INFRA_TECH)

    misweave: list[tuple[str, str, list[str]]] = []
    for m in exp_mods:
        text = m.get("new_text", "") or ""
        if _SOFT_BULLET_HINTS.search(text):
            continue   # mentoring/sprint/review — exempt
        text_l = text.lower()
        is_fe = bool(_FRONTEND_BULLET_HINTS.search(text))
        is_be = bool(_BACKEND_BULLET_HINTS.search(text))
        # Frontend takes precedence — "frontend services with REST APIs" is
        # primarily a frontend bullet that happens to mention an API.
        if is_fe and jd_fe:
            present = any(
                re.search(rf'(?<!\w){re.escape(sk)}(?!\w)', text_l)
                for sk in jd_fe
            )
            if not present:
                misweave.append((m.get("id") or "?", "frontend", jd_fe))
                continue
        if is_be and (jd_be or jd_infra):
            # A backend bullet is OK if it mentions a JD backend language/
            # framework OR a JD cloud/infra tech (the bullet may be a
            # cloud-deploy bullet which doesn't need a language name).
            relevant = jd_be + jd_infra
            present = any(
                re.search(rf'(?<!\w){re.escape(sk)}(?!\w)', text_l)
                for sk in relevant
            )
            if not present and jd_be:
                # Surface jd_be in the message — what the AI should add is
                # a language/framework; infra was a fallback for satisfaction
                # but not for the prompt.
                misweave.append((m.get("id") or "?", "backend", jd_be))
    return misweave


def run_pipeline(resume_path: str, jd_text: str, gkey: str, qkey: str,
                 out_dir: str, want_docx: bool, want_pdf: bool,
                 status_fn: StatusFn,
                 ) -> tuple[SaveResult, str, int, int, list[str]]:

    # ─── Step 1: Parse document ───────────────────────────────────
    log.info("\n📂 Step 1: Parsing resume…")
    status_fn("Parsing resume…")
    doc       = Document(resume_path)
    sections  = parse_document(doc)
    all_items = sections["all"]

    log.info(f"  ✅ Total paragraphs: {len(all_items)}")
    log.info(f"     Summary:    {len(sections['summary'])}")
    log.info(f"     Experience: {len(sections['experience'])}")
    log.info(f"     Skills:     {len(sections['skills'])}")

    # Fallback if Summary not detected — search header + other zones for long paragraphs
    if not sections["summary"]:
        _cpat = re.compile(r'@|\bhttp|\blinkedin|\bwww\.|\+\d|\|\s*\d', re.I)
        candidates = [
            i for i in all_items[:10]
            if len(i["text"]) > 80
            and "heading" not in i.get("style", "").lower()
            and not _cpat.search(i["text"])
            and i["section"] in ("other", "header")
        ]
        if candidates:
            log.warning("  ⚠️  Summary heading not found → using long paragraph as summary fallback")
            # Make these paragraphs modifiable so apply_all won't block them
            sections["summary"] = candidates[:2]
            sections["modifiable_ids"] |= {i["id"] for i in candidates[:2]}
            sections["protected_ids"]  -= {i["id"] for i in candidates[:2]}

    # Fallback if Experience not detected — use entire 'other' section
    if not sections["experience"]:
        log.warning("  ⚠️  Experience not detected → using 'other' paragraphs as fallback")
        sections["experience"] = [i for i in all_items if i["section"] == "other"]

    # ─── Step 2: Extract key facts + JD skills ────────────────────
    log.info("\n🔍 Step 2: Extracting key facts + JD skills…")
    key_facts = extract_key_facts(sections)
    if key_facts:
        log.info(f"  ✅ Key facts to preserve: {', '.join(key_facts)}")
    else:
        log.info("  ℹ️  No special preservation targets found")

    required_skills = _extract_jd_skills(jd_text)
    if not required_skills:
        required_skills = ["relevant tech stack"]

    # Top skills to prioritize in Experience (up to 8)
    top_skills = ", ".join(required_skills[:8])
    log.info(f"  ✅ JD skills extracted ({len(required_skills)}): {', '.join(required_skills[:15])}")

    # Key facts display block (for USER_TEMPLATE)
    if key_facts:
        key_facts_block = "\n".join(f"• {f}" for f in key_facts)
    else:
        key_facts_block = "• (no special preservation targets)"

    # Protected header paragraph IDs (shown to AI as forbidden list)
    contact_ids = sections.get("protected_ids", sections.get("contact_ids", set()))
    contact_ids_str = ", ".join(sorted(contact_ids)) if contact_ids else "(none)"
    log.info(f"  🔒 Protected paragraphs (name / contact / header): {contact_ids_str}")
    log.info(f"  📋 Summary editable IDs: {[i['id'] for i in sections['summary']]}")

    # ─── Step 3: AI call ──────────────────────────────────────────
    log.info("\n🤖 Step 3: AI analysis and modification generation…")
    log.info("  → Single high-quality call with system/user separation")
    status_fn("AI analyzing…")

    user_content = USER_TEMPLATE.format(
        jd=jd_text,
        key_facts_block=key_facts_block,
        required_skills=", ".join(required_skills),
        top_skills=top_skills,
        contact_ids=contact_ids_str,
        summary_text=fmt_section(sections["summary"]),
        experience_text=fmt_section(sections["experience"]),
        skills_text=fmt_section(sections["skills"]),
        other_text=fmt_section(sections["other"][:8]),
    )

    data, api_used = _call_ai_and_parse(SYSTEM_PROMPT, user_content, gkey, qkey)

    before       = data.get("ats_score_before", 0)
    after        = data.get("ats_score_after",  0)
    mods         = data.get("modifications", [])
    skills_found = data.get("required_skills_found", required_skills[:6])
    tips         = data.get("ats_tips", [])

    log.info(f"\n  📊 Estimated ATS score: {before} → {after}")
    log.info(f"  📋 Planned modifications: {len(mods)} paragraphs")
    log.info(f"  🔑 Skills to apply: {', '.join(str(s) for s in skills_found[:10])}")

    # ─── Step 4: Verify Skills / Summary / Experience coverage + retry ─
    def _section_mods(mods_list: list[Modification], sec_name: str) -> list[Modification]:
        return [m for m in mods_list if sec_name in m.get("section", "").lower()]

    # Build modifiable-ID lists per section so retry messages can name the
    # exact paragraphs the AI skipped.
    skl_modifiable_ids = [
        i["id"] for i in sections["skills"]
        if i["id"] in sections["modifiable_ids"]
    ]
    exp_modifiable_ids = [
        i["id"] for i in sections["experience"]
        if i["id"] in sections["modifiable_ids"]
    ]
    skl_total = len(skl_modifiable_ids)
    exp_total = len(exp_modifiable_ids)
    # Coverage thresholds — Skills must be 100% (every category line touched);
    # Experience aims for ≥70% (or 6 minimum) to allow some judgment calls.
    exp_threshold = max(6, int(exp_total * 0.7)) if exp_total else 0

    skl_mods = _section_mods(mods, "skill")     # matches "Skills"
    sum_mods = _section_mods(mods, "summary")
    exp_mods = _section_mods(mods, "experience")

    # Summary length check: count sentence-ending punctuation, must be ≥ 3.
    # We treat ., !, ? followed by whitespace or end-of-string as a sentence
    # boundary. This catches AI returning a 1- or 2-sentence Summary, which
    # is a common failure mode that needs to trigger a retry.
    sum_text_joined = " ".join(m.get("new_text", "") for m in sum_mods).strip()
    sum_sentence_count = len(re.findall(r'[.!?](?=\s|$)', sum_text_joined))

    # Experience JD-coverage check: the bullet count alone doesn't catch the
    # failure mode where the AI lightly polished every bullet but failed to
    # weave the JD's required tech into ANY of them. Without this, a Go-heavy
    # candidate applying for a React/Node.js role would get back a Go-heavy
    # output that ignores the JD's stack — exactly the failure the user reported.
    exp_text_combined = " ".join(m.get("new_text", "") for m in exp_mods)
    top_jd_for_exp = required_skills[:6]
    exp_jd_present: list[str] = []
    exp_jd_missing: list[str] = []
    for sk in top_jd_for_exp:
        sk_pat = re.compile(rf'(?<!\w){re.escape(sk)}(?!\w)', re.IGNORECASE)
        if sk_pat.search(exp_text_combined):
            exp_jd_present.append(sk)
        else:
            exp_jd_missing.append(sk)
    # Need majority of top-6 (≥3 of 6, ≥4 of 7, etc.); if JD has <3 distinct
    # top skills the check is disabled — too small a sample to be meaningful.
    exp_jd_threshold = (len(top_jd_for_exp) + 1) // 2
    exp_jd_insufficient = (
        len(top_jd_for_exp) >= 3
        and len(exp_jd_present) < exp_jd_threshold
    )

    # Per-bullet domain check: find frontend/backend bullets that don't include
    # any JD tech for their domain. Catches uneven JD weaving — e.g. AI weaves
    # tech into older jobs but leaves the most recent job (what recruiters
    # scan first) with zero JD tech.
    misweave_mods = _find_misweave_mods(exp_mods, required_skills)
    exp_misweave = len(misweave_mods) >= 1

    # Soft-skill bullet stuffing: mentoring / sprint / agile / code-review
    # bullets that contain tech keywords, AI tools, or tech-adjacent buzzwords.
    # A senior reviewer spots this instantly as keyword stuffing.
    soft_stuffed = _find_soft_stuffing(exp_mods)
    exp_soft_stuffed = len(soft_stuffed) >= 1

    missing_secs = []
    if skl_total > 0 and len(skl_mods) < skl_total:
        missing_secs.append("Skills")
    if not sum_mods or sum_sentence_count < 3:
        missing_secs.append("Summary")
    if exp_total > 0 and (
        len(exp_mods) < exp_threshold
        or exp_jd_insufficient
        or exp_misweave
        or exp_soft_stuffed
    ):
        missing_secs.append("Experience")

    if missing_secs:
        cov = []
        if "Skills" in missing_secs:
            cov.append(f"Skills {len(skl_mods)}/{skl_total}")
        if "Summary" in missing_secs:
            if not sum_mods:
                cov.append("Summary 0")
            else:
                cov.append(f"Summary {sum_sentence_count} sentences (need ≥3)")
        if "Experience" in missing_secs:
            exp_parts = []
            if len(exp_mods) < exp_threshold:
                exp_parts.append(f"{len(exp_mods)}/{exp_total} bullets (need ≥{exp_threshold})")
            if exp_jd_insufficient:
                exp_parts.append(
                    f"{len(exp_jd_present)}/{len(top_jd_for_exp)} JD-skills woven in "
                    f"(need ≥{exp_jd_threshold})"
                )
            if exp_misweave:
                exp_parts.append(
                    f"{len(misweave_mods)} domain-misweave bullets "
                    f"(frontend/backend bullet without JD tech)"
                )
            if exp_soft_stuffed:
                exp_parts.append(
                    f"{len(soft_stuffed)} soft-bullet keyword stuffing"
                )
            cov.append("Experience " + " · ".join(exp_parts))
        log.warning(f"\n⚠️  Step 4: insufficient coverage [{', '.join(cov)}] → retrying…")
        status_fn(f"Re-analyzing {'/'.join(missing_secs)}…")

        # Build precise lists of UNTOUCHED IDs per section so the AI knows
        # exactly which paragraphs to rewrite — including the original text
        # so the AI doesn't have to re-read [SKILLS] / [EXPERIENCE] context.
        skl_rewritten = {m.get("id") for m in skl_mods if m.get("id")}
        skl_untouched = [pid for pid in skl_modifiable_ids if pid not in skl_rewritten]
        exp_rewritten = {m.get("id") for m in exp_mods if m.get("id")}
        exp_untouched = [pid for pid in exp_modifiable_ids if pid not in exp_rewritten]

        id_map = sections["id_map"]

        def _id_block(label: str, ids: list[str]) -> str:
            if not ids:
                return ""
            lines = [f"  [{pid}] {id_map[pid]['text']}" for pid in ids if pid in id_map]
            return f"UNTOUCHED {label} IDs ({len(ids)}) — rewrite ALL:\n" + "\n".join(lines) + "\n\n"

        untouched_block = _id_block("Skills", skl_untouched) + _id_block("Experience", exp_untouched)

        retry_directives = []
        if "Skills" in missing_secs:
            retry_directives.append(
                f"For Skills: you only rewrote {len(skl_mods)} of {skl_total} category lines. "
                f"Rewrite EVERY remaining Skills line above. For each, read the JD again and "
                f"add the relevant JD-required skills (.NET, C#, Angular, React, cloud platforms, "
                f"AI/LLM tools — whatever the JD asks for) to the FRONT of the category, while "
                f"keeping every original token and parenthetical detail. JD skills you flagged "
                f"earlier as required: {', '.join(skills_found[:12])}"
            )
        if "Summary" in missing_secs:
            length_note = (
                f"Your previous Summary had {sum_sentence_count} sentences — it MUST have at "
                f"least 3 complete sentences ending in periods. "
                if sum_mods else ""
            )
            retry_directives.append(
                f"For Summary: {length_note}Fully rewrite [SUMMARY] from scratch to target "
                f"the JD — new sentences, not minor edits. Preserve key facts verbatim AND "
                f"keep the candidate's distinctive context (industries, compliance, geographies). "
                f"Output MUST be 3-4 distinct sentences, each ending in a period: "
                f"sentence 1 = role positioning, sentence 2 = stack + domain, "
                f"sentence 3+ = outcomes / metrics / differentiators."
            )
        if "Experience" in missing_secs:
            exp_dir_parts = []
            if len(exp_mods) < exp_threshold:
                exp_dir_parts.append(
                    f"You covered only {len(exp_mods)} of {exp_total} modifiable bullets. "
                    f"Rewrite EVERY untouched bullet listed above. Each rewrite must lead "
                    f"with the most JD-relevant aspect."
                )
            if exp_jd_insufficient:
                woven = ", ".join(exp_jd_present) if exp_jd_present else "none"
                exp_dir_parts.append(
                    f"Your Experience text mentions only these JD skills: {woven}. "
                    f"It is MISSING these JD skills entirely: {', '.join(exp_jd_missing)}. "
                    f"This is the program's main failure mode — the hiring filter searches "
                    f"Experience for JD keywords, so missing keywords means the resume fails "
                    f"the screen. For each missing skill, find a bullet whose ACTION DOMAIN "
                    f"is compatible (backend API → Node.js / Express / FastAPI / Spring; "
                    f"frontend UI → React / Next.js / Vue / Angular; data pipeline → "
                    f"Python / Pandas / Spark; cloud → AWS / Azure / GCP / Docker / "
                    f"Kubernetes) and weave the JD skill into that bullet naturally. "
                    f"Keep the candidate's original tech in place — JD skills are ADDED, "
                    f"never substituted. Do NOT inject JD tech into mentoring / sprint / "
                    f"code-review bullets — those stay tech-free."
                )
            if exp_misweave:
                misweave_lines = []
                for mid, dom, jd_tech in misweave_mods:
                    new_text = next(
                        (m.get("new_text", "") for m in exp_mods if m.get("id") == mid),
                        ""
                    )
                    misweave_lines.append(
                        f"  • [{mid}] ({dom}-domain bullet — JD tech for this domain: "
                        f"{', '.join(jd_tech[:5])}):\n"
                        f"      Your rewrite: {new_text[:160]}"
                    )
                exp_dir_parts.append(
                    f"DOMAIN MISWEAVE — these {len(misweave_mods)} bullets describe "
                    f"frontend/backend tasks but the JD tech is NOT the primary named "
                    f"stack. Even one frontend bullet without React/Next.js as the "
                    f"primary tool makes the recruiter conclude the candidate doesn't "
                    f"have the JD's frontend stack. This MUST be fixed by RECONSTRUCTING "
                    f"each bullet (not just appending JD tech to the end):\n"
                    + "\n".join(misweave_lines)
                    + "\nRECONSTRUCTION RULES:\n"
                      "  • Use PATTERN A (REPLACE): swap original tech for JD tech\n"
                      "      'using Go (Golang)' → 'in Node.js and Python'\n"
                      "  • Or PATTERN B (DEMOTE): JD tech leads, original moves to "
                      "secondary clause\n"
                      "      'using Vue.js and Angular' → 'in React and Next.js, "
                      "with Vue components for legacy modules'\n"
                      "  • Or PATTERN C (INSERT): originally generic bullet — JD tech "
                      "becomes the named tooling\n"
                      "      'RESTful APIs and microservices, reducing latency 25%' "
                      "→ 'RESTful APIs and microservices in Node.js and Express, "
                      "reducing latency 25%'\n"
                      "  • FORBIDDEN: 'using Go and Node.js' (additive — Go still "
                      "primary), or listing 4+ technologies in one bullet.\n"
                      "  • The recruiter scans the FIRST tech named — that must be "
                      "the JD tech. The most recent job especially must have JD tech "
                      "leading every technical bullet."
                )
            if exp_soft_stuffed:
                stuff_lines = []
                for mid, words in soft_stuffed:
                    new_text = next(
                        (m.get("new_text", "") for m in exp_mods if m.get("id") == mid),
                        ""
                    )
                    stuff_lines.append(
                        f"  • [{mid}] stuffed words: {', '.join(words[:6])}\n"
                        f"      Your rewrite: {new_text[:160]}"
                    )
                exp_dir_parts.append(
                    f"SOFT-BULLET KEYWORD STUFFING — these "
                    f"{len(soft_stuffed)} bullets describe soft-skill activities "
                    f"(mentoring / sprint planning / agile / code review / "
                    f"leadership) but contain technology references, AI tools, or "
                    f"tech-adjacent buzzwords. This is the most obvious form of "
                    f"keyword stuffing and a senior reviewer spots it instantly:\n"
                    + "\n".join(stuff_lines)
                    + "\nFor each bullet above, REMOVE every tech keyword, AI / LLM "
                      "tool reference, and tech-adjacent buzzword (scalability, "
                      "performance optimization, modular architecture, microservices, "
                      "CI/CD, cloud-native). Soft bullets must read as pure process / "
                      "leadership work with NO technology mentioned. The bullets exist "
                      "to balance the resume — leave them tech-free."
                )
            retry_directives.append("For Experience: " + " ".join(exp_dir_parts))

        retry_user = (
            f"CRITICAL ERROR: Your previous response was incomplete.\n\n"
            f"{untouched_block}"
            + "\n\n".join(retry_directives) + "\n\n"
            f"Now generate the complete correct response, including modifications "
            f"for ALL of the IDs above. Skills modifications MUST come first in the array.\n\n"
            + user_content
        )
        try:
            data2, api_used2 = _call_ai_and_parse(SYSTEM_PROMPT, retry_user, gkey, qkey)
            mods2 = data2.get("modifications", [])
            skl_mods2 = _section_mods(mods2, "skill")
            sum_mods2 = _section_mods(mods2, "summary")
            exp_mods2 = _section_mods(mods2, "experience")

            # Accept retry if it improves any axis we asked about. For Summary,
            # "better" means more mods OR same mods but the new Summary has the
            # required ≥3 sentences (length was the failure mode). For
            # Experience, accept improvement on any of: mod count, global JD
            # coverage, OR domain misweave count.
            sum_text2 = " ".join(m.get("new_text", "") for m in sum_mods2).strip()
            sum_count2 = len(re.findall(r'[.!?](?=\s|$)', sum_text2))
            exp_text2 = " ".join(m.get("new_text", "") for m in exp_mods2)
            exp_jd_present2 = [
                sk for sk in top_jd_for_exp
                if re.compile(rf'(?<!\w){re.escape(sk)}(?!\w)', re.IGNORECASE).search(exp_text2)
            ]
            misweave_mods2 = _find_misweave_mods(exp_mods2, required_skills)
            soft_stuffed2 = _find_soft_stuffing(exp_mods2)
            skl_better = "Skills"     in missing_secs and len(skl_mods2) > len(skl_mods)
            sum_better = "Summary"    in missing_secs and (
                len(sum_mods2) > len(sum_mods) or sum_count2 >= 3
            )
            exp_better = "Experience" in missing_secs and (
                len(exp_mods2) > len(exp_mods)
                or len(exp_jd_present2) > len(exp_jd_present)
                or len(misweave_mods2) < len(misweave_mods)
                or len(soft_stuffed2) < len(soft_stuffed)
            )
            if skl_better or sum_better or exp_better:
                log.info(f"  ✅ Retry succeeded — Skills:{len(skl_mods2)}/{skl_total} / "
                         f"Summary:{len(sum_mods2)} / Experience:{len(exp_mods2)}/{exp_total}")
                mods         = mods2
                api_used     = api_used2
                before       = data2.get("ats_score_before", before)
                after        = data2.get("ats_score_after",  after)
                skills_found = data2.get("required_skills_found", skills_found)
                tips         = data2.get("ats_tips", tips)
                skl_mods     = skl_mods2
                sum_mods     = sum_mods2
                exp_mods     = exp_mods2
            else:
                log.warning("  ⚠️  Retry didn't improve coverage — using original result")
        except Exception as e:
            log.warning(f"  ⚠️  Retry failed: {e}")
    else:
        log.info(f"\n🔎 Step 4: Skills:{len(skl_mods)}/{skl_total} / "
                 f"Summary:{len(sum_mods)} / Experience:{len(exp_mods)}/{exp_total} "
                 f"(JD-skills woven: {len(exp_jd_present)}/{len(top_jd_for_exp)}) "
                 f"— OK ✅")

    # ─── Step 5: Key fact + Summary anchor preservation (warn only) ─
    log.info("\n🔎 Step 5: Checking key fact preservation…")
    lost = verify_key_facts(mods, key_facts)
    if lost:
        log.warning(f"  ⚠️  Missing from output: {', '.join(lost)}")
        log.warning("     → AI was instructed to preserve these but omitted them. Please review and fix manually.")
    else:
        log.info("  ✅ All key facts preserved")

    # Distinctive Summary context (industries / compliance / geography) —
    # these tend to get washed out into generic filler. Warn if dropped.
    summary_old_text = " ".join(i["text"] for i in sections["summary"])
    summary_new_text = " ".join(m.get("new_text", "") for m in sum_mods).lower()
    if summary_old_text and summary_new_text:
        anchors = extract_summary_anchors(summary_old_text)
        if anchors:
            lost_anchors = [a for a in anchors if a.lower() not in summary_new_text]
            if lost_anchors:
                log.warning(f"  ⚠️  Summary lost distinctive context: {', '.join(lost_anchors)}")
                log.warning("     → Consider re-running or manually re-adding these terms")
            else:
                log.info(f"  ✅ Summary distinctive context preserved ({len(anchors)} anchors)")

    # ─── Step 6: Apply modifications ─────────────────────────────
    log.info("\n✏️  Step 6: Applying modifications (formatting fully preserved)…")
    status_fn("Applying modifications…")
    stats = apply_all(sections, mods)
    log.info(f"\n  📌 {stats['applied']} applied / "
             f"{stats['skipped']} skipped / "
             f"{stats['blocked']} blocked (header protection)")

    # Section-level modification summary
    sec_count: dict[str, int] = {}
    for m in mods:
        s = m.get("section", "?")
        sec_count[s] = sec_count.get(s, 0) + 1
    log.info("  📋 By section: " + " | ".join(f"{k}: {v}" for k, v in sec_count.items()))

    # ─── Step 7: Save ─────────────────────────────────────────────
    log.info("\n💾 Step 7: Saving files…")
    status_fn("Saving…")
    saved = save_outputs(doc, resume_path, out_dir, want_docx, want_pdf)

    add_history(skills_found[:6], api_used, resume_path, int(before), int(after))

    # Final report
    log.info("\n" + "═" * 60)
    if tips:
        log.info("💡 ATS Optimization Tips:")
        for i, t in enumerate(tips, 1):
            log.info(f"  {i}. {t}")

    return saved, api_used, before, after, skills_found

