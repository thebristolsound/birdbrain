import { describe, expect, it } from 'vitest'
import type { LaunchedBrowserNotice, LaunchedBrowserSummary } from '@shared/types'
import {
  PANEL_WIDTH_PX,
  extensionWarningTitle,
  formatElapsed,
  noticeCard,
  panelView,
  railFits,
  tabCount,
  tabTitle
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: 1_000,
  tabs: []
}

describe('panelView', () => {
  it('shows nothing before a launch, and nothing while one starts', () => {
    expect(panelView(undefined, null)).toEqual({ kind: 'none' })
    expect(panelView({ state: 'none' }, null)).toEqual({ kind: 'none' })
    expect(panelView({ state: 'starting', browser: SUMMARY, step: 'browser' }, null)).toEqual({
      kind: 'none'
    })
  })

  it.each(['open', 'closing', 'closed'] as const)('shows the browser while it is %s', (state) => {
    expect(panelView({ state, browser: SUMMARY }, null)).toEqual({ kind: state, browser: SUMMARY })
  })

  it('shows a notice until that notice is dismissed', () => {
    const notice: LaunchedBrowserNotice = { code: 'EGRESS_BYPASS', message: 'm' }
    expect(panelView({ state: 'none', notice }, null)).toEqual({ kind: 'notice', notice })
    expect(panelView({ state: 'none', notice }, notice)).toEqual({ kind: 'none' })
    expect(panelView({ state: 'none', notice: { ...notice } }, notice)).toEqual({
      kind: 'notice',
      notice
    })
  })
})

describe('railFits', () => {
  // The room beside the 48-pixel side rail: the Captures screen with its details panel folded
  // takes 240 + 7 + 360 + 40, and on the Wayback tab 360 + 436 + 40.
  it('docks the rail once the folded Captures screen and the rail both fit', () => {
    expect(PANEL_WIDTH_PX).toBe(320)
    expect(railFits(647 + 320 - 1, false)).toBe(false)
    expect(railFits(647 + 320, false)).toBe(true)
  })

  it("needs room for the Wayback tab's slide-out while that tab is up", () => {
    expect(railFits(836 + 320 - 1, true)).toBe(false)
    expect(railFits(836 + 320, true)).toBe(true)
  })
})

describe('noticeCard', () => {
  it('names a bypass as state 11 does, with main’s account as the detail behind it', () => {
    expect(
      noticeCard({ code: 'EGRESS_BYPASS', message: 'A response in Google Chrome did not…' })
    ).toEqual({
      title: 'Browser closed: traffic went around the proxy',
      detail: 'The Capture Session ended.',
      tip: 'A response in Google Chrome did not…'
    })
  })

  it('names an Egress change', () => {
    expect(noticeCard({ code: 'EGRESS_CHANGED', message: 'The Egress changed, so…' })).toEqual({
      title: 'Browser closed: the Egress changed',
      detail: 'The Capture Session ended.',
      tip: 'The Egress changed, so…'
    })
  })

  it('says a browser that did not exit may still be running', () => {
    expect(
      noticeCard({
        code: 'BROWSER_DID_NOT_EXIT',
        message: 'Google Chrome did not exit after Birdbrain killed it.'
      })
    ).toEqual({
      title: 'The launched browser may still be running',
      detail:
        'Google Chrome did not exit after Birdbrain killed it. If its window is open, close it.'
    })
  })

  it('shows any other notice as main wrote it', () => {
    expect(noticeCard({ code: 'SOMETHING', message: 'It closed.' })).toEqual({
      title: 'The launched browser closed',
      detail: 'It closed.'
    })
  })
})

describe('the panel’s words', () => {
  it('prints elapsed time as mm:ss, and with hours past the first', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(42_999)).toBe('00:42')
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59')
    expect(formatElapsed(3_600_000 + 65_000)).toBe('1:01:05')
    expect(formatElapsed(-5_000)).toBe('00:00')
  })

  it('counts tabs', () => {
    expect(tabCount(0)).toBe('No tabs open')
    expect(tabCount(1)).toBe('1 tab')
    expect(tabCount(3)).toBe('3 tabs')
  })

  it('names a tab by its title, or by its URL when it has none', () => {
    expect(tabTitle({ targetId: 't', title: 'Harbor notices', url: 'https://f.test/' })).toBe(
      'Harbor notices'
    )
    expect(tabTitle({ targetId: 't', title: '  ', url: 'about:blank' })).toBe('about:blank')
  })

  it('counts the extensions a warning names', () => {
    expect(extensionWarningTitle(1)).toBe('An extension was added.')
    expect(extensionWarningTitle(2)).toBe('2 extensions were added.')
  })
})
