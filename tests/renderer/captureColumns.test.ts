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
  hasSelection: true
}

describe('visibleCaptureColumns', () => {
  it('renders all three columns as panels in the default configuration', () => {
    expect(visibleCaptureColumns(base)).toEqual({
      list: 'panel',
      viewer: 'panel',
      details: 'panel'
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

  it('always keeps the viewer as a panel', () => {
    expect(
      visibleCaptureColumns({
        waybackActive: true,
        listCollapsed: true,
        detailsCollapsed: true,
        hasSelection: false
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
