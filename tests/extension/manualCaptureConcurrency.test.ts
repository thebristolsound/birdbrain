// Regression test for the concurrent-capture race (#379, PR #407 review):
// two manual captures for different cases on one tab must not re-inject
// selector highlights (CHECK_SELECTORS) or show a toast while either capture
// is still collecting its MHTML/screenshot frames — the finishing capture's
// restore path would otherwise bake extension UI into the in-flight one.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import type {
  ActiveSelectorsResult,
  CaptureServerStatus,
  CaptureUploadResult
} from '@shared/schemas'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getActiveSelectors: vi.fn(),
  sendMhtmlCapture: vi.fn(),
  createSelector: vi.fn()
}))

import { getStatus, getActiveSelectors, sendMhtmlCapture, createSelector } from '@extension/utils/api'
import { removeInjectedBirdbrainUi } from '../../extension/src/captureHygiene'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const TAB = { id: 1, url: 'https://example.test/page', title: 'Example', active: true, windowId: 1 }
const TAB2 = { id: 2, url: 'https://example.test/other', title: 'Other', active: false, windowId: 1 }

const runtimeListeners: Listener[] = []
let contextMenuListener: ((info: { menuItemId: string; selectionText?: string }, tab: typeof TAB) => Promise<void>) | undefined
const sentMessages: Array<{ tabId: number; type: string; status?: string }> = []
let rejectPrepare = false
const executeScriptCalls: Array<{ target: { tabId: number }; func: () => unknown }> = []
// One pending saveAsMHTML callback per in-flight capture, in start order —
// resolving one lets that capture finish while the other stays mid-frame
const mhtmlCallbacks: Array<(blob: Blob) => void> = []
const uploadResolvers: Array<(result: CaptureUploadResult) => void> = []
const uploadRejecters: Array<(err: unknown) => void> = []
// Simulates a mid-capture navigation: tabs.get reports this URL once set, so
// the finally-path re-read sees the navigated page, not the capture-time one
const tabUrlOverride = new Map<number, string>()

function sentOfType(type: string): number {
  return sentMessages.filter((m) => m.type === type).length
}

function sentOfTypeTo(type: string, tabId: number): number {
  return sentMessages.filter((m) => m.type === type && m.tabId === tabId).length
}

function dispatch(message: unknown): void {
  for (const listener of runtimeListeners) {
    listener(message, { id: EXTENSION_ID }, () => {})
  }
}

// Flush enough macrotask turns for the capture pipeline's awaits to settle
async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const STATUS: CaptureServerStatus = {
  running: true,
  activeCase: { id: 'case-a', name: 'Case A' },
  sessionActive: false,
  captureCount: 0,
  autoCaptureMode: 'notify',
  cases: [
    { id: 'case-a', name: 'Case A' },
    { id: 'case-b', name: 'Case B' }
  ],
  ignoredUrlPatterns: [],
  captureScreenshots: false,
  dedupeWindowSeconds: 60,
  theme: 'dark'
}

const SELECTOR_GROUPS: ActiveSelectorsResult = [
  {
    caseId: 'case-a',
    caseName: 'Case A',
    selectors: [
      {
        id: 'sel-1',
        caseId: 'case-a',
        pattern: 'evil@example.com',
        isRegex: false,
        enabled: true,
        createdAt: '2026-08-12T00:00:00.000Z'
      }
    ]
  }
]

const UPLOAD_RESULT: CaptureUploadResult = {
  captureId: 'cap-1',
  hash: 'deadbeef',
  status: 'ok',
  source: 'manual',
  screenshotStatus: 'none'
}

beforeAll(async () => {
  vi.mocked(getStatus).mockResolvedValue(STATUS)
  vi.mocked(getActiveSelectors).mockResolvedValue(SELECTOR_GROUPS)
  vi.mocked(sendMhtmlCapture).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        uploadResolvers.push(resolve)
        uploadRejecters.push(reject)
      })
  )
  vi.mocked(createSelector).mockResolvedValue({
    selector: {
      id: 'sel-created',
      caseId: 'case-1',
      pattern: 'x',
      isRegex: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    status: 'ok'
  })

  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
      getManifest: () => ({ version: '0.0.0-test' }),
      onMessage: { addListener: (fn: Listener) => runtimeListeners.push(fn) },
      onInstalled: { addListener: () => {} }
    },
    webRequest: {
      onHeadersReceived: { addListener: () => {} },
      onBeforeRequest: { addListener: () => {} }
    },
    tabs: {
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback([]),
      get: (tabId: number, callback?: (tab: typeof TAB) => void) => {
        const base = tabId === TAB2.id ? TAB2 : TAB
        const override = tabUrlOverride.get(tabId)
        const tab = override ? { ...base, url: override } : base
        if (callback) {
          callback(tab)
          return undefined
        }
        return Promise.resolve(tab)
      },
      sendMessage: (tabId: number, message: { type: string; status?: string }) => {
        sentMessages.push({ tabId, type: message.type, status: message.status })
        if (message.type === 'PREPARE_FOR_CAPTURE') {
          return rejectPrepare ? Promise.reject(new Error('Receiving end does not exist')) : Promise.resolve({ ok: true })
        }
        if (message.type === 'CHECK_SELECTORS') return Promise.resolve([])
        return Promise.resolve(undefined)
      }
    },
    pageCapture: {
      saveAsMHTML: (_details: unknown, callback: (blob: Blob) => void) => {
        mhtmlCallbacks.push(callback)
      }
    },
    scripting: {
      executeScript: (details: { target: { tabId: number }; func: () => unknown }) => {
        executeScriptCalls.push(details)
        return Promise.resolve([{ result: 'page text' }])
      }
    },
    action: {
      setIcon: () => Promise.resolve(),
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {}
    },
    contextMenus: {
      create: () => {},
      update: () => Promise.resolve(),
      onClicked: {
        addListener: (
          listener: (
            info: { menuItemId: string; selectionText?: string },
            tab: typeof TAB
          ) => Promise<void>
        ) => {
          contextMenuListener = listener
        }
      }
    },
    alarms: {
      get: (_name: string, callback: (alarm?: unknown) => void) => callback(undefined),
      create: () => {},
      onAlarm: { addListener: () => {} }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })

  // Side-effecting import: registers listeners and runs the initial checkStatus
  await import('../../extension/src/background')
  await flush()
})

