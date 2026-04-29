"""Document parsing â€” section classification + key fact extraction."""
import re
from typing import Any

from .types import ParagraphItem, Sections


# Order matters! classify_section() returns the FIRST matching section, so
# specific multi-word section names (certifications, projects, publications,
# awards) are checked before broader ones whose keys contain generic words
# like "professional" or "experience". Without this, "Professional
# Certifications" would be misclassified as experience because experience's
# "professional" key matches as a substring.
SECTION_KEYS: dict[str, list[str]] = {
    "certifications": ["certification", "certificate", "licenses",
                       "credentials"],
    "projects":       ["projects", "selected projects", "key projects",
                       "personal projects", "side projects",
                       "project experience", "notable projects"],
    "publications":   ["publications", "papers", "research",
                       "articles", "presentations"],
    "awards":         ["awards", "honors", "honours", "recognition",
                       "achievements", "accolades"],
    "summary":        ["summary", "objective", "profile", "about", "overview",
                       "executive summary", "professional summary",
                       "ìš”ì•½", "ëª©ì ", "ì†Œê°œ", "í”„ë¡œí•„", "ê°œìš”"],
    "education":      ["education", "academic", "degree", "university",
                       "í•™ë ¥", "êµìœ¡"],
    "skills":         ["skill", "technical", "competenc", "technolog", "expertise",
                       "tools", "languages",
                       "core competencies", "technical skills",
                       "ê¸°ìˆ ", "ìŠ¤í‚¬", "ì—­ëŸ‰"],
    "experience":     ["experience", "work experience", "employment",
                       "professional", "career", "work history",
                       "career history", "employment history",
                       "ê²½í—˜", "ê²½ë ¥", "ì§ë¬´", "ì§ìž¥"],
}

# â”€â”€ Structural line detection within Experience/Education â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Matches typical date / period markers used on resumes:
#   â€¢ English month names (Jan, January, â€¦)
#   â€¢ 4-digit years (1999, 2024, â€¦)
#   â€¢ Numeric short forms: "01/2023", "1/2023", "2023-01", "2023.01"
#   â€¢ Quarter / season labels: "Q1 2023", "Spring 2023"
#   â€¢ "Present" / "Current" / "Now" â€” used as a period endpoint
_DATE_PAT = re.compile(
    r'\b(?:'
    # English month names (full or abbreviated)
    r'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
    r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
    r'|'
    # Bare 4-digit year (1900-2099)
    r'19\d{2}|20\d{2}'
    r'|'
    # Numeric date pieces:  M/YYYY, MM/YYYY, YYYY-MM, YYYY.MM
    r'\d{1,2}/(?:19|20)\d{2}|(?:19|20)\d{2}[.\-/]\d{1,2}'
    r'|'
    # Quarter labels: Q1/Q2/Q3/Q4 [year]
    r'Q[1-4](?:\s*(?:19|20)\d{2})?'
    r'|'
    # Season labels: Spring/Summer/Fall/Autumn/Winter [year]
    r'(?:Spring|Summer|Fall|Autumn|Winter)(?:\s*(?:19|20)\d{2})?'
    r'|'
    # Open-ended period endpoints
    r'Present|Current|Now|Today|Ongoing'
    r')\b',
    re.IGNORECASE,
)

# Contact-info line detector: email, URL, phone, pipe-separated digits
_CONTACT_PAT = re.compile(r'@|\bhttp|\blinkedin|\bwww\.|\+\d|\|\s*\d', re.I)

# Characters that, when they appear at the very start of a paragraph, mark it
# as a manually-typed bullet (the user typed "â€¢ Built â€¦" rather than using a
# list style). These paragraphs are content, never structural â€” even if short.
_BULLET_PREFIXES = ('â€¢', 'â–ª', 'â€£', 'â—', 'â—‹', 'â—¦', 'â–¸', 'â–º', 'â–¶', 'âˆ™', 'âƒ', 'â€“Â·')

# Word/Office paragraph styles that mark a paragraph as a list/bullet item.
# Matched as substrings (case-insensitive). Anything in this set is content.
_LIST_STYLE_HINTS = ('list', 'bullet', 'indent')


