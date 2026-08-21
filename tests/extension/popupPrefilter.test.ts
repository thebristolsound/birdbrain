// The popup's Capture button used to be the one live extension route with no
// ignore-list pre-filter: its MANUAL_CAPTURE message went straight to
// manualCaptureTab, so an operator's rule was enforced only by the capture
// server's 403 (#387). These cases pin the closed gap from the background side
// — the popup itself never matches a pattern, it asks — plus the page-status
// answer the rebuilt popup renders from.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type {
  ActiveSelectorsResult,
  CaptureServerStatus,
  CaptureUploadResult
} from '@shared/schemas'
import type { ManualCaptureResponse, PopupPageStatus } from '@extension/messages'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getActiveSelectors: vi.fn(),
  sendMhtmlCapture: vi.fn(),
  createSelector: vi.fn()
}))

import { getStatus, getActiveSelectors, sendMhtmlCapture } from '@extension/utils/api'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const CLEAN_URL = 'https://example.test/page'
const USER_IGNORED_URL = 'https://secret.example.test/inbox'
const IGNORE_PATTERN = 'secret.example.test'
const CHROME_URL = 'chrome://settings/'

const runtimeListeners: Listener[] = []
// Each tab reports whatever URL the case under test put there, so one chrome
// mock covers clean, operator-ignored and built-in-ignored pages.
const tabUrlById = new Map<number, string | undefined>()
const selectorMatchesByTab = new Map<number, unknown[]>()
const mhtmlCallbacks: Array<(blob: Blob) => void> = []
const uploadResolvers: Array<(result: CaptureUploadResult) => void> = []
let alarmListener: ((alarm: { name: string }) => void) | undefined

function tabFor(tabId: number): {
  id: number
  url?: string
  title: string
  active: boolean
  windowId: number
} {
  return { id: tabId, url: tabUrlById.get(tabId), title: 'Page', active: true, windowId: 1 }
}

function send(message: unknown, sendResponse: SendResponse = () => {}): void {
  for (const listener of runtimeListeners) {
    listener(message, { id: EXTENSION_ID }, sendResponse)
  }
}

async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// Dispatch and wait. Every popup-facing handler answers asynchronously —
// chrome.tabs.get takes a callback and CASE_ACTIVATED waits on a status poll —
// so the response is read after the flush, not from the dispatch.
async function ask<T>(message: unknown): Promise<T | undefined> {
  let captured: T | undefined
  send(message, (response) => {
    if (response !== undefined) captured = response as T
  })
  await flush()
  return captured
}

const STATUS: CaptureServerStatus = {
  running: true,
  activeCase: { id: 'case-a', name: 'Case A' },
  sessionActive: true,
  captureCount: 0,
  autoCaptureMode: 'notify',
  cases: [{ id: 'case-a', name: 'Case A' }],
  ignoredUrlPatterns: [IGNORE_PATTERN],
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
      },
      {
        id: 'sel-2',
        caseId: 'case-a',
        pattern: 'acme',
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
  manifestIndex: 42,
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
      get: (tabId: number, callback?: (tab: ReturnType<typeof tabFor>) => void) => {
        if (callback) {
          callback(tabFor(tabId))
          return undefined
        }
        return Promise.resolve(tabFor(tabId))
      },
      sendMessage: (tabId: number, message: { type: string }) => {
        if (message.type === 'PREPARE_FOR_CAPTURE') return Promise.resolve({ ok: true })
        if (message.type === 'CHECK_SELECTORS') {
          return Promise.resolve(selectorMatchesByTab.get(tabId) ?? [])
        }
        return Promise.resolve(undefined)
      }
    },
    pageCapture: {
      saveAsMHTML: (_details: unknown, callback: (blob: Blob) => void) => {
        mhtmlCallbacks.push(callback)
      }
    },
    scripting: {
      executeScript: () => Promise.resolve([{ result: 'page text' }])
    },
    action: {
      setIcon: () => Promise.resolve(),
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {}
    },
    contextMenus: {
      create: () => {},
      update: () => Promise.resolve(),
      onClicked: { addListener: () => {} }
    },
    alarms: {
      get: (_name: string, callback: (alarm?: unknown) => void) => callback(undefined),
      create: () => {},
      onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => (alarmListener = fn) }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })

  // Side-effecting import: registers listeners and runs the initial checkStatus,
  // which is what loads STATUS.ignoredUrlPatterns into the background.
  await import('../../extension/src/background')
  await flush()
})

