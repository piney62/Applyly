import { detectPlatform, findAdapter } from './detector'
import { FormStateMachine } from './stateMachine'
import { getNonRadioFillableFields, getInputLabel, setNativeValue } from './formFiller'
import type { PlatformAdapter } from './adapters/types'

let machine: FormStateMachine | null = null
let lastDetectedUrl = ''
let confirmWatcher: MutationObserver | null = null
let applicationTracked = false
let activeAdapter: PlatformAdapter | null = null
let lastDetectedAdapter: PlatformAdapter | null = null

// Guard against "Extension context invalidated" after extension reload
function safeSend(msg: Record<string, unknown>) {
  try {
    if (chrome.runtime?.id) chrome.runtime.sendMessage(msg)
  } catch {
    // Context gone — stop all activity
    navObserver.disconnect()
    confirmWatcher?.disconnect()
    machine?.pause()
  }
}

function detectAndNotify() {
  const currentUrl = window.location.href
  if (currentUrl === lastDetectedUrl) return
  lastDetectedUrl = currentUrl

  const adapter = findAdapter(currentUrl)
  if (adapter) lastDetectedAdapter = adapter

  const job = detectPlatform()
  if (job) safeSend({ type: 'JOB_DETECTED', ...job })
}

// Watch for the platform's submission-confirmation page.
// Adapter may provide a custom detectSubmission() — otherwise we match against
// adapter.selectors.confirmationText, with a generic fallback.
const GENERIC_CONFIRMATION_TEXT = ['application has been submitted', 'application submitted', 'thank you for applying']

function checkIfSubmitted() {
  if (applicationTracked) return
  if (!activeAdapter) return

  let submitted = false
  if (activeAdapter.detectSubmission) {
    submitted = activeAdapter.detectSubmission()
  } else {
    const patterns = activeAdapter.selectors.confirmationText ?? GENERIC_CONFIRMATION_TEXT
    const text = (document.body?.textContent ?? '').toLowerCase()
    submitted = patterns.some((p) => text.includes(p.toLowerCase()))
  }

  if (submitted) {
    applicationTracked = true
    confirmWatcher?.disconnect()
    safeSend({ type: 'APPLICATION_SUBMITTED' })
  }
}

function startConfirmationWatch() {
  applicationTracked = false
  confirmWatcher?.disconnect()
  checkIfSubmitted()
  confirmWatcher = new MutationObserver(checkIfSubmitted)
  confirmWatcher.observe(document.body, { childList: true, subtree: true })
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_FILL') {
    machine?.pause()
    // URL may have changed since JOB_DETECTED (e.g., listing → apply subdomain),
    // so fall back to the adapter that matched the original job page.
    const adapter = findAdapter(window.location.href) ?? lastDetectedAdapter
    if (!adapter) {
      console.warn('[Applyly] No adapter matches', window.location.href)
      return
    }
    activeAdapter = adapter
    machine = new FormStateMachine(
      adapter,
      message.resumeData,
      message.token ?? '',
      safeSend,
      message.autoAdvance !== false,
    )
    machine.run()
    startConfirmationWatch()
  }
  if (message.type === 'PAUSE_FILL') {
    machine?.pause()
  }
  if (message.type === 'SET_AUTO_ADVANCE') {
    machine?.setAutoAdvance(message.value as boolean)
  }
  if (message.type === 'USER_EDIT_FIELD') {
    const label = message.label as string
    const value = message.value as string
    const fields = getNonRadioFillableFields()
    const target = fields.find((el) => getInputLabel(el as HTMLElement) === label)
    if (target) setNativeValue(target as HTMLInputElement | HTMLTextAreaElement, value)
  }
  // ADVANCE_PAGE is forwarded from panel → received by stateMachine's waitForUserAdvance listener
})

detectAndNotify()

const navObserver = new MutationObserver(detectAndNotify)
navObserver.observe(document.body, { childList: true, subtree: false })

window.addEventListener('beforeunload', () => {
  navObserver.disconnect()
  confirmWatcher?.disconnect()
  machine?.pause()
})
