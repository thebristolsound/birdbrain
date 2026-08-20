import {
  getStatus,
  sendMhtmlCapture,
  getActiveSelectors,
  createSelector
} from '@extension/utils/api'
import { normalizeResponseHeaders } from '@extension/utils/headers'
import { removeInjectedBirdbrainUi } from '@extension/captureHygiene'
import { CaptureUiSuppressionError, createCaptureSuppression } from '@extension/captureSuppression'
import { MAX_SCREENSHOT_BITMAP_BYTES } from '@shared/constants'
import { matchIgnoredUrl } from '@shared/urlPatterns'
import type { ActiveSelectorsResult, SelectorMatchInfo } from '@shared/schemas'
import type { ManualCaptureResponse, PopupBlock, PopupPageStatus } from '@extension/messages'

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

// A screenshot path that reports it could not clear the page aborts the whole
// capture rather than just the screenshot: the MHTML collected in the same
// bracket is a snapshot of that same uncleaned page, and shipping it as an
// ordinary screenshot-less capture would store evidence that cannot be shown
// clean while telling the operator nothing (#386).
function pageNotCleanError(detail: unknown): CaptureUiSuppressionError {
  return new CaptureUiSuppressionError([detail ?? 'teardown failed'])
}

async function captureScreenshot(tabId: number): Promise<Blob | undefined> {
  let windowId: number
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.active || tab.windowId === chrome.windows.WINDOW_ID_NONE) {
      return undefined
    }
    windowId = tab.windowId
  } catch {
    return undefined
  }
  // The viewport path is reached directly and as the fallback of the two
  // full-page paths, so it re-runs suppression immediately before its frame
  // (#386). Deliberately outside the catch below: a page that cannot be
  // cleared aborts the capture rather than dropping only the screenshot,
  // because the MHTML collected alongside it carries the same injected nodes.
  await prepareTabForCapture(tabId)
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch (err) {
    console.warn('[Birdbrain] Viewport screenshot failed:', String(err))
    return undefined
  }
}

async function captureFullPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE',
      maxBytes: MAX_SCREENSHOT_BITMAP_BYTES
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.suppressionFailed) throw pageNotCleanError(response.error)
    if (response?.error) {
      console.warn(
        '[Birdbrain] Full-page capture failed, falling back to viewport:',
        response.error
      )
    }
    return captureScreenshot(tabId)
  } catch (err) {
    if (err instanceof CaptureUiSuppressionError) throw err
    console.warn('[Birdbrain] Full-page capture threw, falling back to viewport:', String(err))
    return captureScreenshot(tabId)
  }
}

