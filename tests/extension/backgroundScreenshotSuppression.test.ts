// The background half of the capture-UI suppression protocol (#386). The
// content script produces `suppressionFailed`; this is the consumer that
// decides whether an image — and the MHTML collected beside it — ships. Every
// case here drives the real `manualCaptureTab` with screenshots enabled, which
// `manualCaptureConcurrency.test.ts` deliberately does not (`captureScreenshots`
// is false there, so no screenshot path runs at all).
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
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

import {
  getStatus,
  getActiveSelectors,
  sendMhtmlCapture,
  createSelector
} from '@extension/utils/api'
import { removeInjectedBirdbrainUi } from '../../extension/src/captureHygiene'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const TAB = { id: 1, url: 'https://example.test/page', title: 'Example', active: true, windowId: 1 }

const runtimeListeners: Listener[] = []
type ContextMenuListener = (info: { menuItemId: string }, tab: typeof TAB) => Promise<void>
let contextMenuListener: ContextMenuListener | undefined
// Every observable step of a capture, in order — the assertions are about
// ordering (suppression before the frame) as much as about what was called
const events: string[] = []
const toasts: Array<{ status?: string; message?: string }> = []

// Per-test control over what each capture path answers
let fullPageResponse: Record<string, unknown> = { screenshot: 'data:image/png;base64,AAAA' }
let scrollingResponse: Record<string, unknown> = { screenshot: 'data:image/png;base64,AAAA' }
let prepareResponse: Record<string, unknown> | 'throw' = { ok: true }
let executeScriptFails = false

function dispatch(message: unknown): void {
  for (const listener of runtimeListeners) {
    listener(message, { id: EXTENSION_ID }, () => {})
  }
}

async function flush(turns = 8): Promise<void> {
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
  cases: [{ id: 'case-a', name: 'Case A' }],
  ignoredUrlPatterns: [],
  captureScreenshots: true,
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
        createdAt: '2026-08-13T00:00:00.000Z'
      }
    ]
  }
]

const UPLOAD_RESULT: CaptureUploadResult = {
  captureId: 'cap-1',
  hash: 'deadbeef',
  status: 'ok',
  source: 'manual',
  screenshotStatus: 'saved'
}

/** The screenshot blob handed to the upload, or undefined when none shipped */
function uploadedScreenshot(): Blob | undefined {
  const call = vi.mocked(sendMhtmlCapture).mock.calls.at(-1)
  return call?.[0].screenshot
}

