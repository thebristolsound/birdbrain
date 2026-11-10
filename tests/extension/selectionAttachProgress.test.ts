// @vitest-environment jsdom
//
// #1002. A selection Tag or Quote that has to capture the page first used to keep
// the page-side latch up through the attach POST, so the bar showed no progress for
// the longest part of the action. The latch now comes down once the frames are in.
// Both halves run here, the bar in the page and the background's bracket, joined by
// one message bus, so every assertion reads the page the frames are taken from.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type {
  ActiveSelectorsResult,
  CaptureServerStatus,
  CaptureUploadResult,
  ExtensionTagApplyResult,
  UrlLookupResult
} from '@shared/schemas'
import {
  isCaptureUiSuppressed,
  releaseCaptureUiSuppression
} from '../../extension/src/captureSuppression'
import { SELECTION_BAR_SELECTOR } from '../../extension/src/selectionBar'
import { installTrustedInput, operatorClick, operatorMouseUp } from './trustedInput'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getActiveSelectors: vi.fn(),
  getCaptureCard: vi.fn(),
  setCaptureCardTag: vi.fn(),
  sendMhtmlCapture: vi.fn(),
  createSelector: vi.fn(),
  lookupCaptureByUrl: vi.fn(),
  applyTagToUrl: vi.fn(),
  createNoteOnUrl: vi.fn()
}))

import {
  getStatus,
  getActiveSelectors,
  getCaptureCard,
  sendMhtmlCapture,
  lookupCaptureByUrl,
  applyTagToUrl
} from '@extension/utils/api'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const EXTENSION_ID = 'birdbrain-test'
const TAB = { id: 1, url: 'https://example.test/page', title: 'Example', active: true, windowId: 1 }
const PAGE_HTML = '<main><p>Report abuse to evil@example.com immediately.</p></main>'

// content.ts registers first, background.ts second: each side gets its own listeners.
const pageListeners: Listener[] = []
const workerListeners: Listener[] = []
let registering = pageListeners

// Every message the background sent the page, in order.
const toPage: string[] = []
// The page body at the instant each MHTML was taken, in start order.
const bodyAtFrame: string[] = []
const mhtmlCallbacks: Array<(blob: Blob) => void> = []
const attachResolvers: Array<(result: ExtensionTagApplyResult) => void> = []
const uploadResolvers: Array<(result: CaptureUploadResult) => void> = []

// One chrome message hop: the first sendResponse answers, and a message no
// listener keeps open answers undefined, as chrome does.
function deliver(listeners: Listener[], message: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    let keptOpen = false
    for (const listener of listeners) {
      if (listener(message, sender, resolve) === true) keptOpen = true
    }
    if (!keptOpen) resolve(undefined)
  })
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const sentToPage = (type: string): number => toPage.filter((t) => t === type).length

const shadowRoots = new WeakMap<Element, ShadowRoot>()

function bar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTION_BAR_SELECTOR)
}

function barRoot(): ShadowRoot | undefined {
  const host = bar()
  return host ? shadowRoots.get(host) : undefined
}

function barMessage(): string {
  return barRoot()?.querySelector('.message')?.textContent ?? ''
}

function selectParagraph(): void {
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('p')!)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

async function clickTag(): Promise<void> {
  selectParagraph()
  operatorMouseUp()
  await flush()
  operatorClick(barRoot()!.querySelector('[data-action="tag"]')!)
  await flush()
}

function startManualCapture(): void {
  void deliver(
    workerListeners,
    { type: 'MANUAL_CAPTURE', tabId: TAB.id, caseId: 'case-a' },
    { id: EXTENSION_ID }
  )
}

const STATUS: CaptureServerStatus = {
  running: true,
  activeCase: { id: 'case-a', name: 'Case A' },
  sessionActive: false,
  captureCount: 0,
  autoCaptureMode: 'notify',
  cases: [{ id: 'case-a', name: 'Case A' }],
  ignoredUrlPatterns: [],
  captureScreenshots: false,
  dedupeWindowSeconds: 60,
  theme: 'dark'
}

const LOOKUP_MISS: UrlLookupResult = {
  found: false,
  canonicalUrl: TAB.url,
  capture: null
}

const TAG_RESULT: ExtensionTagApplyResult = {
  status: 'ok',
  captureId: 'cap-1',
  captured: true,
  screenshotStatus: 'none',
  tag: { id: 'tag-1', name: 'evil-example-com' }
}

const UPLOAD_RESULT: CaptureUploadResult = {
  captureId: 'cap-2',
  hash: 'deadbeef',
  status: 'ok',
  source: 'manual',
  screenshotStatus: 'none'
}