async function captureScrollingPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE_SCROLLING',
      maxBytes: MAX_SCREENSHOT_BITMAP_BYTES,
      scrollTimeoutMs: 120_000
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.suppressionFailed) throw pageNotCleanError(response.error)
    if (response?.error) {
      console.warn(
        '[Birdbrain] Scrolling capture failed, falling back to full-page:',
        response.error
      )
    }
    // Fallback to non-scrolling full-page capture
    return captureFullPageScreenshot(tabId)
  } catch (err) {
    if (err instanceof CaptureUiSuppressionError) throw err
    console.warn('[Birdbrain] Scrolling capture threw, falling back to full-page:', String(err))
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

function matchesDefaultIgnore(url: string): boolean {
  return DEFAULT_IGNORE.some((pattern) => pattern.test(url))
}

// Deduplication: url -> timestamp of last capture
const dedupeMap = new Map<string, number>()
// HOTFIX: auto-capture temporarily disabled — dedupe window only used by auto paths
// let dedupeWindowMs = 60_000
const CONTEXT_MENU_PARENT_ID = 'birdbrain-parent'
const CONTEXT_MENU_FULL_PAGE_ID = 'birdbrain-capture-full-page'
const CONTEXT_MENU_SCROLLING_ID = 'birdbrain-capture-scrolling'
const SELECTOR_CONTEXT_MENU_ID = 'birdbrain-create-selector'

// Selector capture dedupe: caseId:url -> timestamp
const selectorDedupeMap = new Map<string, number>()

// Manual capture in-flight guard: tabId:caseId -> true while capture is in progress
const pendingManualCaptures = new Set<string>()

function isCapturingTab(tabId: number): boolean {
  const prefix = `${tabId}:`
  for (const key of pendingManualCaptures) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

// What the popup's page-status block is answered from. Both maps are service
// worker memory and nothing more: MV3 evicts the worker and they go with it,
// which is why the popup treats a miss as "not seen here" rather than as
// "never captured" (there is no capture lookup by URL — see #392).
const lastCaptureByTab = new Map<number, { url: string; at: number; manifestIndex: number | null }>()
const selectorSummaryByTab = new Map<number, { url: string; selectors: number; hits: number }>()

// Capture-UI suppression (#379, #386): the single suppress/restore boundary
// every capture runs inside. While a tab is collecting frames nothing may
// inject UI into it — checkSelectorsOnTab bails and capture toasts are skipped
// — or a concurrent capture's MHTML/screenshots would pick the injected nodes
// up. Restore runs when the capture settles, including on the failure path.
const captureSuppression = createCaptureSuppression({
  suppress: prepareTabForCapture,
  restore: async (tabId) => {
    await restoreSelectorHighlights(tabId)
    // A capture that settled while another was mid-frame had its toast held
    // back; the tab may be idle now that this one has released its slot.
    flushHeldToast(tabId)
  }
})

// Progress toasts are dropped while the tab is collecting frames: showing one
// would inject it into another capture's frames, and by the time the tab is
// idle it no longer describes anything.
function sendToastWhenCaptureIdle(tabId: number, message: Record<string, unknown>): void {
  if (captureSuppression.isCollectingFrames(tabId)) return
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

// How a capture ended is the operator's only signal that it succeeded or
// failed, so it is held rather than dropped and delivered once the tab goes
// idle. One held message per tab, latest wins: the toast is a single element
// that each message overwrites anyway.
const heldToastByTab = new Map<number, Record<string, unknown>>()

function sendCaptureOutcomeToast(tabId: number, message: Record<string, unknown>): void {
  if (captureSuppression.isCollectingFrames(tabId)) {
    heldToastByTab.set(tabId, message)
    return
  }
  // Anything already held belongs to a capture that settled earlier and is
  // left for the flush below, so a failure is not overwritten by a later
  // capture's success.
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

function flushHeldToast(tabId: number): void {
  if (captureSuppression.isCollectingFrames(tabId)) return
  const message = heldToastByTab.get(tabId)
  if (!message) return
  heldToastByTab.delete(tabId)
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

async function prepareTabForCapture(tabId: number): Promise<void> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PREPARE_FOR_CAPTURE' })
    if (response?.ok === true) return
    console.warn('[Birdbrain] In-page suppression incomplete:', response?.failures)
  } catch {
    // An extension reload can orphan an old content script: its DOM remains but
    // the new service worker cannot message it.
  }
  // Reached when the content script is unreachable or could not clear its own
  // UI. Execute the cleanup from the current extension before collecting
  // evidence; if this also fails, the rejection aborts the capture rather than
  // capturing DOM whose cleanliness cannot be established.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: removeInjectedBirdbrainUi
  })
}

// Puts back the selector highlights suppression stripped. Runs on the error
// path too, so a failed capture never leaves the page unhighlighted. The tab's
// URL is re-read rather than reused from capture time: the tab may have
// navigated during the capture, and the ignore-pattern checks must run against
// the page that is there now. checkSelectorsOnTab bails while any capture on
// the tab is still collecting frames, so a concurrent capture never has marks
// re-injected under its snapshot.
async function restoreSelectorHighlights(tabId: number): Promise<void> {
  if (activeSelectors.length === 0) return
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.url) await checkSelectorsOnTab(tabId, tab.url)
  } catch {
    // The tab may have closed during the capture — nothing left to restore
  }
}

