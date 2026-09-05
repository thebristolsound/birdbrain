import { create } from 'zustand'
import type { CaptureEvent } from '@shared/types'

// The viewer's tab lives in the store rather than in CaptureViewer because the
// captures route has to know about it: the Wayback tab takes the full width,
// hiding the list and details columns.
export type CaptureViewerTab = 'screenshot' | 'page' | 'text' | 'wayback'

// The archive.org snapshot selected for side-by-side comparison. Keyed by
// capture so moving to another capture cannot leave the previous one's snapshot
// beside it.
export interface WaybackSelection {
  captureId: string
  snapshotUrl: string
  timestamp: string
}

interface AppState {
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
  selectedCaptureIds: Set<string>
  // Which note the Notes tab should mark as selected when it next renders.
  // Set by the dashboard activity feed (#403); the Notes tab reads it.
  selectedNoteId: string | null
  // The same hand-off for the Signals screen (#716). Signals otherwise opens
  // on allSignals[0], so a Mention chip naming one rule would open another.
  selectedSignalId: string | null
  // Shift-click range anchor (#396): the last plainly- or cmd-clicked row.
  selectionAnchorId: string | null
  // The selection as it stood when the anchor was set. A shift-click replaces
  // the previous range rather than unioning with it, so correcting an
  // overshoot shrinks the selection; anything selected before the anchor
  // survives, which is the Finder/Explorer contract.
  selectionRangeBase: string[]
  searchQuery: string
  activeSelectorFilters: string[]
  filteredCaptureIds: string[] | null
  // The tag filter (#918) keeps its own pair rather than sharing the slot
  // above. Both `removeSelectorFilter` and `useSelectorFilters` null
  // `filteredCaptureIds` the moment the selector list empties — and the hook
  // does it on every mount and every case change — so a shared slot would wipe
  // a tag narrowing nothing had touched, leaving the strip naming a filter the
  // list is no longer applying.
  activeTagFilters: string[]
  tagFilteredCaptureIds: string[] | null
  captureEvents: CaptureEvent[]
  captureStats: {
    successCount: number
    failCount: number
    skipCount: number
    lastError?: { message: string; timestamp: string }
  }
  commandPaletteOpen: boolean
  // How many Dialogs are logically open. A count rather than a boolean because
  // dialogs nest, and the inner one closing must not disarm the outer. It is
  // what keyboard guards read: `role="dialog"` survives the close for the
  // length of the exit animation, so the DOM cannot answer this (#686).
  openDialogCount: number
  panelCollapsedForced: boolean
  activeViewerTab: CaptureViewerTab
  // Which archive.org snapshot the Wayback compare shows on the right (#401).
  // It lives here because the panel that picks it is an aside of the captures
  // route while the pane that replays it is inside the viewer, and neither is
  // an ancestor of the other. Never a Capture: it is a replay URL and the time
  // archive.org states for it, held only for as long as the panel is open.
  waybackSelection: WaybackSelection | null

