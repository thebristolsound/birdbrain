import type { PopupPageStatus } from '@extension/messages'

export type PageStatusTone = 'blocked' | 'capturing' | 'captured' | 'idle' | 'unknown'

export interface PageStatusView {
  tone: PageStatusTone
  text: string
  sub: string
}

/**
 * Relative age from the stored capture timestamp, with recent worker upload
 * completion as a fallback when the persisted lookup is unavailable.
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
  // The rules have not reached this worker yet, so `blocked` is answered from an
  // empty list and means nothing. Reporting "not captured yet" here would offer
  // a capture of a page the operator may have excluded.
  if (!status.rulesLoaded) {
    return {
      tone: 'unknown',
      text: 'Checking this page…',
      sub: 'Waiting for your ignore rules from Birdbrain.'
    }
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
    const { at, manifestIndex, format = 'mhtml' } = status.lastCapture
    return {
      tone: 'captured',
      text: formatCapturedAt(at, now),
      // "recorded", not "verified": the server hashes the upload and chains a
      // manifest entry, but nothing here has re-read and checked those bytes.
      // Verification is the app's Verify action and says so there.
      sub:
        manifestIndex === null
          ? `${format.toUpperCase()} · sha256 recorded`
          : `${format.toUpperCase()} · sha256 recorded · index #${manifestIndex}`
    }
  }
  return status.lookupFailed
    ? {
        tone: 'unknown',
        text: 'Capture status unavailable',
        sub: 'Could not check earlier captures. Reopen the popup to retry.'
      }
    : { tone: 'idle', text: 'Not captured yet', sub: 'Right-click to capture this page.' }
}

/**
 * The quiet match-summary line. Returns null when the extension has nothing
 * true to say — a page the selectors have never been run against reports
 * nothing rather than "no selectors matched".
 */
export function deriveMatchSummary(status: PopupPageStatus | null): string | null {
  if (!status || !status.url) return null
  // Same reason as derivePageStatus: with no rules loaded, "ignored" is not yet
  // a question this worker can answer.
  if (!status.rulesLoaded) return null
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
