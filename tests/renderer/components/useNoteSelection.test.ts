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
  focusNode?: Node | null
  rect?: { left: number; bottom: number }
  /** A real jsdom Range, for a selection that crosses the host's edge and is clipped. */
  range?: Range
}): void {
  const { text, collapsed = false, rangeCount = 1, rect = { left: 140, bottom: 60 } } = options
  const anchorNode = options.anchorNode === undefined ? host.firstChild : options.anchorNode
  const focusNode = options.focusNode === undefined ? host.firstChild : options.focusNode
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: collapsed,
    rangeCount,
    anchorNode,
    focusNode,
    removeAllRanges,
    toString: () => text,
    getRangeAt: () => options.range ?? { getBoundingClientRect: () => rect }
  } as unknown as Selection)
}

function rangeBetween(start: [Node, number], end: [Node, number]): Range {
  const range = document.createRange()
  range.setStart(...start)
  range.setEnd(...end)
  return range
}

function outsideParagraph(text: string, where: 'before' | 'after'): Text {
  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createTextNode(text))
  if (where === 'before') document.body.insertBefore(paragraph, host)
  else document.body.appendChild(paragraph)
  return paragraph.firstChild as Text
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
  // jsdom's Range has no getBoundingClientRect at all, so a clipped range needs one.
  Range.prototype.getBoundingClientRect = () => ({ left: 140, bottom: 60 }) as DOMRect
})

afterEach(() => {
  delete (Range.prototype as Partial<Range>).getBoundingClientRect
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

  // The anchor is where the drag started, so a check on it alone passes this
  // direction, and the selection's own text includes what lies past the host (#878).
  it('reads only the text inside the host from a forward drag that overshoots it', () => {
    const outside = outsideParagraph('Case overview', 'after')
    stubSelection({
      text: 'meridian-trust.com overnight Case',
      anchorNode: host.firstChild,
      focusNode: outside,
      range: rangeBetween([host.firstChild as Text, 19], [outside, 4])
    })
    const { result } = setup()

    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toMatchObject({ text: 'meridian-trust.com overnight' })
  })

  it('reads only the text inside the host from a backward drag that starts past it', () => {
    const outside = outsideParagraph('Case overview', 'after')
    stubSelection({
      text: 'meridian-trust.com overnight Case',
      anchorNode: outside,
      focusNode: host.firstChild,
      range: rangeBetween([host.firstChild as Text, 19], [outside, 4])
    })
    const { result } = setup()

    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toMatchObject({ text: 'meridian-trust.com overnight' })
  })

  // Chromium's triple-click on a non-editable host's last block selects the
  // whole block and puts the focus on the block after the host.
  it('offers the last paragraph of a triple-click whose focus lands after the host', () => {
    const last = document.createElement('p')
    last.appendChild(document.createTextNode('Registrant: meridian-trust.com'))
    host.appendChild(last)
    const after = document.createElement('div')
    after.appendChild(document.createElement('p'))
    document.body.appendChild(after)
    stubSelection({
      text: 'Registrant: meridian-trust.com\n\n',
      anchorNode: last.firstChild,
      focusNode: after.firstChild,
      range: rangeBetween([last.firstChild as Text, 0], [after.firstChild as Node, 0])
    })
    const { result } = setup()

    act(() => result.current.onSelectionEnd({ target: host }))
    expect(result.current.selection).toMatchObject({ text: 'Registrant: meridian-trust.com' })
  })

  it('clears for a selection wholly outside the host, on either side of it', () => {
    const { result } = setup()

    for (const where of ['before', 'after'] as const) {
      stubSelection({ text: 'meridian-trust.com' })
      act(() => result.current.onSelectionEnd({ target: host }))
      expect(result.current.selection).not.toBeNull()

      const outside = outsideParagraph('Case overview', where)
      stubSelection({
        text: 'Case overview',
        anchorNode: outside,
        focusNode: outside,
        range: rangeBetween([outside, 0], [outside, 13])
      })
      act(() => result.current.onSelectionEnd({ target: host }))
      expect(result.current.selection).toBeNull()
    }
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

  // The popover unmounts under its own focused button, so dismissing it from
  // the keyboard would otherwise leave focus on the body mid-sentence (#1536).
  it('dismiss returns focus from the overlay to the editor', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    const overlay = document.createElement('div')
    overlay.setAttribute(SELECTION_UI_ATTR, '1')
    const cancel = document.createElement('button')
    overlay.appendChild(cancel)
    host.append(editable, overlay)
    const { result } = setup()
    cancel.focus()

    act(() => result.current.dismiss())

    expect(document.activeElement).toBe(editable)
  })

  it('dismiss leaves focus alone when it is not in the overlay', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    host.appendChild(editable)
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    const { result } = setup()
    elsewhere.focus()

    act(() => result.current.dismiss())

    expect(document.activeElement).toBe(elsewhere)
  })

  it('clears when the host has gone away', () => {
    stubSelection({ text: 'meridian-trust.com' })
    const ref = { current: null as HTMLElement | null }
    const { result } = renderHook(() => useNoteSelection(ref))

    act(() => result.current.onSelectionEnd({ target: null }))
    expect(result.current.selection).toBeNull()
  })
})
