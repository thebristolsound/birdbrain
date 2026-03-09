import {
  checkConnection,
  getStatus,
  sendCapture,
  getActiveSelectors,
  sendSelectorCapture
} from '@extension/utils/api'

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

// Selector capture dedupe: caseId:url -> timestamp
const selectorDedupeMap = new Map<string, number>()

let connected = false
let sessionActive = false
let captureCount = 0

// Selector state
let activeSelectors: Array<{
  caseId: string
  caseName: string
  selectors: Array<{
    id: string
    pattern: string
    isRegex: boolean
    enabled: boolean
  }>
}> = []
let autoCaptureMode: string = 'notify'

// --- Connection management ---

async function checkStatus(): Promise<void> {
  try {
    const status = await getStatus()
    const wasConnected = connected
    connected = status.running
    sessionActive = status.sessionActive
    captureCount = status.captureCount
    autoCaptureMode = status.autoCaptureMode || 'notify'

    if (connected && !wasConnected) {
      updateIcon('connected')
    } else if (!connected && wasConnected) {
      updateIcon('disconnected')
    }

    if (sessionActive) {
      updateIcon('active')
      chrome.action.setBadgeText({ text: String(captureCount) })

      // Fetch active selectors when session is active
      try {
        activeSelectors = await getActiveSelectors()
      } catch {
        activeSelectors = []
      }
    } else if (connected) {
      updateIcon('connected')
      chrome.action.setBadgeText({ text: '' })
      activeSelectors = []
    }

    // Update context menu enabled state
    chrome.contextMenus.update(CONTEXT_MENU_ID, {
      enabled: connected && sessionActive
    }).catch(() => {
      // Menu may not exist yet
    })
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

// --- Context menu for manual capture ---

const CONTEXT_MENU_ID = 'birdbrain-capture-page'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Capture with Birdbrain',
    contexts: ['page'],
    enabled: false
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return
  if (!tab?.id || !tab.url) return
  if (!sessionActive || !connected) return

  // Manual capture — skip dedupe (user explicitly chose to capture)
  captureTab(tab.id, tab.url)
})

// --- Capture orchestration ---

function shouldCapture(url: string): boolean {
  if (!sessionActive || !connected) return false
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(url))) return false

  // Dedupe check
  const lastCapture = dedupeMap.get(url)
  if (lastCapture && Date.now() - lastCapture < DEDUPE_WINDOW_MS) return false

  return true
}

function shouldSelectorCapture(caseId: string, url: string): boolean {
  const key = `${caseId}:${url}`
  const last = selectorDedupeMap.get(key)
  if (last && Date.now() - last < DEDUPE_WINDOW_MS) return false
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

async function handleSelectorCapture(
  tabId: number,
  url: string,
  caseId: string
): Promise<void> {
  if (!shouldSelectorCapture(caseId, url)) return

  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' }) as {
      html: string
      title: string
      textContent: string
    }

    let screenshot: string | undefined
    try {
      screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
      screenshot = screenshot.replace(/^data:image\/png;base64,/, '')
    } catch {
      // Screenshot may fail
    }

    await sendSelectorCapture({
      caseId,
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent,
      matchedSelectors: []
    })

    selectorDedupeMap.set(`${caseId}:${url}`, Date.now())
  } catch (err) {
    console.error('Selector capture failed:', err)
  }
}

async function checkSelectorsOnTab(tabId: number, url: string): Promise<void> {
  if (activeSelectors.length === 0) return
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(url))) return

  try {
    const matches = await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_SELECTORS',
      selectors: activeSelectors
    }) as Array<{
      selectorId: string
      caseId: string
      caseName: string
      pattern: string
      matchText: string
      context: string
      index: number
    }>

    if (!matches || matches.length === 0) return

    // Group matches by case
    const caseMatches = new Map<string, typeof matches>()
    for (const m of matches) {
      if (!caseMatches.has(m.caseId)) caseMatches.set(m.caseId, [])
      caseMatches.get(m.caseId)!.push(m)
    }

    // Update badge to show match count
    chrome.action.setBadgeText({ text: String(matches.length) })
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' })

    if (autoCaptureMode === 'auto') {
      // Auto-capture for each matching case
      for (const [caseId] of caseMatches) {
        handleSelectorCapture(tabId, url, caseId)
      }
    } else {
      // Notify mode — show notification
      const caseNames = [...new Set(matches.map((m) => m.caseName))]
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Birdbrain: Selector Matches',
        message: `${matches.length} match${matches.length !== 1 ? 'es' : ''} found for: ${caseNames.join(', ')}`
      })
    }
  } catch {
    // Content script may not be ready
  }
}

// Listen for page load completions
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Existing session capture
    if (shouldCapture(tab.url)) {
      captureTab(tabId, tab.url)
    }

    // Selector matching (independent of session capture)
    if (sessionActive && activeSelectors.length > 0) {
      checkSelectorsOnTab(tabId, tab.url)
    }
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

// --- Message handling from popup and content script ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE') {
    sendResponse({
      connected,
      sessionActive,
      captureCount,
      activeSelectorCount: activeSelectors.reduce(
        (sum, g) => sum + g.selectors.length,
        0
      ),
      activeCaseCount: activeSelectors.length
    })
  }

  if (message.type === 'SELECTOR_CAPTURE' && sender.tab?.id && sender.tab?.url) {
    handleSelectorCapture(sender.tab.id, sender.tab.url, message.caseId)
  }

  return true
})

// Clear state when session stops
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SESSION_STOPPED') {
    dedupeMap.clear()
    selectorDedupeMap.clear()
    captureCount = 0
    activeSelectors = []

    // Clear highlights on all tabs
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {
            // Tab may not have content script
          })
        }
      }
    })
  }
})
