import {
  fillField,
  fillRadioGroup,
  fillCheckboxGroup,
  getRadioGroups,
  getCheckboxGroups,
  getNonRadioFillableFields,
  getGroupLabel,
  getInputLabel,
  type ResumeData,
  type FillResult,
} from './formFiller'
import type { PlatformAdapter } from './adapters/types'

// ── Types ──────────────────────────────────────────────────────────────────────

type MachineStatus = 'armed' | 'filling' | 'navigating' | 'complete' | 'paused'

// ── Next-button detection ──────────────────────────────────────────────────────

// Generic fallbacks used after platform adapter's own selectors don't match.
const GENERIC_NEXT_SELECTORS = [
  'button[aria-label="Next" i]',
  'button[aria-label="Continue" i]',
  'input[type="submit"][value*="next" i]',
  'input[type="submit"][value*="continue" i]',
  'button[type="submit"]',
]

const SUBMIT_KEYWORDS = ['submit', 'apply', 'send application', 'finish', 'complete application']

function isBtnVisible(btn: HTMLButtonElement): boolean {
  if (btn.disabled) return false
  // offsetParent is null for position:fixed elements (e.g. Indeed's sticky footer),
  // so use getBoundingClientRect instead
  const r = btn.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

// ── FormStateMachine ───────────────────────────────────────────────────────────

type SafeSend = (msg: Record<string, unknown>) => void

export class FormStateMachine {
  private status: MachineStatus = 'armed'
  private currentPage = 1
  private totalPages: number | null = null
  private filledCount = 0
  private aiCount = 0
  private observer: MutationObserver | null = null
  private adapter: PlatformAdapter
  private resumeData: ResumeData
  private token: string
  private send: SafeSend
  private autoAdvance: boolean
  private filledElements = new WeakSet<HTMLElement>()

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
    // ARMED: wait until form fields actually appear in the DOM
    // (user still needs to click Apply on the job page)
    this.send({ type: 'FILL_ARMED' })
    await this.waitForForm()

    if (this.status === 'paused') return
    this.status = 'filling'
    this.detectTotalPages()
    this.notifyPageChange()

    while (this.status === 'filling') {
      // Resume selection page: handle upload + navigation entirely here
      if (
        this.adapter.selectors.resumeSelectionForm &&
        document.querySelector(this.adapter.selectors.resumeSelectionForm)
      ) {
        const handled = await this.handleResumeSelectionPage()
        if (handled) continue
      }

      await this.fillCurrentPage()
      if ((this.status as MachineStatus) === 'paused') break

      // Allow SPA to react to field changes (e.g. Indeed shows Continue button after selects are filled)
      await this.delay(500)

      const lastPage = this.isLastPage()
      const nextBtn = lastPage ? null : this.findNextButton()

      // Semi-auto: always verify the current page before advancing or completing
      if (!this.autoAdvance) {
        this.send({ type: 'PAGE_FILL_COMPLETE', currentPage: this.currentPage, totalPages: this.totalPages })
        await this.waitForUserAdvance()
        if ((this.status as MachineStatus) === 'paused') break
      }

      if (lastPage || !nextBtn) {
        this.complete()
        break
      }

      // Include first element of each group so group-only pages still anchor the transition
      const prevNonRadio = getNonRadioFillableFields()
      const prevRadioFirsts = Array.from(getRadioGroups().values())
        .map((inputs) => inputs[0])
        .filter((el): el is HTMLInputElement => !!el)
      const prevCheckboxFirsts = Array.from(getCheckboxGroups().values())
        .map((inputs) => inputs[0])
        .filter((el): el is HTMLInputElement => !!el)
      const prevFields = [...prevNonRadio, ...prevRadioFirsts, ...prevCheckboxFirsts]

      this.status = 'navigating'
      nextBtn.click()
      this.currentPage++
      this.notifyPageChange()

      await this.waitForPageTransition(prevFields)
      if ((this.status as MachineStatus) !== 'paused') this.status = 'filling'
    }
  }

  pause() {
    this.status = 'paused'
    this.observer?.disconnect()
  }

  setAutoAdvance(v: boolean) {
    this.autoAdvance = v
  }

  // ── Page filling ────────────────────────────────────────────────────────────

  private async handleResumeSelectionPage(): Promise<boolean> {
    // Adapter may provide a fully custom implementation (e.g. Workday widgets).
    // Otherwise we use the default flow below, parameterized by adapter.selectors.
    if (this.adapter.handleResumeSelectionPage) {
      return this.adapter.handleResumeSelectionPage({
        resumeData: this.resumeData,
        token: this.token,
        send: this.send,
        delay: this.delay.bind(this),
        currentPage: this.currentPage,
        setStatusNavigating: () => { this.status = 'navigating' },
        observerHook: (o) => { this.observer = o },
      })
    }

    if (!this.resumeData.id) return false

    // Notify panel of this page's single field
    this.send({ type: 'PAGE_FIELDS_DETECTED', labels: ['Resume'], currentPage: this.currentPage })

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

    if (!fileData) return false

    // Inject directly into the hidden file input — no button clicks needed
    const fileInputSel = this.adapter.selectors.fileInput
    const fileInput = (fileInputSel ? document.querySelector<HTMLInputElement>(fileInputSel) : null)
      ?? document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!fileInput) return false

    const bytes = atob(fileData.content_base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: fileData.content_type })
    const file = new File([blob], fileData.filename, { type: fileData.content_type })
    const dt = new DataTransfer()
    dt.items.add(file)
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))

    this.send({ type: 'FIELD_FILLED', fieldLabel: 'Resume', value: fileData.filename, isAI: false, pageIndex: this.currentPage })

    await this.delay(2000) // wait for Indeed to process the upload

    // Semi-auto: show verification button and wait for user
    if (!this.autoAdvance) {
      this.send({ type: 'PAGE_FILL_COMPLETE', currentPage: this.currentPage, totalPages: this.totalPages })
      await this.waitForUserAdvance()
      if ((this.status as MachineStatus) === 'paused') return true
    }

    // Click Continue and wait for the resume form to disappear
    const resumeContinueSels = this.adapter.selectors.resumePageContinue ?? []
    let continueBtn: HTMLButtonElement | null = null
    for (const sel of resumeContinueSels) {
      continueBtn = document.querySelector<HTMLButtonElement>(sel)
      if (continueBtn) break
    }
    continueBtn = continueBtn ?? this.findNextButton()
    if (!continueBtn) return true

    this.status = 'navigating'
    continueBtn.click()
    this.currentPage++
    this.notifyPageChange()

    // Wait for resume-selection-form to leave the DOM
    const resumeFormSel = this.adapter.selectors.resumeSelectionForm
    await new Promise<void>((resolve) => {
      this.observer?.disconnect()
      this.observer = new MutationObserver(() => {
        if (!resumeFormSel || !document.querySelector(resumeFormSel)) {
          this.observer?.disconnect()
          setTimeout(resolve, 400)
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => { this.observer?.disconnect(); resolve() }, 8000)
    })

    if ((this.status as MachineStatus) !== 'paused') this.status = 'filling'
    return true
  }

  private async fillCurrentPage() {

    const checkboxGroups = getCheckboxGroups()
    const radioGroups = getRadioGroups()
    const fields = getNonRadioFillableFields()

    // Notify panel of all fields detected on this page
    const allLabels = [
      ...Array.from(checkboxGroups.values()).map((inputs) =>
        inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      ),
      ...Array.from(radioGroups.values()).map((inputs) =>
        inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      ),
      ...fields.map((el) => getInputLabel(el as HTMLElement) || 'Field'),
    ].filter(Boolean)
    this.send({ type: 'PAGE_FIELDS_DETECTED', labels: allLabels, currentPage: this.currentPage })

    // Pass 1: checkbox groups — one AI call per group, not per checkbox
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
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: this.currentPage })
      }
    }

    // Pass 2: radio groups (track by first input element)
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
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: this.currentPage })
      }
    }
    if (radioGroups.size > 0) await this.delay(100)

    // Pass 3: other fields — skip already-filled elements
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
        this.send({ type: 'FIELD_SKIPPED', fieldLabel: label, pageIndex: this.currentPage })
      }
    }
  }

  /** Semi-auto: wait until panel sends ADVANCE_PAGE */
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

  // ── Transition detection ────────────────────────────────────────────────────

  /** ARMED → FILLING: wait until form fields appear in DOM */
  private waitForForm(): Promise<void> {
    const hasAnyFields = () =>
      getNonRadioFillableFields().length > 0 ||
      getRadioGroups().size > 0 ||
      getCheckboxGroups().size > 0

    return new Promise((resolve) => {
      if (hasAnyFields()) {
        resolve()
        return
      }
      this.observer?.disconnect()
      this.observer = new MutationObserver(() => {
        if (hasAnyFields()) {
          this.observer?.disconnect()
          setTimeout(resolve, 500) // settle
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      // 5-minute timeout — user may take time to click Apply
      setTimeout(() => { this.observer?.disconnect(); resolve() }, 5 * 60 * 1000)
    })
  }

  /** NAVIGATING → FILLING: wait until old fields leave and new ones arrive */
  private waitForPageTransition(prevFields: HTMLElement[]): Promise<void> {
    return new Promise((resolve) => {
      this.observer?.disconnect()

      const check = (): boolean => {
        const prevGone = prevFields.length === 0 || prevFields.every((f) => !document.contains(f))
        if (!prevGone) return false
        return getNonRadioFillableFields().length > 0 ||
          getRadioGroups().size > 0 ||
          getCheckboxGroups().size > 0
      }

      // Resolve immediately if new page is already fully rendered
      if (check()) { setTimeout(resolve, 400); return }

      this.observer = new MutationObserver(() => {
        if (check()) {
          this.observer?.disconnect()
          setTimeout(resolve, 400)
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      // Hard timeout — proceed even if detection fails
      setTimeout(() => { this.observer?.disconnect(); resolve() }, 8000)
    })
  }

  // ── Button detection (adapter-aware) ────────────────────────────────────────

  private findNextButton(): HTMLButtonElement | null {
    const adapterSels = this.adapter.selectors.nextButton ?? []
    for (const sel of [...adapterSels, ...GENERIC_NEXT_SELECTORS]) {
      const btn = document.querySelector<HTMLButtonElement>(sel)
      if (btn && isBtnVisible(btn)) return btn
    }
    // Fallback: any visible button whose text looks like "next/continue"
    const buttons = document.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    for (const btn of buttons) {
      const t = btn.innerText?.toLowerCase() ?? ''
      if ((t.includes('next') || t.includes('continue')) && isBtnVisible(btn)) return btn
    }
    return null
  }

  private isLastPage(): boolean {
    const btn = this.findNextButton()
    if (!btn) return true
    const t = (btn.innerText ?? btn.value ?? '').toLowerCase()
    return SUBMIT_KEYWORDS.some((kw) => t.includes(kw))
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private detectTotalPages() {
    const indicator = document.querySelector(
      '[class*="pagination"], [data-automation-id="pagination"], [aria-label*="step" i]'
    )
    if (indicator) {
      const m = indicator.textContent?.match(/of\s+(\d+)/i)
      if (m) this.totalPages = parseInt(m[1])
    }
  }

  private notifyPageChange() {
    this.send({
      type: 'PAGE_CHANGED',
      currentPage: this.currentPage,
      totalPages: this.totalPages,
    })
  }

  private complete() {
    this.status = 'complete'
    this.observer?.disconnect()
    this.send({
      type: 'ALL_FIELDS_DONE',
      totalFilled: this.filledCount,
      aiCount: this.aiCount,
    })
  }

  private report(result: FillResult) {
    this.filledCount++
    if (result.isAI) this.aiCount++
    this.send({
      type: 'FIELD_FILLED',
      fieldLabel: result.label,
      value: result.value,
      isAI: result.isAI,
      pageIndex: this.currentPage,
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
