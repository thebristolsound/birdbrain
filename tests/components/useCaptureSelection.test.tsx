// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { renderHook, act, cleanup, render } from '@testing-library/react'
import { useCaptureSelection } from '@renderer/components/captures/useCaptureSelection'
import { Dialog, DialogContent } from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'

const ORDER = ['cap-1', 'cap-2', 'cap-3', 'cap-4']

function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
  return event
}

function state() {
  return useAppStore.getState()
}

beforeEach(() => {
  useAppStore.setState({
    selectedCaptureId: null,
    selectedCaptureIds: new Set(),
    selectionAnchorId: null,
    openDialogCount: 0
  })
})

afterEach(() => {
  cleanup()
})

describe('useCaptureSelection', () => {
  it('plain click selects the detail row, sets the anchor, and leaves the multi-set alone', () => {
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    act(() =>
      result.current.handleRowClick('cap-2', { shiftKey: false, metaKey: false, ctrlKey: false })
    )

    expect(state().selectedCaptureId).toBe('cap-2')
    expect(state().selectionAnchorId).toBe('cap-2')
    expect(state().selectedCaptureIds.size).toBe(0)
  })

  it('cmd-click toggles the multi-set without moving the detail selection', () => {
    useAppStore.setState({ selectedCaptureId: 'cap-1' })
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    act(() =>
      result.current.handleRowClick('cap-3', { shiftKey: false, metaKey: true, ctrlKey: false })
    )

    expect(state().selectedCaptureId).toBe('cap-1')
    expect([...state().selectedCaptureIds]).toEqual(['cap-3'])
    expect(state().selectionAnchorId).toBe('cap-3')
  })

  it('shift-click extends from the anchor and the detail follows', () => {
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    act(() =>
      result.current.handleRowClick('cap-1', { shiftKey: false, metaKey: false, ctrlKey: false })
    )
    act(() =>
      result.current.handleRowClick('cap-3', { shiftKey: true, metaKey: false, ctrlKey: false })
    )

    expect([...state().selectedCaptureIds].sort()).toEqual(['cap-1', 'cap-2', 'cap-3'])
    expect(state().selectedCaptureId).toBe('cap-3')
    // Anchor stays put so a further shift-click re-extends from it.
    expect(state().selectionAnchorId).toBe('cap-1')
  })

  it('checkbox click toggles and re-anchors; checkbox shift-click ranges without detail', () => {
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    act(() =>
      result.current.handleCheckboxClick('cap-2', {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false
      })
    )
    expect([...state().selectedCaptureIds]).toEqual(['cap-2'])
    expect(state().selectionAnchorId).toBe('cap-2')

    act(() =>
      result.current.handleCheckboxClick('cap-4', {
        shiftKey: true,
        metaKey: false,
        ctrlKey: false
      })
    )
    expect([...state().selectedCaptureIds].sort()).toEqual(['cap-2', 'cap-3', 'cap-4'])
    expect(state().selectedCaptureId).toBeNull()
  })

  it('scopes visible counts to the displayed order while hidden ids survive in the store', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1', 'cap-hidden']) })
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    expect(result.current.visibleSelectedIds).toEqual(['cap-1'])
    expect(result.current.selectionActive).toBe(true)
    expect(result.current.allVisibleSelected).toBe(false)
    expect(state().selectedCaptureIds.has('cap-hidden')).toBe(true)
  })

  it('toggleSelectAll selects every displayed row, then clears everything', () => {
    const { result } = renderHook(() => useCaptureSelection(ORDER))

    act(() => result.current.toggleSelectAll())
    expect([...state().selectedCaptureIds].sort()).toEqual([...ORDER].sort())

    act(() => result.current.toggleSelectAll())
    expect(state().selectedCaptureIds.size).toBe(0)
  })

  it('cmd-A selects the current filter and is suppressed inside text inputs', () => {
    renderHook(() => useCaptureSelection(ORDER))

    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => {
      press('a', { metaKey: true }, input)
    })
    expect(state().selectedCaptureIds.size).toBe(0)

    let event: KeyboardEvent
    act(() => {
      event = press('a', { metaKey: true })
    })
    expect([...state().selectedCaptureIds].sort()).toEqual([...ORDER].sort())
    expect(event!.defaultPrevented).toBe(true)
    input.remove()
  })

  it('Escape clears the selection', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']) })
    renderHook(() => useCaptureSelection(ORDER))

    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(0)
  })

  // Kept, but it no longer carries the palette's weight. Registering `claim`
  // before renderHook hard-codes the favourable ordering, and the real ordering
  // is the opposite: this hook lives in a descendant of the layout that owns the
  // palette, and React flushes child effects first. The palette case is pinned
  // by store state in the test below instead.
  it('Escape defers to a handler that already claimed the key', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']) })
    const claim = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', claim)
    renderHook(() => useCaptureSelection(ORDER))

    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(1)
    window.removeEventListener('keydown', claim)
  })

  it('Escape defers to the command palette regardless of listener order', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']), commandPaletteOpen: true })
    // No competing listener and no preventDefault: if precedence depended on
    // registration order or on the DOM dialog query, this would clear. The
    // palette renders no role="dialog", so state is the only honest signal.
    renderHook(() => useCaptureSelection(ORDER))

    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(1)
    useAppStore.setState({ commandPaletteOpen: false })
  })

  it('Escape defers to an open dialog or guarded overlay', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']) })
    renderHook(() => useCaptureSelection(ORDER))

    // Registration count, not a DOM query for role="dialog": the role outlives
    // the close by the length of the exit animation (#686).
    useAppStore.setState({ openDialogCount: 1 })
    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(1)
    useAppStore.setState({ openDialogCount: 0 })

    const guarded = document.createElement('div')
    guarded.setAttribute('data-selection-escape-guard', '')
    document.body.appendChild(guarded)
    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(1)
    guarded.remove()

    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(0)
  })

  it('Escape clears the selection while a just-closed dialog is still animating out', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']) })
    const { rerender } = render(<SelectionWithDialog dialogOpen />)

    rerender(<SelectionWithDialog dialogOpen={false} />)

    // AnimatePresence keeps the content mounted for the exit animation, so the
    // role attribute is still queryable here. That is the whole point: the
    // dialog is logically closed and the guard must already be disarmed (#686).
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(0)
  })

  it('one Escape closes the open dialog without also clearing the selection', () => {
    useAppStore.setState({ selectedCaptureIds: new Set(['cap-1']) })
    render(<SelectionWithDialog dialogOpen />)

    act(() => {
      press('Escape')
    })

    // The dialog's own close and the selection clear are both window listeners
    // for this one keydown; the registration outlives the dispatch, so the
    // press does one thing. This is the precedence contract #687 inherits.
    expect(state().openDialogCount).toBe(0)
    expect(state().selectedCaptureIds.size).toBe(1)

    act(() => {
      press('Escape')
    })
    expect(state().selectedCaptureIds.size).toBe(0)
  })
})

function SelectionWithDialog({ dialogOpen }: { dialogOpen: boolean }) {
  const [open, setOpen] = useState(dialogOpen)
  useCaptureSelection(ORDER)

  // The prop drives the dialog on a rerender, so a test can close it from the
  // outside; Escape closes it from the inside through Dialog's own listener.
  const isOpen = dialogOpen && open

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent onClose={() => setOpen(false)}>confirm</DialogContent>
    </Dialog>
  )
}
