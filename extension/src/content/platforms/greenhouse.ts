import {
  fillField,
  fillRadioGroup,
  fillCheckboxGroup,
  fillReactSelectField,
  getRadioGroups,
  getCheckboxGroups,
  getReactSelectContainers,
  getReactSelectLabel,
  getNonRadioFillableFields,
  getGroupLabel,
  getInputLabel,
  type ResumeData,
  type FillResult,
} from '../formFiller'
import type { PlatformAdapter } from '../adapters/types'

// ── Types ──────────────────────────────────────────────────────────────────────

type FillerStatus = 'armed' | 'filling' | 'complete' | 'paused'
type SafeSend = (msg: Record<string, unknown>) => void

// ── GreenhouseFiller ───────────────────────────────────────────────────────────
//
// Greenhouse uses a single-page application form — no multi-page navigation.
// Flow: wait for form → inject resume → fill all fields → complete (no Submit click).
//
// DOM facts (from job-boards.greenhouse.io):
//   Text fields : label[for="id"] pattern — standard, getInputLabel() handles it
//   React Select: .select__container wrapping input[role="combobox"] — fillReactSelectField() handles it
//   Phone       : input#phone[type="tel"] inside .iti (intl-tel-input) — filled as plain text
//   Resume      : input#resume[type="file"] (visually-hidden) — inject via DataTransfer
//   GDPR consent: input[type="checkbox"] with "consent" in label — auto-checked by fillCheckboxField()
//   Demographic : React Select (race/gender/lgbtq/disability) — auto-picks "Prefer not to respond"
//   Submit      : button[type="submit"].btn containing "Submit application"

export class GreenhouseFiller {
  private status: FillerStatus = 'armed'
  private observer: MutationObserver | null = null
  private adapter: PlatformAdapter
  private resumeData: ResumeData
  private token: string
  private send: SafeSend
  private autoAdvance: boolean
  private filledElements = new WeakSet<HTMLElement>()
  private filledCount = 0
  private aiCount = 0