beforeAll(async () => {
  vi.mocked(getStatus).mockResolvedValue(STATUS)
  vi.mocked(getActiveSelectors).mockResolvedValue([] as ActiveSelectorsResult)
  vi.mocked(getCaptureCard).mockRejectedValue(new Error('metadata unavailable'))
  vi.mocked(lookupCaptureByUrl).mockResolvedValue(LOOKUP_MISS)
  vi.mocked(applyTagToUrl).mockImplementation(
    () => new Promise((resolve) => attachResolvers.push(resolve))
  )
  vi.mocked(sendMhtmlCapture).mockImplementation(
    () => new Promise((resolve) => uploadResolvers.push(resolve))
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
      getManifest: () => ({ version: '0.0.0-test' }),
      onMessage: { addListener: (fn: Listener) => registering.push(fn) },
      onInstalled: { addListener: () => {} },
      sendMessage: (message: unknown) =>
        deliver(workerListeners, message, { id: EXTENSION_ID, tab: TAB })
    },
    webRequest: {
      onHeadersReceived: { addListener: () => {} },
      onBeforeRequest: { addListener: () => {} }
    },
    tabs: {
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback([]),
      get: (_tabId: number, callback?: (tab: typeof TAB) => void) => {
        if (callback) return callback(TAB)
        return Promise.resolve(TAB)
      },
      sendMessage: (_tabId: number, message: { type: string }) => {
        toPage.push(message.type)
        return deliver(pageListeners, message, { id: EXTENSION_ID })
      }
    },
    pageCapture: {
      saveAsMHTML: (_details: unknown, callback: (blob: Blob) => void) => {
        bodyAtFrame.push(document.body.innerHTML)
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
      onAlarm: { addListener: () => {} }
    },
    windows: { WINDOW_ID_NONE: -1 }
  })
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    vi.stubGlobal('requestAnimationFrame', () => 0)
  }
  // jsdom has no layout: back the selection rect the bar is placed from with a fixed box.
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 120,
      left: 40,
      right: 200,
      width: 160,
      height: 20,
      x: 40,
      y: 100,
      toJSON: () => ({})
    }) as DOMRect
  installTrustedInput()
  // The bar's root is closed, so record every root as it is attached.
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init)
    shadowRoots.set(this, root)
    return root
  })

  await import('../../extension/src/content')
  registering = workerListeners
  await import('../../extension/src/background')
  await flush()
})

beforeEach(async () => {
  releaseCaptureUiSuppression()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  window.getSelection()?.removeAllRanges()
  await flush()
  document.head.innerHTML = ''
  document.body.innerHTML = PAGE_HTML
  toPage.length = 0
  bodyAtFrame.length = 0
  mhtmlCallbacks.length = 0
  attachResolvers.length = 0
  uploadResolvers.length = 0
})

describe('a selection attach shows its progress during the POST (#1002)', () => {
  it('releases once its frames are in, and a later capture re-holds the latch', async () => {
    await clickTag()
    // The attach's own bracket strips the busy bar before its frames
    expect(mhtmlCallbacks).toHaveLength(1)
    expect(bodyAtFrame[0]).toBe(PAGE_HTML)
    expect(isCaptureUiSuppressed()).toBe(true)
    expect(bar()).toBeNull()

    mhtmlCallbacks[0](new Blob(['mhtml-selection']))
    await flush()
    // Frames in, POST in flight: the latch is down and the bar shows progress
    expect(attachResolvers).toHaveLength(1)
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(1)
    expect(isCaptureUiSuppressed()).toBe(false)
    expect(barRoot()?.querySelector('.spinner')).not.toBeNull()
    expect(barMessage()).toBe('Tagging page...')
    // The operator's selection, held out of the frames (#993), is back too
    expect(window.getSelection()!.toString()).toContain('evil@example.com')

    // A manual capture of the same tab starts while the POST is still in flight
    startManualCapture()
    await flush()
    expect(mhtmlCallbacks).toHaveLength(2)
    expect(isCaptureUiSuppressed()).toBe(true)
    expect(bar()).toBeNull()
    expect(bodyAtFrame[1]).toBe(PAGE_HTML)

    // The attach settles mid-frame: its result waits, and the latch stays up
    attachResolvers[0](TAG_RESULT)
    await flush()
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(1)
    expect(isCaptureUiSuppressed()).toBe(true)
    expect(bar()).toBeNull()
    expect(document.body.innerHTML).toBe(PAGE_HTML)

    // The manual capture is unchanged: its upload runs with the latch still up...
    mhtmlCallbacks[1](new Blob(['mhtml-manual']))
    await flush()
    expect(uploadResolvers).toHaveLength(1)
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(1)
    expect(isCaptureUiSuppressed()).toBe(true)

    // ...and its settling releases it, when the attach's result reaches the operator
    uploadResolvers[0](UPLOAD_RESULT)
    await flush()
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(2)
    expect(isCaptureUiSuppressed()).toBe(false)
    expect(barMessage()).toBe('Tagged "evil-example-com"')
  })

  it('keeps the latch up through the POST while another capture is still collecting', async () => {
    await clickTag()
    startManualCapture()
    await flush()
    expect(mhtmlCallbacks).toHaveLength(2)

    // The attach's frames finish first; the manual capture is still mid-frame
    mhtmlCallbacks[0](new Blob(['mhtml-selection']))
    await flush()
    expect(attachResolvers).toHaveLength(1)
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(0)
    expect(isCaptureUiSuppressed()).toBe(true)
    expect(bar()).toBeNull()

    mhtmlCallbacks[1](new Blob(['mhtml-manual']))
    await flush()
    expect(bodyAtFrame).toEqual([PAGE_HTML, PAGE_HTML])

    // The attach's bracket is the first to settle with no capture collecting
    attachResolvers[0](TAG_RESULT)
    await flush()
    expect(sentToPage('RELEASE_CAPTURE_UI')).toBe(1)
    expect(isCaptureUiSuppressed()).toBe(false)
    expect(barMessage()).toBe('Tagged "evil-example-com"')

    uploadResolvers[0](UPLOAD_RESULT)
    await flush()
  })
})
