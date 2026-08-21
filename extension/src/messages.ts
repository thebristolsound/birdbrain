// The popup ↔ background message payloads.
//
// Type-only, and deliberately so: both halves ship in the same extension
// bundle, so this is a compile-time contract rather than a wire format. It
// lives outside popup/ because the background service worker is the side that
// produces every value in it — the popup only renders what it is told.

/** Which rule refused a URL: the built-in scheme list, or an operator pattern. */
export type PopupBlockReason = 'default' | 'user'

/** The refusing rule, and the operator pattern behind it when there was one. */
export interface PopupBlock {
  reason: PopupBlockReason
  /** The matched Settings pattern; null for the built-in scheme list. */
  pattern: string | null
}

/**
 * What the background knows about one tab, for the popup's page-status block.
 *
 * Everything here is answered from the service worker's own memory. There is
 * no capture lookup by URL (#392 adds one), so `lastCapture` reports only a
 * capture this worker performed and still remembers: absent means "not seen
 * here", never "never captured".
 */
export interface PopupPageStatus {
  /** The tab's URL when the status was taken; null when it could not be read. */
  url: string | null
  /** Non-null when a capture of this URL would be refused before it starts. */
  blocked: PopupBlock | null
  /** A manual capture of this tab is between request and settle. */
  capturing: boolean
  /** The last successful manual capture of this exact URL in this tab. */
  lastCapture: { at: number; manifestIndex: number | null } | null
  /** Selector hits from the last scan of this URL; null when never scanned. */
  selectorSummary: { selectors: number; hits: number } | null
  /** Enabled selectors on the active case, across all its groups. */
  activeSelectorCount: number
  /**
   * The operator's ignore rules have reached this service worker at least once.
   *
   * They live only in worker memory and arrive with the first successful status
   * poll, so between a cold start and that poll the worker holds an empty list.
   * An empty list matches nothing, which would answer `blocked: null` for a URL
   * the operator has excluded. While this is false, `blocked` says nothing and
   * the popup must not offer a capture.
   */
  rulesLoaded: boolean
}

/** The background's answer to a popup MANUAL_CAPTURE request. */
export interface ManualCaptureResponse {
  /** True once the capture is under way; false means nothing was sent. */
  started: boolean
  /** Non-null when the pre-filter refused the URL, so the popup can say why. */
  blocked: PopupBlock | null
  /**
   * Nothing was sent because the operator's ignore rules had not loaded yet, so
   * the pre-filter could not decide. Distinct from `blocked`: the rules may or
   * may not refuse this URL, and the worker declines to guess.
   */
  notReady: boolean
}
