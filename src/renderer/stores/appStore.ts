import { create } from 'zustand'
import type { CaptureEvent, FieldHit, LaunchedBrowserNotice } from '@shared/types'

// The viewer's tab lives in the store rather than in CaptureViewer because the
// captures route has to know about it: the Wayback tab takes the full width,
// hiding the list and details columns.
export type CaptureViewerTab = 'screenshot' | 'page' | 'text' | 'links' | 'wayback'

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
  // The Active Case the last session event named, or null. Not the Case on screen: a Capture
  // Session records into its Active Case wherever the Operator is looking.
  activeCaseId: string | null
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
  // The capture list's rows in display order, after every narrowing and the
  // sort, or null while no list is mounted. The viewer's pager reads it; the
  // list's own filters are component state it could not otherwise see.
  displayedCaptureIds: string[] | null
  captureEvents: CaptureEvent[]
  captureStats: {
    successCount: number
    failCount: number
    skipCount: number
    lastError?: { message: string; timestamp: string }
  }
  commandPaletteOpen: boolean
  // The Case the launched browser's start dialog is open for, or null while it is closed.
  startDialogCaseId: string | null
  // The confirmation before a Capture Session with a launched browser open stops (`1i`), opened
  // from the panel's Stop… and from the Capture Session switch.
  stopConfirmOpen: boolean
  // Clicked Captures (#1832): the tab the Operator picked as the capture target, whether the next
  // Capture runs Scroll-to-load (off by default, per Capture), and the tab picker the shortcut
  // and Choose tab… open.
  captureTargetId: string | null
  scrollToLoadNext: boolean
  tabPickerOpen: boolean
  // The notice of how the last launched browser closed that the Operator dismissed. Main keeps
  // its notice until the next launch.
  dismissedLaunchNotice: LaunchedBrowserNotice | null
  // The Share mark is on screen, so the Case action bar's pill wears its ring.
  shareMarkOpen: boolean
  // A tour chapter is running, so the Share mark stays off screen.
  tourRunning: boolean
  // How many Dialogs are logically open. A count rather than a boolean because
  // dialogs nest, and the inner one closing must not disarm the outer. It is
  // what keyboard guards read: `role="dialog"` survives the close for the
  // length of the exit animation, so the DOM cannot answer this (#686).
  openDialogCount: number
  panelCollapsedForced: boolean
  // The selected capture's tab. Each capture keeps the tab it was left on in
  // `viewerTabs` for the session, so moving between captures does not carry one
  // capture's tab (the full-width Wayback tab above all) onto the next.
  activeViewerTab: CaptureViewerTab
  viewerTabs: Record<string, CaptureViewerTab>
  // Which archive.org snapshot the Wayback compare shows on the right (#401).
  // It lives here because the panel that picks it is an aside of the captures
  // route while the pane that replays it is inside the viewer, and neither is
  // an ancestor of the other. Never a Capture: it is a replay URL and the time
  // archive.org states for it, held only for as long as the panel is open.
  waybackSelection: WaybackSelection | null
  // The search hit the viewer shows (docs/plans/2026-10-09-case-retrieval-first-slice.md,
  // D7): the Text tab marks a header hit's span, and the Links tab a link hit's rows.
  // Keyed by its Exhibit, which is the Capture's id. Selecting another Capture, or none,
  // drops it.
  viewerHit: FieldHit | null
  // Counts the openings of a hit. A repeated search returns the same hit object, so the
  // count, not the object, tells one opening from the next; the exact check's answer
  // belongs to one opening.
  viewerHitOpening: number
  // The Captures a run of link clicks came through, oldest first, for the viewer's Back
  // (#1735). Only a link click pushes; every other selection empties it, so it never
  // describes anything but that run. Not persisted, like the viewer's tab.
  captureTrail: string[]

  setSessionActive: (active: boolean) => void
  setActiveCaseId: (caseId: string | null) => void
  setConnectedToExtension: (connected: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  openStartDialog: (caseId: string) => void
  closeStartDialog: () => void
  setStopConfirmOpen: (open: boolean) => void
  setCaptureTargetId: (targetId: string | null) => void
  setScrollToLoadNext: (on: boolean) => void
  setTabPickerOpen: (open: boolean) => void
  dismissLaunchNotice: (notice: LaunchedBrowserNotice) => void
  setShareMarkOpen: (open: boolean) => void
  setTourRunning: (running: boolean) => void
  registerOpenDialog: () => void
  unregisterOpenDialog: () => void
  setPanelCollapsedForced: (forced: boolean) => void
  setActiveViewerTab: (tab: CaptureViewerTab) => void
  setWaybackSelection: (selection: WaybackSelection | null) => void
  setViewerHit: (hit: FieldHit | null) => void
  setSelectedCaptureId: (id: string | null) => void
  setSelectedNoteId: (id: string | null) => void
  setSelectedSignalId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  selectCapture: (id: string) => void
  followCaptureLink: (id: string) => void
  goBackInTrail: (liveIds: ReadonlySet<string>) => void
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
  setDisplayedCaptureIds: (ids: string[] | null) => void
  addCaptureEvent: (event: CaptureEvent) => void
  clearCaptureEvents: () => void
}

function selectedCaptureState(
  id: string | null,
  captureTrail: string[] = [],
  unviewedTab: CaptureViewerTab = 'screenshot'
) {
  return ({ viewerHit, viewerTabs }: AppState) => {
    const activeViewerTab = (id && viewerTabs[id]) || unviewedTab
    return {
      selectedCaptureId: id,
      viewerHit: viewerHit?.exhibitId === id ? viewerHit : null,
      activeViewerTab,
      // Recorded on open, not only on a tab click, so Back and a reselect return a
      // capture opened from a link to the tab it opened on.
      viewerTabs: id && !viewerTabs[id] ? { ...viewerTabs, [id]: activeViewerTab } : viewerTabs,
      captureTrail
    }
  }
}

