// The background half of the in-page selection bar (#393): SELECTION_ACTION
// relays every server call for the content script (which never fetches), and
// the Tag/Quote auto-capture rides the same suppression bracket as every
// other capture — strip before frames, attach only after ingest material is
// collected, release the page-side latch when the bracket settles, on the
// failure path too.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type {
  ActiveSelectorsResult,
  CaptureServerStatus,
  ExtensionNoteCreateResult,
  ExtensionTagApplyResult,
  UrlLookupResult
} from '@shared/schemas'
import type { SelectionActionResponse } from '@extension/messages'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getActiveSelectors: vi.fn(),
  sendMhtmlCapture: vi.fn(),
  createSelector: vi.fn(),
  lookupCaptureByUrl: vi.fn(),
  applyTagToUrl: vi.fn(),
  createNoteOnUrl: vi.fn()
}))

import {
  getStatus,
  getActiveSelectors,
  createSelector,
  lookupCaptureByUrl,
  applyTagToUrl,
  createNoteOnUrl
} from '@extension/utils/api'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const TAB = { id: 1, url: 'https://example.test/page', title: 'Example', active: true, windowId: 1 }

const runtimeListeners: Listener[] = []
// Every observable step in order — the assertions are about ordering
// (suppression before frames, attach before release) as much as about calls.
const events: string[] = []

let prepareResponse: Record<string, unknown> = { ok: true }
let mhtmlFails = false

function dispatchWithResponse(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of runtimeListeners) {
      listener(message, { id: EXTENSION_ID, tab: TAB }, resolve)
    }
  })
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

const LOOKUP_MISS: UrlLookupResult = {
  found: false,
  canonicalUrl: 'https://example.test/page',
  capture: null
}

const LOOKUP_HIT: UrlLookupResult = {
  found: true,
  canonicalUrl: 'https://example.test/page',
  capture: {
    id: 'cap-1',
    url: TAB.url,
    title: 'Example',
    timestamp: '2026-08-25T00:00:00.000Z'
  }
}

const TAG_RESULT: ExtensionTagApplyResult = {
  status: 'ok',
  captureId: 'cap-1',
  captured: true,
  screenshotStatus: 'saved',
  tag: { id: 'tag-1', name: 'evil-example-com' }
}

const NOTE_RESULT = {
  status: 'ok',
  captureId: 'cap-1',
  captured: true,
  screenshotStatus: 'saved',
  note: { id: 'note-1', caseId: 'case-a', title: 'Quote - Example' }
} as unknown as ExtensionNoteCreateResult

/** Re-point the background's polled state and wait for the re-poll to land. */
async function activateStatus(status: CaptureServerStatus): Promise<void> {
  vi.mocked(getStatus).mockResolvedValue(status)
  await dispatchWithResponse({ type: 'CASE_ACTIVATED' })
}

beforeAll(async () => {
  vi.mocked(getStatus).mockResolvedValue(STATUS)
  vi.mocked(getActiveSelectors).mockResolvedValue([] as ActiveSelectorsResult)
  vi.mocked(createSelector).mockResolvedValue({
    selector: {
      id: 'sel-created',
      caseId: 'case-a',
      pattern: 'x',
      isRegex: false,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    status: 'ok'
  })
  vi.mocked(lookupCaptureByUrl).mockImplementation(async () => {
    events.push('lookup')
    return LOOKUP_MISS
  })
  vi.mocked(applyTagToUrl).mockImplementation(async () => {
    events.push('applyTag')
    return TAG_RESULT
  })
  vi.mocked(createNoteOnUrl).mockImplementation(async () => {
    events.push('createNote')
    return NOTE_RESULT
  })
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
      get: () => Promise.resolve(TAB),
      captureVisibleTab: () => {
        events.push('captureVisibleTab')
        return Promise.resolve('data:image/png;base64,BBBB')
      },
      sendMessage: (_tabId: number, message: { type: string }) => {
        events.push(message.type)
        if (message.type === 'PREPARE_FOR_CAPTURE') return Promise.resolve(prepareResponse)
        if (message.type === 'CAPTURE_FULL_PAGE') {
          return Promise.resolve({ screenshot: 'data:image/png;base64,AAAA' })
        }
        if (message.type === 'CHECK_SELECTORS') return Promise.resolve([])
        return Promise.resolve(undefined)
      }
    },
    pageCapture: {
      saveAsMHTML: (_details: unknown, callback: (blob?: Blob) => void) => {
        events.push('saveAsMHTML')
        callback(mhtmlFails ? undefined : new Blob(['mhtml']))
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
      onAlarm: { addListener: () => {} }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })

  // Side-effecting import: registers listeners and runs the initial checkStatus
  await import('../../extension/src/background')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

beforeEach(() => {
  events.length = 0
  prepareResponse = { ok: true }
  mhtmlFails = false
  vi.mocked(createSelector).mockClear()
  vi.mocked(getActiveSelectors).mockClear()
  vi.mocked(lookupCaptureByUrl).mockClear()
  vi.mocked(applyTagToUrl).mockClear()
  vi.mocked(createNoteOnUrl).mockClear()
})

describe('SELECTION_ACTION: selector (R8, one click)', () => {
  it('creates the selector exactly like the context-menu path and re-scans', async () => {
    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'selector',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: true, detail: 'Selector created', captured: false })
    expect(vi.mocked(createSelector)).toHaveBeenCalledWith({
      caseId: 'case-a',
      pattern: 'evil@example.com',
      label: 'from example.test'
    })
    // The refetch that keeps highlights current, same as the context menu
    expect(vi.mocked(getActiveSelectors)).toHaveBeenCalled()
    // One click creates a watcher, never a capture
    expect(events).not.toContain('saveAsMHTML')
  })

  it('maps a server rejection to the context-menu wording', async () => {
    vi.mocked(createSelector).mockRejectedValueOnce({ status: 400, detail: 'Pattern too short' })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'selector',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: false, error: 'Selector rejected: Pattern too short' })
  })
})

