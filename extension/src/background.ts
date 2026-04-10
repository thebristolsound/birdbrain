import {
  getStatus,
  sendMhtmlCapture,
  getActiveSelectors,
  createSelector
} from '@extension/utils/api'

function captureMhtml(tabId: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (blob) => {
      if (chrome.runtime.lastError || !blob) {
        reject(new Error(chrome.runtime.lastError?.message || 'pageCapture failed'))
        return
      }
      resolve(blob)
    })
  })
}

function getExtensionVersion(): string {
  return chrome.runtime.getManifest().version
}

function getUserAgentString(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : ''
}

function getBrowserVersion(): string {
  const match = typeof navigator !== 'undefined' ? navigator.userAgent.match(/Chrome\/(\S+)/) : null
  return match ? 'Chrome/' + match[1] : ''
}

async function getPlainTextFromTab(tabId: number): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText ?? ''
    })
    return (results[0]?.result as string) ?? ''
  } catch {
    return ''
  }
}

async function captureScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.active || tab.windowId === chrome.windows.WINDOW_ID_NONE) {
      return undefined
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch {
    return undefined
  }
}

const CAPTURE_MAX_BYTES = 100 * 1024 * 1024 // 100 MB

async function captureFullPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE',
      maxBytes: CAPTURE_MAX_BYTES
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.error) {
      console.warn(
        '[Birdbrain] Full-page capture failed, falling back to viewport:',
        response.error
      )
    }
    return captureScreenshot(tabId)
  } catch {
    return captureScreenshot(tabId)
  }
}

async function captureScrollingPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE_SCROLLING',
      maxBytes: CAPTURE_MAX_BYTES,
      scrollTimeoutMs: 120_000
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.error) {
      console.warn(
        '[Birdbrain] Scrolling capture failed, falling back to full-page:',
        response.error
      )
    }
    // Fallback to non-scrolling full-page capture
    return captureFullPageScreenshot(tabId)
  } catch {
    // Content script unreachable — fallback
    return captureFullPageScreenshot(tabId)
  }
}

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
let dedupeWindowMs = 60_000
const CONTEXT_MENU_PARENT_ID = 'birdbrain-parent'
const CONTEXT_MENU_FULL_PAGE_ID = 'birdbrain-capture-full-page'
const CONTEXT_MENU_SCROLLING_ID = 'birdbrain-capture-scrolling'
const SELECTOR_CONTEXT_MENU_ID = 'birdbrain-create-selector'

// Selector capture dedupe: caseId:url -> timestamp
const selectorDedupeMap = new Map<string, number>()

// Manual capture in-flight guard: tabId:caseId -> true while capture is in progress
const pendingManualCaptures = new Set<string>()

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
let availableCases: Array<{ id: string; name: string }> = []
let activeCaseId: string | null = null
let userIgnoredPatterns: string[] = []
let captureScreenshotsEnabled = true

// --- Connection management ---

async function checkStatus(): Promise<void> {
  try {
    const status = await getStatus()
    const wasConnected = connected
    const previousCaseId = activeCaseId
    connected = status.running
    sessionActive = status.sessionActive
    captureCount = status.captureCount
    autoCaptureMode = status.autoCaptureMode || 'notify'
    availableCases = status.cases || []
    activeCaseId = status.activeCase?.id || null
    userIgnoredPatterns = status.ignoredUrlPatterns || []
    captureScreenshotsEnabled = status.captureScreenshots !== false
    dedupeWindowMs = (status.dedupeWindowSeconds ?? 60) * 1000

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

    // Fetch active selectors whenever connected
    if (connected) {
      try {
        activeSelectors = await getActiveSelectors()
      } catch {
        activeSelectors = []
      }
    } else {
      activeSelectors = []
    }

    // If active case changed, clear old highlights and re-scan active tab
    if (connected && activeCaseId !== previousCaseId) {
      // Clear highlights on all tabs
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {})
          }
        }
      })

      // Re-scan the active tab with new case's selectors
      if (activeCaseId && activeSelectors.length > 0) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0]
          if (activeTab?.id && activeTab.url) {
            checkSelectorsOnTab(activeTab.id, activeTab.url)
          }
        })
      }
    }

    // Update context menu enabled state
    const menuEnabled = connected && !!activeCaseId
    chrome.contextMenus.update(CONTEXT_MENU_PARENT_ID, { enabled: menuEnabled }).catch(() => {})
    chrome.contextMenus.update(SELECTOR_CONTEXT_MENU_ID, { enabled: menuEnabled }).catch(() => {})
  } catch {
    connected = false
    sessionActive = false
    updateIcon('disconnected')
  }
}

