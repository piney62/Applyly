"""End-to-end pipeline: parse â†’ AI rewrite â†’ apply â†’ save."""
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


def run_pipeline(resume_path: str, jd_text: str, gkey: str, qkey: str,
                 out_dir: str, want_docx: bool, want_pdf: bool,
                 status_fn: StatusFn,
                 ) -> tuple[SaveResult, str, int, int, list[str]]:

    # â”€â”€â”€ Step 1: Parse document â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info("\nðŸ“‚ Step 1: Parsing resumeâ€¦")
    status_fn("Parsing resumeâ€¦")
    doc       = Document(resume_path)
    sections  = parse_document(doc)
    all_items = sections["all"]

    log.info(f"  âœ… Total paragraphs: {len(all_items)}")
    log.info(f"     Summary:    {len(sections['summary'])}")
    log.info(f"     Experience: {len(sections['experience'])}")
    log.info(f"     Skills:     {len(sections['skills'])}")

    # Fallback if Summary not detected â€” search header + other zones for long paragraphs
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
            log.warning("  âš ï¸  Summary heading not found â†’ using long paragraph as summary fallback")
            # Make these paragraphs modifiable so apply_all won't block them
            sections["summary"] = candidates[:2]
            sections["modifiable_ids"] |= {i["id"] for i in candidates[:2]}
            sections["protected_ids"]  -= {i["id"] for i in candidates[:2]}

    # Fallback if Experience not detected â€” use entire 'other' section
    if not sections["experience"]:
        log.warning("  âš ï¸  Experience not detected â†’ using 'other' paragraphs as fallback")
        sections["experience"] = [i for i in all_items if i["section"] == "other"]

    # â”€â”€â”€ Step 2: Extract key facts + JD skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info("\nðŸ” Step 2: Extracting key facts + JD skillsâ€¦")
    key_facts = extract_key_facts(sections)
    if key_facts:
        log.info(f"  âœ… Key facts to preserve: {', '.join(key_facts)}")
    else:
        log.info("  â„¹ï¸  No special preservation targets found")

    required_skills = _extract_jd_skills(jd_text)
    if not required_skills:
        required_skills = ["relevant tech stack"]

    # Top skills to prioritize in Experience (up to 8)
    top_skills = ", ".join(required_skills[:8])
    log.info(f"  âœ… JD skills extracted ({len(required_skills)}): {', '.join(required_skills[:15])}")

    # Key facts display block (for USER_TEMPLATE)
    if key_facts:
        key_facts_block = "\n".join(f"â€¢ {f}" for f in key_facts)
    else:
        key_facts_block = "â€¢ (no special preservation targets)"

    # Protected header paragraph IDs (shown to AI as forbidden list)
    contact_ids = sections.get("protected_ids", sections.get("contact_ids", set()))
    contact_ids_str = ", ".join(sorted(contact_ids)) if contact_ids else "(none)"
    log.info(f"  ðŸ”’ Protected paragraphs (name / contact / header): {contact_ids_str}")
    log.info(f"  ðŸ“‹ Summary editable IDs: {[i['id'] for i in sections['summary']]}")

    # â”€â”€â”€ Step 3: AI call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info("\nðŸ¤– Step 3: AI analysis and modification generationâ€¦")
    log.info("  â†’ Single high-quality call with system/user separation")
    status_fn("AI analyzingâ€¦")

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

    log.info(f"\n  ðŸ“Š Estimated ATS score: {before} â†’ {after}")
    log.info(f"  ðŸ“‹ Planned modifications: {len(mods)} paragraphs")
    log.info(f"  ðŸ”‘ Skills to apply: {', '.join(str(s) for s in skills_found[:10])}")

    # â”€â”€â”€ Step 4: Verify Skills / Summary / Experience coverage + retry â”€
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
    # Coverage thresholds â€” Skills must be 100% (every category line touched);
    # Experience aims for â‰¥70% (or 6 minimum) to allow some judgment calls.
    exp_threshold = max(6, int(exp_total * 0.7)) if exp_total else 0

    skl_mods = _section_mods(mods, "skill")     # matches "Skills"
    sum_mods = _section_mods(mods, "summary")
    exp_mods = _section_mods(mods, "experience")

    # Summary length check: count sentence-ending punctuation, must be â‰¥ 3.
    # We treat ., !, ? followed by whitespace or end-of-string as a sentence
    # boundary. This catches AI returning a 1- or 2-sentence Summary, which
    # is a common failure mode that needs to trigger a retry.
    sum_text_joined = " ".join(m.get("new_text", "") for m in sum_mods).strip()
    sum_sentence_count = len(re.findall(r'[.!?](?=\s|$)', sum_text_joined))

    missing_secs = []
    if skl_total > 0 and len(skl_mods) < skl_total:
        missing_secs.append("Skills")
    if not sum_mods or sum_sentence_count < 3:
        missing_secs.append("Summary")
    if exp_total > 0 and len(exp_mods) < exp_threshold:
        missing_secs.append("Experience")

    if missing_secs:
        cov = []
        if "Skills" in missing_secs:
            cov.append(f"Skills {len(skl_mods)}/{skl_total}")
        if "Summary" in missing_secs:
            if not sum_mods:
                cov.append("Summary 0")
            else:
                cov.append(f"Summary {sum_sentence_count} sentences (need â‰¥3)")
        if "Experience" in missing_secs:
            cov.append(f"Experience {len(exp_mods)}/{exp_total} (need â‰¥{exp_threshold})")
        log.warning(f"\nâš ï¸  Step 4: insufficient coverage [{', '.join(cov)}] â†’ retryingâ€¦")
        status_fn(f"Re-analyzing {'/'.join(missing_secs)}â€¦")

        # Build precise lists of UNTOUCHED IDs per section so the AI knows
        # exactly which paragraphs to rewrite â€” including the original text
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
            return f"UNTOUCHED {label} IDs ({len(ids)}) â€” rewrite ALL:\n" + "\n".join(lines) + "\n\n"

        untouched_block = _id_block("Skills", skl_untouched) + _id_block("Experience", exp_untouched)

        retry_directives = []
        if "Skills" in missing_secs:
            retry_directives.append(
                f"For Skills: you only rewrote {len(skl_mods)} of {skl_total} category lines. "
                f"Rewrite EVERY remaining Skills line above. For each, read the JD again and "
                f"add the relevant JD-required skills (.NET, C#, Angular, React, cloud platforms, "
                f"AI/LLM tools â€” whatever the JD asks for) to the FRONT of the category, while "
                f"keeping every original token and parenthetical detail. JD skills you flagged "
                f"earlier as required: {', '.join(skills_found[:12])}"
            )
        if "Summary" in missing_secs:
            length_note = (
                f"Your previous Summary had {sum_sentence_count} sentences â€” it MUST have at "
                f"least 3 complete sentences ending in periods. "
                if sum_mods else ""
            )
            retry_directives.append(
                f"For Summary: {length_note}Fully rewrite [SUMMARY] from scratch to target "
                f"the JD â€” new sentences, not minor edits. Preserve key facts verbatim AND "
                f"keep the candidate's distinctive context (industries, compliance, geographies). "
                f"Output MUST be 3-4 distinct sentences, each ending in a period: "
                f"sentence 1 = role positioning, sentence 2 = stack + domain, "
                f"sentence 3+ = outcomes / metrics / differentiators."
            )
        if "Experience" in missing_secs:
            retry_directives.append(
                f"For Experience: you covered only {len(exp_mods)} of {exp_total} modifiable bullets. "
                f"Rewrite EVERY untouched bullet listed above. Each rewrite must lead with the "
                f"most JD-relevant aspect."
            )

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
            # required â‰¥3 sentences (length was the failure mode).
            sum_text2 = " ".join(m.get("new_text", "") for m in sum_mods2).strip()
            sum_count2 = len(re.findall(r'[.!?](?=\s|$)', sum_text2))
            skl_better = "Skills"     in missing_secs and len(skl_mods2) > len(skl_mods)
            sum_better = "Summary"    in missing_secs and (
                len(sum_mods2) > len(sum_mods) or sum_count2 >= 3
            )
            exp_better = "Experience" in missing_secs and len(exp_mods2) > len(exp_mods)
            if skl_better or sum_better or exp_better:
                log.info(f"  âœ… Retry succeeded â€” Skills:{len(skl_mods2)}/{skl_total} / "
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
                log.warning("  âš ï¸  Retry didn't improve coverage â€” using original result")
        except Exception as e:
            log.warning(f"  âš ï¸  Retry failed: {e}")
    else:
        log.info(f"\nðŸ”Ž Step 4: Skills:{len(skl_mods)}/{skl_total} / "
                 f"Summary:{len(sum_mods)} / Experience:{len(exp_mods)}/{exp_total} â€” OK âœ…")

    # â”€â”€â”€ Step 5: Key fact + Summary anchor preservation (warn only) â”€
    log.info("\nðŸ”Ž Step 5: Checking key fact preservationâ€¦")
    lost = verify_key_facts(mods, key_facts)
    if lost:
        log.warning(f"  âš ï¸  Missing from output: {', '.join(lost)}")
        log.warning("     â†’ AI was instructed to preserve these but omitted them. Please review and fix manually.")
    else:
        log.info("  âœ… All key facts preserved")

    # Distinctive Summary context (industries / compliance / geography) â€”
    # these tend to get washed out into generic filler. Warn if dropped.
    summary_old_text = " ".join(i["text"] for i in sections["summary"])
    summary_new_text = " ".join(m.get("new_text", "") for m in sum_mods).lower()
    if summary_old_text and summary_new_text:
        anchors = extract_summary_anchors(summary_old_text)
        if anchors:
            lost_anchors = [a for a in anchors if a.lower() not in summary_new_text]
            if lost_anchors:
                log.warning(f"  âš ï¸  Summary lost distinctive context: {', '.join(lost_anchors)}")
                log.warning("     â†’ Consider re-running or manually re-adding these terms")
            else:
                log.info(f"  âœ… Summary distinctive context preserved ({len(anchors)} anchors)")

    # â”€â”€â”€ Step 6: Apply modifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info("\nâœï¸  Step 6: Applying modifications (formatting fully preserved)â€¦")
    status_fn("Applying modificationsâ€¦")
    stats = apply_all(sections, mods)
    log.info(f"\n  ðŸ“Œ {stats['applied']} applied / "
             f"{stats['skipped']} skipped / "
             f"{stats['blocked']} blocked (header protection)")

    # Section-level modification summary
    sec_count: dict[str, int] = {}
    for m in mods:
        s = m.get("section", "?")
        sec_count[s] = sec_count.get(s, 0) + 1
    log.info("  ðŸ“‹ By section: " + " | ".join(f"{k}: {v}" for k, v in sec_count.items()))

    # â”€â”€â”€ Step 7: Save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log.info("\nðŸ’¾ Step 7: Saving filesâ€¦")
    status_fn("Savingâ€¦")
    saved = save_outputs(doc, resume_path, out_dir, want_docx, want_pdf)

    add_history(skills_found[:6], api_used, resume_path, int(before), int(after))

    # Final report
    log.info("\n" + "â•" * 60)
    if tips:
        log.info("ðŸ’¡ ATS Optimization Tips:")
        for i, t in enumerate(tips, 1):
            log.info(f"  {i}. {t}")

    return saved, api_used, before, after, skills_found

