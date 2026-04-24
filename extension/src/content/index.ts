import { detectPlatform } from './detector'
import { FormStateMachine } from './stateMachine'

let machine: FormStateMachine | null = null
let lastDetectedUrl = ''

// Guard against "Extension context invalidated" after extension reload
function safeSend(msg: Record<string, unknown>) {
  try {
    if (chrome.runtime?.id) chrome.runtime.sendMessage(msg)
  } catch {
    // Context gone — stop all activity
    navObserver.disconnect()
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
  machine?.pause()
})