// Poll for status
setInterval(
  () => {
    checkStatus()
  },
  connected ? 30_000 : 5_000
)

// Initial check
checkStatus()

// --- Context menu for manual capture ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PARENT_ID,
    title: 'Birdbrain',
    contexts: ['page'],
    enabled: false
  })
  chrome.contextMenus.create({
    id: CONTEXT_MENU_FULL_PAGE_ID,
    parentId: CONTEXT_MENU_PARENT_ID,
    title: 'Capture Full Page',
    contexts: ['page']
  })
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SCROLLING_ID,
    parentId: CONTEXT_MENU_PARENT_ID,
    title: 'Capture Full Page (Scrolling)',
    contexts: ['page']
  })
  chrome.contextMenus.create({
    id: SELECTOR_CONTEXT_MENU_ID,
    title: 'Create Selector from Selection',
    contexts: ['selection'],
    enabled: false
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === SELECTOR_CONTEXT_MENU_ID) {
    if (!tab?.id || !tab.url) return
    if (!connected) return
    if (!activeCaseId) return

    const selectedText = info.selectionText?.trim()
    if (!selectedText) return

    // Derive label from page hostname
    let label: string | undefined
    try {
      label = `from ${new URL(tab.url).hostname}`
    } catch {
      // Invalid URL, skip label
    }

    // Show "creating" toast
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'SHOW_CAPTURE_TOAST',
        status: 'capturing',
        message: 'Creating selector...'
      })
      .catch(() => {})

    chrome.tabs
      .sendMessage(tab.id, {
        type: 'UPDATE_CAPTURE_TOAST',
        status: 'capturing',
        message: 'Creating selector...'
      })
      .catch(() => {})
    try {
      await createSelector({
        caseId: activeCaseId,
        pattern: selectedText,
        label
      })

      chrome.tabs
        .sendMessage(tab.id, {
          type: 'UPDATE_CAPTURE_TOAST',
          status: 'success',
          message: 'Selector created'
        })
        .catch(() => {})

      // Re-fetch selectors and rehighlight current page
      try {
        activeSelectors = await getActiveSelectors()
        if (tab.url) {
          checkSelectorsOnTab(tab.id, tab.url)
        }
      } catch {
        // Non-critical — highlights will appear on next page load
      }
    } catch (err) {
      console.error('[Birdbrain] Create selector failed:', err)

      let message = 'Failed to create selector'
      if (err && typeof err === 'object' && 'status' in err) {
        const apiErr = err as { status: number; detail: string }
        if (apiErr.status === 400) message = `Selector rejected: ${apiErr.detail}`
        else if (apiErr.status === 404) message = 'Case not found'
      } else if (err instanceof TypeError) {
        message = "Can't reach Birdbrain — is it running?"
      }

      chrome.tabs
        .sendMessage(tab.id, {
          type: 'UPDATE_CAPTURE_TOAST',
          status: 'error',
          message
        })
        .catch(() => {})
    }
    return
  }

  if (
    info.menuItemId !== CONTEXT_MENU_FULL_PAGE_ID &&
    info.menuItemId !== CONTEXT_MENU_SCROLLING_ID
  )
    return
  if (!tab?.id || !tab.url) return
  if (!connected) return
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(tab.url!))) return
  if (isIgnoredByUser(tab.url!)) return

  const targetCaseId = activeCaseId
  if (!targetCaseId) {
    console.warn('[Birdbrain] Manual capture skipped: no active case')
    return
  }

  const scrolling = info.menuItemId === CONTEXT_MENU_SCROLLING_ID
  manualCaptureTab(tab.id, tab.url, targetCaseId, scrolling)
})

// --- Capture orchestration ---

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(withWildcards, 'i')
}

function isIgnoredByUser(url: string): boolean {
  for (const pattern of userIgnoredPatterns) {
    try {
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/')
        const re = new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1))
        if (re.test(url)) return true
      } else if (pattern.includes('*') || pattern.includes('?')) {
        if (globToRegex(pattern).test(url)) return true
      } else {
        if (url.includes(pattern)) return true
      }
    } catch {
      /* skip */
    }
  }
  return false
}

