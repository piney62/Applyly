import { detectPlatform } from './detector'
import { FormStateMachine } from './stateMachine'

let machine: FormStateMachine | null = null
let lastDetectedUrl = ''
let confirmWatcher: MutationObserver | null = null
let applicationTracked = false

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

  const job = detectPlatform()
  if (job) safeSend({ type: 'JOB_DETECTED', ...job })
}

// Watch for Indeed's "Your application has been submitted!" confirmation page
function checkIfSubmitted() {
  if (applicationTracked) return
  const text = document.body?.textContent ?? ''
  if (text.includes('application has been submitted')) {
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
    machine = new FormStateMachine(
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
