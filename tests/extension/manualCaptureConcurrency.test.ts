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

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const TAB = { id: 1, url: 'https://example.test/page', title: 'Example', active: true, windowId: 1 }

const runtimeListeners: Listener[] = []
let contextMenuListener: ((info: { menuItemId: string; selectionText?: string }, tab: typeof TAB) => Promise<void>) | undefined
const sentMessages: Array<{ tabId: number; type: string }> = []
let rejectPrepare = false
let fallbackCleanupCount = 0
// One pending saveAsMHTML callback per in-flight capture, in start order —
// resolving one lets that capture finish while the other stays mid-frame
const mhtmlCallbacks: Array<(blob: Blob) => void> = []
const uploadResolvers: Array<(result: CaptureUploadResult) => void> = []

function sentOfType(type: string): number {
  return sentMessages.filter((m) => m.type === type).length
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
    () => new Promise((resolve) => uploadResolvers.push(resolve))
  )
  vi.mocked(createSelector).mockResolvedValue({ id: 'sel-created' })

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
      get: (_tabId: number, callback?: (tab: typeof TAB) => void) => {
        if (callback) {
          callback(TAB)
          return undefined
        }
        return Promise.resolve(TAB)
      },
      sendMessage: (tabId: number, message: { type: string }) => {
        sentMessages.push({ tabId, type: message.type })
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
        if (details.func.name === 'removeInjectedBirdbrainUi') fallbackCleanupCount++
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
    rejectPrepare = true
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    expect(fallbackCleanupCount).toBe(1)
    expect(mhtmlCallbacks.length).toBe(3)

    mhtmlCallbacks[2](new Blob(['mhtml-3']))
    await flush()
    uploadResolvers[2](UPLOAD_RESULT)
    await flush()
    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(3)
    rejectPrepare = false
  })
})
