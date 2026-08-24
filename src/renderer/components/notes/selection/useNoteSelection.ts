import { useCallback, useState, type RefObject } from 'react'
import { isActionableSelection, normalizeSelection } from '@shared/selectionKind'
import {
  selectionOverlayPosition,
  type SelectionOverlayPosition
} from '@renderer/components/notes/selection/noteSelectionGeometry'

/** `bar` is the two-action strip; `confirm` is the typed confirmation popover. */
export type NoteSelectionStep = 'bar' | 'confirm'

export type NoteSelectionMode = 'selector' | 'tag'

export interface NoteSelectionState extends SelectionOverlayPosition {
  /** Whitespace-collapsed selected passage. */
  text: string
  step: NoteSelectionStep
  /** Which action the confirm popover is confirming. Meaningless while `step` is `bar`. */
  mode: NoteSelectionMode
}

export interface UseNoteSelection {
  selection: NoteSelectionState | null
  /** Attach to the editor host's mouseup/keyup. */
  onSelectionEnd: (event: { target: EventTarget | null }) => void
  openConfirm: (mode: NoteSelectionMode) => void
  dismiss: () => void
}

/**
 * Marks the overlay's own DOM so a click inside it is not read as a new
 * selection. Without it, pressing a bar button lands a collapsed selection on
 * the host and closes the thing being pressed.
 */
export const SELECTION_UI_ATTR = 'data-selection-ui'

function clearNativeSelection(): void {
  const selection = window.getSelection()
  if (selection?.removeAllRanges) selection.removeAllRanges()
}

/**
 * Raise a Selector/Tag action bar for text selected inside the note editor
 * (#391).
 *
 * The DOM read stays here and the maths lives in `noteSelectionGeometry`, so
 * the part with a right answer is testable without a layout engine. A
 * selection that is too short or too long simply dismisses rather than
 * offering an action — see `isActionableSelection` for where the bounds come
 * from.
 */
export function useNoteSelection(hostRef: RefObject<HTMLElement | null>): UseNoteSelection {
  const [selection, setSelection] = useState<NoteSelectionState | null>(null)

  const dismiss = useCallback(() => {
    setSelection(null)
  }, [])

  const onSelectionEnd = useCallback(
    (event: { target: EventTarget | null }) => {
      const target = event.target
      // A click on the bar or the popover is an interaction with the overlay,
      // not a new selection.
      if (target instanceof Element && target.closest(`[${SELECTION_UI_ATTR}]`)) return

      const host = hostRef.current
      const native = window.getSelection()
      if (!host || !native || native.isCollapsed || native.rangeCount === 0) {
        setSelection(null)
        return
      }
      // A selection that started in the editor can end outside it; only text
      // the note actually contains gets an action.
      if (native.anchorNode && !host.contains(native.anchorNode)) {
        setSelection(null)
        return
      }
      const text = normalizeSelection(native.toString())
      if (!isActionableSelection(text)) {
        setSelection(null)
        return
      }
      const rect = native.getRangeAt(0).getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()
      const position = selectionOverlayPosition(rect, {
        left: hostRect.left,
        top: hostRect.top,
        scrollLeft: host.scrollLeft,
        scrollTop: host.scrollTop,
        clientWidth: host.clientWidth
      })
      setSelection({ text, step: 'bar', mode: 'selector', ...position })
    },
    [hostRef]
  )

  const openConfirm = useCallback((mode: NoteSelectionMode) => {
    // The passage is already captured in state, so the native highlight has
    // done its job; dropping it here keeps the editor from re-raising the bar
    // when focus moves into the popover.
    clearNativeSelection()
    setSelection((current) => (current ? { ...current, step: 'confirm', mode } : current))
  }, [])

  return { selection, onSelectionEnd, openConfirm, dismiss }
}
