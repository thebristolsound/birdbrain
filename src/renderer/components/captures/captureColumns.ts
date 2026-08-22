// Layout facts for the three-column Captures screen, kept out of the route so
// the branchy visibility rules are unit-testable without a DOM.
//
// The bounds are the design's own: list 316/240/560, details 400/320/680.
// react-resizable-panels reads bare numbers as pixels.

export const PANEL_GROUP_ID = 'captures-columns'

export const RAIL_WIDTH_PX = 40

export const LIST_PANEL = {
  id: 'capture-list',
  defaultSize: 316,
  minSize: 240,
  maxSize: 560
} as const

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
 * overlay form: an opaque 400px overlay left up would cover the full-bleed
 * snapshot list and its pin controls. A details rail the operator collapsed
 * themselves stays put, so the tags/notes counts remain reachable.
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

  return { list, viewer: 'panel', details, detailsOverlay }
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