  constructor(
    adapter: PlatformAdapter,
    resumeData: ResumeData,
    token: string,
    send: SafeSend,
    autoAdvance = true,
  ) {
    this.adapter = adapter
    this.resumeData = resumeData
    this.token = token
    this.send = send
    this.autoAdvance = autoAdvance
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async run() {
    this.send({ type: 'FILL_ARMED' })
    await this.waitForForm()

    if (this.status === 'paused') return
    this.status = 'filling'
    this.send({ type: 'PAGE_CHANGED', currentPage: 1, totalPages: 1 })

    // Inject resume file before filling other fields
    await this.injectResume()
    if ((this.status as FillerStatus) === 'paused') return

    await this.fillPage()
    if ((this.status as FillerStatus) === 'paused') return

    if (!this.autoAdvance) {
      this.send({ type: 'PAGE_FILL_COMPLETE', currentPage: 1, totalPages: 1 })
      await this.waitForUserAdvance()
      if ((this.status as FillerStatus) === 'paused') return
    }

    this.complete()
  }

  pause() {
    this.status = 'paused'
    this.observer?.disconnect()
  }

  setAutoAdvance(v: boolean) {
    this.autoAdvance = v
  }

  // ── Resume injection ────────────────────────────────────────────────────────

  private async injectResume() {
    if (!this.resumeData.id) return

    // Greenhouse uses input#resume[type="file"] (visually-hidden, inject directly)
    const fileInput = document.querySelector<HTMLInputElement>('input#resume[type="file"]')
    if (!fileInput) return

    const fileData = await new Promise<{ filename: string; content_type: string; content_base64: string } | null>(
      (resolve) => {
        try {
          if (!chrome.runtime?.id) { resolve(null); return }
          chrome.runtime.sendMessage(
            { type: 'API_CALL', method: 'GET', path: `/resume/file/${this.resumeData.id}`, token: this.token },
            (res: { data?: { filename: string; content_type: string; content_base64: string } } | undefined) =>
              resolve(res?.data ?? null),
          )
        } catch { resolve(null) }
      },
    )

    if (!fileData) return

    const bytes = atob(fileData.content_base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: fileData.content_type })
    const file = new File([blob], fileData.filename, { type: fileData.content_type })
    const dt = new DataTransfer()
    dt.items.add(file)
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))

    this.send({ type: 'FIELD_FILLED', fieldLabel: 'Resume', value: fileData.filename, isAI: false, pageIndex: 1 })
    this.filledCount++
    await this.delay(500) // let the form process the file attachment
  }

  // ── Page filling ────────────────────────────────────────────────────────────

  private async fillPage() {
    const reactSelects = getReactSelectContainers()
    const checkboxGroups = getCheckboxGroups()
    const radioGroups = getRadioGroups()
    const fields = getNonRadioFillableFields()

    const allLabels = [
      ...reactSelects.map((c) => getReactSelectLabel(c) || 'Select'),
      ...Array.from(checkboxGroups.values()).map((inputs) =>
        inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      ),
      ...Array.from(radioGroups.values()).map((inputs) =>
        inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      ),
      ...fields.map((el) => getInputLabel(el as HTMLElement) || 'Field'),
    ].filter(Boolean)
    this.send({ type: 'PAGE_FIELDS_DETECTED', labels: allLabels, currentPage: 1 })

    // Pass 0: React Select dropdowns (country, custom questions, demographic)
    for (const container of reactSelects) {
      if (this.status === 'paused') return
      if (this.filledElements.has(container)) continue
      const label = getReactSelectLabel(container) || 'Select'
      const result = await fillReactSelectField(container, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        this.filledElements.add(container)
        this.report(result)
        await this.delay(150)
      } else {
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: 1 })
      }
    }

    // Pass 1: Checkbox groups (multi-select with shared name)
    for (const [, inputs] of checkboxGroups) {
      if (this.status === 'paused') return
      if (inputs[0] && this.filledElements.has(inputs[0])) continue
      const label = inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      const result = await fillCheckboxGroup(inputs, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        if (inputs[0]) this.filledElements.add(inputs[0])
        this.report(result)
        await this.delay(30)
      } else {
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: 1 })
      }
    }

    // Pass 2: Radio groups
    for (const [, inputs] of radioGroups) {
      if (this.status === 'paused') return
      if (inputs[0] && this.filledElements.has(inputs[0])) continue
      const label = inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      const result = await fillRadioGroup(inputs, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        if (inputs[0]) this.filledElements.add(inputs[0])
        this.report(result)
        await this.delay(30)
      } else {
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: 1 })
      }
    }

    // Pass 3: Text / tel / email / checkbox (individual) fields
    for (const field of fields) {
      if (this.status === 'paused') return
      if (this.filledElements.has(field)) continue
      const label = getInputLabel(field as HTMLElement) || 'Field'
      const result = await fillField(field, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        this.filledElements.add(field)
        this.report(result)
        await this.delay(result.isAI ? 0 : 30)
      } else {
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: 1 })
      }
    }
  }

  // ── Transition detection ────────────────────────────────────────────────────

  private waitForForm(): Promise<void> {
    const hasFields = () =>
      getNonRadioFillableFields().length > 0 ||
      getReactSelectContainers().length > 0 ||
      getCheckboxGroups().size > 0

    return new Promise((resolve) => {
      if (hasFields()) { resolve(); return }
      this.observer?.disconnect()
      this.observer = new MutationObserver(() => {
        if (hasFields()) {
          this.observer?.disconnect()
          setTimeout(resolve, 500)
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => { this.observer?.disconnect(); resolve() }, 5 * 60 * 1000)
    })
  }

  private waitForUserAdvance(): Promise<void> {
    return new Promise((resolve) => {
      const listener = (msg: Record<string, unknown>) => {
        if (msg.type === 'ADVANCE_PAGE') {
          try { chrome.runtime.onMessage.removeListener(listener) } catch { /* ignore */ }
          resolve()
        }
      }
      try {
        if (chrome.runtime?.id) chrome.runtime.onMessage.addListener(listener)
        else resolve()
      } catch { resolve() }
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private complete() {
    this.status = 'complete'
    this.observer?.disconnect()
    this.send({ type: 'ALL_FIELDS_DONE', totalFilled: this.filledCount, aiCount: this.aiCount })
  }

  private report(result: FillResult) {
    this.filledCount++
    if (result.isAI) this.aiCount++
    this.send({
      type: 'FIELD_FILLED',
      fieldLabel: result.label,
      value: result.value,
      isAI: result.isAI,
      pageIndex: 1,
    })
  }

  private async getAIAnswer(question: string, options?: string[]): Promise<string> {
    const body = {
      question: options
        ? `${question}\nChoose the single best answer from these options: ${options.join(' | ')}\nRespond with only the option text.`
        : question,
      resume_id: this.resumeData.id ?? '',
      job_description_text: '',
    }
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(options?.[0] ?? ''); return }
        chrome.runtime.sendMessage(
          { type: 'API_CALL', method: 'POST', path: '/ai/answer', body, token: this.token },
          (res: { data?: { answer?: string } } | undefined) =>
            resolve(res?.data?.answer ?? (options?.[0] ?? ''))
        )
      } catch {
        resolve(options?.[0] ?? '')
      }
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
