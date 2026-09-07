// The popup's match-summary line (#387 AC4) is answered from the per-tab
// selector summary, and the passive scan that writes it runs only on page load
// and only while a session is active. Starting a session does not reload the
// tab the operator is already on, so before #682 the line stayed blank on that
// tab until the operator navigated somewhere.
//
// This file pins the rising-edge rescan that closes it, from the background
// side, and asserts the exact line the popup then renders. The worker's own
// clock is the 30 s status alarm, so the poll is driven through the registered
// alarm listener rather than through a message the app cannot send.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { ActiveSelectorsResult, CaptureServerStatus, SelectorMatchInfo } from '@shared/schemas'
import type { PopupPageStatus } from '@extension/messages'
import { deriveMatchSummary } from '@extension/popup/pageStatus'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getActiveSelectors: vi.fn(),
  sendMhtmlCapture: vi.fn(),
  createSelector: vi.fn()
}))

import { getStatus, getActiveSelectors } from '@extension/utils/api'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown
type AlarmListener = (alarm: { name: string }) => void

const EXTENSION_ID = 'birdbrain-test'
const ALARM_STATUS_CHECK = 'birdbrain-status-check'
// The tab the worker happened to scan when it first saw the active case, and
// the tab the operator has since moved to. Only the second one is the subject.
const FIRST_TAB_ID = 41
const SUBJECT_TAB_ID = 42

const runtimeListeners: Listener[] = []
const alarmListeners: AlarmListener[] = []
const scannedTabs: number[] = []
const urlByTab = new Map<number, string>([
  [FIRST_TAB_ID, 'https://acme.example.test/index'],
  [SUBJECT_TAB_ID, 'https://acme.example.test/dossier']
])
let activeTabId = FIRST_TAB_ID

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
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: 'sel-2',
        caseId: 'case-a',
        pattern: 'acme',
        isRegex: false,
        enabled: true,
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ]
  }
]

// Two distinct selectors, three hits — the counts the summary line reports are
// derived separately, so they must not be equal in the fixture.
function match(selectorId: string, index: number): SelectorMatchInfo {
  return {
    selectorId,
    caseId: 'case-a',
    caseName: 'Case A',
    pattern: selectorId === 'sel-1' ? 'evil@example.com' : 'acme',
    matchText: 'acme',
    context: 'context',
    index
  }
}

const MATCHES: SelectorMatchInfo[] = [match('sel-1', 0), match('sel-2', 1), match('sel-2', 2)]

function statusWith(sessionActive: boolean): CaptureServerStatus {
  return {
    running: true,
    activeCase: { id: 'case-a', name: 'Case A' },
    sessionActive,
    captureCount: 0,
    autoCaptureMode: 'notify',
    cases: [{ id: 'case-a', name: 'Case A' }],
    ignoredUrlPatterns: [],
    captureScreenshots: false,
    dedupeWindowSeconds: 60,
    theme: 'dark'
  }
}

function tabFor(tabId: number): { id: number; url: string; title: string; active: boolean } {
  return {
    id: tabId,
    url: urlByTab.get(tabId) ?? 'https://acme.example.test/other',
    title: 'Dossier',
    active: tabId === activeTabId
  }
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

/** One turn of the 30 s status alarm, awaited to completion. */
async function poll(sessionActive: boolean): Promise<void> {
  vi.mocked(getStatus).mockResolvedValue(statusWith(sessionActive))
  for (const listener of alarmListeners) listener({ name: ALARM_STATUS_CHECK })
  await flush()
}

beforeAll(async () => {
  // The first poll runs at import with no session: this is the sessionless,
  // already-loaded tab the defect describes.
  vi.mocked(getStatus).mockResolvedValue(statusWith(false))
  vi.mocked(getActiveSelectors).mockResolvedValue(SELECTOR_GROUPS)

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
      query: (_query: unknown, callback: (tabs: unknown[]) => void) =>
        callback([tabFor(activeTabId)]),
      get: (tabId: number, callback?: (tab: ReturnType<typeof tabFor>) => void) => {
        if (callback) {
          callback(tabFor(tabId))
          return undefined
        }
        return Promise.resolve(tabFor(tabId))
      },
      sendMessage: (tabId: number, message: { type: string }) => {
        if (message.type !== 'CHECK_SELECTORS') return Promise.resolve(undefined)
        scannedTabs.push(tabId)
        return Promise.resolve(MATCHES)
      }
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
      onAlarm: { addListener: (fn: AlarmListener) => alarmListeners.push(fn) }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })

  await import('../../extension/src/background')
  await flush()
  // The import poll is the worker's first sighting of the active case, so it
  // takes the case-change branch and scans whatever tab was active then. The
  // operator has since moved on: from here the subject tab has never been
  // scanned, which is the state the defect describes.
  activeTabId = SUBJECT_TAB_ID
  scannedTabs.length = 0
})

describe('session rising edge rescans the active tab (#682)', () => {
  it('renders nothing for a tab the sessionless worker has never scanned', async () => {
    await poll(false)

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: SUBJECT_TAB_ID })

    expect(scannedTabs).toEqual([])
    expect(status?.selectorSummary).toBeNull()
    // The defect exactly: selectors exist for the case, so the popup cannot
    // fall back to "No selectors set for this case." and prints no line at all.
    expect(status?.activeSelectorCount).toBe(2)
    expect(deriveMatchSummary(status ?? null)).toBeNull()
  })

  it('scans on the false-to-true edge and the popup then reports the counts', async () => {
    await poll(true)

    expect(scannedTabs).toEqual([SUBJECT_TAB_ID])

    const status = await ask<PopupPageStatus>({ type: 'GET_PAGE_STATUS', tabId: SUBJECT_TAB_ID })

    expect(status?.selectorSummary).toEqual({ selectors: 2, hits: 3 })
    expect(deriveMatchSummary(status ?? null)).toBe('2 selectors matched · 3 hits on this page')
  })

  it('does not rescan while the session simply stays active', async () => {
    scannedTabs.length = 0

    await poll(true)
    await poll(true)

    expect(scannedTabs).toEqual([])
  })

  it('scans again on the next edge after the session stops and restarts', async () => {
    scannedTabs.length = 0

    await poll(false)
    expect(scannedTabs).toEqual([])

    await poll(true)
    expect(scannedTabs).toEqual([SUBJECT_TAB_ID])
  })
})