def _is_bullet_line(text: str, style: str) -> bool:
    """A paragraph is a bullet (= modifiable content) if either:
      - it starts with a known bullet glyph, or
      - its Word style name contains list/bullet/indent.
    """
    if text.lstrip().startswith(_BULLET_PREFIXES):
        return True
    style_lower = style.lower()
    return any(h in style_lower for h in _LIST_STYLE_HINTS)


def _is_structural_exp_line(text: str, style: str) -> bool:
    """
    Return True for structural lines inside body sections that MUST NOT be
    rewritten: company names, job titles, date ranges, locations, paper
    citations, certification titles.

    Detection rules (in order):
      â€¢ Bullet paragraph (â€¢ prefix or list style)        â†’  modifiable
      â€¢ Length > 120 chars                               â†’  body content
      â€¢ Pipe-separated metadata, â‰¤ 80 chars              â†’  protect
        (e.g. "Home Depot | Atlanta, GA | Remote",
              "Software Solutions Inc., San Francisco, CA | Hybrid Remote")
      â€¢ Contains a date/period marker:
          - Short (â‰¤ 60 chars)            â†’ metadata row â†’ protect
          - No sentence-final punctuation â†’ metadata row â†’ protect
          - Otherwise (long sentence ending in . ? !) â†’ content
      â€¢ Contains em-dash / spaced hyphen                 â†’  protect
      â€¢ Very short (â‰¤ 50 chars) line                     â†’  protect

    The pipe rule has a higher length cap because company-location-mode
    metadata can run long with full company names + city/state + work mode.
    """
    t = text.strip()
    if len(t) > 120:
        return False
    if _is_bullet_line(t, style):
        return False
    # Pipe-separated metadata row â€” almost always company/location/mode.
    # Higher length cap (80) accommodates full company names like
    # "Software Solutions Inc., San Francisco, CA | Hybrid".
    if "|" in t and len(t) <= 80:
        return True
    if _DATE_PAT.search(t):
        # Date present â€” distinguish metadata rows from content sentences:
        # metadata is short OR doesn't end with sentence punctuation.
        if len(t) <= 60:
            return True
        if not t.rstrip().endswith(('.', '!', '?')):
            return True
        return False   # long sentence ending in punctuation â†’ content
    if "â€“" in t or " - " in t:
        return True
    if len(t) <= 50:
        return True
    return False


def classify_section(text: str) -> str | None:
    """
    Section heading detection: only short titles (<= 60 chars) qualify as headings.
    Long paragraphs are treated as content even if they contain section keywords.
    e.g. "business objectives" contains "objective" but is NOT a heading.
         "Highly experienced...10+ years of experience" contains "experience" but is NOT a heading.
    """
    t = text.strip()
    if len(t) > 60:          # Over 60 chars = content paragraph, never a heading
        return None
    tl = t.lower()
    for sec, keys in SECTION_KEYS.items():
        if any(k in tl for k in keys):
            return sec
    return None


