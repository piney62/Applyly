const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

interface ApiCallMessage {
  type: 'API_CALL'
  method: string
  path: string
  body?: unknown
  token?: string
}

interface OpenSidePanelMessage {
  type: 'OPEN_SIDE_PANEL'
}

type IncomingMessage = ApiCallMessage | OpenSidePanelMessage

async function handleApiCall(msg: ApiCallMessage): Promise<{ data?: unknown; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (msg.token) {
    headers['Authorization'] = `Bearer ${msg.token}`
  }

  try {
    const res = await fetch(`${API_BASE}${msg.path}`, {
      method: msg.method,
      headers,
      body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ detail: res.statusText }))
      return { error: errBody.detail ?? 'Request failed' }
    }

    const data = await res.json()
    return { data }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

chrome.runtime.onMessage.addListener(
  (message: IncomingMessage, sender, sendResponse) => {
    if (message.type === 'API_CALL') {
      handleApiCall(message).then(sendResponse)
      return true // keep port open for async response
    }

    if (message.type === 'OPEN_SIDE_PANEL' && sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id })
    }

    return false
  }
)

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

// Track tab updates — notify side panel of URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.runtime
      .sendMessage({ type: 'TAB_UPDATED', tabId })
      .catch(() => {}) // side panel may not be open
  }
})
