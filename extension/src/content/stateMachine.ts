import {
  fillField,
  fillRadioGroup,
  getRadioGroups,
  getNonRadioFillableFields,
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
  // Indeed
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
      await this.fillCurrentPage()
      if ((this.status as MachineStatus) === 'paused') break

      if (isLastPage()) {
        this.complete()
        break
      }

      const nextBtn = findNextButton()
      if (!nextBtn) { this.complete(); break }

      // Semi-auto: notify panel and wait for user to click Next
      if (!this.autoAdvance) {
        this.send({ type: 'PAGE_FILL_COMPLETE', currentPage: this.currentPage, totalPages: this.totalPages })
        await this.waitForUserAdvance()
        if ((this.status as MachineStatus) === 'paused') break
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

  private async fillCurrentPage() {
    const radioGroups = getRadioGroups()
    const fields = getNonRadioFillableFields()

    // Notify panel of all fields detected on this page
    const allLabels = [
      ...Array.from(radioGroups.values()).map((inputs) =>
        inputs[0] ? inputs[0].name || inputs[0].getAttribute('aria-label') || 'Question' : 'Question'
      ),
      ...fields.map((el) => {
        const id = el.getAttribute('id')
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null
        return (
          (labelEl as HTMLElement)?.innerText?.trim() ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('name') ||
          'Field'
        )
      }),
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
