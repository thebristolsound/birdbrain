// @vitest-environment jsdom
//
// The in-page selection bar (#393): raised by a page mouseup, gated on the
// background's connection + active-case state, and a full participant in the
// capture suppression protocol — stripped by the strip, latched against
// re-injection until the background's release, restored afterwards on the
// success and failure paths alike.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import {
  createCaptureSuppression,
  isCaptureUiSuppressed,
  releaseCaptureUiSuppression
} from '../../extension/src/captureSuppression'
import { removeInjectedBirdbrainUi } from '../../extension/src/captureHygiene'
import {
  SELECTION_BAR_ID,
  SELECTION_BAR_MARKER,
  SELECTION_BAR_MARKER_VALUE,
  SELECTION_BAR_SELECTOR
} from '../../extension/src/selectionBar'
import type { SelectionActionResponse } from '@extension/messages'
import { SELECTION_QUOTE_MAX_LENGTH } from '@shared/selectionKind'
import { installTrustedInput, operatorClick, operatorMouseUp } from './trustedInput'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const listeners: Listener[] = []
const sendMessageMock = vi.fn()

// Per-test control over the background the bar talks to
let stateResponse: unknown = { connected: true, activeCaseId: 'case-1' }
let stateRejects = false
let actionResponse: unknown = { ok: true, detail: 'Selector created', captured: false }
const actionRequests: Array<{ action: string; text: string; rawText: string }> = []

function dispatch(message: unknown): unknown[] {
  const responses: unknown[] = []
  for (const listener of listeners) {
    listener(message, {}, (r) => responses.push(r))
  }
  return responses
}

const PAGE_HTML = '<main><p>Report abuse to evil@example.com immediately.</p></main>'

function setPageHtml(html: string): void {
  document.head.innerHTML = ''
  document.body.innerHTML = html
}

function selectParagraph(): void {
  const p = document.querySelector('p')!
  const range = document.createRange()
  range.selectNodeContents(p)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
}

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mouseUp(): Promise<void> {
  operatorMouseUp()
  await flushTimers()
}

// Looked up the way ownership is decided — by the marker render() sets, never
// by the id a page is free to carry.
function bar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTION_BAR_SELECTOR)
}

// Every root attachShadow returns, recorded before content.ts loads: the bar's root is closed,
// so host.shadowRoot cannot reach it.
const shadowRoots = new WeakMap<Element, ShadowRoot>()

function barRoot(): ShadowRoot | undefined {
  const host = bar()
  return host ? shadowRoots.get(host) : undefined
}

function barButtons(): HTMLButtonElement[] {
  return Array.from(barRoot()?.querySelectorAll('button') ?? [])
}

function barMessage(): string {
  return barRoot()?.querySelector('.message')?.textContent ?? ''
}

async function clickAction(action: string): Promise<void> {
  const button = barRoot()!.querySelector(`[data-action="${action}"]`) as HTMLButtonElement
  operatorClick(button)
  await flushTimers()
}

beforeAll(async () => {
  sendMessageMock.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'GET_STATE') {
      if (stateRejects) throw new Error('Extension context invalidated')
      return stateResponse
    }
    if (message.type === 'SELECTION_ACTION') {
      const request = message as unknown as { action: string; text: string; rawText: string }
      actionRequests.push({ action: request.action, text: request.text, rawText: request.rawText })
      return actionResponse
    }
    return {}
  })
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: sendMessageMock
    }
  })
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    vi.stubGlobal('requestAnimationFrame', () => 0)
  }
  // jsdom has no layout, and its Range does not implement
  // getBoundingClientRect — back the selection rect with a fixed box
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
  // Before the import below: the bar registers its mouseup listener once, at import
  installTrustedInput()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init)
    shadowRoots.set(this, root)
    return root
  })
  // Side-effecting import: registers the message listener and the bar's
  // document listeners
  await import('../../extension/src/content')
})

beforeEach(async () => {
  // The latch and the bar state are module state shared across tests: release
  // the latch, dismiss whatever bar a previous test left, and start clean.
  releaseCaptureUiSuppression()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  clearSelection()
  await flushTimers()
  setPageHtml(PAGE_HTML)
  stateResponse = { connected: true, activeCaseId: 'case-1' }
  stateRejects = false
  actionResponse = { ok: true, detail: 'Selector created', captured: false }
  actionRequests.length = 0
  sendMessageMock.mockClear()
})

describe('raising the bar', () => {
  it('appears on an actionable selection with all three actions enabled', async () => {
    selectParagraph()
    await mouseUp()

    const buttons = barButtons()
    expect(buttons.map((b) => b.dataset.action)).toEqual(['selector', 'tag', 'quote'])
    expect(buttons.every((b) => !b.disabled)).toBe(true)
  })

  it('does not appear for a selection below the actionable minimum', async () => {
    setPageHtml('<main><p>ab</p></main>')
    selectParagraph()
    await mouseUp()

    expect(bar()).toBeNull()
  })

  it('hides when the selection collapses', async () => {
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    clearSelection()
    await mouseUp()
    expect(bar()).toBeNull()
  })

  it('renders disabled actions when the app is not connected', async () => {
    stateResponse = { connected: false, activeCaseId: null }
    selectParagraph()
    await mouseUp()

    const buttons = barButtons()
    expect(buttons.length).toBe(3)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(buttons[0].title).toBe('Birdbrain is not running')
  })

  it('renders disabled actions when no case is active', async () => {
    stateResponse = { connected: true, activeCaseId: null }
    selectParagraph()
    await mouseUp()

    const buttons = barButtons()
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(buttons[0].title).toBe('Select an active case in Birdbrain first')
  })

  it('fails closed when the service worker is unreachable: no bar at all', async () => {
    stateRejects = true
    selectParagraph()
    await mouseUp()

    expect(bar()).toBeNull()
  })

  it('a disabled bar sends nothing when clicked', async () => {
    stateResponse = { connected: false, activeCaseId: null }
    selectParagraph()
    await mouseUp()

    await clickAction('tag')
    expect(actionRequests).toEqual([])
  })
})

