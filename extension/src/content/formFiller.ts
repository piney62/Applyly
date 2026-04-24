// ── Types ──────────────────────────────────────────────────────────────────────

export interface ResumeData {
  id?: string
  name?: string
  email?: string
  phone?: string
  linkedin?: string
  location?: string
  summary?: string
  skills?: string[]
  experience?: Array<{ company: string; title: string; start: string; end: string; bullets: string[] }>
  education?: Array<{ school: string; degree: string; year: string }>
  [key: string]: unknown
}

export interface FillResult {
  label: string
  value: string
  isAI: boolean
}

export type GetAIAnswer = (question: string, options?: string[]) => Promise<string>

// ── Constants ──────────────────────────────────────────────────────────────────

const OPEN_ENDED_TRIGGERS = ['tell', 'describe', 'explain', 'why', 'how', 'what motivated',
  'share', 'elaborate', 'briefly', 'summary', 'background', 'experience with', 'passion']

const FIELD_MAP: Record<string, (r: ResumeData) => string | undefined> = {
  'full name':      (r) => r.name,
  'first name':     (r) => r.name?.split(' ')[0],
  'last name':      (r) => r.name?.split(' ').slice(1).join(' '),
  'given name':     (r) => r.name?.split(' ')[0],
  'family name':    (r) => r.name?.split(' ').slice(1).join(' '),
  'surname':        (r) => r.name?.split(' ').slice(1).join(' '),
  'phone number':   (r) => r.phone,
  'current title':  (r) => r.experience?.[0]?.title,
  'current company':(r) => r.experience?.[0]?.company,
  'street address': (_r) => undefined,   // no street-level data in resume
  'city, state':    (r) => r.location,   // full "City, ST" location string
  'linkedin':       (r) => r.linkedin,
  'location':       (r) => r.location,
  'portfolio':      (r) => r.linkedin,
  'website':        (r) => r.linkedin,
  'mobile':         (r) => r.phone,
  'email':          (r) => r.email,
  'phone':          (r) => r.phone,
  'city':           (r) => r.location?.split(',')[0]?.trim(),
  'address':        (r) => r.location,
  'name':           (r) => r.name,
}

// ── Label utilities ────────────────────────────────────────────────────────────

function innerText(el: Element | null): string {
  if (!el) return ''
  return (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || ''
}

export function getInputLabel(el: HTMLElement): string {
  const id = el.getAttribute('id')
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`)
    if (label) return innerText(label)
  }
  const parentLabel = el.closest('label')
  if (parentLabel) return innerText(parentLabel)

  // fieldset > legend (e.g. Indeed phone number field)
  const fieldset = el.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend) return innerText(legend)
  }

  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    ''
  )
}

export function getGroupLabel(firstInput: HTMLElement): string {
  // fieldset > legend
  const fieldset = firstInput.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend) return innerText(legend)
  }

  // role="group" + aria-labelledby
  const group = firstInput.closest('[role="group"]')
  if (group) {
    const labelId = group.getAttribute('aria-labelledby')
    if (labelId) {
      const text = innerText(document.getElementById(labelId))
      if (text) return text
    }
    const ariaLabel = group.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel
  }

  // Walk up — look for preceding sibling with text
  let el: HTMLElement | null = firstInput.parentElement
  for (let i = 0; i < 6; i++) {
    if (!el) break
    let prev = el.previousElementSibling
    while (prev) {
      const t = innerText(prev)
      if (t.length > 2 && t.length < 300) return t
      prev = prev.previousElementSibling
    }
    el = el.parentElement
  }

  return (firstInput as HTMLInputElement).name || ''
}

function getOptionLabel(input: HTMLInputElement): string {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`)
    if (label) return innerText(label)
  }
  const parentLabel = input.closest('label')
  if (parentLabel) {
    return innerText(parentLabel).replace(input.value, '').trim()
  }
  const next = input.nextElementSibling
  if (next && (next.tagName === 'LABEL' || next.tagName === 'SPAN')) return innerText(next)
  return input.value || ''
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isOpenEnded(label: string): boolean {
  const lc = label.toLowerCase()
  return OPEN_ENDED_TRIGGERS.some((t) => lc.includes(t))
}

