const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// In-memory PDF relay: sidepanel stores PDF here, pdf-viewer.html fetches it
let _pendingPdf: string | null = null

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
  (message: IncomingMessage | { type: string; pdf_base64?: string }, _sender, sendResponse) => {
    if ((message as ApiCallMessage).type === 'API_CALL') {
      handleApiCall(message as ApiCallMessage).then(sendResponse)
      return true
    }

    if (message.type === 'OPEN_SIDE_PANEL' && (_sender as chrome.runtime.MessageSender).tab?.id) {
      chrome.sidePanel.open({ tabId: (_sender as chrome.runtime.MessageSender).tab!.id! })
    }

    // PDF relay: sidepanel calls STORE_PDF, pdf-viewer.html calls GET_PDF
    if (message.type === 'STORE_PDF') {
      _pendingPdf = (message as { type: string; pdf_base64: string }).pdf_base64 ?? null
      sendResponse({ ok: true })
      return true
    }
    if (message.type === 'GET_PDF') {
      sendResponse({ pdf_base64: _pendingPdf })
      _pendingPdf = null
      return true
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
