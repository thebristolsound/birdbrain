import { describe, it, expect } from 'vitest'
import {
  capturePanelIds,
  captureSessionRailFits,
  detailsFoldRoomPx,
  viewerMinPx,
  visibleCaptureColumns,
  DETAILS_PANEL,
  LIST_PANEL,
  RAIL_WIDTH_PX,
  SIDE_RAIL_PX,
  VIEWER_PANEL
} from '@renderer/components/captures/captureColumns'

const base = {
  waybackActive: false,
  listCollapsed: false,
  detailsCollapsed: false,
  hasSelection: true,
  sessionPanel: false,
  forcedPanelOpen: false
}

// The narrow-viewport shape: the details column is forced to its rail and the
// operator has pressed Expand details, which floats the overlay beside it.
const forcedOpen = { ...base, detailsCollapsed: true, forcedPanelOpen: true }

describe('visibleCaptureColumns', () => {
  it('renders all three columns as panels in the default configuration', () => {
    expect(visibleCaptureColumns(base)).toEqual({
      list: 'panel',
      viewer: 'panel',
      details: 'panel',
      detailsOverlay: false,
      waybackPanel: false
    })
  })

  it('swaps the list for its rail when the list is collapsed', () => {
    expect(visibleCaptureColumns({ ...base, listCollapsed: true }).list).toBe('rail')
  })

  it('swaps the details column for its rail when collapsed', () => {
    expect(visibleCaptureColumns({ ...base, detailsCollapsed: true }).details).toBe('rail')
  })

  it('hides the details column entirely when nothing is selected', () => {
    expect(visibleCaptureColumns({ ...base, hasSelection: false }).details).toBe('hidden')
    // Even collapsed: a rail with no capture behind it has nothing to show.
    expect(
      visibleCaptureColumns({ ...base, hasSelection: false, detailsCollapsed: true }).details
    ).toBe('hidden')
  })

  it('hides the list outright on the Wayback tab rather than falling back to the rail', () => {
    expect(visibleCaptureColumns({ ...base, waybackActive: true }).list).toBe('hidden')
    expect(visibleCaptureColumns({ ...base, waybackActive: true, listCollapsed: true }).list).toBe(
      'hidden'
    )
  })

  it('hides the expanded details panel on the Wayback tab but keeps a collapsed rail', () => {
    expect(visibleCaptureColumns({ ...base, waybackActive: true }).details).toBe('hidden')
    expect(
      visibleCaptureColumns({ ...base, waybackActive: true, detailsCollapsed: true }).details
    ).toBe('rail')
  })

  it('raises the narrow-viewport overlay beside the rail, not instead of it', () => {
    const columns = visibleCaptureColumns(forcedOpen)
    expect(columns.detailsOverlay).toBe(true)
    expect(columns.details).toBe('rail')
  })

  it('keeps the overlay down until the operator expands the rail', () => {
    expect(visibleCaptureColumns({ ...base, detailsCollapsed: true }).detailsOverlay).toBe(false)
  })

  // An opaque 400px overlay left up on the Wayback tab covers the compare panes
  // and the snapshot panel behind it.
  it('drops the overlay on the Wayback tab, leaving the compare its width', () => {
    const columns = visibleCaptureColumns({ ...forcedOpen, waybackActive: true })
    expect(columns.detailsOverlay).toBe(false)
    expect(columns.list).toBe('hidden')
    expect(columns.details).toBe('rail')
  })

  it('hides the overlay when nothing is selected', () => {
    expect(visibleCaptureColumns({ ...forcedOpen, hasSelection: false }).detailsOverlay).toBe(false)
  })

  it('raises the archive.org slide-out exactly on the Wayback tab (#401)', () => {
    expect(visibleCaptureColumns(base).waybackPanel).toBe(false)
    expect(visibleCaptureColumns({ ...base, waybackActive: true }).waybackPanel).toBe(true)
    // It is chrome outside the resizable Group, so it does not join the panel
    // set the saved layout is keyed on.
    expect(capturePanelIds(visibleCaptureColumns({ ...base, waybackActive: true }))).toEqual([
      'capture-viewer'
    ])
  })

  it('always keeps the viewer as a panel', () => {
    expect(
      visibleCaptureColumns({
        waybackActive: true,
        listCollapsed: true,
        detailsCollapsed: true,
        hasSelection: false,
        sessionPanel: false,
        forcedPanelOpen: true
      }).viewer
    ).toBe('panel')
  })
})