function mapResumeField(label: string, resume: ResumeData): string | undefined {
  const lc = label.toLowerCase()
  // Sort by key length descending so "first name" matches before "name"
  const entries = Object.entries(FIELD_MAP).sort((a, b) => b[0].length - a[0].length)
  for (const [key, fn] of entries) {
    if (lc.includes(key)) return fn(resume)
  }
  return undefined
}

// React-controlled inputs need native setter to trigger onChange
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ── Fill handlers ──────────────────────────────────────────────────────────────

async function fillTextField(
  el: HTMLInputElement | HTMLTextAreaElement,
  resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  // Skip already-filled fields — don't overwrite data the site pre-populated
  if (el.value?.trim()) return null

  const label = getInputLabel(el)
  let value: string | undefined
  let isAI = false

  if (isOpenEnded(label)) {
    value = await getAI(label)
    isAI = true
  } else {
    value = mapResumeField(label, resume)
  }
  if (!value) return null

  setNativeValue(el, value)
  return { label, value, isAI }
}

async function fillSelectField(
  el: HTMLSelectElement,
  resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  // Skip if a non-default option is already selected
  if (el.selectedIndex > 0) return null

  const label = getInputLabel(el)
  const options = Array.from(el.options).filter((o) => o.value).map((o) => o.text.trim())

  let targetText: string | undefined = mapResumeField(label, resume)

  // If no direct map, ask AI to pick from options
  if (!targetText && options.length > 0) {
    targetText = await getAI(label, options)
  }
  if (!targetText) return null

  const opt = Array.from(el.options).find((o) =>
    o.text.toLowerCase().includes(targetText!.toLowerCase()) ||
    targetText!.toLowerCase().includes(o.text.toLowerCase())
  )
  if (!opt) return null

  el.selectedIndex = opt.index
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { label, value: opt.text, isAI: false }
}

async function fillCheckboxField(
  el: HTMLInputElement,
  _resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  const label = getInputLabel(el)
  if (!label) return null

  // Privacy policy / terms → always check
  const lc = label.toLowerCase()
  if (lc.includes('agree') || lc.includes('terms') || lc.includes('privacy')) {
    if (!el.checked) el.click()
    return { label, value: 'checked', isAI: false }
  }

  const answer = await getAI(`Should I check this checkbox? "${label}" Answer yes or no only.`)
  if (answer.toLowerCase().includes('yes') && !el.checked) el.click()
  else if (answer.toLowerCase().includes('no') && el.checked) el.click()
  return { label, value: el.checked ? 'checked' : 'unchecked', isAI: true }
}

function fillDateField(
  el: HTMLInputElement,
  resume: ResumeData,
): FillResult | null {
  const label = getInputLabel(el).toLowerCase()
  let dateStr = ''

  if (label.includes('start') || label.includes('from') || label.includes('begin')) {
    dateStr = resume.experience?.[0]?.start ?? ''
  } else if (label.includes('end') || label.includes('to')) {
    const end = resume.experience?.[0]?.end ?? ''
    if (end.toLowerCase() === 'present') return null
    dateStr = end
  } else if (label.includes('grad') || label.includes('education')) {
    dateStr = resume.education?.[0]?.year?.split('–')[1]?.trim() ?? ''
  }

  if (!dateStr) return null

  // Try to format as YYYY-MM-DD for date inputs
  const parsed = new Date(dateStr)
  if (!isNaN(parsed.getTime())) {
    const formatted = parsed.toISOString().split('T')[0]
    setNativeValue(el, formatted)
    return { label: getInputLabel(el), value: formatted, isAI: false }
  }

  return null
}

async function fillContentEditable(
  el: HTMLElement,
  _resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  const label =
    el.getAttribute('aria-label') ||
    el.getAttribute('data-placeholder') ||
    el.getAttribute('placeholder') ||
    ''
  if (!label) return null

  const value = await getAI(label)
  if (!value) return null

  el.innerText = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { label, value, isAI: true }
}

