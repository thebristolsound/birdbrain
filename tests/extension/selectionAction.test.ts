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
import type { PopupPageStatus, SelectionActionResponse } from '@extension/messages'

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
const FULL_PAGE_SHOT = { screenshot: 'data:image/png;base64,AAAA' }
let fullPageResponse: Record<string, unknown> = FULL_PAGE_SHOT
// What chrome.tabs.get answers once the frames are in — the navigation cases
// re-point it so the collected bytes belong to a page other than the sender's.
let tabAfterFrames: typeof TAB = TAB
// Answers promise-shape tabs.get reads in order before falling back to
// tabAfterFrames, so a test can hand the concurrent frame-collection sample
// one page and the post-settle re-read another.
let tabGetQueue: (typeof TAB)[] = []

// `senderTab` lets a test act from its own tab id: lastCaptureByTab persists
// across tests, so stamped/not-stamped assertions need a tab no other test
// has written to.
function dispatchWithResponse(message: unknown, senderTab: typeof TAB = TAB): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of runtimeListeners) {
      listener(message, { id: EXTENSION_ID, tab: senderTab }, resolve)
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
      // Both call shapes: the capture paths await the promise, GET_PAGE_STATUS
      // passes a callback
      get: (_tabId?: unknown, callback?: (tab: unknown) => void) => {
        if (callback) return callback(tabAfterFrames)
        return Promise.resolve(tabGetQueue.length > 0 ? tabGetQueue.shift() : tabAfterFrames)
      },
      captureVisibleTab: () => {
        events.push('captureVisibleTab')
        return Promise.resolve('data:image/png;base64,BBBB')
      },
      sendMessage: (_tabId: number, message: { type: string }) => {
        events.push(message.type)
        if (message.type === 'PREPARE_FOR_CAPTURE') return Promise.resolve(prepareResponse)
        if (message.type === 'CAPTURE_FULL_PAGE') return Promise.resolve(fullPageResponse)
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
  fullPageResponse = FULL_PAGE_SHOT
  tabAfterFrames = TAB
  tabGetQueue = []
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

  it('refuses to attach when the tab navigated while the page was being captured', async () => {
    // The frames describe whatever the tab shows now; `url` came from the
    // sender. Attaching across that gap would store one page's bytes under
    // another page's URL, so the action is refused rather than corrected.
    tabAfterFrames = { ...TAB, url: 'https://example.test/somewhere-else', title: 'Elsewhere' }

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error: 'The page navigated while it was being captured; nothing was attached'
    })
    expect(vi.mocked(applyTagToUrl)).not.toHaveBeenCalled()
    expect(vi.mocked(createNoteOnUrl)).not.toHaveBeenCalled()
    // The refusal is inside the bracket, so the latch still comes down
    expect(events).toContain('RELEASE_CAPTURE_UI')
  })

  it('refuses when the navigation lands after the concurrent tab read, before frames settle', async () => {
    // The tabs.get inside the frame Promise.all resolves at t=0 while the
    // MHTML and a long screenshot stitch keep running; only the fresh re-read
    // taken after every frame settled can see a navigation in that window.
    tabGetQueue = [TAB, { ...TAB, url: 'https://example.test/somewhere-else', title: 'Elsewhere' }]

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error: 'The page navigated while it was being captured; nothing was attached'
    })
    expect(vi.mocked(applyTagToUrl)).not.toHaveBeenCalled()
    expect(events).toContain('RELEASE_CAPTURE_UI')
  })

  it('attaches when only the fragment moved: the same page under the lookup rule', async () => {
    // The comparison is the server's own canonical identity, not string
    // equality — an in-page anchor click must not read as a navigation.
    tabAfterFrames = { ...TAB, url: 'https://example.test/page#section-3' }

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response.ok).toBe(true)
    expect(vi.mocked(applyTagToUrl)).toHaveBeenCalled()
  })

  it('says so inline when the server dropped an oversized screenshot', async () => {
    // The manual path shows this as a degraded toast; the bar has no toast, so
    // a silent success would hide a capture that landed without its frame.
    vi.mocked(applyTagToUrl).mockResolvedValueOnce({
      ...TAG_RESULT,
      screenshotStatus: 'dropped',
      screenshotWarning: 'Screenshot too large (12 MB); capture stored without it'
    })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: true,
      detail: 'Tagged "evil-example-com" — Screenshot too large (12 MB); capture stored without it',
      captured: true
    })
  })

  it('says so inline when the full-page screenshot fell back to the visible part (#1667)', async () => {
    fullPageResponse = { error: 'OffscreenCanvas is not available in this context' }

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'quote',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: true,
      detail:
        'Quote saved to case notes — full-page screenshot failed; visible part of the page only',
      captured: true
    })
    expect(events).toContain('captureVisibleTab')
    expect(vi.mocked(createNoteOnUrl).mock.calls[0][0].payload.screenshot).toBeInstanceOf(Blob)
  })

  it('keeps the dropped-screenshot detail when a fallback also happened (#1667)', async () => {
    fullPageResponse = { error: 'OffscreenCanvas is not available in this context' }
    vi.mocked(applyTagToUrl).mockResolvedValueOnce({ ...TAG_RESULT, screenshotStatus: 'dropped' })

    const response = (await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'tag',
      text: 'evil@example.com'
    })) as SelectionActionResponse

    expect(response).toEqual({
      ok: true,
      detail: 'Tagged "evil-example-com" — screenshot too large',
      captured: true
    })
  })

  it('reports the Capture the failed attach freshly stored, and stamps the page status', async () => {
    // The one failure that is not a clean refusal: #392 returns the stored
    // capture id on the 500 whose ingest succeeded and whose tag did not,
    // with `captured: true` saying the ingest was this request's own.
    const senderTab = { ...TAB, id: 41 }
    vi.mocked(applyTagToUrl).mockRejectedValueOnce({
      status: 500,
      detail: 'Failed to apply tag',
      captureId: 'cap-stored',
      captured: true
    })

    const response = (await dispatchWithResponse(
      { type: 'SELECTION_ACTION', action: 'tag', text: 'evil@example.com' },
      senderTab
    )) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error: 'Failed to apply tag — the page was captured, but nothing was attached to it',
      captureId: 'cap-stored'
    })
    vi.mocked(lookupCaptureByUrl).mockRejectedValueOnce(new Error('offline'))
    const status = (await dispatchWithResponse({
      type: 'GET_PAGE_STATUS',
      tabId: senderTab.id
    })) as PopupPageStatus
    expect(status.lastCapture).not.toBeNull()
  })

  it('does not call a pre-existing capture fresh when the attach to it fails', async () => {
    // The same 500 also names a capture the case already held (the resolve
    // branch). That is old evidence: the wording must not claim the page was
    // captured, and the popup's "Captured just now" line must not be stamped.
    const senderTab = { ...TAB, id: 42 }
    vi.mocked(applyTagToUrl).mockRejectedValueOnce({
      status: 500,
      detail: 'Failed to apply tag',
      captureId: 'cap-old',
      captured: false
    })

    const response = (await dispatchWithResponse(
      { type: 'SELECTION_ACTION', action: 'tag', text: 'evil@example.com' },
      senderTab
    )) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error:
        "Failed to apply tag — the case already held this page's capture; nothing was attached to it",
      captureId: 'cap-old'
    })
    const status = (await dispatchWithResponse({
      type: 'GET_PAGE_STATUS',
      tabId: senderTab.id
    })) as PopupPageStatus
    expect(status.lastCapture).toBeNull()
  })

  it('claims no freshness when the error body does not say, and stamps nothing', async () => {
    // A body without the `captured` flag leaves freshness unknown. The cost of
    // not stamping is one duplicate capture offer; a false "just now" would
    // misdate evidence to the operator, so unknown reads as not-fresh.
    const senderTab = { ...TAB, id: 43 }
    vi.mocked(applyTagToUrl).mockRejectedValueOnce({
      status: 500,
      detail: 'Failed to apply tag',
      captureId: 'cap-unknown'
    })

    const response = (await dispatchWithResponse(
      { type: 'SELECTION_ACTION', action: 'tag', text: 'evil@example.com' },
      senderTab
    )) as SelectionActionResponse

    expect(response).toEqual({
      ok: false,
      error:
        'Failed to apply tag — a capture of this page exists in the case, but nothing was attached to it',
      captureId: 'cap-unknown'
    })
    const status = (await dispatchWithResponse({
      type: 'GET_PAGE_STATUS',
      tabId: senderTab.id
    })) as PopupPageStatus
    expect(status.lastCapture).toBeNull()
  })

  it('notes an attach-ingested capture in the popup page status (#962)', async () => {
    // Only manualCaptureTab used to write this map, so a page Tag or Quote had
    // just captured still read as never seen and invited a duplicate capture.
    await dispatchWithResponse({
      type: 'SELECTION_ACTION',
      action: 'quote',
      text: 'The quoted passage.'
    })

    vi.mocked(lookupCaptureByUrl).mockRejectedValueOnce(new Error('offline'))
    const status = (await dispatchWithResponse({
      type: 'GET_PAGE_STATUS',
      tabId: TAB.id
    })) as PopupPageStatus

    expect(status.lastCapture).not.toBeNull()
    // The attach routes return no manifest index, so the field is honestly null
    expect(status.lastCapture?.manifestIndex).toBeNull()
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
