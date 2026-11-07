// Layout facts for the three-column Captures screen, kept out of the route so
// the branchy visibility rules are unit-testable without a DOM.
//
// The bounds are the design's own: list 316/240/560 (shared with the Notes list,
// layout/listColumnSize.ts), details 400/320/680. react-resizable-panels reads bare
// numbers as pixels.

import { LIST_COLUMN_SIZE } from '@renderer/components/layout/listColumnSize'
import { WAYBACK_PANEL_WIDTH_PX } from '@renderer/components/captures/waybackPanelModel'

export const PANEL_GROUP_ID = 'captures-columns'

export const RAIL_WIDTH_PX = 40

// The app's side rail on Case screens (Sidebar's `w-12`).
export const SIDE_RAIL_PX = 48

// The details panel folds when the screen's own width is under this: the window rule it replaces
// folded below a 1,100-pixel window, which leaves 118 pixels above the docked minimums
// (240 + 7 + 360 + 7 + 320 = 934) beside the side rail. Reading the screen's width instead of the
// window's lets the panel give way to the Capture Session rail (#1831).
export const DETAILS_FOLD_ROOM_PX = 1_100 - SIDE_RAIL_PX

export const LIST_PANEL = { id: 'capture-list', ...LIST_COLUMN_SIZE } as const

export const VIEWER_PANEL = {
  id: 'capture-viewer',
  minSize: 360
} as const

export const DETAILS_PANEL = {
  id: 'capture-details',
  defaultSize: 400,
  minSize: 320,
  maxSize: 680
} as const

// SEPARATOR_CLASS's `w-[7px]`.
const SEPARATOR_PX = 7

// The Capture Session rail on a Case screen (#1831, `1f`).
const CAPTURE_SESSION_RAIL_PX = 320

// While the Capture Session rail is docked the viewer keeps at least this much: the list and the
// details panel give way toward their minimums first, and the details panel folds when that is
// not enough (design review of 2026-11-04, answer 1).
export const DOCKED_VIEWER_MIN_PX = 480

export function viewerMinPx(railDocked: boolean): number {
  return railDocked ? DOCKED_VIEWER_MIN_PX : VIEWER_PANEL.minSize
}

// The screen width under which the details panel folds. Beside the docked rail it is the docked
// minimums with the viewer at 480: 240 + 7 + 480 + 7 + 320 = 1,054.
export function detailsFoldRoomPx(railDocked: boolean): number {
  if (!railDocked) return DETAILS_FOLD_ROOM_PX
  return (
    LIST_PANEL.minSize + SEPARATOR_PX + DOCKED_VIEWER_MIN_PX + SEPARATOR_PX + DETAILS_PANEL.minSize
  )
}

// Whether the Capture Session rail docks, given the room beside the side rail: the rail, plus the
// Captures screen with its details panel folded to a strip and the viewer at 480. On the Wayback
// tab the list goes and the 436-pixel slide-out comes. Every Case screen uses the Captures
// screen's minimums, and the rule reads no selection, so selecting or clearing a Capture never
// swaps the rail for the strip.
export function captureSessionRailFits(room: number, waybackTab: boolean): boolean {
  const beside = waybackTab
    ? DOCKED_VIEWER_MIN_PX + WAYBACK_PANEL_WIDTH_PX + RAIL_WIDTH_PX
    : LIST_PANEL.minSize + SEPARATOR_PX + DOCKED_VIEWER_MIN_PX + RAIL_WIDTH_PX
  return room >= beside + CAPTURE_SESSION_RAIL_PX
}

export type CaptureColumnState = 'panel' | 'rail' | 'hidden'

export interface CaptureColumnsInput {
  /** The viewer is showing the Wayback tab, which takes the full width. */
  waybackActive: boolean
  listCollapsed: boolean
  /** User preference or the narrow-viewport force; the route folds them first. */
  detailsCollapsed: boolean
  hasSelection: boolean
  /**
   * The operator has expanded the details rail on a viewport too narrow to dock
   * the panel. The route folds its forced flag in first, as with
   * `detailsCollapsed`.
   */
  forcedPanelOpen: boolean
}

export interface CaptureColumns {
  list: CaptureColumnState
  viewer: 'panel'
  details: CaptureColumnState
  /**
   * The 436px archive.org slide-out (#401). Like the rails it is fixed chrome
   * outside the resizable Group, so it is a fourth output rather than a column
   * state, and it is bound 1:1 to the Wayback tab rather than toggled on its own.
   */
  waybackPanel: boolean
  /**
   * The narrow-viewport details overlay floats over the viewer's right edge
   * *beside* its rail, so it is a fourth output rather than a `details` state.
   */
  detailsOverlay: boolean
}

/**
 * Which of the three columns render as a resizable panel, as a 40px rail, or
 * not at all, plus whether the narrow-viewport details overlay is up.
 *
 * On the Wayback tab the list does not fall back to its rail — it disappears
 * outright, and so does the expanded details panel, in either the docked or the
 * overlay form: an opaque 400px overlay left up would cover the compare panes and
 * the snapshot panel beside them. A details rail the operator collapsed themselves
 * stays put, so the tags/notes counts remain reachable.
 */
export function visibleCaptureColumns({
  waybackActive,
  listCollapsed,
  detailsCollapsed,
  hasSelection,
  forcedPanelOpen
}: CaptureColumnsInput): CaptureColumns {
  const list: CaptureColumnState = waybackActive ? 'hidden' : listCollapsed ? 'rail' : 'panel'

  let details: CaptureColumnState
  if (!hasSelection) {
    details = 'hidden'
  } else if (detailsCollapsed) {
    details = 'rail'
  } else if (waybackActive) {
    details = 'hidden'
  } else {
    details = 'panel'
  }

  const detailsOverlay = hasSelection && forcedPanelOpen && !waybackActive

  return { list, viewer: 'panel', details, detailsOverlay, waybackPanel: waybackActive }
}

/**
 * The panel ids currently inside the Group, in DOM order. `useDefaultLayout`
 * keys a saved layout on this list, so a collapsed column does not overwrite
 * the widths the full configuration was last dragged to.
 */
export function capturePanelIds(columns: CaptureColumns): string[] {
  const ids: string[] = []
  if (columns.list === 'panel') ids.push(LIST_PANEL.id)
  ids.push(VIEWER_PANEL.id)
  if (columns.details === 'panel') ids.push(DETAILS_PANEL.id)
  return ids
}