def parse_document(doc: Any) -> Sections:
    """
    Extract paragraphs, assign P-numbers, and classify into sections.

    Core design principle â€” structure independence:
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    The resume header may contain any number of lines: name, phone, email,
    portfolio URL, job title, photo caption, etc. The parser must handle
    all of these correctly regardless of how many header lines there are.

    Section headings (Summary / Work Experience / Skills / Education) are
    used as anchors to determine section boundaries:

      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
      â”‚ Name                            â”‚ â†’ "header"  (protected from edits)
      â”‚ Phone | Email | LinkedIn | ...  â”‚ â†’ "header"  (protected from edits)
      â”‚ Portfolio links, etc.           â”‚ â†’ "header"  (protected from edits)
      â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤ â† everything before first section heading = header
      â”‚ Summary           â† heading     â”‚ â†’ "heading_summary"
      â”‚   Actual summary  â† content     â”‚ â†’ "summary"  (editable)
      â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
      â”‚ Work Experience   â† heading     â”‚ â†’ "heading_experience"
      â”‚   Job bullets     â† content     â”‚ â†’ "experience" (editable)
      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

    classify_section() only flags paragraphs <= 60 chars as headings,
    so content paragraphs can never be misclassified as headings.
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    """
    all_items: list[ParagraphItem] = []
    idx = 0

    # 1) Collect body paragraphs
    for para in doc.paragraphs:
        t = para.text.strip()
        if t:
            all_items.append({
                "id":      f"P{idx:03d}",
                "text":    t,
                "para":    para,
                "style":   para.style.name if para.style else "Normal",
                "section": "other",
            })
            idx += 1

    # 2) Collect paragraphs inside tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    t = para.text.strip()
                    if t:
                        all_items.append({
                            "id":       f"P{idx:03d}",
                            "text":     t,
                            "para":     para,
                            "style":    para.style.name if para.style else "Normal",
                            "section":  "other",
                            "in_table": True,
                        })
                        idx += 1

    # 3) Section classification â€” heading anchor approach
    #    Everything before the first section heading = "header" (name, contact, URL, title, etc.)
    #    Paragraphs over 60 chars â†’ classify_section() returns None â†’ treated as content
    found_first_heading = False
    current = "other"
    for item in all_items:
        sec = classify_section(item["text"])
        if sec:
            found_first_heading = True
            current = sec
            item["section"] = "heading_" + sec
        elif not found_first_heading:
            item["section"] = "header"   # all paragraphs before first heading = protected
        else:
            item["section"] = current

    # 3b) Headingless-summary rescue:
    #     Many resumes have no "Summary" heading â€” the summary paragraph sits
    #     directly after contact info with no label. In that case, all paragraphs
    #     before the first section heading are classified as "header" â†’ protected
    #     â†’ AI never rewrites the summary.
    #
    #     Fix: within the "header" zone, any paragraph that is long (> 80 chars)
    #     is almost certainly a professional summary/profile, not a name/contact
    #     line. Re-classify it as "summary" so it becomes modifiable.
    #
    #     Contact-info lines are short (name, title, email, URL) â€” they stay "header".
    for item in all_items:
        if (item["section"] == "header"
                and len(item["text"]) > 80
                and not _CONTACT_PAT.search(item["text"])):
            item["section"] = "summary"

    # 4) Build result dictionary
    result: dict[str, Any] = {
        "all":    all_items,
        "id_map": {i["id"]: i for i in all_items},
    }
    # All recognized section names (must match SECTION_KEYS keys + "other"/"header")
    _named_sections = ("summary", "experience", "skills", "education",
                       "projects", "certifications", "publications", "awards",
                       "other", "header")
    for sec in _named_sections:
        result[sec] = [i for i in all_items if i["section"] == sec]

    # 5) Protected ID set: entire header (name, contact, portfolio, etc.)
    protected = {i["id"] for i in result["header"]}

    # Also protect structural lines within sections that have job/project/date
    # title rows (Experience, Education, Projects, Certifications, Publications,
    # Awards). These are short non-list lines like "Acme Corp â€“ Engineer" or
    # "AWS Solutions Architect â€“ 2023" or "Jan 2023 â€“ Present" that must NEVER
    # be rewritten.
    structural = {
        i["id"]
        for sec in ("experience", "education", "projects",
                    "certifications", "publications", "awards")
        for i in result[sec]
        if _is_structural_exp_line(i["text"], i.get("style", ""))
    }
    protected |= structural

    result["protected_ids"] = protected
    result["contact_ids"]   = protected   # backward compatibility alias

    # 6) Modifiable ID whitelist (used by apply_all)
    # Every named section EXCEPT "header" is potentially modifiable.
    # The protected set then strips out structural lines.
    _modifiable_sections = ("summary", "experience", "skills", "education",
                            "projects", "certifications", "publications",
                            "awards", "other")
    result["modifiable_ids"] = (
        {
            i["id"]
            for sec in _modifiable_sections
            for i in result[sec]
        }
        - protected
    )
    return result  # type: ignore[return-value]


