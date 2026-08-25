// @vitest-environment jsdom
//
// Known-answer test for capture hygiene (#379): after PREPARE_FOR_CAPTURE the
// serialisable DOM must be identical to the page before any Birdbrain UI was
// injected — this is the DOM that pageCapture.saveAsMHTML archives and that the
// screenshot passes render.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { showToast, updateToast } from '../../extension/src/toast'
import { removeInjectedBirdbrainUi } from '../../extension/src/captureHygiene'
import { releaseCaptureUiSuppression } from '../../extension/src/captureSuppression'
import { SELECTION_BAR_ID } from '../../extension/src/selectionBar'
import type { ActiveCaseSelectors } from '@shared/types'
import type { SelectorMatchInfo } from '@shared/schemas'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const listeners: Listener[] = []
const sendMessageMock = vi.fn()

function dispatch(message: unknown): unknown[] {
  const responses: unknown[] = []
  for (const listener of listeners) {
    listener(message, {}, (r) => responses.push(r))
  }
  return responses
}

// Screenshot messages answer asynchronously; resolve on the first sendResponse
function dispatchAsync(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of listeners) {
      listener(message, {}, resolve)
    }
  })
}

// The span is a page-owned decoy sharing the extension's id prefix: cleanup is
// constrained to the div shadow style host, so it must survive every path
const PAGE_HTML =
  '<main><p>Report abuse to evil@example.com immediately.</p><p>Unrelated text.</p>' +
  '<span id="birdbrain-styles-page">Page-owned decoy</span></main>'

const SELECTOR_GROUPS: ActiveCaseSelectors[] = [
  {
    caseId: 'case-1',
    caseName: 'Case One',
    selectors: [
      {
        id: 'sel-1',
        caseId: 'case-1',
        pattern: 'evil@example.com',
        isRegex: false,
        enabled: true,
        createdAt: '2026-08-11T00:00:00.000Z'
      }
    ]
  }
]

function setPageHtml(html: string): void {
  document.head.innerHTML = ''
  document.body.innerHTML = html
  // CHECK_SELECTORS reads body.innerText, which jsdom does not implement —
  // back it with textContent so the real matching path runs
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    get: () => document.body.textContent ?? ''
  })
}

// Raises the real selection bar (#393) through its live mouseup path, so the
// known answer covers the bar's actual host markup rather than a stand-in
async function raiseSelectionBar(): Promise<void> {
  sendMessageMock.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'GET_STATE') return { connected: true, activeCaseId: 'case-1' }
    return {}
  })
  const p = document.querySelector('p')!
  const range = document.createRange()
  range.selectNodeContents(p)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new MouseEvent('mouseup'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(document.getElementById(SELECTION_BAR_ID)).not.toBeNull()
  window.getSelection()?.removeAllRanges()
}

// Minimal stand-ins for the browser APIs the screenshot path needs: jsdom has
// no OffscreenCanvas, no scrolling and no layout, so the stitching step is given
// just enough to run with zero collected slices.
function stubScreenshotEnvironment(): void {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext(): { drawImage: () => void } {
        return { drawImage: () => {} }
      }
      convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
      }
    }
  )
  window.scrollTo = () => {}
  window.scrollBy = () => {}
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => 2000
  })
}

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: sendMessageMock
    }
  })
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    vi.stubGlobal('requestAnimationFrame', () => 0)
  }
  stubScreenshotEnvironment()
  // jsdom's Range does not implement getBoundingClientRect; the bar's
  // placement needs one
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
  // Side-effecting import: registers the content script's onMessage listener
  await import('../../extension/src/content')
})

beforeEach(() => {
  // The suppression latch (#393) is module state a previous test's strip
  // leaves raised; every test here starts with the page un-suppressed
  releaseCaptureUiSuppression()
  sendMessageMock.mockReset()
})

describe('PREPARE_FOR_CAPTURE (#379)', () => {
  it('strips toast, highlights and selection bar so the serialised DOM matches the pre-injection page', async () => {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML

    // Inject real highlights through the live CHECK_SELECTORS path
    const [matches] = dispatch({ type: 'CHECK_SELECTORS', selectors: SELECTOR_GROUPS }) as [
      SelectorMatchInfo[]
    ]
    expect(matches.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('mark.birdbrain-selector-highlight').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('style[data-birdbrain-highlight]').length).toBeGreaterThan(0)

    // Inject the real capture toast and raise the real selection bar (#393)
    showToast({ status: 'capturing' })
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()
    await raiseSelectionBar()

    const responses = dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(responses).toContainEqual({ ok: true })

    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
    expect(document.getElementById(SELECTION_BAR_ID)).toBeNull()
    expect(document.querySelectorAll('mark.birdbrain-selector-highlight').length).toBe(0)
    expect(document.querySelectorAll('style[data-birdbrain-highlight]').length).toBe(0)
    // The randomized style container host carries a birdbrain- id prefix; only
    // the page-owned decoy may survive cleanup
    const remaining = Array.from(document.querySelectorAll('[id^="birdbrain-"]'), (n) => n.id)
    expect(remaining).toEqual(['birdbrain-styles-page'])
    // Known answer: what saveAsMHTML would serialise is the original page
    expect(document.documentElement.outerHTML).toBe(baseline)
  })

  it('removes a toast that is mid-dismissal without waiting for its timer', () => {
    setPageHtml(PAGE_HTML)
    updateToast({ status: 'success' })
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
  })

  it('responds ok and leaves the DOM untouched when nothing was injected', () => {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML

    const responses = dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(responses).toContainEqual({ ok: true })
    expect(document.documentElement.outerHTML).toBe(baseline)
  })

  it('reports which teardown failed instead of claiming a clean page', () => {
    setPageHtml(PAGE_HTML)
    const host = document.createElement('div')
    host.id = 'birdbrain-capture-toast'
    document.body.appendChild(host)
    // Simulate a teardown that cannot complete: the node refuses to be removed
    const remove = vi.spyOn(host, 'remove').mockImplementation(() => {
      throw new Error('detached host')
    })

    const [response] = dispatch({ type: 'PREPARE_FOR_CAPTURE' }) as [
      { ok: boolean; failures?: string[] }
    ]
    expect(response.ok).toBe(false)
    expect(response.failures?.[0]).toContain('detached host')

    remove.mockRestore()
    host.remove()
  })

  it('supports direct cleanup when an orphaned content script cannot receive messages', async () => {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML
    dispatch({ type: 'CHECK_SELECTORS', selectors: SELECTOR_GROUPS })
    showToast({ status: 'capturing' })
    await raiseSelectionBar()

    removeInjectedBirdbrainUi()

    // The page-owned prefix-colliding decoy survives the fallback cleanup too
    expect(document.getElementById('birdbrain-styles-page')).not.toBeNull()
    expect(document.documentElement.outerHTML).toBe(baseline)
  })
})