// The Capture Session is a tab of the right panel, so the panel has something to show with no
// Capture selected, and a running session stays one click from its stop control.
describe('while the right panel holds the Capture Session tab', () => {
  const session = { ...base, sessionPanel: true }

  it('shows the panel with no Capture selected', () => {
    expect(visibleCaptureColumns({ ...session, hasSelection: false }).details).toBe('panel')
    expect(capturePanelIds(visibleCaptureColumns({ ...session, hasSelection: false }))).toEqual([
      'capture-list',
      'capture-viewer',
      'capture-details'
    ])
  })

  it('folds to the strip with no Capture selected, and opens the overlay from it', () => {
    const folded = { ...session, hasSelection: false, detailsCollapsed: true }
    expect(visibleCaptureColumns(folded).details).toBe('rail')
    expect(visibleCaptureColumns(folded).detailsOverlay).toBe(false)
    expect(visibleCaptureColumns({ ...folded, forcedPanelOpen: true }).detailsOverlay).toBe(true)
  })

  it('keeps the strip on the Wayback tab, where the details alone would go', () => {
    expect(visibleCaptureColumns({ ...session, waybackActive: true }).details).toBe('rail')
    expect(visibleCaptureColumns({ ...base, waybackActive: true }).details).toBe('hidden')
  })

  it('lets the strip open the overlay on the Wayback tab', () => {
    const open = { ...session, waybackActive: true, forcedPanelOpen: true }
    expect(visibleCaptureColumns(open).detailsOverlay).toBe(true)
    expect(visibleCaptureColumns({ ...open, sessionPanel: false }).detailsOverlay).toBe(false)
  })
})

describe('capturePanelIds', () => {
  it('lists the panels in DOM order', () => {
    expect(capturePanelIds(visibleCaptureColumns(base))).toEqual([
      'capture-list',
      'capture-viewer',
      'capture-details'
    ])
  })

  it('omits columns that are rails or hidden, so a saved layout is keyed per shape', () => {
    expect(capturePanelIds(visibleCaptureColumns({ ...base, listCollapsed: true }))).toEqual([
      'capture-viewer',
      'capture-details'
    ])
    expect(capturePanelIds(visibleCaptureColumns({ ...base, waybackActive: true }))).toEqual([
      'capture-viewer'
    ])
  })
})

describe('panel bounds', () => {
  it('matches the designed widths', () => {
    expect(LIST_PANEL).toMatchObject({ defaultSize: 316, minSize: 240, maxSize: 560 })
    expect(DETAILS_PANEL).toMatchObject({ defaultSize: 400, minSize: 320, maxSize: 680 })
    expect(VIEWER_PANEL.minSize).toBe(360)
    expect(RAIL_WIDTH_PX).toBe(40)
  })
})

// The viewer's 480-pixel minimum is the point where the one right
// panel folds to its strip. The window figures add the 72-pixel side rail.
describe('the right panel with the Capture Session tab', () => {
  const SIDE = SIDE_RAIL_PX

  it('keeps the viewer at 480 while that panel is docked, and at its own 360 otherwise', () => {
    expect(viewerMinPx(true)).toBe(480)
    expect(viewerMinPx(false)).toBe(360)
  })

  it('folds below a 1,054-pixel screen, a 1,126-pixel window', () => {
    expect(detailsFoldRoomPx(true)).toBe(240 + 7 + 480 + 7 + 320)
    expect(detailsFoldRoomPx(true) + SIDE).toBe(1_126)
  })

  it("keeps the details panel's own fold with no Capture Session", () => {
    expect(detailsFoldRoomPx(false)).toBe(1_052)
  })
})

// The other Case screens dock the Capture Session as a rail of its own.
describe('the Capture Session rail on the other Case screens', () => {
  it('docks from a 1,159-pixel window', () => {
    expect(captureSessionRailFits(1_159 - SIDE_RAIL_PX)).toBe(true)
    expect(captureSessionRailFits(1_158 - SIDE_RAIL_PX)).toBe(false)
  })
})
