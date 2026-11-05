import type {
  LaunchedBrowserNotice,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary,
  LaunchedBrowserTab,
  LaunchedCaptureProgress,
  LaunchedCaptureShortcut
} from '@shared/types'
import {
  LIST_PANEL,
  RAIL_WIDTH_PX,
  VIEWER_PANEL
} from '@renderer/components/captures/captureColumns'
import { WAYBACK_PANEL_WIDTH_PX } from '@renderer/components/captures/waybackPanelModel'

// What the Capture Session panel (S3: `1f`, `2a`, `2c`, `2d`) shows, and where it docks, with the
// clicked-Capture step's capture target, Capture control and per-tab "from first request" chip
// (#1832).

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
    case 'EGRESS_UNWATCHED':
      return { title: 'Browser closed: a tab could not be watched', detail: ENDED, tip: message }
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

// The tabs a clicked Capture can take (#1832): every tab the engine records whose page it may
// capture.
export function capturableTabs(tabs: readonly LaunchedBrowserTab[]): LaunchedBrowserTab[] {
  return tabs.filter((tab) => tab.firstRequest !== undefined && tab.refusal === undefined)
}

// The tab the panel's Capture control takes: the one the Operator picked while it can still be
// captured, otherwise the only capturable tab. With several and no pick, none: the control names
// its tab before the click, so it never guesses.
export function captureTarget(
  tabs: readonly LaunchedBrowserTab[],
  pickedId: string | null
): LaunchedBrowserTab | null {
  const capturable = capturableTabs(tabs)
  const picked = capturable.find(({ targetId }) => targetId === pickedId)
  if (picked) return picked
  return capturable.length === 1 ? capturable[0] : null
}

export interface TabStatus {
  label: string
  tip?: string
  tone: 'chip' | 'muted' | 'danger'
}

// Names no cause (feasibility assessment, question 9) and carries no reload advice (`1f`).
const NOT_FROM_FIRST_REQUEST =
  'Birdbrain did not record this page from its first request, so a Capture of it has no ' +
  'Transaction Record.'

// Only the cached half sits under the lead-in; a service worker's response is recorded and
// counted (stage-2 ruling 3, assessment state 5).
const FROM_FIRST_REQUEST =
  'This does not mean every exchange was recorded: a cached response can leave a gap, which the ' +
  'inventory lists. A response a service worker served is recorded without its endpoint, and the ' +
  'inventory counts those.'

// The tab row's status (`1k`, states 5, 6 and 8).
export function tabStatus(tab: LaunchedBrowserTab): TabStatus | null {
  switch (tab.refusal) {
    case 'private':
      return {
        label: "can't capture · private",
        tip: 'A private window keeps its own cookies, so Birdbrain never records or captures it.',
        tone: 'muted'
      }
    case 'not-http':
      return {
        label: 'never captured',
        tip: 'Birdbrain captures http and https pages only.',
        tone: 'muted'
      }
    case 'crashed':
      return {
        label: 'tab crashed',
        tip: 'Reload it in the browser, then capture.',
        tone: 'danger'
      }
  }
  if (tab.firstRequest === undefined) return null
  return tab.firstRequest
    ? { label: 'from first request', tip: FROM_FIRST_REQUEST, tone: 'chip' }
    : { label: 'not from first request', tip: NOT_FROM_FIRST_REQUEST, tone: 'muted' }
}

export interface ProgressLine {
  kind: 'capturing' | 'captured' | 'abandoned' | 'refused'
  text: string
  detail?: string
}

// The line under the Capture control (`1l`, state 7).
export function progressLine(
  progress: LaunchedCaptureProgress | undefined,
  tabs: readonly LaunchedBrowserTab[]
): ProgressLine | null {
  if (!progress) return null
  switch (progress.state) {
    case 'capturing': {
      const tab = tabs.find(({ targetId }) => targetId === progress.targetId)
      return { kind: 'capturing', text: `Capturing ${tab ? tabTitle(tab) : progress.title}…` }
    }
    case 'captured':
      return { kind: 'captured', text: `${progress.citation} · Captured` }
    case 'abandoned':
      return {
        kind: 'abandoned',
        text: 'Capture abandoned',
        detail: 'The page changed mid-capture; try again.'
      }
    case 'refused':
    case 'failed':
      return { kind: 'refused', text: 'Not captured', detail: progress.message }
  }
}

// An Electron accelerator with this platform's primary modifier (`modifierLabel`).
export function acceleratorLabel(accelerator: string, modifier: string): string {
  return accelerator
    .split('+')
    .map((key) => (key === 'CommandOrControl' ? modifier : key))
    .join('+')
}

// The shortcut line (`1r`). Birdbrain cannot tell whether a desktop delivers the shortcut, so the
// line never says it works: it offers it to try, or says the desktop refused it.
export function shortcutLine({ state }: LaunchedCaptureShortcut): string {
  return state === 'failed'
    ? 'This desktop refused the shortcut. Use the Capture button.'
    : 'Try the shortcut while the browser has focus, or use the Capture button.'
}