const MAX_CAPTURE_EVENTS = 50

// The feed keeps the newest 50 rows, but a running background job's 'received' row goes last: the
// Recapture controls read it as the job still running, and a large batch's 'queued' rows would
// otherwise push it out. Those rows go too, oldest first, only when nothing else is left to
// drop. The event just added, at index 0, always stays.
function capCaptureEvents(events: CaptureEvent[]): CaptureEvent[] {
  let excess = events.length - MAX_CAPTURE_EVENTS
  if (excess <= 0) return events
  const kept = [...events]
  for (let i = kept.length - 1; i > 0 && excess > 0; i--) {
    const { type, source, jobId } = kept[i]
    if (type === 'received' && source === 'recapture' && jobId !== undefined) continue
    kept.splice(i, 1)
    excess--
  }
  return kept.slice(0, MAX_CAPTURE_EVENTS)
}

export const useAppStore = create<AppState>((set) => ({
  sessionActive: false,
  activeCaseId: null,
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
  displayedCaptureIds: null,
  captureEvents: [],
  captureStats: { successCount: 0, failCount: 0, skipCount: 0 },
  commandPaletteOpen: false,
  startDialogCaseId: null,
  stopConfirmOpen: false,
  captureTargetId: null,
  scrollToLoadNext: false,
  tabPickerOpen: false,
  dismissedLaunchNotice: null,
  shareMarkOpen: false,
  tourRunning: false,
  openDialogCount: 0,
  panelCollapsedForced: false,
  activeViewerTab: 'screenshot',
  viewerTabs: {},
  waybackSelection: null,
  viewerHit: null,
  viewerHitOpening: 0,
  captureTrail: [],

  setSessionActive: (active) => set({ sessionActive: active }),
  setActiveCaseId: (caseId) => set({ activeCaseId: caseId }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  openStartDialog: (caseId) => set({ startDialogCaseId: caseId }),
  closeStartDialog: () => set({ startDialogCaseId: null }),
  setStopConfirmOpen: (open) => set({ stopConfirmOpen: open }),
  setCaptureTargetId: (targetId) => set({ captureTargetId: targetId }),
  setScrollToLoadNext: (on) => set({ scrollToLoadNext: on }),
  setTabPickerOpen: (open) => set({ tabPickerOpen: open }),
  dismissLaunchNotice: (notice) => set({ dismissedLaunchNotice: notice }),
  setShareMarkOpen: (open) => set({ shareMarkOpen: open }),
  setTourRunning: (running) => set({ tourRunning: running }),
  registerOpenDialog: () => set((s) => ({ openDialogCount: s.openDialogCount + 1 })),
  // Clamped: an unbalanced release would otherwise drive the count negative and
  // leave every later guard reading "no dialog" while one is up.
  unregisterOpenDialog: () => set((s) => ({ openDialogCount: Math.max(0, s.openDialogCount - 1) })),
  setPanelCollapsedForced: (forced) => set({ panelCollapsedForced: forced }),
  setActiveViewerTab: (tab) =>
    set(({ selectedCaptureId, viewerTabs }) => ({
      activeViewerTab: tab,
      viewerTabs: selectedCaptureId ? { ...viewerTabs, [selectedCaptureId]: tab } : viewerTabs
    })),
  setWaybackSelection: (selection) => set({ waybackSelection: selection }),
  setViewerHit: (hit) => set((s) => ({ viewerHit: hit, viewerHitOpening: s.viewerHitOpening + 1 })),
  setSelectedCaptureId: (id) => set(selectedCaptureState(id)),
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),
  setSelectedSignalId: (id) => set({ selectedSignalId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCapture: (id) => set(selectedCaptureState(id)),

  followCaptureLink: (id) =>
    set((s) => {
      const from = s.selectedCaptureId
      if (from === null || from === id) return {}
      // A Capture with no tab of its own opens on the tab the link was clicked in.
      return selectedCaptureState(id, [...s.captureTrail, from], s.activeViewerTab)(s)
    }),

  // Pops past Captures deleted since they were pushed. With none left alive the trail
  // empties and the selection stays.
  goBackInTrail: (liveIds) =>
    set((s) => {
      const { captureTrail } = s
      for (let i = captureTrail.length - 1; i >= 0; i--) {
        const id = captureTrail[i]
        if (liveIds.has(id)) return selectedCaptureState(id, captureTrail.slice(0, i))(s)
      }
      return { captureTrail: [] }
    }),

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
  setDisplayedCaptureIds: (ids) => set({ displayedCaptureIds: ids }),

  addCaptureEvent: (event) =>
    set((s) => {
      let existing = s.captureEvents
      // A background job keeps one row: each of its events replaces the row its last event left,
      // matched by job id, so two jobs for one address never clear each other's row. A terminal
      // event with no job (the extension, the launched browser, a URL the queue refused at
      // enqueue) replaces a 'received' row from its own source and address that has no job.
      const { jobId, type, url, source } = event
      const terminal = type === 'stored' || type === 'failed' || type === 'skipped'
      let idx = -1
      if (jobId) {
        idx = existing.findIndex((e) => e.jobId === jobId)
      } else if (terminal) {
        idx = existing.findIndex(
          (e) =>
            e.type === 'received' && e.jobId === undefined && e.url === url && e.source === source
        )
      }
      if (idx !== -1) {
        existing = [...existing.slice(0, idx), ...existing.slice(idx + 1)]
      }
      const events = capCaptureEvents([event, ...existing])
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
