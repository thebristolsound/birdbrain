// The operator's ignore rules reach the service worker only with the first
// successful status poll, and they live in worker memory. MV3 evicts the worker
// freely, so there is a window on every wake where the pattern list is empty —
// and an empty list matches nothing, which reads as "this page is fine to
// capture" for a page the operator has excluded.
//
// This file pins that window from the background side. It is a separate module
// instance from popupPrefilter.test.ts on purpose: that file's beforeAll awaits
// the first poll, so the state under test here cannot exist in it.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { CaptureServerStatus } from '@shared/schemas'
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
const IGNORE_PATTERN = 'secret.example.test'
const USER_IGNORED_URL = 'https://secret.example.test/inbox'

const runtimeListeners: Listener[] = []
const tabUrlById = new Map<number, string | undefined>()

// Never resolves. This is the whole point: the worker is up, the listeners are
// registered, and the rules have not arrived.
let releaseStatus: (status: CaptureServerStatus) => void = () => {}
const pendingStatus = new Promise<CaptureServerStatus>((resolve) => {
  releaseStatus = resolve
})

function tabFor(tabId: number): { id: number; url?: string; title: string; active: boolean } {
  return { id: tabId, url: tabUrlById.get(tabId), title: 'Page', active: true }
}

async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function ask<T>(message: unknown): Promise<T | undefined> {
  let captured: T | undefined
  for (const listener of runtimeListeners) {
    listener(message, { id: EXTENSION_ID }, (response?: unknown) => {
      if (response !== undefined) captured = response as T
    })
  }
  await flush()
  return captured
}

beforeAll(async () => {
  vi.mocked(getStatus).mockReturnValue(pendingStatus)
  vi.mocked(getActiveSelectors).mockResolvedValue([])
  vi.mocked(sendMhtmlCapture).mockResolvedValue({
    captureId: 'cap-1',
    hash: 'deadbeef',
    manifestIndex: 1,
    status: 'ok',
    source: 'manual',
    screenshotStatus: 'none'
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
      get: (tabId: number, callback?: (tab: ReturnType<typeof tabFor>) => void) => {
        if (callback) {
          callback(tabFor(tabId))
          return undefined
        }
        return Promise.resolve(tabFor(tabId))
      },
      sendMessage: () => Promise.resolve(undefined)
    },
    pageCapture: { saveAsMHTML: () => {} },
    scripting: { executeScript: () => Promise.resolve([{ result: '' }]) },
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
      onAlarm: { addListener: () => {} }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })

  await import('../../extension/src/background')
  await flush()
})

describe('popup capture route before the ignore rules have loaded (#387)', () => {
  it('reports the rules as not loaded, so the popup cannot read blocked as safe', async () => {
    tabUrlById.set(10, USER_IGNORED_URL)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 10 })

    // blocked is null only because the pattern list is empty. rulesLoaded is
    // what tells the popup that null means "unknown" rather than "allowed".
    expect(status?.blocked).toBeNull()
    expect(status?.rulesLoaded).toBe(false)
  })

  it('refuses a manual capture rather than sending a page the rules may exclude', async () => {
    tabUrlById.set(11, USER_IGNORED_URL)

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 11,
      caseId: 'case-a'
    })

    expect(response).toEqual({ started: false, blocked: null, notReady: true })
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })

  it('answers tab id 0 rather than dropping the message silently', async () => {
    tabUrlById.set(0, USER_IGNORED_URL)

    expect(await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 0 })).toBeDefined()
    expect(
      await ask<ManualCaptureResponse>({ type: 'MANUAL_CAPTURE', tabId: 0, caseId: 'case-a' })
    ).toEqual({ started: false, blocked: null, notReady: true })
  })

  it('enforces the operator rule once the first poll lands', async () => {
    releaseStatus({
      running: true,
      activeCase: { id: 'case-a', name: 'Case A' },
      sessionActive: false,
      captureCount: 0,
      autoCaptureMode: 'notify',
      cases: [{ id: 'case-a', name: 'Case A' }],
      ignoredUrlPatterns: [IGNORE_PATTERN],
      captureScreenshots: false,
      dedupeWindowSeconds: 60,
      theme: 'dark'
    })
    await flush()
    tabUrlById.set(12, USER_IGNORED_URL)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: 12 })
    expect(status?.rulesLoaded).toBe(true)
    expect(status?.blocked).toEqual({ reason: 'user', pattern: IGNORE_PATTERN })

    const response = await ask<ManualCaptureResponse>({
      type: 'MANUAL_CAPTURE',
      tabId: 12,
      caseId: 'case-a'
    })
    expect(response).toEqual({
      started: false,
      blocked: { reason: 'user', pattern: IGNORE_PATTERN },
      notReady: false
    })
    expect(vi.mocked(sendMhtmlCapture)).not.toHaveBeenCalled()
  })
})