describe('running an action', () => {
  it('relays the action to the background and shows progress meanwhile', async () => {
    selectParagraph()
    await mouseUp()

    let resolveAction: (value: unknown) => void = () => {}
    actionResponse = new Promise((resolve) => {
      resolveAction = resolve
    })
    const clicked = clickAction('tag')

    await Promise.resolve()
    expect(barRoot()?.querySelector('.spinner')).not.toBeNull()

    resolveAction({ ok: true, detail: 'Tagged "evil-example-com"', captured: true })
    await clicked

    expect(actionRequests).toEqual([
      {
        action: 'tag',
        text: 'Report abuse to evil@example.com immediately.',
        rawText: 'Report abuse to evil@example.com immediately.'
      }
    ])
    expect(barMessage()).toBe('Tagged "evil-example-com"')
  })

  it("sends a multi-line selection's line breaks beside the collapsed passage (#1003)", async () => {
    setPageHtml(
      '<main><p>\n  Acme Holdings Ltd\n  12 Harbour Road\n\n  Bristol BS1 4AA\n</p></main>'
    )
    selectParagraph()
    await mouseUp()

    await clickAction('quote')

    expect(actionRequests).toEqual([
      {
        action: 'quote',
        text: 'Acme Holdings Ltd 12 Harbour Road Bristol BS1 4AA',
        rawText: 'Acme Holdings Ltd\n  12 Harbour Road\n\n  Bristol BS1 4AA'
      }
    ])
  })

  it('sends the collapsed passage as quote text when the raw one is over the cap', async () => {
    setPageHtml(`<main><p>Acme${'\n'.repeat(SELECTION_QUOTE_MAX_LENGTH)}Holdings</p></main>`)
    selectParagraph()
    await mouseUp()

    await clickAction('quote')

    expect(actionRequests).toEqual([
      { action: 'quote', text: 'Acme Holdings', rawText: 'Acme Holdings' }
    ])
  })

  it('shows the failure inline, verbatim', async () => {
    selectParagraph()
    await mouseUp()

    actionResponse = {
      ok: false,
      error: 'Failed to capture page; nothing was attached'
    } satisfies SelectionActionResponse
    await clickAction('quote')

    expect(barMessage()).toBe('Failed to capture page; nothing was attached')
    expect(barRoot()?.querySelector('.status.error')).not.toBeNull()
  })
})