// --- Response header capture (#119) ---
// Cache the latest main_frame response headers per tab so the capture paths can
// attach them. Keyed by tabId; we store the URL alongside the headers and only
// hand them to a capture when the URL still matches, guarding against a tab that
// navigated away between onHeadersReceived and the capture call.
const responseHeadersByTab = new Map<number, { url: string; headers: Record<string, string> }>()

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return undefined
    responseHeadersByTab.set(details.tabId, {
      url: details.url,
      headers: normalizeResponseHeaders(details.responseHeaders)
    })
    return undefined
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders']
)

// Clear a tab's cached headers on navigation start so we never attach stale
// headers from a previous page to a capture of the new one.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return undefined
    responseHeadersByTab.delete(details.tabId)
    return undefined
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }
)

chrome.tabs.onRemoved.addListener((tabId) => {
  responseHeadersByTab.delete(tabId)
  heldToastByTab.delete(tabId)
  lastCaptureByTab.delete(tabId)
  selectorSummaryByTab.delete(tabId)
})

// Returns the cached headers for a tab only when they belong to the URL being
// captured; otherwise undefined (no headers anchored rather than wrong ones).
function getHeadersForCapture(tabId: number, url: string): Record<string, string> | undefined {
  const cached = responseHeadersByTab.get(tabId)
  if (!cached || cached.url !== url) return undefined
  return Object.keys(cached.headers).length > 0 ? cached.headers : undefined
}

let connected = false
let sessionActive = false
let captureCount = 0

// Selector state
let activeSelectors: ActiveSelectorsResult = []
// HOTFIX: auto-capture temporarily disabled
// let autoCaptureMode: string = 'notify'
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
    // HOTFIX: auto-capture temporarily disabled
    // autoCaptureMode = status.autoCaptureMode || 'notify'
    availableCases = status.cases || []
    activeCaseId = status.activeCase?.id || null
    userIgnoredPatterns = status.ignoredUrlPatterns || []
    captureScreenshotsEnabled = status.captureScreenshots !== false
    // dedupeWindowMs = (status.dedupeWindowSeconds ?? 60) * 1000

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
      // The cached per-tab match summaries counted the previous case's
      // selectors, so the popup would otherwise attribute them to the new one.
      selectorSummaryByTab.clear()
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

// Poll for status using chrome.alarms for MV3 service worker persistence.
// MV3 enforces a minimum repeating alarm period of 0.5 minutes (30 s);
// values below that are silently clamped by Chrome.
const ALARM_STATUS_CHECK = 'birdbrain-status-check'

// Initial check on startup
checkStatus()

// Set up alarm for periodic status checks (30 s — the MV3 minimum)
chrome.alarms.get(ALARM_STATUS_CHECK, (existing) => {
  if (!existing) {
    chrome.alarms.create(ALARM_STATUS_CHECK, { periodInMinutes: 0.5 })
  }
})

// Handle alarm to check status
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_STATUS_CHECK) {
    checkStatus()
  }
})

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

    sendToastWhenCaptureIdle(tab.id, {
      type: 'SHOW_CAPTURE_TOAST',
      status: 'capturing',
      message: 'Creating selector...'
    })
    sendToastWhenCaptureIdle(tab.id, {
      type: 'UPDATE_CAPTURE_TOAST',
      status: 'capturing',
      message: 'Creating selector...'
    })
    try {
      await createSelector({
        caseId: activeCaseId,
        pattern: selectedText,
        label
      })

      sendToastWhenCaptureIdle(tab.id, {
        type: 'UPDATE_CAPTURE_TOAST',
        status: 'success',
        message: 'Selector created'
      })

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

      sendToastWhenCaptureIdle(tab.id, {
        type: 'UPDATE_CAPTURE_TOAST',
        status: 'error',
        message
      })
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
  if (blockedCaptureReason(tab.url) !== null) return

  const targetCaseId = activeCaseId
  if (!targetCaseId) {
    console.warn('[Birdbrain] Manual capture skipped: no active case')
    return
  }

  const scrolling = info.menuItemId === CONTEXT_MENU_SCROLLING_ID
  manualCaptureTab(tab.id, tab.url, targetCaseId, scrolling)
})