describe('concurrent manual captures on one tab (#379)', () => {
  it('defers highlight restore and toasts until the last capture finishes', async () => {
    // Capture 1 (case-a) starts and blocks on saveAsMHTML
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()
    expect(sentOfType('PREPARE_FOR_CAPTURE')).toBe(1)
    expect(mhtmlCallbacks.length).toBe(1)

    // Capture 2 (case-b) starts on the same tab while capture 1 is mid-frame
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-b' })
    await flush()
    expect(sentOfType('PREPARE_FOR_CAPTURE')).toBe(2)
    expect(mhtmlCallbacks.length).toBe(2)

    // Creating a selector is another in-page toast route. It must remain
    // suppressed while either capture is collecting evidence.
    await contextMenuListener?.(
      { menuItemId: 'birdbrain-create-selector', selectionText: 'evil@example.com' },
      TAB
    )
    expect(vi.mocked(createSelector)).toHaveBeenCalledTimes(1)
    expect(sentOfType('SHOW_CAPTURE_TOAST')).toBe(0)
    expect(sentOfType('UPDATE_CAPTURE_TOAST')).toBe(0)

    // Capture 1 finishes frames while capture 2 is still collecting: nothing
    // may be injected into the page — no highlight restore, no toast
    mhtmlCallbacks[0](new Blob(['mhtml-1']))
    await flush()
    expect(sentOfType('CHECK_SELECTORS')).toBe(0)
    expect(sentOfType('SHOW_CAPTURE_TOAST')).toBe(0)
    expect(sentOfType('UPDATE_CAPTURE_TOAST')).toBe(0)

    // Capture 2 finishes frames while both uploads remain pending. Frame
    // suppression ends now, and the last frame collector owns the toast.
    mhtmlCallbacks[1](new Blob(['mhtml-2']))
    await flush()
    expect(sentOfType('SHOW_CAPTURE_TOAST')).toBe(1)
    expect(sentOfType('UPDATE_CAPTURE_TOAST')).toBe(0)
    expect(sentOfType('CHECK_SELECTORS')).toBe(0)

    uploadResolvers[0](UPLOAD_RESULT)
    uploadResolvers[1](UPLOAD_RESULT)
    await flush()
    expect(sentOfType('UPDATE_CAPTURE_TOAST')).toBe(1)
    expect(sentOfType('CHECK_SELECTORS')).toBe(2)
    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(2)
  })

  it('falls back to direct DOM cleanup when an orphaned content script cannot be messaged', async () => {
    const uploadBase = vi.mocked(sendMhtmlCapture).mock.calls.length
    rejectPrepare = true
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    const fallbackCalls = executeScriptCalls.filter((call) => call.func === removeInjectedBirdbrainUi)
    expect(fallbackCalls).toHaveLength(1)
    expect(fallbackCalls[0].target.tabId).toBe(TAB.id)
    expect(mhtmlCallbacks.length).toBe(3)

    mhtmlCallbacks[2](new Blob(['mhtml-3']))
    await flush()
    uploadResolvers[2](UPLOAD_RESULT)
    await flush()
    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(uploadBase + 1)
    rejectPrepare = false
  })

  it('gates per tab: an in-flight capture on one tab does not suppress another tab', async () => {
    // Counts to TAB accumulate across the tests above; assert on deltas.
    // Callback/resolver indices are baseline-relative for the same reason.
    const baselineShow = sentOfTypeTo('SHOW_CAPTURE_TOAST', TAB.id)
    const baselineCheck = sentOfTypeTo('CHECK_SELECTORS', TAB.id)
    const cbBase = mhtmlCallbacks.length
    const upBase = uploadResolvers.length

    // A capture on tab 1 starts and stays mid-frame throughout
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()
    // A capture on tab 2 starts and finishes while tab 1 is still collecting
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB2.id, caseId: 'case-a' })
    await flush()
    expect(mhtmlCallbacks.length).toBe(cbBase + 2)

    // Tab 2 dispatched second, so its frame callback is second past baseline
    mhtmlCallbacks[cbBase + 1](new Blob(['mhtml-tab2']))
    await flush()
    // Tab 2's frames are done and it is the only capture on that tab — a
    // global in-flight count would wrongly suppress this toast until tab 1
    // finished, which is exactly the regression this case pins down
    expect(sentOfTypeTo('SHOW_CAPTURE_TOAST', TAB2.id)).toBe(1)

    // Tab 2 reaches upload first, so its resolver is first past baseline
    expect(uploadResolvers.length).toBe(upBase + 1)
    uploadResolvers[upBase](UPLOAD_RESULT)
    await flush()
    expect(sentOfTypeTo('UPDATE_CAPTURE_TOAST', TAB2.id)).toBe(1)
    expect(sentOfTypeTo('CHECK_SELECTORS', TAB2.id)).toBe(1)
    // Tab 1 is still collecting frames: nothing may be injected there
    expect(sentOfTypeTo('SHOW_CAPTURE_TOAST', TAB.id)).toBe(baselineShow)
    expect(sentOfTypeTo('CHECK_SELECTORS', TAB.id)).toBe(baselineCheck)

    // Tab 1 finishes normally with its own toast and highlight restore
    mhtmlCallbacks[cbBase](new Blob(['mhtml-tab1']))
    await flush()
    expect(sentOfTypeTo('SHOW_CAPTURE_TOAST', TAB.id)).toBe(baselineShow + 1)
    expect(uploadResolvers.length).toBe(upBase + 2)
    uploadResolvers[upBase + 1](UPLOAD_RESULT)
    await flush()
    expect(sentOfTypeTo('CHECK_SELECTORS', TAB.id)).toBe(baselineCheck + 1)
  })

  it("holds a failed capture's error toast until the tab is idle instead of dropping it", async () => {
    const cbBase = mhtmlCallbacks.length
    const upBase = uploadResolvers.length
    const errorToasts = (): number =>
      sentMessages.filter(
        (m) => m.tabId === TAB.id && m.type === 'UPDATE_CAPTURE_TOAST' && m.status === 'error'
      ).length
    const baselineErrors = errorToasts()

    const baselineRelease = sentOfTypeTo('RELEASE_CAPTURE_UI', TAB.id)

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-b' })
    await flush()
    expect(mhtmlCallbacks.length).toBe(cbBase + 2)

    // Capture A finishes frames and then fails its upload while capture B is
    // still collecting: the error toast cannot be shown now — it would be
    // injected into B's frames — but it must not be lost either
    mhtmlCallbacks[cbBase](new Blob(['mhtml-a']))
    await flush()
    uploadRejecters[upBase](new Error('server exploded'))
    await flush()
    expect(errorToasts()).toBe(baselineErrors)
    // A's restore ran while B was mid-frame: the page-side suppression latch
    // (#393) must not be released under B's frames
    expect(sentOfTypeTo('RELEASE_CAPTURE_UI', TAB.id)).toBe(baselineRelease)

    // B finishes: the tab goes idle and A's failure finally reaches the operator
    mhtmlCallbacks[cbBase + 1](new Blob(['mhtml-b']))
    await flush()
    uploadResolvers[upBase + 1](UPLOAD_RESULT)
    await flush()
    expect(errorToasts()).toBe(baselineErrors + 1)
    // ...and only now, with no capture on the tab collecting frames, is the
    // latch released
    expect(sentOfTypeTo('RELEASE_CAPTURE_UI', TAB.id)).toBe(baselineRelease + 1)
  })

  it('skips highlight restore when the tab navigated to an ignored URL mid-capture', async () => {
    const baselineCheck = sentOfTypeTo('CHECK_SELECTORS', TAB2.id)
    const baselineUpdate = sentOfTypeTo('UPDATE_CAPTURE_TOAST', TAB2.id)
    const cbBase = mhtmlCallbacks.length
    const upBase = uploadResolvers.length

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB2.id, caseId: 'case-a' })
    await flush()
    expect(mhtmlCallbacks.length).toBe(cbBase + 1)

    // The tab navigates to an ignored URL while the capture is mid-frame: the
    // restore path must re-read the URL and run the ignore checks against it,
    // not against the capture-time URL (#379 post-merge review round)
    tabUrlOverride.set(TAB2.id, 'chrome://newtab/')
    mhtmlCallbacks[cbBase](new Blob(['mhtml-navigated']))
    await flush()
    expect(uploadResolvers.length).toBe(upBase + 1)
    uploadResolvers[upBase](UPLOAD_RESULT)
    await flush()

    // The capture itself completed with its toast...
    expect(sentOfTypeTo('UPDATE_CAPTURE_TOAST', TAB2.id)).toBe(baselineUpdate + 1)
    // ...but no highlights were re-injected into the ignored page
    expect(sentOfTypeTo('CHECK_SELECTORS', TAB2.id)).toBe(baselineCheck)
    tabUrlOverride.delete(TAB2.id)
  })
})