beforeEach(() => {
  vi.mocked(sendMhtmlCapture).mockClear()
  tabUrlById.clear()
  selectorMatchesByTab.clear()
})

describe('popup MANUAL_CAPTURE pre-filter (#387)', () => {
  it('blocks a URL matching an operator ignore pattern and names the rule', async () => {
    tabUrlById.set(10, USER_IGNORED_URL)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 10,
      caseId: 'case-a'
    })

    expect(response).toEqual({
      started: false,
      blocked: { reason: 'user', pattern: IGNORE_PATTERN },
      notReady: false
    })
    // The point of the pre-filter: the capture never reaches the server, so the
    // 403 is no longer the only thing standing between an ignored URL and the
    // case.
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('blocks a built-in ignored scheme without naming an operator pattern', async () => {
    tabUrlById.set(11, CHROME_URL)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 11,
      caseId: 'case-a'
    })

    expect(response).toEqual({
      started: false,
      blocked: { reason: 'default', pattern: null },
      notReady: false
    })
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('reports nothing started when the tab has no readable URL', async () => {
    tabUrlById.set(12, undefined)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 12,
      caseId: 'case-a'
    })

    expect(response).toEqual({ started: false, blocked: null, notReady: false })
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('captures a clean URL and records it for the popup page status', async () => {
    tabUrlById.set(13, CLEAN_URL)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 13,
      caseId: 'case-a'
    })
    expect(response).toEqual({ started: true, blocked: null, notReady: false })

    const capturingStatus = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 13 })
    expect(capturingStatus?.capturing).toBe(true)
    expect(capturingStatus?.blocked).toBeNull()
    expect(capturingStatus?.lastCapture).toBeNull()

    mhtmlCallbacks[mhtmlCallbacks.length - 1](new Blob(['mhtml']))
    await flush()
    uploadResolvers[uploadResolvers.length - 1](UPLOAD_RESULT)
    await flush()

    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(1)
    const settled = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 13 })
    expect(settled?.capturing).toBe(false)
    expect(settled?.lastCapture?.manifestIndex).toBe(42)
  })

  it('re-reads the tab URL, so a mid-popup navigation into an ignored page is caught', async () => {
    tabUrlById.set(14, CLEAN_URL)
    // The popup rendered its Capture button against a capturable page; the tab
    // navigated before the click landed.
    tabUrlById.set(14, USER_IGNORED_URL)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 14,
      caseId: 'case-a'
    })

    expect(response?.started).toBe(false)
    expect(response?.blocked?.pattern).toBe(IGNORE_PATTERN)
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('stops blocking once the operator removes the pattern on the next status poll', async () => {
    tabUrlById.set(15, USER_IGNORED_URL)
    expect((await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 15 }))?.blocked).toEqual({
      reason: 'user',
      pattern: IGNORE_PATTERN
    })

    vi.mocked(getStatus).mockResolvedValueOnce({ ...STATUS, ignoredUrlPatterns: [] })
    alarmListener?.({ name: 'birdbrain-status-check' })
    await flush()

    expect((await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 15 }))?.blocked).toBeNull()
    vi.mocked(getStatus).mockResolvedValue(STATUS)
    alarmListener?.({ name: 'birdbrain-status-check' })
    await flush()
  })
})