  setSessionActive: (active: boolean) => void
  setConnectedToExtension: (connected: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  registerOpenDialog: () => void
  unregisterOpenDialog: () => void
  setPanelCollapsedForced: (forced: boolean) => void
  setActiveViewerTab: (tab: CaptureViewerTab) => void
  setWaybackSelection: (selection: WaybackSelection | null) => void
  setSelectedCaptureId: (id: string | null) => void
  setSelectedNoteId: (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  selectCapture: (id: string) => void
  toggleCaptureSelection: (id: string) => void
  selectAllCaptures: (ids: string[]) => void
  clearCaptureSelection: () => void
  setSelectionAnchor: (id: string | null) => void
  selectCaptureRange: (orderedIds: string[], targetId: string) => void
  deselectCaptures: (ids: string[]) => void
  addSelectorFilter: (selectorId: string) => void
  removeSelectorFilter: (selectorId: string) => void
  clearSelectorFilters: () => void
  setFilteredCaptureIds: (ids: string[] | null) => void
  addTagFilter: (tagId: string) => void
  removeTagFilter: (tagId: string) => void
  clearTagFilters: () => void
  setTagFilteredCaptureIds: (ids: string[] | null) => void
  addCaptureEvent: (event: CaptureEvent) => void
  clearCaptureEvents: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessionActive: false,
  connectedToExtension: false,
  selectedCaptureId: null,
  selectedCaptureIds: new Set(),
  selectedNoteId: null,
  selectedSignalId: null,
  selectionAnchorId: null,
  selectionRangeBase: [],
  searchQuery: '',
  activeSelectorFilters: [],
  filteredCaptureIds: null,
  activeTagFilters: [],
  tagFilteredCaptureIds: null,
  captureEvents: [],
  captureStats: { successCount: 0, failCount: 0, skipCount: 0 },
  commandPaletteOpen: false,
  openDialogCount: 0,
  panelCollapsedForced: false,
  activeViewerTab: 'screenshot',
  waybackSelection: null,

  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  registerOpenDialog: () => set((s) => ({ openDialogCount: s.openDialogCount + 1 })),
  // Clamped: an unbalanced release would otherwise drive the count negative and
  // leave every later guard reading "no dialog" while one is up.
  unregisterOpenDialog: () => set((s) => ({ openDialogCount: Math.max(0, s.openDialogCount - 1) })),
  setPanelCollapsedForced: (forced) => set({ panelCollapsedForced: forced }),
  setActiveViewerTab: (tab) => set({ activeViewerTab: tab }),
  setWaybackSelection: (selection) => set({ waybackSelection: selection }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),
  setSelectedSignalId: (id) => set({ selectedSignalId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCapture: (id) => set({ selectedCaptureId: id }),

  toggleCaptureSelection: (id) =>
    set((s) => {
      const newSet = new Set(s.selectedCaptureIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { selectedCaptureIds: newSet }
    }),

  // Unions rather than replaces. The gesture means "select what I can see";
  // discarding ids the current filter hides would break the contract that
  // selection survives a filter change.
  selectAllCaptures: (ids) =>
    set((s) => ({ selectedCaptureIds: new Set([...s.selectedCaptureIds, ...ids]) })),

  clearCaptureSelection: () =>
    set({ selectedCaptureIds: new Set(), selectionAnchorId: null, selectionRangeBase: [] }),

  setSelectionAnchor: (id) =>
    set((s) => ({ selectionAnchorId: id, selectionRangeBase: [...s.selectedCaptureIds] })),

  selectCaptureRange: (orderedIds, targetId) =>
    set((s) => {
      const targetIdx = orderedIds.indexOf(targetId)
      if (targetIdx === -1) return {}
      const anchorIdx = s.selectionAnchorId ? orderedIds.indexOf(s.selectionAnchorId) : -1
      // A missing or stale anchor (cleared, or filtered out of the current
      // order) falls back to the target itself, so the gesture still selects
      // the clicked row instead of silently doing nothing.
      const from = anchorIdx === -1 ? targetIdx : Math.min(anchorIdx, targetIdx)
      const to = anchorIdx === -1 ? targetIdx : Math.max(anchorIdx, targetIdx)
      // Rebuilt from the base each time, not accumulated. Shift-clicking a
      // nearer row after overshooting has to shrink the range, or the operator
      // corrects the gesture, sees no change, and a bulk delete takes rows they
      // thought they had dropped.
      const base = anchorIdx === -1 ? [...s.selectedCaptureIds] : s.selectionRangeBase
      const next = new Set(base)
      for (const id of orderedIds.slice(from, to + 1)) next.add(id)
      return {
        selectedCaptureIds: next,
        selectionAnchorId: anchorIdx === -1 ? targetId : s.selectionAnchorId,
        selectionRangeBase: base
      }
    }),

  deselectCaptures: (ids) =>
    set((s) => {
      if (ids.length === 0) return {}
      const next = new Set(s.selectedCaptureIds)
      for (const id of ids) next.delete(id)
      return { selectedCaptureIds: next }
    }),

  addSelectorFilter: (selectorId) =>
    set((s) => ({
      activeSelectorFilters: s.activeSelectorFilters.includes(selectorId)
        ? s.activeSelectorFilters
        : [...s.activeSelectorFilters, selectorId]
    })),

  removeSelectorFilter: (selectorId) =>
    set((s) => {
      const updated = s.activeSelectorFilters.filter((id) => id !== selectorId)
      return {
        activeSelectorFilters: updated,
        filteredCaptureIds: updated.length === 0 ? null : s.filteredCaptureIds
      }
    }),

  clearSelectorFilters: () => set({ activeSelectorFilters: [], filteredCaptureIds: null }),

  setFilteredCaptureIds: (ids) => set({ filteredCaptureIds: ids }),

  // The tag filter's four, mirroring the selector four above. Multi-select, and
  // a union at the point of the query: a capture carrying ANY selected tag
  // stays, which is what `getCapturesWithAnyTag` returns.
  addTagFilter: (tagId) =>
    set((s) => ({
      activeTagFilters: s.activeTagFilters.includes(tagId)
        ? s.activeTagFilters
        : [...s.activeTagFilters, tagId]
    })),

  removeTagFilter: (tagId) =>
    set((s) => {
      const updated = s.activeTagFilters.filter((id) => id !== tagId)
      return {
        activeTagFilters: updated,
        tagFilteredCaptureIds: updated.length === 0 ? null : s.tagFilteredCaptureIds
      }
    }),

  clearTagFilters: () => set({ activeTagFilters: [], tagFilteredCaptureIds: null }),

  setTagFilteredCaptureIds: (ids) => set({ tagFilteredCaptureIds: ids }),

  addCaptureEvent: (event) =>
    set((s) => {
      let existing = s.captureEvents
      // Terminal events replace the matching 'received' spinner
      if (event.type === 'stored' || event.type === 'failed' || event.type === 'skipped') {
        const idx = existing.findIndex(
          (e) => e.type === 'received' && e.url === event.url && e.source === event.source
        )
        if (idx !== -1) {
          existing = [...existing.slice(0, idx), ...existing.slice(idx + 1)]
        }
      }
      const events = [event, ...existing].slice(0, 50)
      const stats = { ...s.captureStats }
      if (event.type === 'stored') stats.successCount++
      if (event.type === 'failed') {
        stats.failCount++
        stats.lastError = { message: event.error || 'Unknown error', timestamp: event.timestamp }
      }
      if (event.type === 'skipped') stats.skipCount++
      return { captureEvents: events, captureStats: stats }
    }),

  clearCaptureEvents: () =>
    set({ captureEvents: [], captureStats: { successCount: 0, failCount: 0, skipCount: 0 } })
}))
