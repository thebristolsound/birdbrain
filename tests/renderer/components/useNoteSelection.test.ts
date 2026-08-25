// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import {
  useNoteSelection,
  SELECTION_UI_ATTR
} from '@renderer/components/notes/selection/useNoteSelection'

let host: HTMLDivElement
let removeAllRanges: ReturnType<typeof vi.fn>

/**
 * jsdom has no layout engine, so `getBoundingClientRect` is all zeroes and a
 * real Range would place the overlay at the origin regardless of the input.
 * Stubbing the Selection is what lets the hook's decisions — is this passage
 * actionable, is it inside the host, is this click the overlay's own — be
 * tested; the arithmetic has its own test against `selectionOverlayPosition`.
 */
function stubSelection(options: {
  text: string
  collapsed?: boolean
  rangeCount?: number
  anchorNode?: Node | null
  rect?: { left: number; bottom: number }
}): void {
  const { text, collapsed = false, rangeCount = 1, rect = { left: 140, bottom: 60 } } = options
  const anchorNode = options.anchorNode === undefined ? host.firstChild : options.anchorNode
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: collapsed,
    rangeCount,
    anchorNode,
    removeAllRanges,
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => rect })
  } as unknown as Selection)
}

function setup() {
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null }
  ref.current = host
  return renderHook(() => useNoteSelection(ref))
}

beforeEach(() => {
  removeAllRanges = vi.fn()
  host = document.createElement('div')
  host.appendChild(document.createTextNode('the funds moved to meridian-trust.com overnight'))
  document.body.appendChild(host)
  // jsdom returns zeroes for every box; the values themselves do not matter
  // here, only that the hook reads them.
  host.getBoundingClientRect = () => ({ left: 100, top: 20 }) as DOMRect
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useNoteSelection', () => {
  it('raises the bar for an actionable passage inside the editor', () => {
    stubSelection({ text: ' meridian-trust.com ' })
    const { result } = setup()

    act(() => result.current.onSelectionEnd({ target: host }))

    expect(result.current.selection).toMatchObject({
      text: 'meridian-trust.com',
      step: 'bar',
      mode: 'selector'
    })
  })

  it('ignores a collapsed caret and an empty range', () => {
    const { result } = setup()

    stubSelection({ text: 'meridian-trust.com', collapsed: true })
    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toBeNull()

    stubSelection({ text: 'meridian-trust.com', rangeCount: 0 })
    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toBeNull()
  })

  it('ignores a selection whose anchor is outside the editor', () => {
    const outside = document.createElement('p')
    document.body.appendChild(outside)
    stubSelection({ text: 'meridian-trust.com', anchorNode: outside })
    const { result } = setup()

    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toBeNull()
  })

  it('ignores a passage too short or too long to be an identifier', () => {
    const { result } = setup()

    stubSelection({ text: 'to' })
    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toBeNull()

    stubSelection({ text: 'x'.repeat(161) })
    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toBeNull()
  })

  it('treats a click inside the overlay as an interaction, not a new selection', () => {
    stubSelection({ text: 'meridian-trust.com' })
    const { result } = setup()
    act(() => result.current.onSelectionEnd({ target: host }))
    act(() => result.current.openConfirm('tag'))

    const bar = document.createElement('div')
    bar.setAttribute(SELECTION_UI_ATTR, '1')
    host.appendChild(bar)
    const button = document.createElement('button')
    bar.appendChild(button)

    // Without the guard this collapses the selection the popover is about and
    // closes the thing being clicked.
    act(() => result.current.onSelectionEnd({ target: button }))
    expect(result.current.selection).toMatchObject({ step: 'confirm', mode: 'tag' })
  })

  it('moves to the confirm step keeping the captured passage, and drops the highlight', () => {
    stubSelection({ text: 'meridian-trust.com' })
    const { result } = setup()
    act(() => result.current.onSelectionEnd({ target: host }))

    act(() => result.current.openConfirm('selector'))
    expect(result.current.selection).toMatchObject({
      text: 'meridian-trust.com',
      step: 'confirm',
      mode: 'selector'
    })
    expect(removeAllRanges).toHaveBeenCalled()
  })

  it('openConfirm is inert with nothing selected', () => {
    const { result } = setup()
    act(() => result.current.openConfirm('tag'))
    expect(result.current.selection).toBeNull()
  })

  it('dismiss clears the overlay', () => {
    stubSelection({ text: 'meridian-trust.com' })
    const { result } = setup()
    act(() => result.current.onSelectionEnd({ target: host }))

    act(() => result.current.dismiss())
    expect(result.current.selection).toBeNull()
  })

  it('clears when the host has gone away', () => {
    stubSelection({ text: 'meridian-trust.com' })
    const ref = { current: null as HTMLElement | null }
    const { result } = renderHook(() => useNoteSelection(ref))

    act(() => result.current.onSelectionEnd({ target: null }))
    expect(result.current.selection).toBeNull()
  })
})
