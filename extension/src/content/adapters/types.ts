import type { JobInfo } from '../detector'
import type { ResumeData } from '../formFiller'

// Context object passed to adapter form-filling overrides
export interface FillContext {
  resumeData: ResumeData
  token: string
  send: (msg: Record<string, unknown>) => void
  delay: (ms: number) => Promise<void>
  currentPage: number
  setStatusNavigating: () => void
  observerHook: (observer: MutationObserver | null) => void
}

// Declarative selectors a platform can supply. Generic fallbacks fill in the rest.
export interface AdapterSelectors {
  // Next/Continue button (advances to next page in a multi-step form)
  nextButton?: string[]
  // Submit button (signals the last page — also typically matched by SUBMIT_KEYWORDS)
  submitButton?: string[]
  // Selector that, when present in the DOM, indicates a separate resume-selection page
  resumeSelectionForm?: string
  // File input for direct resume injection (used by handleResumeSelectionPage)
  fileInput?: string
  // Continue button on the resume page (may differ from main next button)
  resumePageContinue?: string[]
  // Confirmation text patterns to watch for on the post-submit page
  confirmationText?: string[]
}

export interface PlatformAdapter {
  // Identity
  readonly name: string
  detect(url: string): boolean

  // Job extraction (existing)
  extract(): JobInfo

  // Form-filling — declarative
  readonly selectors: AdapterSelectors

  // Form-filling — optional imperative overrides
  // If unset, state machine uses generic behavior.
  handleResumeSelectionPage?(ctx: FillContext): Promise<boolean>
  detectSubmission?(): boolean
}
