import {
  fillField,
  fillRadioGroup,
  getRadioGroups,
  getNonRadioFillableFields,
  getGroupLabel,
  getInputLabel,
  type ResumeData,
  type FillResult,
} from './formFiller'

// ── Types ──────────────────────────────────────────────────────────────────────

type MachineStatus = 'armed' | 'filling' | 'navigating' | 'complete' | 'paused'

// ── Next-button detection ──────────────────────────────────────────────────────

const NEXT_BTN_SELECTORS = [
  // Workday
  '[data-automation-id="bottom-navigation-next-button"]',
  // LinkedIn Easy Apply
  'button.artdeco-button--primary[aria-label*="next" i]',
  // Greenhouse
  '[data-submits] input[type="submit"]',
  // Indeed Apply flow (continue-button appears on every step including questions page)
  'button[data-testid="continue-button"]',
  'button[data-testid="next-button"]',
  '.ia-continueButton',
  // Generic
  'button[aria-label="Next" i]',
  'button[aria-label="Continue" i]',
  'input[type="submit"][value*="next" i]',
  'input[type="submit"][value*="continue" i]',
  'button[type="submit"]',
]

const SUBMIT_KEYWORDS = ['submit', 'apply', 'send application', 'finish', 'complete application']

function findNextButton(): HTMLButtonElement | null {
  for (const sel of NEXT_BTN_SELECTORS) {
    const btn = document.querySelector<HTMLButtonElement>(sel)
    if (btn && !btn.disabled && btn.offsetParent !== null) return btn
  }
  // Fallback: any visible button whose text looks like "next/continue"
  const buttons = document.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
  for (const btn of buttons) {
    const t = btn.innerText?.toLowerCase() ?? ''
    if ((t.includes('next') || t.includes('continue')) && btn.offsetParent !== null) return btn
  }
  return null
}

function isLastPage(): boolean {
  const btn = findNextButton()
  if (!btn) return true
  const t = (btn.innerText ?? btn.value ?? '').toLowerCase()
  return SUBMIT_KEYWORDS.some((kw) => t.includes(kw))
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
  private resumeData: ResumeData
  private token: string
  private send: SafeSend
  private autoAdvance: boolean
  private filledElements = new WeakSet<HTMLElement>()

  constructor(resumeData: ResumeData, token: string, send: SafeSend, autoAdvance = true) {
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
      if (document.querySelector('[data-testid="resume-selection-form"]')) {
        const handled = await this.handleResumeSelectionPage()
        if (handled) continue
      }

      await this.fillCurrentPage()
      if ((this.status as MachineStatus) === 'paused') break

      // Allow SPA to react to field changes (e.g. Indeed shows Continue button after selects are filled)
      await this.delay(500)

      const lastPage = isLastPage()
      const nextBtn = lastPage ? null : findNextButton()

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

      const prevFields = getNonRadioFillableFields()
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
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][data-testid="resume-selection-file-resume-radio-card-file-input"]')
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
    const continueBtn = document.querySelector<HTMLButtonElement>('[data-testid="continue-button"]')
      ?? document.querySelector<HTMLButtonElement>('[data-testid="hp-continue-button-0"]')
    if (!continueBtn) return true

    this.status = 'navigating'
    continueBtn.click()
    this.currentPage++
    this.notifyPageChange()

    // Wait for resume-selection-form to leave the DOM
    await new Promise<void>((resolve) => {
      this.observer?.disconnect()
      this.observer = new MutationObserver(() => {
        if (!document.querySelector('[data-testid="resume-selection-form"]')) {
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

    const radioGroups = getRadioGroups()
    const fields = getNonRadioFillableFields()

    // Notify panel of all fields detected on this page
    const allLabels = [
      ...Array.from(radioGroups.values()).map((inputs) =>
        inputs[0] ? (getGroupLabel(inputs[0]) || inputs[0].name || 'Question') : 'Question'
      ),
      ...fields.map((el) => getInputLabel(el as HTMLElement) || 'Field'),
    ].filter(Boolean)
    this.send({ type: 'PAGE_FIELDS_DETECTED', labels: allLabels, currentPage: this.currentPage })

    // Pass 1: radio groups (track by first input element)
    for (const [, inputs] of radioGroups) {
      if (this.status === 'paused') return
      if (inputs[0] && this.filledElements.has(inputs[0])) continue
      const result = await fillRadioGroup(inputs, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        if (inputs[0]) this.filledElements.add(inputs[0])
        this.report(result)
        await this.delay(30)
      }
    }
    if (radioGroups.size > 0) await this.delay(100)

    // Pass 2: other fields — skip already-filled elements
    for (const field of fields) {
      if (this.status === 'paused') return
      if (this.filledElements.has(field)) continue
      const result = await fillField(field, this.resumeData, (q, opts) => this.getAIAnswer(q, opts))
      if (result) {
        this.filledElements.add(field)
        this.report(result)
        await this.delay(result.isAI ? 0 : 30)
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
    return new Promise((resolve) => {
      if (getNonRadioFillableFields().length > 0 || getRadioGroups().size > 0) {
        resolve()
        return
      }
      this.observer?.disconnect()
      this.observer = new MutationObserver(() => {
        const hasFields =
          getNonRadioFillableFields().length > 0 || getRadioGroups().size > 0
        if (hasFields) {
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
      this.observer = new MutationObserver(() => {
        const prevGone =
          prevFields.length === 0 ||
          prevFields.every((f) => !document.contains(f))
        const newFields = getNonRadioFillableFields()
        const newGroups = getRadioGroups()

        if (prevGone && (newFields.length > 0 || newGroups.size > 0)) {
          this.observer?.disconnect()
          setTimeout(resolve, 400) // settle
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      // Hard timeout — proceed even if detection fails
      setTimeout(() => { this.observer?.disconnect(); resolve() }, 8000)
    })
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