// The page can select text and dispatch events, and the click tests grant it a button the closed
// root hides; none of that may stand in for the operator.
describe('page script cannot act for the operator (#992)', () => {
  it('cannot raise the bar with a synthesised mouseup', async () => {
    selectParagraph()
    document.dispatchEvent(new MouseEvent('mouseup'))
    await flushTimers()

    expect(bar()).toBeNull()
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('gets no handle on the buttons from the host', async () => {
    selectParagraph()
    await mouseUp()

    expect(barButtons()).toHaveLength(3)
    expect(bar()!.shadowRoot).toBeNull()
  })

  it.each(['selector', 'tag', 'quote'])(
    'cannot run %s by clicking a raised bar',
    async (action) => {
      selectParagraph()
      await mouseUp()

      barRoot()!.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click()
      expect(barRoot()?.querySelector('.spinner')).toBeNull()
      await flushTimers()

      expect(actionRequests).toEqual([])
      expect(barButtons().map((b) => b.dataset.action)).toEqual(['selector', 'tag', 'quote'])
    }
  )
})

describe('capture suppression round trip (#386)', () => {
  it('strip removes the bar, the latch blocks re-raising, release restores it', async () => {
    const baseline = document.documentElement.outerHTML
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    // The strip: what saveAsMHTML would serialise is the pre-injection page
    const responses = dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(responses).toContainEqual({ ok: true })
    expect(bar()).toBeNull()
    expect(document.documentElement.outerHTML).toBe(baseline)
    expect(isCaptureUiSuppressed()).toBe(true)

    // The latch: a mouseup mid-capture must not put the bar back between the
    // strip and the frames
    selectParagraph()
    await mouseUp()
    expect(bar()).toBeNull()

    // The release: the background's restore effect says the bracket closed
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(isCaptureUiSuppressed()).toBe(false)
    expect(bar()).not.toBeNull()
  })

  it('blocks a raise whose state query was in flight when the strip landed', async () => {
    let resolveState: (value: unknown) => void = () => {}
    stateResponse = new Promise((resolve) => {
      resolveState = resolve
    })
    selectParagraph()
    operatorMouseUp()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The bracket opens while the bar is still waiting for GET_STATE
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    resolveState({ connected: true, activeCaseId: 'case-1' })
    await flushTimers()

    expect(bar()).toBeNull()

    dispatch({ type: 'RELEASE_CAPTURE_UI' })
  })

  it('restores the bar on the failure path, still showing the error', async () => {
    selectParagraph()
    await mouseUp()

    let rejectAction: (value: unknown) => void = () => {}
    actionResponse = new Promise((resolve) => {
      rejectAction = resolve
    })
    const clicked = clickAction('tag')
    await Promise.resolve()

    // The auto-capture's own bracket strips the in-flight bar
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(bar()).toBeNull()

    // The failed capture's restore path releases the latch first...
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(barRoot()?.querySelector('.spinner')).not.toBeNull()

    // ...and the refusal then lands in the restored bar
    rejectAction({ ok: false, error: 'Capture failed' } satisfies SelectionActionResponse)
    await clicked
    expect(barMessage()).toBe('Capture failed')
  })

  it('re-arms the auto-hide of a restored result chip', async () => {
    selectParagraph()
    await mouseUp()
    actionResponse = { ok: true, detail: 'Selector created', captured: false }
    await clickAction('selector')
    expect(barMessage()).toBe('Selector created')

    // The strip clears the pending auto-hide along with the host; the restored
    // chip must not persist forever
    vi.useFakeTimers()
    try {
      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(bar()).toBeNull()
      dispatch({ type: 'RELEASE_CAPTURE_UI' })
      expect(barMessage()).toBe('Selector created')

      vi.advanceTimersByTime(3000)
      expect(bar()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restore a ready bar whose selection collapsed during the capture', async () => {
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(bar()).toBeNull()

    // The operator clicked elsewhere while the latch was up: the retained
    // ready state is an offer against text no longer selected, and restoring
    // it would invite an action on it. A click leaves a caret, not an empty
    // selection: the strip already emptied it (#993).
    const p = document.querySelector('p')!
    window.getSelection()!.collapse(p.firstChild, 3)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(bar()).toBeNull()
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })

  it('does not restore a ready bar whose selection was replaced during the capture', async () => {
    setPageHtml(
      '<main><p>Report abuse to evil@example.com immediately.</p>' +
        '<p id="second">A different passage entirely.</p></main>'
    )
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('second')!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    // Dropped, not adopted: the release restores nothing, and the mouseup
    // that produced the new selection runs its own pass.
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(bar()).toBeNull()
    // The held passage is not put back over the operator's newer selection.
    expect(window.getSelection()!.toString()).toBe('A different passage entirely.')
  })

  it('a restored ready bar quotes the line breaks of the selection it comes back to (#1003)', async () => {
    setPageHtml(
      '<main><p>Acme Holdings Ltd\n12 Harbour Road</p>' +
        '<p id="second">Acme Holdings Ltd 12   Harbour\nRoad</p></main>'
    )
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('second')!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    // Same collapsed passage, so the offer survives the capture
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(bar()).not.toBeNull()

    await clickAction('quote')
    expect(actionRequests).toEqual([
      {
        action: 'quote',
        text: 'Acme Holdings Ltd 12 Harbour Road',
        rawText: 'Acme Holdings Ltd 12   Harbour\nRoad'
      }
    ])
  })

  it('is removed by the orphaned-content-script fallback strip', async () => {
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    removeInjectedBirdbrainUi()
    expect(bar()).toBeNull()
  })

  it('Escape dismisses the bar', async () => {
    selectParagraph()
    await mouseUp()
    expect(bar()).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(bar()).toBeNull()
  })
})

// The native highlight is painted over page content, so a selection left in
// place is in every frame of the capture (#993). It is held for the bracket
// and put back on release, like the bar.
describe("the operator's selection stays out of the frames (#993)", () => {
  // The release loop logs and swallows a listener that throws, which would also skip the bar.
  const RELEASE_FAILED = '[Birdbrain] Suppression release listener failed:'

  function selectionEnds(): [Node | null, number, Node | null, number] {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = window.getSelection()!
    return [anchorNode, anchorOffset, focusNode, focusOffset]
  }

  it('collapses the selection for the strip and puts the same passage back on release', async () => {
    selectParagraph()
    await mouseUp()
    const before = selectionEnds()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)

    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(selectionEnds()).toEqual(before)
    expect(window.getSelection()!.toString()).toBe('Report abuse to evil@example.com immediately.')
    // Restored before the stale-selection check, so the offer comes back.
    expect(bar()).not.toBeNull()
  })

  // Without composed ranges, getRangeAt reports a shadow-crossing selection as collapsed, so a
  // caret cannot be told from one; both are cleared, as before the caret rule.
  it('clears even a collapsed selection where composed ranges are unavailable', () => {
    expect('getComposedRanges' in Selection.prototype).toBe(false)
    const text = document.querySelector('p')!.firstChild!
    window.getSelection()!.collapse(text, 5)

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })

    expect(selectionEnds()).toEqual([text, 5, text, 5])
  })

  it('keeps a backward selection backward where the selection reports no direction', async () => {
    // jsdom has no Selection.direction, so this is the anchor comparison's branch.
    expect('direction' in Selection.prototype).toBe(false)
    const text = document.querySelector('p')!.firstChild!
    window.getSelection()!.setBaseAndExtent(text, 30, text, 7)
    await mouseUp()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })

    expect(selectionEnds()).toEqual([text, 30, text, 7])
  })

  describe('where the selection reports its direction, as Chromium does', () => {
    let direction = 'none'

    beforeEach(() => {
      Object.defineProperty(Selection.prototype, 'direction', {
        configurable: true,
        get: () => direction
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(Selection.prototype, 'direction')
    })

    it.each([
      ['backward', [30, 7]],
      ['forward', [7, 30]]
    ])('keeps a %s selection that way', (reported, [anchor, focus]) => {
      direction = reported
      const text = document.querySelector('p')!.firstChild!
      window.getSelection()!.setBaseAndExtent(text, anchor, text, focus)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(window.getSelection()!.rangeCount).toBe(0)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(selectionEnds()).toEqual([text, anchor, text, focus])
    })

    // The anchor is retargeted out of a shadow tree the composed start can sit in, so comparing
    // the two would call such a forward selection backward: the reported direction decides.
    it.each([
      ['backward', [7, 30], [30, 7]],
      ['forward', [30, 7], [7, 30]]
    ])(
      'puts a %s selection back that way, whatever the anchor suggests',
      (reported, [anchor, focus], restored) => {
        direction = reported
        const text = document.querySelector('p')!.firstChild!
        window.getSelection()!.setBaseAndExtent(text, anchor, text, focus)

        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        dispatch({ type: 'RELEASE_CAPTURE_UI' })

        expect(selectionEnds()).toEqual([text, restored[0], text, restored[1]])
      }
    )
  })

  it('stays collapsed through every per-frame strip, and the passage still takes a second action', async () => {
    selectParagraph()
    await mouseUp()
    let resolveAction: (value: unknown) => void = () => {}
    actionResponse = new Promise((resolve) => {
      resolveAction = resolve
    })
    const clicked = clickAction('tag')
    await Promise.resolve()

    // The auto-capture's bracket strips once, then again before each slice;
    // a later strip sees the empty selection and must keep what the first held.
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)

    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    resolveAction({ ok: true, detail: 'Page tagged', captured: true })
    await clicked
    expect(window.getSelection()!.toString()).toBe('Report abuse to evil@example.com immediately.')

    await mouseUp()
    await clickAction('quote')
    expect(actionRequests.map((r) => [r.action, r.text])).toEqual([
      ['tag', 'Report abuse to evil@example.com immediately.'],
      ['quote', 'Report abuse to evil@example.com immediately.']
    ])
  })

  it('puts back a selection the bar never offered on', async () => {
    // Below the actionable minimum: no bar, but the highlight still paints.
    setPageHtml('<main><p>ab</p></main>')
    selectParagraph()
    await mouseUp()
    expect(bar()).toBeNull()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(window.getSelection()!.toString()).toBe('ab')
  })

  it('leaves the page without a selection when there was none, and still puts the bar back', async () => {
    selectParagraph()
    await mouseUp()
    await clickAction('selector')
    clearSelection()
    const warn = vi.spyOn(console, 'warn')

    try {
      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(window.getSelection()!.rangeCount).toBe(0)
      expect(barMessage()).toBe('Selector created')
      expect(warn).not.toHaveBeenCalledWith(RELEASE_FAILED, expect.anything())
    } finally {
      warn.mockRestore()
    }
  })

  it('holds the selection the operator made mid-capture, not the earlier one', async () => {
    setPageHtml(
      '<main><p>Report abuse to evil@example.com immediately.</p>' +
        '<p id="second">A different passage entirely.</p></main>'
    )
    selectParagraph()
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('second')!)
    window.getSelection()!.addRange(range)

    // The next slice's strip takes the new selection out of the frame too.
    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(window.getSelection()!.toString()).toBe('A different passage entirely.')
  })

  it('is collapsed by the orphaned-content-script fallback strip', () => {
    selectParagraph()
    removeInjectedBirdbrainUi()
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  // The background also runs the fallback strip after a live script reports a failed teardown,
  // and that script still gets the release.
  it('puts the held selection back when the fallback strip ran after the hold', () => {
    selectParagraph()
    const before = selectionEnds()

    dispatch({ type: 'PREPARE_FOR_CAPTURE' })
    removeInjectedBirdbrainUi()
    expect(window.getSelection()!.rangeCount).toBe(0)
    dispatch({ type: 'RELEASE_CAPTURE_UI' })

    expect(selectionEnds()).toEqual(before)
  })

  // Wired the way background.ts wires it: suppress strips the page, and restore sends the release
  // only once no capture on the tab is collecting frames.
  describe("through the background's capture bracket", () => {
    function bracket() {
      const suppression = createCaptureSuppression({
        suppress: async () => {
          dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        },
        restore: async (tabId) => {
          if (!suppression.isCollectingFrames(tabId)) dispatch({ type: 'RELEASE_CAPTURE_UI' })
        }
      })
      return suppression
    }

    const PASSAGE = 'Report abuse to evil@example.com immediately.'

    it('holds the selection until the last concurrent capture has its frames, then puts it back', async () => {
      selectParagraph()
      const suppression = bracket()
      let resolveFirst: () => void = () => {}
      let resolveSecond: () => void = () => {}
      const first = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      const second = new Promise<void>((resolve) => {
        resolveSecond = resolve
      })

      const captureA = suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(() => first)
      })
      const captureB = suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(() => second)
      })

      resolveFirst()
      await captureA
      expect(window.getSelection()!.rangeCount).toBe(0)
      expect(isCaptureUiSuppressed()).toBe(true)

      resolveSecond()
      await captureB
      expect(window.getSelection()!.toString()).toBe(PASSAGE)
      expect(isCaptureUiSuppressed()).toBe(false)
    })

    it('puts the selection back when the capture throws mid-frame', async () => {
      selectParagraph()
      const boom = new Error('captureVisibleTab failed')
      let duringFrame = -1

      await expect(
        bracket().withSuppression(1, async ({ collectFrames }) => {
          await collectFrames(async () => {
            duringFrame = window.getSelection()!.rangeCount
            throw boom
          })
        })
      ).rejects.toBe(boom)

      expect(duringFrame).toBe(0)
      expect(window.getSelection()!.toString()).toBe(PASSAGE)
    })
  })

  // A text field's selection is its own: in Chromium the document's reports a caret beside the
  // field, and removeAllRanges would drop the field's selection with nothing to put back.
  describe('in a focused text field', () => {
    function fieldEnds(field: HTMLInputElement | HTMLTextAreaElement): unknown[] {
      const { selectionStart, selectionEnd, selectionDirection } = field
      return [selectionStart, selectionEnd, selectionDirection]
    }

    function focusedInput(): HTMLInputElement {
      setPageHtml(`${PAGE_HTML}<input value="Hello wide world">`)
      const input = document.querySelector('input')!
      input.focus()
      input.setSelectionRange(2, 6, 'backward')
      // jsdom keeps a field's selection apart from the document's. Chromium reports a focused
      // field's caret or selection to the document as a point just before the field, through
      // every click, key and selection the operator makes in it.
      const parent = input.parentNode!
      window.getSelection()!.collapse(parent, Array.from(parent.childNodes).indexOf(input))
      return input
    }

    it('collapses the field for every strip and puts its selection back, still focused', () => {
      const input = focusedInput()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(fieldEnds(input).slice(0, 2)).toEqual([6, 6])
      expect(document.activeElement).toBe(input)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(fieldEnds(input)).toEqual([2, 6, 'backward'])
      expect(document.activeElement).toBe(input)
    })

    // The last two start or end on the caret the strip left, as shift and an arrow key would.
    it.each([
      [0, 5],
      [3, 6],
      [6, 9]
    ])(
      'keeps a selection the operator made in the field during the capture (%i to %i)',
      (start, end) => {
        const input = focusedInput()

        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        input.setSelectionRange(start, end)
        dispatch({ type: 'RELEASE_CAPTURE_UI' })

        expect(fieldEnds(input).slice(0, 2)).toEqual([start, end])
      }
    )

    it('keeps a caret the operator moved in the field during the capture', () => {
      const input = focusedInput()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      // A click elsewhere in the field: still collapsed, but not where the strip left it.
      input.setSelectionRange(11, 11)
      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(fieldEnds(input).slice(0, 2)).toEqual([11, 11])
    })

    it('keeps the caret after text the operator typed in the field during the capture', () => {
      const input = focusedInput()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      input.setRangeText('!!', 6, 6, 'end')
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(input.value).toBe('Hello !!wide world')
      expect(fieldEnds(input).slice(0, 2)).toEqual([8, 8])
    })

    it('selects nothing in a field whose text changed under a caret that did not move', () => {
      const input = focusedInput()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      // One character deleted and one typed: the caret is back where the strip left it, and the
      // held offsets now name other text.
      input.setRangeText('X', 5, 6, 'end')
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(input.value).toBe('HelloXwide world')
      expect(fieldEnds(input).slice(0, 2)).toEqual([6, 6])
    })

    // The background runs the fallback strip after a live script reports a failed teardown. Its
    // clear empties the document's selection, and in Chromium that drops the focused field's own
    // selection to its start, which jsdom does not do, so the test sets it.
    it("puts the field's selection back when the fallback strip ran after the hold", () => {
      const input = focusedInput()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      removeInjectedBirdbrainUi()
      expect(window.getSelection()!.rangeCount).toBe(0)
      input.setSelectionRange(0, 0)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(fieldEnds(input)).toEqual([2, 6, 'backward'])
      expect(document.activeElement).toBe(input)
    })

    it('finds the field inside a web component', () => {
      setPageHtml(`${PAGE_HTML}<div id="host"></div>`)
      const host = document.getElementById('host')!
      host.attachShadow({ mode: 'open' }).innerHTML = '<textarea>Hello wide world</textarea>'
      const textarea = host.shadowRoot!.querySelector('textarea')!
      textarea.focus()
      textarea.setSelectionRange(1, 4)
      expect(document.activeElement).toBe(host)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(fieldEnds(textarea).slice(0, 2)).toEqual([4, 4])
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(fieldEnds(textarea).slice(0, 2)).toEqual([1, 4])
    })

    it('treats a focused input with no text selection as no field', () => {
      setPageHtml(`${PAGE_HTML}<input type="checkbox">`)
      document.querySelector('input')!.focus()
      selectParagraph()

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(window.getSelection()!.rangeCount).toBe(0)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(window.getSelection()!.toString()).toBe(
        'Report abuse to evil@example.com immediately.'
      )
    })
  })

  // An email, number or date input reports no selection offsets. Chromium reports a caret or a
  // selection inside one as a point just before the input, with a composed range that spans the
  // input, and jsdom models none of it. These tests stand in what Chromium 154 did in the review
  // round's probe: the selected text and its direction, and a character-wise move or extend,
  // which acts inside such an input. collapseToStart and collapseToEnd act on the point the
  // document reports once anything has read it, which takes the caret out of the input, so the
  // stand-in fails a test that calls either there.
  describe('in a focused input that reports no selection offsets', () => {
    const VALUES = {
      email: 'someone@example.com',
      number: '1234567890',
      date: '2026-11-11',
      time: '10:30',
      'datetime-local': '2026-11-11T10:30',
      month: '2026-11',
      week: '2026-W46'
    }
    const STUBBED = ['toString', 'collapseToStart', 'collapseToEnd', 'modify'] as const
    const LEFT_THE_INPUT = 'collapsed on the point the document reports, outside the input'
    const originals = new Map<string, PropertyDescriptor>()
    let input: HTMLInputElement
    let point: [Node, number]
    // The input's own caret or selection, as offsets into its value.
    let inner: { anchor: number; focus: number }
    // Every move and extend the extension asked for, inside the input or not.
    let moves: string[] = []

    function inside(selection: Selection): boolean {
      const { rangeCount, isCollapsed, anchorNode, anchorOffset } = selection
      return rangeCount === 1 && isCollapsed && anchorNode === point[0] && anchorOffset === point[1]
    }

    function focusedInputOf(type: keyof typeof VALUES, anchor = 0, focus = anchor): void {
      setPageHtml(`${PAGE_HTML}<input type="${type}" value="${VALUES[type]}">`)
      input = document.querySelector('input')!
      input.focus()
      expect(input.selectionStart).toBeNull()
      const parent = input.parentNode!
      point = [parent, Array.from(parent.childNodes).indexOf(input)]
      window.getSelection()!.collapse(...point)
      inner = { anchor, focus }
      moves = []
    }

    beforeEach(() => {
      for (const name of STUBBED) {
        const original = Object.getOwnPropertyDescriptor(Selection.prototype, name)
        if (original) originals.set(name, original)
      }
      const real = (name: string, selection: Selection, args: unknown[]): unknown =>
        (originals.get(name)?.value as (...a: unknown[]) => unknown)?.apply(selection, args)
      Object.defineProperties(Selection.prototype, {
        toString: {
          configurable: true,
          value(this: Selection) {
            if (!inside(this)) return real('toString', this, [])
            const { anchor, focus } = inner
            return input.value.slice(Math.min(anchor, focus), Math.max(anchor, focus))
          }
        },
        direction: {
          configurable: true,
          get(this: Selection) {
            if (!inside(this) || inner.anchor === inner.focus) return 'none'
            return inner.anchor < inner.focus ? 'forward' : 'backward'
          }
        },
        collapseToStart: {
          configurable: true,
          value(this: Selection) {
            if (!inside(this)) return real('collapseToStart', this, [])
            throw new Error(LEFT_THE_INPUT)
          }
        },
        collapseToEnd: {
          configurable: true,
          value(this: Selection) {
            if (!inside(this)) return real('collapseToEnd', this, [])
            throw new Error(LEFT_THE_INPUT)
          }
        },
        modify: {
          configurable: true,
          value(this: Selection, alter: string, direction: string, granularity: string) {
            moves.push(`${alter} ${direction}`)
            if (!inside(this)) return real('modify', this, [alter, direction, granularity])
            expect(granularity).toBe('character')
            const { anchor, focus } = inner
            const forward = direction === 'forward'
            if (alter === 'move' && anchor !== focus) {
              // As an arrow key does: onto the end it moves towards, and no further.
              inner.anchor = inner.focus = forward
                ? Math.max(anchor, focus)
                : Math.min(anchor, focus)
              return
            }
            inner.focus = Math.max(0, Math.min(input.value.length, focus + (forward ? 1 : -1)))
            if (alter === 'move') inner.anchor = inner.focus
          }
        },
        getComposedRanges: {
          configurable: true,
          value(this: Selection) {
            const { startContainer, startOffset, endContainer, endOffset } = this.getRangeAt(0)
            return [
              inside(this)
                ? new StaticRange({
                    startContainer: point[0],
                    startOffset: point[1],
                    endContainer: point[0],
                    endOffset: point[1] + 1
                  })
                : new StaticRange({ startContainer, startOffset, endContainer, endOffset })
            ]
          }
        }
      })
    })

    afterEach(() => {
      for (const name of [...STUBBED, 'direction', 'getComposedRanges']) {
        Reflect.deleteProperty(Selection.prototype, name)
        const original = originals.get(name)
        if (original) Object.defineProperty(Selection.prototype, name, original)
      }
      originals.clear()
    })

    function expectCaretLeftAlone(): void {
      const removeAllRanges = vi.spyOn(Selection.prototype, 'removeAllRanges')
      try {
        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        expect(removeAllRanges).not.toHaveBeenCalled()
        expect(selectionEnds()).toEqual([...point, ...point])
        dispatch({ type: 'RELEASE_CAPTURE_UI' })
        expect(selectionEnds()).toEqual([...point, ...point])
        // Not even collapsed on itself: nothing here may fire the page's selectionchange.
        expect(moves).toEqual([])
      } finally {
        removeAllRanges.mockRestore()
      }
    }

    it.each(Object.keys(VALUES) as Array<keyof typeof VALUES>)(
      'leaves a caret in a focused %s input alone',
      (type) => {
        focusedInputOf(type, 3)
        expectCaretLeftAlone()
      }
    )

    it('leaves that caret alone where composed ranges are unavailable too', () => {
      Reflect.deleteProperty(Selection.prototype, 'getComposedRanges')
      focusedInputOf('email', 3)
      expectCaretLeftAlone()
    })

    it.each([
      ['forward', 0, 7],
      ['backward', 7, 0]
    ])(
      'takes a %s selection inside the input out of every frame and puts it back as it was',
      (_direction, anchor, focus) => {
        focusedInputOf('email', anchor, focus)
        const removeAllRanges = vi.spyOn(Selection.prototype, 'removeAllRanges')
        try {
          expect(window.getSelection()!.toString()).toBe('someone')

          dispatch({ type: 'PREPARE_FOR_CAPTURE' })
          dispatch({ type: 'PREPARE_FOR_CAPTURE' })
          expect(window.getSelection()!.toString()).toBe('')
          // Collapsed on the selection's anchor, inside the input: the document's own selection
          // is not emptied, which would lose the place in the input.
          expect(inner).toEqual({ anchor, focus: anchor })
          expect(removeAllRanges).not.toHaveBeenCalled()

          dispatch({ type: 'RELEASE_CAPTURE_UI' })
          expect(inner).toEqual({ anchor, focus })
          expect(selectionEnds()).toEqual([...point, ...point])
          expect(document.activeElement).toBe(input)
          // One move for all the strips, then one step per selected character.
          const towardsFocus = anchor < focus ? 'forward' : 'backward'
          expect(moves).toEqual([
            `move ${anchor < focus ? 'backward' : 'forward'}`,
            ...Array.from('someone', () => `extend ${towardsFocus}`)
          ])
        } finally {
          removeAllRanges.mockRestore()
        }
      }
    )

    it('keeps a caret the operator moved in the input during the capture', () => {
      focusedInputOf('email', 0, 7)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      inner = { anchor: 12, focus: 12 }
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: 12, focus: 12 })
      expect(selectionEnds()).toEqual([...point, ...point])
    })

    it('keeps a caret the operator moved to where nothing can be extended', () => {
      focusedInputOf('email', 0, 7)
      const end = VALUES.email.length

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      inner = { anchor: end, focus: end }
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: end, focus: end })
      expect(selectionEnds()).toEqual([...point, ...point])
    })

    it('selects nothing in an input whose text changed during the capture', () => {
      focusedInputOf('email', 0, 7)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      // The held text is still there under the caret, so only the whole value tells.
      input.value = 'someone@example.org'
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: 0, focus: 0 })
      expect(selectionEnds()).toEqual([...point, ...point])
    })

    it('keeps a selection the operator made in the input during the capture', () => {
      focusedInputOf('email', 0, 7)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      inner = { anchor: 3, focus: 9 }
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: 3, focus: 9 })
      expect(selectionEnds()).toEqual([...point, ...point])
    })

    it('selects nothing in an input that lost the focus during the capture', () => {
      focusedInputOf('email', 0, 7)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      input.blur()
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: 0, focus: 0 })
      expect(selectionEnds()).toEqual([...point, ...point])
    })

    it('selects nothing in the input once the selection has moved to the page', () => {
      focusedInputOf('email', 0, 7)
      const text = document.querySelector('p')!.firstChild!

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      window.getSelection()!.collapse(text, 5)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(inner).toEqual({ anchor: 0, focus: 0 })
      expect(selectionEnds()).toEqual([text, 5, text, 5])
      // The page's caret is not extended either.
      expect(moves).toEqual(['move backward'])
    })
  })

  describe('with composed ranges, which keep ends inside shadow trees', () => {
    let calls: GetComposedRangesOptions[] = []
    let composed: () => StaticRange
    let runtimeOnly: typeof chrome

    beforeEach(() => {
      calls = []
      runtimeOnly = chrome
      Object.defineProperty(Selection.prototype, 'getComposedRanges', {
        configurable: true,
        value: (options: GetComposedRangesOptions) => {
          calls.push(options)
          return [composed()]
        }
      })
      vi.stubGlobal('chrome', {
        ...chrome,
        dom: { openOrClosedShadowRoot: (element: HTMLElement) => shadowRoots.get(element) ?? null }
      })
    })

    afterEach(() => {
      delete (Selection.prototype as Partial<Selection>).getComposedRanges
      vi.stubGlobal('chrome', runtimeOnly)
    })

    function twoParagraphs(): [Text, Text] {
      setPageHtml(
        '<main><p>Report abuse to evil@example.com immediately.</p>' +
          '<p id="second">A different passage entirely.</p><div id="host"></div></main>'
      )
      const [first, second] = Array.from(document.querySelectorAll('p'))
      return [first.firstChild as Text, second.firstChild as Text]
    }

    // A click leaves a caret that paints no highlight; clearing it would only fire the page's
    // selectionchange on every capture taken after a click.
    it('leaves a caret alone when its composed range is collapsed', () => {
      const [first] = twoParagraphs()
      composed = () =>
        new StaticRange({
          startContainer: first,
          startOffset: 5,
          endContainer: first,
          endOffset: 5
        })
      window.getSelection()!.collapse(first, 5)
      const removeAllRanges = vi.spyOn(Selection.prototype, 'removeAllRanges')

      try {
        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        expect(removeAllRanges).not.toHaveBeenCalled()
        expect(window.getSelection()!.rangeCount).toBe(1)
        dispatch({ type: 'RELEASE_CAPTURE_UI' })
        expect(selectionEnds()).toEqual([first, 5, first, 5])
      } finally {
        removeAllRanges.mockRestore()
      }
    })

    // The caret was never held, so nothing puts it back.
    it('loses a caret to the fallback strip run after a failed teardown', () => {
      const [first] = twoParagraphs()
      composed = () =>
        new StaticRange({
          startContainer: first,
          startOffset: 5,
          endContainer: first,
          endOffset: 5
        })
      window.getSelection()!.collapse(first, 5)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(window.getSelection()!.rangeCount).toBe(1)
      removeInjectedBirdbrainUi()
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(window.getSelection()!.rangeCount).toBe(0)
    })

    // Chromium's getRangeAt reports a selection that crosses a shadow boundary as collapsed; the
    // composed range is what tells it from a caret, so the highlight still leaves the frame.
    it('clears a shadow-crossing selection that getRangeAt reports as collapsed', () => {
      const [first, second] = twoParagraphs()
      composed = () =>
        new StaticRange({
          startContainer: first,
          startOffset: 7,
          endContainer: second,
          endOffset: 11
        })
      window.getSelection()!.collapse(first, 7)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(window.getSelection()!.rangeCount).toBe(0)
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(selectionEnds()).toEqual([first, 7, second, 11])
    })

    it('restores from the composed range and hands it every shadow root, closed ones included', () => {
      const [first, second] = twoParagraphs()
      const open = document.getElementById('host')!.attachShadow({ mode: 'open' })
      open.innerHTML = '<span id="inner"></span>'
      const closed = open.getElementById('inner')!.attachShadow({ mode: 'closed' })
      composed = () =>
        new StaticRange({
          startContainer: first,
          startOffset: 7,
          endContainer: second,
          endOffset: 11
        })
      window.getSelection()!.setBaseAndExtent(first, 7, first, 12)

      dispatch({ type: 'PREPARE_FOR_CAPTURE' })
      expect(calls).toEqual([{ shadowRoots: [open, closed] }])
      dispatch({ type: 'RELEASE_CAPTURE_UI' })

      expect(selectionEnds()).toEqual([first, 7, second, 11])
    })

    it('restores no range the page cut short during the capture, and still puts the bar back', async () => {
      const [first] = twoParagraphs()
      // Only the end falls past the shortened text, so each end is checked on its own.
      composed = () =>
        new StaticRange({
          startContainer: first,
          startOffset: 2,
          endContainer: first,
          endOffset: 30
        })
      window.getSelection()!.setBaseAndExtent(first, 2, first, 30)
      await mouseUp()
      await clickAction('selector')
      const warn = vi.spyOn(console, 'warn')

      try {
        dispatch({ type: 'PREPARE_FOR_CAPTURE' })
        first.data = 'Gone.'
        dispatch({ type: 'RELEASE_CAPTURE_UI' })

        expect(window.getSelection()!.rangeCount).toBe(0)
        expect(barMessage()).toBe('Selector created')
        expect(warn).not.toHaveBeenCalledWith(RELEASE_FAILED, expect.anything())
      } finally {
        warn.mockRestore()
      }
    })
  })
})

