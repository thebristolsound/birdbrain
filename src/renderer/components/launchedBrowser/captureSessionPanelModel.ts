import type {
  LaunchedBrowserNotice,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary,
  LaunchedBrowserTab
} from '@shared/types'
import {
  LIST_PANEL,
  RAIL_WIDTH_PX,
  VIEWER_PANEL
} from '@renderer/components/captures/captureColumns'
import { WAYBACK_PANEL_WIDTH_PX } from '@renderer/components/captures/waybackPanelModel'

// What the Capture Session panel (S3: `1f`, `2a`, `2c`, `2d`) shows, and where it docks. The
// capture target, the Capture control and the per-tab "from first request" chip are the
// clicked-Capture step's (#1832).

export const PANEL_WIDTH_PX = 320

// SEPARATOR_CLASS's `w-[7px]`.
const SEPARATOR_PX = 7

// The room beside the side rail the Captures screen needs with its details panel folded to a strip:
// list, separator, viewer and the strip. On the Wayback tab the list goes and the 436-pixel
// slide-out comes, beside the details strip the fold leaves.
const CAPTURES_MIN_PX = LIST_PANEL.minSize + SEPARATOR_PX + VIEWER_PANEL.minSize + RAIL_WIDTH_PX
const WAYBACK_MIN_PX = VIEWER_PANEL.minSize + WAYBACK_PANEL_WIDTH_PX + RAIL_WIDTH_PX

// Whether the rail docks, given the room beside the side rail. Every Case screen uses the Captures
// screen's minimums. The rule reads no selection, so selecting or clearing a Capture never swaps
// the rail for the strip.
export function railFits(room: number, waybackTab: boolean): boolean {
  return room >= (waybackTab ? WAYBACK_MIN_PX : CAPTURES_MIN_PX) + PANEL_WIDTH_PX
}

export type PanelView =
  | { kind: 'none' }
  | { kind: 'open' | 'closing' | 'closed'; browser: LaunchedBrowserSummary }
  | { kind: 'notice'; notice: LaunchedBrowserNotice }

// A starting browser has the start dialog's checklist instead. Main keeps a notice until the next
// launch, so the Operator's dismissal is held here, by the notice it dismissed.
export function panelView(
  status: LaunchedBrowserStatus | undefined,
  dismissedNotice: LaunchedBrowserNotice | null
): PanelView {
  if (!status || status.state === 'starting') return { kind: 'none' }
  if (status.state === 'none') {
    const { notice } = status
    return notice && notice !== dismissedNotice ? { kind: 'notice', notice } : { kind: 'none' }
  }
  return { kind: status.state, browser: status.browser }
}

export interface NoticeCard {
  title: string
  detail: string
  tip?: string
}

const ENDED = 'The Capture Session ended.'

// How the last launched browser closed, when Birdbrain closed it (state 11) or it would not exit.
export function noticeCard({ code, message }: LaunchedBrowserNotice): NoticeCard {
  switch (code) {
    case 'EGRESS_BYPASS':
      return { title: 'Browser closed: traffic went around the proxy', detail: ENDED, tip: message }
    case 'EGRESS_CHANGED':
      return { title: 'Browser closed: the Egress changed', detail: ENDED, tip: message }
    case 'BROWSER_DID_NOT_EXIT':
      return {
        title: 'The launched browser may still be running',
        detail: `${message} If its window is open, close it.`
      }
    default:
      return { title: 'The launched browser closed', detail: message }
  }
}

// mm:ss, and h:mm:ss past the first hour.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return hours > 0 ? `${hours}:${rest}` : rest
}

// The pop-out's title, the one the desktop's window list shows (`1g`).
export function popOutTitle(caseName: string): string {
  return caseName ? `Birdbrain · ${caseName} · Capture Session` : 'Birdbrain · Capture Session'
}

export function tabCount(count: number): string {
  if (count === 0) return 'No tabs open'
  return count === 1 ? '1 tab' : `${count} tabs`
}

export function tabTitle({ title, url }: LaunchedBrowserTab): string {
  return title.trim() || url
}

// The engine knows an extension by ID only, so the warning names none (state 9).
export function extensionWarningTitle(count: number): string {
  return count === 1 ? 'An extension was added.' : `${count} extensions were added.`
}