// --- Capture orchestration ---

// Same matcher the capture server runs, so a URL this side skips is the one the
// server would refuse. Regex literals use the platform RegExp here: the service
// worker has no vm sandbox, and a runaway pattern stalls only the extension,
// not the app. The cost is that this side has no timeout where the server does,
// so a pattern that exhausts the server's budget is skipped here and accepted
// there — see matchIgnoredUrl.
//
// THE seam: this is the only function in the extension that reads the
// operator's ignore patterns, and every route that needs an answer asks it —
// the context-menu capture handler above, the popup's MANUAL_CAPTURE message
// and its page-status query, and checkSelectorsOnTab, all through
// blockedCaptureReason below. Anything that widens or narrows the list (the
// per-case exclusions of #400) changes it here and nowhere else; in particular
// the popup never matches patterns itself, it asks.
//
// It returns the matched pattern rather than a boolean because every caller
// that blocks something also has to say which rule did it — the server's 403
// names the pattern for the same reason — and a second lookup for the text
// would be a second place patterns are read.
function isIgnoredByUser(url: string): string | null {
  return matchIgnoredUrl(url, userIgnoredPatterns)
}

// Why a capture of `url` would be refused before it is attempted, or null when
// nothing refuses it. The built-in scheme list is reported without a pattern —
// it is not an operator rule and there is nothing useful to name.
function blockedCaptureReason(url: string): PopupBlock | null {
  if (matchesDefaultIgnore(url)) return { reason: 'default', pattern: null }
  const pattern = isIgnoredByUser(url)
  return pattern === null ? null : { reason: 'user', pattern }
}

// The popup's view of one tab. Read-only: taking it must not scan the page or
// touch the network, because it runs every time the popup polls.
function pageStatusForTab(tabId: number, url: string | undefined): PopupPageStatus {
  const activeSelectorCount = activeSelectors.reduce((sum, g) => sum + g.selectors.length, 0)
  if (!url) {
    return {
      url: null,
      blocked: null,
      capturing: false,
      lastCapture: null,
      selectorSummary: null,
      activeSelectorCount
    }
  }
  // Both caches are keyed by tab but matched on URL: a tab that navigated away
  // must not inherit the previous page's capture record or match counts.
  const lastCapture = lastCaptureByTab.get(tabId)
  const summary = selectorSummaryByTab.get(tabId)
  return {
    url,
    blocked: blockedCaptureReason(url),
    capturing: isCapturingTab(tabId),
    lastCapture:
      lastCapture?.url === url
        ? { at: lastCapture.at, manifestIndex: lastCapture.manifestIndex }
        : null,
    selectorSummary:
      summary?.url === url ? { selectors: summary.selectors, hits: summary.hits } : null,
    activeSelectorCount
  }
}

