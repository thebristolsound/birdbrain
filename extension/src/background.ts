import { checkConnection, getStatus, sendCapture } from '@extension/utils/api'

// URL patterns to ignore
const DEFAULT_IGNORE = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^about:/,
  /^devtools:/,
  /^data:/,
  /^file:/,
  /localhost:19845/
]

// Deduplication: url -> timestamp of last capture
const dedupeMap = new Map<string, number>()
const DEDUPE_WINDOW_MS = 60_000

let connected = false
let sessionActive = false
let captureCount = 0

// --- Connection management ---

async function checkStatus(): Promise<void> {
  try {
    const status = await getStatus()
    const wasConnected = connected
    connected = status.running
    sessionActive = status.sessionActive
    captureCount = status.captureCount

    if (connected && !wasConnected) {
      updateIcon('connected')
    } else if (!connected && wasConnected) {
      updateIcon('disconnected')
    }

    if (sessionActive) {
      updateIcon('active')
      chrome.action.setBadgeText({ text: String(captureCount) })
    } else if (connected) {
      updateIcon('connected')
      chrome.action.setBadgeText({ text: '' })
    }
  } catch {
    connected = false
    sessionActive = false
    updateIcon('disconnected')
  }
}

// Poll for status
setInterval(() => {
  checkStatus()
}, connected ? 30_000 : 5_000)

// Initial check
checkStatus()

// --- Capture orchestration ---

function shouldCapture(url: string): boolean {
  if (!sessionActive || !connected) return false
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(url))) return false

  // Dedupe check
  const lastCapture = dedupeMap.get(url)
  if (lastCapture && Date.now() - lastCapture < DEDUPE_WINDOW_MS) return false

  return true
}

async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    // Extract page content via content script
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' }) as {
      html: string
      title: string
      textContent: string
    }

    // Take screenshot
    let screenshot: string | undefined
    try {
      screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
      // Remove data:image/png;base64, prefix
      screenshot = screenshot.replace(/^data:image\/png;base64,/, '')
    } catch {
      // Screenshot may fail (e.g., restricted pages)
    }

    // Send to local server
    await sendCapture({
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent
    })

    // Update dedupe map
    dedupeMap.set(url, Date.now())

    // Update badge
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('Capture failed:', err)
  }
}

// Listen for page load completions
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && shouldCapture(tab.url)) {
    captureTab(tabId, tab.url)
  }
})

// --- Icon/badge management ---

type IconState = 'active' | 'connected' | 'disconnected'

function updateIcon(state: IconState): void {
  const suffix = state === 'active' ? '-active' : ''
  const iconPath = {
    16: `icons/icon-16${suffix}.png`,
    48: `icons/icon-48${suffix}.png`,
    128: `icons/icon-128${suffix}.png`
  }

  chrome.action.setIcon({ path: iconPath }).catch(() => {
    // Icon files may not exist yet
  })

  if (state === 'disconnected') {
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' })
  } else if (state === 'active') {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
  } else {
    chrome.action.setBadgeText({ text: '' })
  }
}

// --- Message handling from popup ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    sendResponse({ connected, sessionActive, captureCount })
  }
  return true
})

// Clear dedupe map when session stops
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SESSION_STOPPED') {
    dedupeMap.clear()
    captureCount = 0
  }
})