describe('popup GET_PAGE_STATUS (#387)', () => {
  it('answers blocked for an ignored page without touching the capture path', async () => {
    tabUrlById.set(20, USER_IGNORED_URL)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 20 })

    expect(status?.url).toBe(USER_IGNORED_URL)
    expect(status?.blocked).toEqual({ reason: 'user', pattern: IGNORE_PATTERN })
    expect(status?.capturing).toBe(false)
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('reports the active case selector count and no summary for an unscanned page', async () => {
    tabUrlById.set(21, CLEAN_URL)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 21 })

    expect(status?.activeSelectorCount).toBe(2)
    // Never scanned is not the same as scanned and matched nothing.
    expect(status?.selectorSummary).toBeNull()
  })

  it('reports distinct selectors and total hits once the page has been scanned', async () => {
    tabUrlById.set(22, CLEAN_URL)
    selectorMatchesByTab.set(22, [
      {
        selectorId: 'sel-1',
        caseId: 'case-a',
        caseName: 'Case A',
        pattern: 'evil@example.com',
        matchText: 'evil@example.com',
        context: '',
        index: 0
      },
      {
        selectorId: 'sel-1',
        caseId: 'case-a',
        caseName: 'Case A',
        pattern: 'evil@example.com',
        matchText: 'evil@example.com',
        context: '',
        index: 1
      },
      {
        selectorId: 'sel-2',
        caseId: 'case-a',
        caseName: 'Case A',
        pattern: 'acme',
        matchText: 'acme',
        context: '',
        index: 2
      }
    ])

    send({ type: 'MANUAL_CAPTURE', tabId: 22, caseId: 'case-a' })
    await flush()
    mhtmlCallbacks[mhtmlCallbacks.length - 1](new Blob(['mhtml']))
    await flush()
    uploadResolvers[uploadResolvers.length - 1](UPLOAD_RESULT)
    // The capture's restore path re-runs the selector scan, which is what fills
    // the summary the popup reads.
    await flush()

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 22 })
    expect(status?.selectorSummary).toEqual({ selectors: 2, hits: 3 })
  })

  it('does not attribute another URL capture record or match summary to this page', async () => {
    tabUrlById.set(22, 'https://example.test/somewhere-else')

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 22 })

    expect(status?.lastCapture).toBeNull()
    expect(status?.selectorSummary).toBeNull()
  })

  it('drops cached match summaries when the popup switches the active case', async () => {
    tabUrlById.set(30, CLEAN_URL)
    selectorMatchesByTab.set(30, [
      {
        selectorId: 'sel-1',
        caseId: 'case-a',
        caseName: 'Case A',
        pattern: 'evil@example.com',
        matchText: 'evil@example.com',
        context: '',
        index: 0
      }
    ])
    send({ type: 'MANUAL_CAPTURE', tabId: 30, caseId: 'case-a' })
    await flush()
    mhtmlCallbacks[mhtmlCallbacks.length - 1](new Blob(['mhtml']))
    await flush()
    uploadResolvers[uploadResolvers.length - 1](UPLOAD_RESULT)
    await flush()
    expect(
      (await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 30 }))?.selectorSummary
    ).toEqual({ selectors: 1, hits: 1 })

    // The popup activates a case against the capture server directly, so the
    // background is told rather than left to notice on its 30 s alarm — until
    // it re-polls, its counts belong to the case the operator just left.
    vi.mocked(getStatus).mockResolvedValueOnce({
      ...STATUS,
      activeCase: { id: 'case-b', name: 'Case B' }
    })
    selectorMatchesByTab.delete(30)
    expect(await ask({ type: 'CASE_ACTIVATED' })).toEqual({ ok: true })

    const after = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 30 })
    expect(after?.selectorSummary).toBeNull()
    // And the capture record with them. A manifest index is meaningful only in
    // the case directory that produced it, so reporting "captured, index #42"
    // under Case B would tell the operator Case B holds a page it does not.
    expect(after?.lastCapture).toBeNull()
  })

  it('answers neutrally when the tab URL cannot be read', async () => {
    tabUrlById.set(23, undefined)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 23 })

    expect(status).toEqual({
      url: null,
      blocked: null,
      capturing: false,
      lastCapture: null,
      selectorSummary: null,
      activeSelectorCount: 2,
      rulesLoaded: true
    })
  })
})