// HOTFIX: auto-capture temporarily disabled — shouldCapture/captureTab (session auto-capture)
// and shouldSelectorCapture/handleSelectorCapture (selector auto-capture) are commented out.
// Manual capture (popup camera button + context menu) is unaffected.
/*
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
      httpStatus: 200,
      headers: getHeadersForCapture(tabId, url)
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('[Birdbrain] Auto-capture failed:', err)
    let message = 'Capture failed'
    if (err && typeof err === 'object' && 'status' in err) {
      const apiErr = err as { status: number; detail: string }
      if (apiErr.status === 400) message = 'Capture rejected: ' + apiErr.detail
      else if (apiErr.status === 403) message = 'URL is blacklisted'
      else if (apiErr.status === 500) message = 'Server error - check Birdbrain app'
    } else if (err instanceof TypeError) {
      message = "Can't reach Birdbrain - is it running?"
    }
    chrome.tabs
      .sendMessage(tabId, { type: 'UPDATE_CAPTURE_TOAST', status: 'error', message })
      .catch(() => {})
  }
}
*/

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
    // The whole capture runs inside the suppression boundary: injected
    // extension UI (toast, selector highlights) is stripped before any frame or
    // DOM snapshot is taken — otherwise the toast is baked into the screenshots
    // and every injected node is serialised into the MHTML — and restored when
    // the capture settles. Toasts are deferred until the frames are collected.
    await captureSuppression.withSuppression(tabId, async ({ collectFrames }) => {
      const { frames, lastOnTab } = await collectFrames(() =>
        Promise.all([
          captureMhtml(tabId),
          chrome.tabs.get(tabId),
          getPlainTextFromTab(tabId),
          captureScreenshotsEnabled
            ? scrolling
              ? captureScrollingPageScreenshot(tabId)
              : captureFullPageScreenshot(tabId)
            : Promise.resolve(undefined)
        ])
      )
      const [mhtmlBlob, tab, textContent, screenshot] = frames

      // The last capture to finish collecting frames owns the upload toast.
      if (lastOnTab) sendToastWhenCaptureIdle(tabId, { type: 'SHOW_CAPTURE_TOAST' })

      const result = await sendMhtmlCapture({
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
        httpStatus: 200,
        headers: getHeadersForCapture(tabId, url)
      })

      // The only record the extension keeps of a capture. It backs the popup's
      // "Captured N min ago" line and nothing else — no evidence claim rides
      // on it, and the app remains the authority on what was stored.
      lastCaptureByTab.set(tabId, {
        url,
        at: Date.now(),
        manifestIndex: result.manifestIndex ?? null
      })

      const toastStatus = result.screenshotStatus === 'dropped' ? 'degraded' : 'success'
      const toastMessage =
        result.screenshotStatus === 'dropped' ? 'Captured (screenshot too large)' : undefined
      if (lastOnTab) {
        sendCaptureOutcomeToast(tabId, {
          type: 'UPDATE_CAPTURE_TOAST',
          status: toastStatus,
          message: toastMessage
        })
      }
    })
  } catch (err) {
    console.error('[Birdbrain] Manual capture failed:', err)
    let message = 'Capture failed'
    if (err instanceof CaptureUiSuppressionError) {
      message = 'Capture aborted: Birdbrain UI could not be removed from the page'
    } else if (err && typeof err === 'object' && 'status' in err) {
      const apiErr = err as { status: number; detail: string }
      if (apiErr.status === 400) message = 'Capture rejected: ' + apiErr.detail
      else if (apiErr.status === 403) message = 'URL is blacklisted'
      else if (apiErr.status === 404) message = 'Case not found'
      else if (apiErr.status === 500) message = 'Server error - check Birdbrain app'
    } else if (err instanceof TypeError) {
      message = "Can't reach Birdbrain - is it running?"
    }
    // Reported outside the boundary, so this capture no longer counts as
    // collecting: the toast is shown only when the tab has no capture left
    // mid-frame that it would appear inside — and held until that one settles
    // otherwise, so a failure is never silent.
    sendCaptureOutcomeToast(tabId, { type: 'UPDATE_CAPTURE_TOAST', status: 'error', message })
  } finally {
    pendingManualCaptures.delete(key)
  }
}

/*
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
      headers: getHeadersForCapture(tabId, url),
      matchedSelectors: []
    })
    selectorDedupeMap.set(caseId + ':' + url, Date.now())
  } catch (err) {
    console.error('Selector capture failed:', err)
  }
}
*/