def extract_summary_anchors(text: str) -> list[str]:
    """Distinctive phrases the AI must keep when rewriting the Summary.

    These are the candidate's real differentiators that easily get washed out
    into generic filler ("modern enterprises", "scalable solutions"):
      â€¢ Industries (any sector â€” tech, healthcare, retail, NPO, etc.)
      â€¢ Compliance / regulatory frameworks (any acronym + "compliant"-style)
      â€¢ Markets / regions / work modes
      â€¢ Sector-agnostic role qualifiers ("contractor", "full-time", etc.)

    Returns a deduped list of up to 8 anchors (in original casing).
    Used by the pipeline as a soft check â€” warns when an anchor disappears
    from the rewrite, but never auto-edits the prose.
    """
    anchors: list[str] = []

    # â”€â”€ Industries / domains (broad cross-sector list) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    anchors.extend(re.findall(
        r'\b(?:'
        # Tech-adjacent
        r'healthcare|telehealth|fintech|finance|banking|insurance|'
        r'telecom|e-?commerce|retail|saas|adtech|edtech|martech|proptech|'
        # Industrial / heavy
        r'automotive|manufacturing|aerospace|defense|defence|mining|'
        r'oil\s*(?:&|and)?\s*gas|utilities|construction|shipping|'
        r'logistics|transportation|aviation|maritime|'
        # Consumer / services
        r'gaming|media|entertainment|hospitality|hotel|food|beverage|'
        r'fashion|apparel|sports|advertising|marketing|consulting|'
        r'education|publishing|tourism|travel|'
        # Public / regulated
        r'government|public\s+sector|nonprofit|non[- ]?profit|npo|ngo|'
        r'pharma(?:ceutical)?|biotech|life\s*sciences|legal|accounting|'
        # Other
        r'energy|real\s*estate|agriculture|agritech|cleantech|cybersecurity'
        r')\b',
        text, re.I,
    ))

    # â”€â”€ Compliance / regulatory (named frameworks + "X-compliant" phrases) â”€â”€
    anchors.extend(re.findall(
        r'\b(?:'
        # Privacy & data
        r'HIPAA|HITRUST|GDPR|CCPA|LGPD|PIPEDA|PDPA|FERPA|COPPA|'
        # Security & infosec
        r'SOC[- ]?[123]|ISO[- ]?\d+|NIST(?:[- ]?\d+)?|FedRAMP|FISMA|CMMC|'
        r'PCI(?:[- ]?DSS)?|SOX|'
        # Sector-specific
        r'FDA|FAA|FCC|HL7|FHIR|GxP|ICH[- ]?GCP|MDR|IVDR|ITAR|EAR|'
        r'OSHA|EPA|IFRS|GAAP|MIFID|Basel|'
        # Regional/locale (less common but real)
        r'PH\s+privacy|UK\s+privacy|APRA|MAS'
        r')\b',
        text, re.I,
    ))

    # General "[X]-compliant" / "[X]-certified" phrases (catch-all)
    anchors.extend(m.group(0) for m in re.finditer(
        r'\b[A-Z][A-Z0-9]{1,9}[- ](?:compliant|certified|regulated|approved)\b',
        text,
    ))

    # â”€â”€ Markets / regions / work modes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    anchors.extend(re.findall(
        r'\b(?:US|USA|UK|EU|EMEA|APAC|LATAM|MENA|ANZ|DACH|GCC|NORDIC|'
        r'BENELUX|North\s+America|onsite|remote|hybrid|contractor|'
        r'full[- ]?time|part[- ]?time|freelance)\b',
        text,
    ))

    # â”€â”€ Dedupe preserving order, cap at 8 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    seen: set[str] = set()
    out: list[str] = []
    for a in anchors:
        key = a.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(a.strip())
        if len(out) >= 8:
            break
    return out


def extract_key_facts(sections: Sections) -> list[str]:
    """
    Extract key phrases from the Summary that must be preserved in AI output.
    Used only to instruct the AI via prompt â€” never inserted directly into text.
    """
    facts = []
    # Analyze Summary section text only (Experience metrics are not targeted)
    summary_text = " ".join(i["text"] for i in sections.get("summary", []))
    if not summary_text:
        summary_text = " ".join(i["text"] for i in sections["all"][:5])

    # Extract meaningful complete phrases like "10+ years of experience"
    for m in re.findall(r'\d+\+?\s*(?:years?|ë…„)\s*(?:of\s+)?(?:experience|ê²½í—˜)?', summary_text, re.I):
        facts.append(m.strip())

    # Seniority level â€” only when present in Summary (with context, not bare words)
    for pattern in [r'Full[- ]Stack\s+\w+', r'Senior\s+\w+\s+\w+',
                    r'Lead\s+\w+\s+\w+', r'Principal\s+\w+', r'Staff\s+\w+']:
        for m in re.findall(pattern, summary_text, re.I):
            facts.append(m.strip())

    return list(dict.fromkeys(facts))[:6]  # max 6, deduped

