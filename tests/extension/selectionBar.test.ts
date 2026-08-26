// @vitest-environment jsdom
//
// The in-page selection bar (#393): raised by a page mouseup, gated on the
// background's connection + active-case state, and a full participant in the
// capture suppression protocol — stripped by the strip, latched against
// re-injection until the background's release, restored afterwards on the
// success and failure paths alike.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  isCaptureUiSuppressed,
  releaseCaptureUiSuppression
} from '../../extension/src/captureSuppression'
import { removeInjectedBirdbrainUi } from '../../extension/src/captureHygiene'
import { SELECTION_BAR_ID, SELECTION_BAR_SELECTOR } from '../../extension/src/selectionBar'
import type { SelectionActionResponse } from '@extension/messages'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const listeners: Listener[] = []
const sendMessageMock = vi.fn()

// Per-test control over the background the bar talks to
let stateResponse: unknown = { connected: true, activeCaseId: 'case-1' }
let stateRejects = false
let actionResponse: unknown = { ok: true, detail: 'Selector created', captured: false }
const actionRequests: Array<{ action: string; text: string }> = []

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
  document.dispatchEvent(new MouseEvent('mouseup'))
  await flushTimers()
}

// Looked up the way ownership is decided — by the marker render() sets, never
// by the id a page is free to carry.
function bar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTION_BAR_SELECTOR)
}

function barButtons(): HTMLButtonElement[] {
  return Array.from(bar()?.shadowRoot?.querySelectorAll('button') ?? [])
}

function barMessage(): string {
  return bar()?.shadowRoot?.querySelector('.message')?.textContent ?? ''
}

async function clickAction(action: string): Promise<void> {
  const button = bar()!.shadowRoot!.querySelector(`[data-action="${action}"]`) as HTMLButtonElement
  button.click()
  await flushTimers()
}

beforeAll(async () => {
  sendMessageMock.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'GET_STATE') {
      if (stateRejects) throw new Error('Extension context invalidated')
      return stateResponse
    }
    if (message.type === 'SELECTION_ACTION') {
      const request = message as unknown as { action: string; text: string }
      actionRequests.push({ action: request.action, text: request.text })
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
    expect(bar()?.shadowRoot?.querySelector('.spinner')).not.toBeNull()

    resolveAction({ ok: true, detail: 'Tagged "evil-example-com"', captured: true })
    await clicked

    expect(actionRequests).toEqual([
      { action: 'tag', text: 'Report abuse to evil@example.com immediately.' }
    ])
    expect(barMessage()).toBe('Tagged "evil-example-com"')
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
    expect(bar()?.shadowRoot?.querySelector('.status.error')).not.toBeNull()
  })
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
    document.dispatchEvent(new MouseEvent('mouseup'))
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
    expect(bar()?.shadowRoot?.querySelector('.spinner')).not.toBeNull()

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
    // it would invite an action on it.
    clearSelection()
    dispatch({ type: 'RELEASE_CAPTURE_UI' })
    expect(bar()).toBeNull()
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

describe('the bar is the page\'s guest, not its owner', () => {
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
    expect(decoy.shadowRoot).toBeNull()

    removeInjectedBirdbrainUi()
    expect(bar()).toBeNull()
    expect(document.body.contains(decoy)).toBe(true)
    expect(decoy.textContent).toBe('Page-owned, not ours')
  })

  it('raises the bar on a page that stops mouseup propagation', async () => {
    // Custom editors routinely swallow mouseup, and they are exactly the pages
    // worth investigating; a bubble-phase listener would never run there.
    document.querySelector('main')!.addEventListener('mouseup', (e) => e.stopPropagation())
    selectParagraph()
    document.querySelector('p')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
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
    document.dispatchEvent(new MouseEvent('mouseup'))
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
    document.dispatchEvent(new MouseEvent('mouseup'))
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
})