async function checkSelectorsOnTab(tabId: number, url: string): Promise<void> {
  if (activeSelectors.length === 0) return
  // Capture-UI suppression (#379, #386): never inject highlights while a
  // capture is collecting frames on this tab — onUpdated, checkStatus's
  // case-change re-scan and a finished concurrent capture's restore all route
  // through here. The suppression boundary re-runs this when the capture ends.
  if (captureSuppression.isCollectingFrames(tabId)) return
  if (blockedCaptureReason(url) !== null) return

  try {
    const matches = (await chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_SELECTORS',
      selectors: activeSelectors
    })) as SelectorMatchInfo[]

    // The scan is the only thing that knows which selectors hit this page, and
    // it has been discarding that after the badge update. Keep the counts the
    // popup's match-summary line reports — including a scan that matched
    // nothing, which is the difference between "no selectors matched" and
    // "this page was never scanned".
    const hits = matches ?? []
    selectorSummaryByTab.set(tabId, {
      url,
      selectors: new Set(hits.map((m) => m.selectorId)).size,
      hits: hits.length
    })

    if (hits.length === 0) return

    // Update badge to show match count
    chrome.action.setBadgeText({ text: String(hits.length) })
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' })

    // HOTFIX: auto-capture temporarily disabled — selector matches only update the badge
    /*
    // Group matches by case
    const caseMatches = new Map<string, typeof matches>()
    for (const m of matches) {
      if (!caseMatches.has(m.caseId)) caseMatches.set(m.caseId, [])
      caseMatches.get(m.caseId)!.push(m)
    }

    if (autoCaptureMode === 'auto') {
      // Auto-capture for each matching case
      for (const [caseId] of caseMatches) {
        handleSelectorCapture(tabId, url, caseId)
      }
    }
    */
  } catch {
    // Content script may not be ready
  }
}

// Listen for page load completions
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // HOTFIX: auto-capture temporarily disabled
    /*
    // Existing session capture
    if (shouldCapture(tab.url)) {
      captureTab(tabId, tab.url)
    }
    */

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
  // Reject messages from other extensions
  if (sender.id !== chrome.runtime.id) return false

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

  if (message.type === 'CASE_ACTIVATED') {
    // The popup switches the active case against the capture server directly,
    // so the background would not notice until the next 30 s status alarm — and
    // until then its selectors, highlights and cached per-tab match summaries
    // all still belong to the case the operator just left. Re-poll now, and
    // answer only once that has landed so the popup's next page-status read
    // sees the new case rather than the old one's counts.
    checkStatus().then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === 'GET_PAGE_STATUS' && message.tabId) {
    chrome.tabs.get(message.tabId, (tab) => {
      sendResponse(pageStatusForTab(message.tabId, tab?.url))
    })
    return true
  }

  if (message.type === 'MANUAL_CAPTURE' && message.tabId && message.caseId) {
    chrome.tabs.get(message.tabId, (tab) => {
      // The URL is re-read here rather than taken from the popup: the tab may
      // have navigated between the popup rendering its Capture button and the
      // click, and the ignore rules must be applied to the page that is there
      // now — the same reason restoreSelectorHighlights re-reads it.
      const url = tab?.url
      if (!url) {
        sendResponse({ started: false, blocked: null } satisfies ManualCaptureResponse)
        return
      }
      const blocked = blockedCaptureReason(url)
      if (blocked) {
        sendResponse({ started: false, blocked } satisfies ManualCaptureResponse)
        return
      }
      manualCaptureTab(message.tabId, url, message.caseId)
      sendResponse({ started: true, blocked: null } satisfies ManualCaptureResponse)
    })
    return true
  }

  return true
})

// Clear state when session stops
chrome.runtime.onMessage.addListener((message, sender) => {
  // Reject messages from other extensions
  if (sender.id !== chrome.runtime.id) return false

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