function shouldCapture(url: string): boolean {
  if (!sessionActive || !connected) return false
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(url))) return false
  if (isIgnoredByUser(url)) return false

  // Dedupe check
  const lastCapture = dedupeMap.get(url)
  if (lastCapture && Date.now() - lastCapture < dedupeWindowMs) return false

  return true
}

function shouldSelectorCapture(caseId: string, url: string): boolean {
  const key = `${caseId}:${url}`
  const last = selectorDedupeMap.get(key)
  if (last && Date.now() - last < dedupeWindowMs) return false
  return true
}

async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled ? captureScreenshot(tabId) : Promise.resolve(undefined)
    ])

    await sendMhtmlCapture({
      source: 'auto',
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      screenshot,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('Capture failed:', err)
  }
}

async function manualCaptureTab(
  tabId: number,
  url: string,
  caseId: string,
  scrolling: boolean = false
): Promise<void> {
  const key = `${tabId}:${caseId}`
  if (pendingManualCaptures.has(key)) return
  pendingManualCaptures.add(key)
  try {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_CAPTURE_TOAST' }).catch(() => {})

    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled
        ? scrolling
          ? captureScrollingPageScreenshot(tabId)
          : captureFullPageScreenshot(tabId)
        : Promise.resolve(undefined)
    ])

    await sendMhtmlCapture({
      source: 'manual',
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      screenshot,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    chrome.tabs
      .sendMessage(tabId, { type: 'UPDATE_CAPTURE_TOAST', status: 'success' })
      .catch(() => {})

    // Re-evaluate selector highlights after capture
    if (activeSelectors.length > 0) {
      checkSelectorsOnTab(tabId, url)
    }
  } catch (err) {
    console.error('[Birdbrain] Manual capture failed:', err)
    let message = 'Capture failed'
    if (err && typeof err === 'object' && 'status' in err) {
      const apiErr = err as { status: number; detail: string }
      if (apiErr.status === 400) message = 'Capture rejected: ' + apiErr.detail
      else if (apiErr.status === 403) message = 'URL is blacklisted'
      else if (apiErr.status === 404) message = 'Case not found'
      else if (apiErr.status === 500) message = 'Server error - check Birdbrain app'
    } else if (err instanceof TypeError) {
      message = "Can't reach Birdbrain - is it running?"
    }
    chrome.tabs
      .sendMessage(tabId, { type: 'UPDATE_CAPTURE_TOAST', status: 'error', message })
      .catch(() => {})
  } finally {
    pendingManualCaptures.delete(key)
  }
}

async function handleSelectorCapture(tabId: number, url: string, caseId: string): Promise<void> {
  if (!shouldSelectorCapture(caseId, url)) return
  try {
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled ? captureFullPageScreenshot(tabId) : Promise.resolve(undefined)
    ])
    await sendMhtmlCapture({
      source: 'selector',
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      screenshot,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200,
      matchedSelectors: []
    })
    selectorDedupeMap.set(caseId + ':' + url, Date.now())
  } catch (err) {
    console.error('Selector capture failed:', err)
  }
}

async function checkSelectorsOnTab(tabId: number, url: string): Promise<void> {
  if (activeSelectors.length === 0) return
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(url))) return
  if (isIgnoredByUser(url)) return

  try {
    const matches = (await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_SELECTORS',
      selectors: activeSelectors
    })) as Array<{
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
  if (message.type === 'REQUEST_VIEWPORT_CAPTURE') {
    const tab = sender.tab
    if (
      tab?.id == null ||
      tab?.windowId == null ||
      tab.windowId === chrome.windows.WINDOW_ID_NONE
    ) {
      sendResponse({ error: 'No tab ID or window ID' })
      return true
    }
    if (!tab.active) {
      sendResponse({ error: 'Tab is not the active tab; cannot capture visible tab' })
      return true
    }
    chrome.tabs
      .captureVisibleTab(tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: String(err) }))
    return true // keep channel open for async
  }

  if (message.type === 'GET_STATE') {
    sendResponse({
      connected,
      sessionActive,
      captureCount,
      activeSelectorCount: activeSelectors.reduce((sum, g) => sum + g.selectors.length, 0),
      activeCaseCount: activeSelectors.length,
      activeCaseId,
      availableCases
    })
  }

  if (message.type === 'MANUAL_CAPTURE' && message.tabId && message.caseId) {
    chrome.tabs.get(message.tabId, (tab) => {
      if (tab?.url) {
        manualCaptureTab(message.tabId, tab.url, message.caseId)
      }
    })
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