describe("the bar is the page's guest, not its owner", () => {
  it('never adopts or removes a page-owned element carrying the bar id', async () => {
    // An id is not ownership. Adopting the node would break the bar (no shadow
    // root to render into) and the strip that runs before every MHTML and
    // screenshot frame would delete a page element out of the evidence.
    setPageHtml(
      '<main><p>Report abuse to evil@example.com immediately.</p>' +
        `<div id="${SELECTION_BAR_ID}">Page-owned, not ours</div></main>`
    )
    const decoy = document.querySelector<HTMLElement>('main > div')!
    selectParagraph()
    await mouseUp()

    expect(bar()).not.toBeNull()
    expect(bar()).not.toBe(decoy)
    expect(shadowRoots.has(decoy)).toBe(false)

    removeInjectedBirdbrainUi()
    expect(bar()).toBeNull()
    expect(document.body.contains(decoy)).toBe(true)
    expect(decoy.textContent).toBe('Page-owned, not ours')
  })

  it('does not render into a page-forged host carrying the marker', async () => {
    // The marker is not ownership either: rendering into a forged host's open root would hand
    // the page the buttons.
    setPageHtml(
      '<main><p>Report abuse to evil@example.com immediately.</p></main>' +
        `<div ${SELECTION_BAR_MARKER}="${SELECTION_BAR_MARKER_VALUE}"></div>`
    )
    const pageRoot = bar()!.attachShadow({ mode: 'open' })
    selectParagraph()
    await mouseUp()

    expect(pageRoot.querySelector('button')).toBeNull()
  })

  it('raises the bar on a page that stops mouseup propagation', async () => {
    // Custom editors routinely swallow mouseup, and they are exactly the pages
    // worth investigating; a bubble-phase listener would never run there.
    document.querySelector('main')!.addEventListener('mouseup', (e) => e.stopPropagation())
    selectParagraph()
    operatorMouseUp(document.querySelector('p')!, { bubbles: true })
    await flushTimers()

    expect(barButtons().map((b) => b.dataset.action)).toEqual(['selector', 'tag', 'quote'])
  })
})