// ── Radio group handler (exported for stateMachine) ────────────────────────────

export async function fillRadioGroup(
  inputs: HTMLInputElement[],
  _resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  if (inputs.length === 0) return null
  const question = getGroupLabel(inputs[0])
  const options = inputs.map(getOptionLabel)

  // Simple yes/no resolution without AI
  const qLc = question.toLowerCase()
  let choice: string | null = null

  if (qLc.includes('authorized') || qLc.includes('eligible') || qLc.includes('legal')) {
    choice = 'no' // safer default for work authorization
  } else if (qLc.includes('sponsorship') || qLc.includes('visa')) {
    choice = 'yes' // yes, needs sponsorship
  }

  // If a radio is already checked, report it as filled without touching it
  const alreadyChecked = inputs.find((i) => i.checked)
  if (alreadyChecked) {
    return { label: question, value: getOptionLabel(alreadyChecked), isAI: false }
  }

  if (choice) {
    const target = inputs.find((i) => getOptionLabel(i).toLowerCase().startsWith(choice!))
    if (target) { if (!target.checked) target.click(); return { label: question, value: choice, isAI: false } }
  }

  // AI picks from options
  const picked = await getAI(question, options)
  const target = inputs.find((i) =>
    getOptionLabel(i).toLowerCase().includes(picked.toLowerCase()) ||
    picked.toLowerCase().includes(getOptionLabel(i).toLowerCase())
  )
  if (target) {
    if (!target.checked) target.click()
    return { label: question, value: getOptionLabel(target), isAI: true }
  }

  return null
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function fillField(
  el: HTMLElement,
  resume: ResumeData,
  getAI: GetAIAnswer,
): Promise<FillResult | null> {
  const tag = el.tagName.toLowerCase()
  const type = (el as HTMLInputElement).type?.toLowerCase()

  if (tag === 'select') return fillSelectField(el as HTMLSelectElement, resume, getAI)
  if (tag === 'textarea') return fillTextField(el as HTMLTextAreaElement, resume, getAI)
  if (el.getAttribute('contenteditable') === 'true') return fillContentEditable(el, resume, getAI)

  if (tag === 'input') {
    if (type === 'checkbox') return fillCheckboxField(el as HTMLInputElement, resume, getAI)
    if (type === 'date') return fillDateField(el as HTMLInputElement, resume)
    if (['text', 'email', 'tel', 'url', 'number'].includes(type))
      return fillTextField(el as HTMLInputElement, resume, getAI)
  }

  return null
}

// ── Field discovery ────────────────────────────────────────────────────────────

export function getRadioGroups(): Map<string, HTMLInputElement[]> {
  const groups = new Map<string, HTMLInputElement[]>()
  const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]:not([disabled])')
  for (const radio of radios) {
    const key = radio.name || `_unnamed_${radio.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(radio)
  }
  return groups
}

export function getNonRadioFillableFields(): HTMLElement[] {
  const selector = [
    'input[type="text"]:not([disabled]):not([readonly])',
    'input[type="email"]:not([disabled]):not([readonly])',
    'input[type="tel"]:not([disabled]):not([readonly])',
    'input[type="url"]:not([disabled]):not([readonly])',
    'input[type="number"]:not([disabled]):not([readonly])',
    'input[type="date"]:not([disabled]):not([readonly])',
    'input[type="checkbox"]:not([disabled])',
    'textarea:not([disabled]):not([readonly])',
    'select:not([disabled])',
    '[contenteditable="true"]',
  ].join(', ')
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || (el as HTMLInputElement).type === 'hidden' === false
  ).filter(
    // Exclude known invisible/utility fields
    (el) => {
      const name = el.getAttribute('name') ?? ''
      if (name === 'g-recaptcha-response') return false
      if (name.startsWith('g-recaptcha')) return false
      // Exclude elements with zero dimensions (display:none, visibility:hidden)
      const rect = el.getBoundingClientRect()
      return rect.width > 0 || rect.height > 0
    }
  )
}

// Legacy export kept for compatibility
export function getAllFillableFields(): HTMLElement[] {
  return getNonRadioFillableFields()
}
