// The popup's page-status derivations, kept out of the component so they can be
// asserted directly.
//
// Every line here is answered from state the extension actually holds. The
// prototype's "Captured 4 min ago · MHTML · sha256 verified · index #36" for an
// arbitrary page needs a capture lookup by URL that no endpoint offers yet
// (#392); until it does, the popup reports only the four states with data
// behind them — capturing, captured by this worker, not seen here, and refused
// before it starts — and says so rather than implying a lookup happened.
import type { PopupPageStatus } from '@extension/messages'

export type PageStatusTone = 'blocked' | 'capturing' | 'captured' | 'idle'

export interface PageStatusView {
  tone: PageStatusTone
  text: string
  sub: string
}

/**
 * Relative age of a capture this popup's service worker performed. The instant
 * is the extension's own record of when the upload succeeded, not a stored
 * capture timestamp.
 */
export function formatCapturedAt(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return 'Captured just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Captured ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Captured ${hours} h ago`
  return 'Captured over a day ago'
}

export function derivePageStatus(status: PopupPageStatus | null, now: number): PageStatusView {
  // No answer at all — an evicted service worker that has not woken yet. Say
  // that rather than inventing a page state from the absence of one.
  if (!status) {
    return {
      tone: 'idle',
      text: 'Page status unavailable',
      sub: 'Reopen the popup to try again.'
    }
  }
  if (!status.url) {
    return { tone: 'idle', text: 'No page to capture', sub: 'Open a page in this tab first.' }
  }
  if (status.blocked) {
    return {
      tone: 'blocked',
      text: "This page can't be captured",
      sub:
        status.blocked.reason === 'user' && status.blocked.pattern
          ? `Ignored by your rule: ${status.blocked.pattern}`
          : 'Browser, extension and local pages are always ignored.'
    }
  }
  if (status.capturing) {
    return { tone: 'capturing', text: 'Capturing…', sub: 'Serializing page and assets' }
  }
  if (status.lastCapture) {
    const { at, manifestIndex } = status.lastCapture
    return {
      tone: 'captured',
      text: formatCapturedAt(at, now),
      // "recorded", not "verified": the server hashes the upload and chains a
      // manifest entry, but nothing here has re-read and checked those bytes.
      // Verification is the app's Verify action and says so there.
      sub:
        manifestIndex === null
          ? 'MHTML · sha256 recorded'
          : `MHTML · sha256 recorded · index #${manifestIndex}`
    }
  }
  return {
    tone: 'idle',
    text: 'Not captured yet',
    // The disclaimer is the point: an absent record means this worker has not
    // captured the page, which is not the same as the case having no capture
    // of it.
    sub: "Captures made earlier aren't tracked here."
  }
}

/**
 * The quiet match-summary line. Returns null when the extension has nothing
 * true to say — a page the selectors have never been run against reports
 * nothing rather than "no selectors matched".
 */
export function deriveMatchSummary(status: PopupPageStatus | null): string | null {
  if (!status || !status.url) return null
  if (status.blocked) return "Selectors don't run on ignored pages."
  if (status.selectorSummary) {
    const { selectors, hits } = status.selectorSummary
    if (selectors === 0) return 'No selectors matched this page.'
    const selectorWord = selectors === 1 ? 'selector' : 'selectors'
    const hitWord = hits === 1 ? 'hit' : 'hits'
    return `${selectors} ${selectorWord} matched · ${hits} ${hitWord} on this page`
  }
  if (status.activeSelectorCount === 0) return 'No selectors set for this case.'
  return null
}