describe('a slow service worker cannot strand the bar on stale text', () => {
  it('renders nothing when the selection collapsed during the state query', async () => {
    let resolveState: ((value: unknown) => void) | null = null
    sendMessageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve
        })
    )

    selectParagraph()
    operatorMouseUp()
    await flushTimers()
    expect(bar()).toBeNull()

    clearSelection()
    resolveState!({ connected: true, activeCaseId: 'case-1' })
    await flushTimers()

    expect(bar()).toBeNull()
  })

  it('renders nothing when the selection was replaced during the state query', async () => {
    setPageHtml(
      '<main><p>Report abuse to evil@example.com immediately.</p>' +
        '<p id="second">A different passage entirely.</p></main>'
    )
    let resolveState: ((value: unknown) => void) | null = null
    sendMessageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve
        })
    )

    selectParagraph()
    operatorMouseUp()
    await flushTimers()

    // The operator moved on before the worker answered
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('second')!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    resolveState!({ connected: true, activeCaseId: 'case-1' })
    await flushTimers()

    // Dropped, not adopted: the mouseup that produced the new selection runs
    // its own pass rather than this continuation inheriting it
    expect(bar()).toBeNull()
  })

  it('still raises when the same passage is re-selected with other line breaks (#1003)', async () => {
    setPageHtml(
      '<main><p>Acme Holdings Ltd\n12 Harbour Road</p>' +
        '<p id="second">Acme Holdings Ltd 12   Harbour\nRoad</p></main>'
    )
    let resolveState: ((value: unknown) => void) | null = null
    sendMessageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve
        })
    )

    selectParagraph()
    operatorMouseUp()
    await flushTimers()

    const range = document.createRange()
    range.selectNodeContents(document.getElementById('second')!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    resolveState!({ connected: true, activeCaseId: 'case-1' })
    await flushTimers()

    // The stale check compares collapsed passages, so a layout difference
    // alone is the same offer
    expect(bar()).not.toBeNull()

    // The offer is against the selection on screen now, so a Quote carries
    // that selection's line breaks, not those of the one it replaced
    await clickAction('quote')
    expect(actionRequests).toEqual([
      {
        action: 'quote',
        text: 'Acme Holdings Ltd 12 Harbour Road',
        rawText: 'Acme Holdings Ltd 12   Harbour\nRoad'
      }
    ])
  })
})