describe('SELECTION_ACTION: tag and quote ride the #392 attach endpoints', () => {
  it('attaches to an existing Capture without opening a suppression bracket', async () => {
    vi.mocked(lookupCaptureByUrl).mockResolvedValueOnce(LOOKUP_HIT)

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: true, detail: 'Tagged "evil-example-com"', captured: true })
    // Nothing is acquired, so nothing is stripped and no frames are taken
    expect(events).not.toContain('PREPARE_FOR_CAPTURE')
    expect(events).not.toContain('saveAsMHTML')
    expect(events).not.toContain('RELEASE_CAPTURE_UI')
    const call = vi.mocked(applyTagToUrl).mock.calls[0][0]
    expect(call.tagName).toBe('evil-example-com')
    expect(call.payload.mhtml).toBeUndefined()
  })

  it('auto-captures inside the suppression bracket, attaching only after the frames', async () => {
    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: true, detail: 'Tagged "evil-example-com"', captured: true })
    // Strip before any frame; attach strictly after the frames; latch released
    // only once the bracket settles
    const prepare = events.indexOf('PREPARE_FOR_CAPTURE')
    const mhtml = events.indexOf('saveAsMHTML')
    const attach = events.indexOf('applyTag')
    const release = events.indexOf('RELEASE_CAPTURE_UI')
    expect(prepare).toBeGreaterThan(-1)
    expect(prepare).toBeLessThan(mhtml)
    expect(mhtml).toBeLessThan(attach)
    expect(attach).toBeLessThan(release)
    const call = vi.mocked(applyTagToUrl).mock.calls[0][0]
    expect(call.payload.mhtml).toBeInstanceOf(Blob)
    expect(call.payload.screenshot).toBeInstanceOf(Blob)
    expect(call.payload.title).toBe('Example')
  })

  it('creates a quote Note titled after the page with the selection as body', async () => {
    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'quote',
      text: '  The quoted passage.  '
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: true, detail: 'Quote saved to case notes', captured: true })
    const call = vi.mocked(createNoteOnUrl).mock.calls[0][0]
    expect(call.noteTitle).toBe('Quote - Example')
    expect(call.noteText).toBe('The quoted passage.')
    expect(call.payload.mhtml).toBeInstanceOf(Blob)
  })

  it('a failed auto-capture creates nothing and still releases the latch', async () => {
    mhtmlFails = true

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response.ok).toBe(false)
    // No attach ever ran: nothing was created on the failure path
    expect(vi.mocked(applyTagToUrl)).not.toHaveBeenCalled()
    expect(vi.mocked(createNoteOnUrl)).not.toHaveBeenCalled()
    // The failure path restores too — the page-side latch is released
    expect(events).toContain('RELEASE_CAPTURE_UI')
  })

  it('surfaces the server refusal verbatim when the attach itself fails', async () => {
    vi.mocked(applyTagToUrl).mockRejectedValueOnce({
      status: 500,
      detail: 'Failed to capture page; nothing was attached'
    })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error: 'Failed to capture page; nothing was attached'
    })
    expect(events).toContain('RELEASE_CAPTURE_UI')
  })

  it('refuses an excluded URL on the ingest branch without capturing anything', async () => {
    await activateStatus({ ...STATUS, effectiveIgnoredUrlPatterns: ['example.test'] })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: false, error: 'URL excluded by pattern: example.test' })
    expect(events).not.toContain('saveAsMHTML')
    expect(vi.mocked(applyTagToUrl)).not.toHaveBeenCalled()

    await activateStatus(STATUS)
  })
})

describe('SELECTION_ACTION: state gating', () => {
  it('refuses every action without an active case, touching no endpoint', async () => {
    await activateStatus({ ...STATUS, activeCase: null })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error: 'Not connected to Birdbrain with an active case'
    })
    expect(vi.mocked(lookupCaptureByUrl)).not.toHaveBeenCalled()
    expect(vi.mocked(createSelector)).not.toHaveBeenCalled()

    await activateStatus(STATUS)
  })

  it('refuses an empty selection', async () => {
    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: '   '
    })) as SelectionActionResponse

    expect(response).toEqual({ ok: false, error: 'Nothing selected' })
    expect(vi.mocked(lookupCaptureByUrl)).not.toHaveBeenCalled()
  })
})