// Known-answer test for #386: the DOM at the instant a frame is requested is
// the pre-injection page, on every screenshot path — the background having
// suppressed earlier is not what the guarantee rests on.
describe('screenshot paths suppress before any frame (#386)', () => {
  /** Injects the toast and live highlights, returning the pre-injection DOM */
  function injectAllExtensionUi(): string {
    setPageHtml(PAGE_HTML)
    const baseline = document.documentElement.outerHTML
    dispatch({ type: 'CHECK_SELECTORS', selectors: SELECTOR_GROUPS })
    showToast({ status: 'capturing' })
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()
    expect(document.querySelectorAll('mark.birdbrain-selector-highlight').length).toBeGreaterThan(0)
    return baseline
  }

  function recordDomAtEachFrame(): string[] {
    const framesSeen: string[] = []
    sendMessageMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'REQUEST_VIEWPORT_CAPTURE') {
        framesSeen.push(document.documentElement.outerHTML)
      }
      return {}
    })
    return framesSeen
  }

  it('takes no full-page frame while extension UI is on the page', async () => {
    const baseline = injectAllExtensionUi()
    const framesSeen = recordDomAtEachFrame()

    await dispatchAsync({ type: 'CAPTURE_FULL_PAGE' })

    expect(framesSeen.length).toBeGreaterThan(0)
    for (const dom of framesSeen) {
      expect(dom).not.toContain('birdbrain-capture-toast')
      expect(dom).not.toContain('birdbrain-selector-highlight')
      expect(dom).not.toContain('data-birdbrain-highlight')
      expect(dom).toBe(baseline)
    }
  })

  it('re-strips UI injected between slices, not only before the first frame', async () => {
    const baseline = injectAllExtensionUi()
    const framesSeen: string[] = []
    // A toast arriving mid-capture is the live case: the background holds
    // toasts for a tab that is collecting frames, but an orphaned content
    // script or a concurrent capture's restore can still inject between slices
    sendMessageMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'REQUEST_VIEWPORT_CAPTURE') {
        framesSeen.push(document.documentElement.outerHTML)
        showToast({ status: 'capturing' })
        expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()
        // An orphaned content script's selection bar: the live bar is latched
        // out mid-capture, but a stale script that never saw the strip could
        // still hold its host in the DOM when a slice comes due
        const orphanBar = document.createElement('div')
        orphanBar.id = SELECTION_BAR_ID
        document.body.appendChild(orphanBar)
      }
      return {}
    })

    await dispatchAsync({ type: 'CAPTURE_FULL_PAGE' })

    // More than one slice, or the injection never gets a later frame to reach
    expect(framesSeen.length).toBeGreaterThan(1)
    for (const dom of framesSeen) {
      expect(dom).not.toContain('birdbrain-capture-toast')
      expect(dom).not.toContain(SELECTION_BAR_ID)
      expect(dom).toBe(baseline)
    }
  })

  it('takes no scrolling-capture frame while extension UI is on the page', async () => {
    injectAllExtensionUi()
    const framesSeen = recordDomAtEachFrame()

    await dispatchAsync({ type: 'CAPTURE_FULL_PAGE_SCROLLING', scrollTimeoutMs: 1 })

    expect(framesSeen.length).toBeGreaterThan(0)
    for (const dom of framesSeen) {
      expect(dom).not.toContain('birdbrain-capture-toast')
      expect(dom).not.toContain('birdbrain-selector-highlight')
      expect(dom).not.toContain('data-birdbrain-highlight')
    }
  })

  it('aborts the frame rather than capturing a page it cannot clear', async () => {
    injectAllExtensionUi()
    const toastHost = document.getElementById('birdbrain-capture-toast')!
    const remove = vi.spyOn(toastHost, 'remove').mockImplementation(() => {
      throw new Error('detached host')
    })
    const framesSeen = recordDomAtEachFrame()

    const response = (await dispatchAsync({ type: 'CAPTURE_FULL_PAGE' })) as {
      error?: string
      suppressionFailed?: boolean
    }

    expect(framesSeen).toEqual([])
    expect(response.suppressionFailed).toBe(true)
    expect(response.error).toContain('detached host')

    remove.mockRestore()
  })
})
