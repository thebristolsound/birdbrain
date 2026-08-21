import { useEffect, useMemo } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

// Modifier state is all the gesture logic needs, and accepting the Pick lets
// row keydown (Enter/Space) reuse the same handler as mouse clicks.
export type RowModifierEvent = Pick<
  React.MouseEvent | React.KeyboardEvent,
  'shiftKey' | 'metaKey' | 'ctrlKey'
>

// Multiselect gesture contract from the V2 handoff bundle (HANDOFF.md
// "Multiselect", issue #396): plain click selects and the detail pane follows,
// cmd/ctrl-click toggles, shift-click extends from the anchor, cmd-A selects
// the current filter, Escape clears. Selection survives filter changes — the
// store keeps hidden ids — while the bar, its count and its actions are scoped
// to the rows the current filter shows, matching the prototype's `nSel`.
export function useCaptureSelection(displayedIds: string[]) {
  const selectedCaptureIds = useAppStore((s) => s.selectedCaptureIds)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const toggleCaptureSelection = useAppStore((s) => s.toggleCaptureSelection)
  const selectAllCaptures = useAppStore((s) => s.selectAllCaptures)
  const clearCaptureSelection = useAppStore((s) => s.clearCaptureSelection)
  const deselectCaptures = useAppStore((s) => s.deselectCaptures)
  const selectCaptureRange = useAppStore((s) => s.selectCaptureRange)
  const setSelectionAnchor = useAppStore((s) => s.setSelectionAnchor)

  const visibleSelectedIds = useMemo(
    () => displayedIds.filter((id) => selectedCaptureIds.has(id)),
    [displayedIds, selectedCaptureIds]
  )
  const allVisibleSelected =
    displayedIds.length > 0 && visibleSelectedIds.length === displayedIds.length

  function handleRowClick(id: string, e: RowModifierEvent) {
    if (e.shiftKey) {
      // Range from the anchor; detail follows the shift-clicked row but the
      // anchor stays put so successive shift-clicks re-extend from it.
      selectCaptureRange(displayedIds, id)
      selectCapture(id)
      return
    }
    if (e.metaKey || e.ctrlKey) {
      toggleCaptureSelection(id)
      setSelectionAnchor(id)
      return
    }
    selectCapture(id)
    setSelectionAnchor(id)
  }

  function handleCheckboxClick(id: string, e: RowModifierEvent) {
    if (e.shiftKey) {
      selectCaptureRange(displayedIds, id)
      return
    }
    toggleCaptureSelection(id)
    setSelectionAnchor(id)
  }

  function toggleSelectAll() {
    // Both branches are scoped to what the filter shows, because the checkbox's
    // own checked state and the bar's count are. Clearing the whole store here
    // would drop selections the operator cannot currently see and was given no
    // indication of.
    if (allVisibleSelected) deselectCaptures(displayedIds)
    else selectAllCaptures(displayedIds)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        if (inEditable || displayedIds.length === 0) return
        e.preventDefault()
        selectAllCaptures(displayedIds)
        return
      }
      if (e.key === 'Escape') {
        if (inEditable) return
        // Open dialogs and the bar's own overlays own Escape while they are
        // up; the guard attribute lets non-dialog overlays opt in.
        if (document.querySelector('[role="dialog"], [data-selection-escape-guard]')) return
        // The command palette is checked by state rather than by the DOM query
        // above, because it renders no role="dialog". Reading the store makes
        // the precedence independent of listener registration order; see the
        // note on the listener below.
        if (useAppStore.getState().commandPaletteOpen) return
        if (useAppStore.getState().selectedCaptureIds.size > 0) clearCaptureSelection()
      }
    }
    // On `window`, not `document`: a document listener fires first during
    // bubbling and would clear the selection out from under a palette
    // dismissal. That is necessary but not sufficient. Same-target listeners
    // fire in registration order, and this hook lives in CaptureList, a
    // descendant of the root layout that owns the palette — React flushes child
    // effects before parent effects, so this listener registers first and the
    // defaultPrevented check cannot be relied on. The palette is therefore
    // checked by store state above rather than by ordering.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [displayedIds, selectAllCaptures, clearCaptureSelection, deselectCaptures])

  return {
    selectedCaptureIds,
    visibleSelectedIds,
    allVisibleSelected,
    selectionActive: visibleSelectedIds.length > 0,
    handleRowClick,
    handleCheckboxClick,
    toggleSelectAll,
    clearSelection: clearCaptureSelection
  }
}