beforeAll(async () => {
  vi.mocked(getStatus).mockResolvedValue(STATUS)
  vi.mocked(getActiveSelectors).mockResolvedValue(SELECTOR_GROUPS)
  vi.mocked(sendMhtmlCapture).mockResolvedValue(UPLOAD_RESULT)
  vi.mocked(createSelector).mockResolvedValue({ id: 'sel-created' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['png']) }))
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
        if (callback) {
          callback(TAB)
          return undefined
        }
        return Promise.resolve(TAB)
      },
      captureVisibleTab: () => {
        events.push('captureVisibleTab')
        return Promise.resolve('data:image/png;base64,BBBB')
      },
      sendMessage: (
        _tabId: number,
        message: { type: string; status?: string; message?: string }
      ) => {
        events.push(message.type)
        if (message.type === 'PREPARE_FOR_CAPTURE') {
          return prepareResponse === 'throw'
            ? Promise.reject(new Error('Receiving end does not exist'))
            : Promise.resolve(prepareResponse)
        }
        if (message.type === 'CAPTURE_FULL_PAGE') return Promise.resolve(fullPageResponse)
        if (message.type === 'CAPTURE_FULL_PAGE_SCROLLING')
          return Promise.resolve(scrollingResponse)
        if (message.type === 'CHECK_SELECTORS') return Promise.resolve([])
        if (message.type === 'UPDATE_CAPTURE_TOAST' || message.type === 'SHOW_CAPTURE_TOAST') {
          toasts.push({ status: message.status, message: message.message })
        }
        return Promise.resolve(undefined)
      }
    },
    pageCapture: {
      saveAsMHTML: (_details: unknown, callback: (blob: Blob) => void) => {
        events.push('saveAsMHTML')
        callback(new Blob(['mhtml']))
      }
    },
    scripting: {
      executeScript: (details: { func: () => unknown }) => {
        if (details.func === removeInjectedBirdbrainUi) {
          events.push('executeScript:strip')
          if (executeScriptFails) return Promise.reject(new Error('Cannot access contents of url'))
          return Promise.resolve([{ result: undefined }])
        }
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
        addListener: (listener: ContextMenuListener) => {
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

beforeEach(() => {
  events.length = 0
  toasts.length = 0
  fullPageResponse = { screenshot: 'data:image/png;base64,AAAA' }
  scrollingResponse = { screenshot: 'data:image/png;base64,AAAA' }
  prepareResponse = { ok: true }
  executeScriptFails = false
  vi.mocked(sendMhtmlCapture).mockClear()
})

describe('background screenshot paths under suppression (#386)', () => {
  it('suppresses before the frame and ships the full-page screenshot', async () => {
    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    expect(events.indexOf('PREPARE_FOR_CAPTURE')).toBeLessThan(events.indexOf('CAPTURE_FULL_PAGE'))
    expect(events).not.toContain('captureVisibleTab')
    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(1)
    expect(uploadedScreenshot()).toBeInstanceOf(Blob)
  })

  it('re-suppresses immediately before the viewport frame it falls back to', async () => {
    fullPageResponse = { error: 'OffscreenCanvas is not available in this context' }

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    // The frame must be preceded by its own strip, not only by the one the
    // boundary ran before the capture started
    const frame = events.indexOf('captureVisibleTab')
    expect(frame).toBeGreaterThan(-1)
    expect(events.lastIndexOf('PREPARE_FOR_CAPTURE')).toBeLessThan(frame)
    expect(events.filter((e) => e === 'PREPARE_FOR_CAPTURE')).toHaveLength(2)
    expect(uploadedScreenshot()).toBeInstanceOf(Blob)
  })

  it('aborts the whole capture — MHTML included — when the page cannot be cleared', async () => {
    fullPageResponse = { error: 'detached host', suppressionFailed: true }

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    // No fallback frame of the same page, and nothing stored: the MHTML taken
    // in the same bracket is a snapshot of that same uncleaned page
    expect(events).not.toContain('captureVisibleTab')
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toEqual({
      status: 'error',
      message: 'Capture aborted: Birdbrain UI could not be removed from the page'
    })
  })

  it('aborts on the scrolling path too, without falling back to full-page', async () => {
    scrollingResponse = { error: 'detached host', suppressionFailed: true }

    // Only the context menu reaches the scrolling path
    await contextMenuListener?.({ menuItemId: 'birdbrain-capture-scrolling' }, TAB)
    await flush()

    expect(events).toContain('CAPTURE_FULL_PAGE_SCROLLING')
    expect(events).not.toContain('CAPTURE_FULL_PAGE')
    expect(events).not.toContain('captureVisibleTab')
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
    expect(toasts.at(-1)?.status).toBe('error')
  })

  it('strips directly when the content script reports it could not clear itself', async () => {
    prepareResponse = { ok: false, failures: ['detached host'] }

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    expect(events).toContain('executeScript:strip')
    expect(vi.mocked(sendMhtmlCapture)).toHaveBeenCalledTimes(1)
  })

  it('aborts when neither the content script nor the direct strip can clear the page', async () => {
    prepareResponse = 'throw'
    executeScriptFails = true

    dispatch({ type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' })
    await flush()

    expect(events).not.toContain('saveAsMHTML')
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
    expect(toasts.at(-1)?.status).toBe('error')
  })
})
