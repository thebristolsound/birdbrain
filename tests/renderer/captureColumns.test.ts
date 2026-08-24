import { describe, it, expect } from 'vitest'
import {
  capturePanelIds,
  visibleCaptureColumns,
  DETAILS_PANEL,
  LIST_PANEL,
  RAIL_WIDTH_PX,
  VIEWER_PANEL
} from '@renderer/components/captures/captureColumns'

const base = {
  waybackActive: false,
  listCollapsed: false,
  detailsCollapsed: false,
  hasSelection: true,
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
    expect(
      visibleCaptureColumns({ ...base, waybackActive: true, listCollapsed: true }).list
    ).toBe('hidden')
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
        forcedPanelOpen: true
      }).viewer
    ).toBe('panel')
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
