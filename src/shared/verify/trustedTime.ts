import type { TrustedTime } from '@shared/types'
import { parseTimestampToken } from '@shared/verify/timestampToken'

// Trusted-time resolution rule (verify-core, #161). The SINGLE home for the
// pure "resolve-from-manifest" logic: given the parsed manifest entries, decide
// each capture's trusted-time axis. No fs, no DB — callers (the app's
// fs-reading `resolveTrustedTime` wrapper and the standalone package verifier)
// supply the already-parsed entries so the app and verifier can never drift.
//
// A capture is identified by its contentHash:
//   - a 'timestamp' entry referencing it, carrying a token whose imprint matches
//     → 'rfc3161' (+ TSA identity and stamped-at from the token)
//   - else a v2+ capture entry with no such timestamp yet → 'pending'
//   - else (v1/grandfathered, or no capture entry) → 'none'
// Pending vs none is the eligibility distinction: v2 captures are expected to be
// stamped (so 'pending' until they are); legacy v1 captures never were.

export interface TrustedTimeResult {
  trustedTime: TrustedTime
  // Present only when trustedTime is 'rfc3161'.
  tsaName?: string
  // ISO 8601 of the TSA's asserted time; present only when 'rfc3161'.
  stampedAt?: string
}

// A manifest entry as a loosely-typed record — the shape both callers already
// hold (the app's lenient JSON.parse, and verify-core's schema-validated
// entries). Resolution only sniffs a handful of fields, so a record keeps the
// rule decoupled from the full discriminated union.
type EntryRecord = Record<string, unknown>

// True iff the entry is an rfc3161 timestamp whose token attests `contentHash`.
/**
 * Validates a timestamp entry and extracts RFC3161 details if it contains a valid token for the given content hash.
 *
 * Exported because it is also the export packager's admission rule (#1108):
 * whether a token is written into a package is decided by the same function
 * that decides whether the exhibit is called stamped, so a package cannot
 * enclose a token file for an exhibit its own documents call unstamped. Both
 * grounds for rejection matter to that caller — a token that does not parse and
 * a token whose imprint attests other content are equally not a stamp.
 *
 * @param entry - The manifest entry to validate.
 * @param contentHash - The content hash the timestamp should cover.
 * @returns An RFC3161 result if the entry is valid and the token matches the hash, `undefined` otherwise.
 */
export function stampFor(entry: EntryRecord, contentHash: string): TrustedTimeResult | undefined {
  if (
    entry.type !== 'timestamp' ||
    entry.subject === 'entry' ||
    entry.captureContentHash !== contentHash ||
    typeof entry.tsaToken !== 'string'
  ) {
    return undefined
  }
  try {
    const parsed = parseTimestampToken(Buffer.from(entry.tsaToken, 'base64'))
    if (parsed.messageImprintHex === contentHash) {
      return {
        trustedTime: 'rfc3161',
        tsaName: parsed.tsaName,
        stampedAt: parsed.stampedAt.toISOString()
      }
    }
  } catch {
    // Malformed token — ignore; the worker will re-stamp.
  }
  return undefined
}

/**
 * Determines whether an entry is a v2+ capture eligible to be considered for pending trusted-time status.
 *
 * @returns `true` if the entry is a capture with schema version 2 or higher and a matching content hash, `false` otherwise
 */
function isEligibleCapture(entry: EntryRecord, contentHash: string): boolean {
  return (
    entry.type === 'capture' &&
    entry.contentHash === contentHash &&
    typeof entry.schemaVersion === 'number' &&
    entry.schemaVersion >= 2
  )
}

/**
 * Determines the trusted-time status for a capture by its content hash.
 *
 * Searches entries for a valid RFC3161 timestamp matching the hash. If found, the capture
 * has trusted time. If no valid timestamp is found but an eligible v2+ capture exists,
 * the status is pending. Otherwise, there is no trusted time.
 *
 * @param entries - Manifest entries to scan
 * @param contentHash - The content hash identifying the capture
 * @returns The trusted-time status for the capture
 */
export function resolveTrustedTimeFromEntries(
  entries: ReadonlyArray<EntryRecord>,
  contentHash: string
): TrustedTimeResult {
  let eligible = false
  for (const entry of entries) {
    const stamp = stampFor(entry, contentHash)
    if (stamp) return stamp
    if (isEligibleCapture(entry, contentHash)) eligible = true
  }
  return { trustedTime: eligible ? 'pending' : 'none' }
}

// Resolves the trusted-time axis for EVERY capture in one pass, keyed by
// contentHash. Captures absent from the returned map are 'none'
/**
 * Builds an index of trusted-time results for captures in the manifest entries.
 *
 * @returns A map from content hash to trusted-time status. Results include RFC3161-stamped captures and v2+ captures marked as pending verification.
 */
export function buildTrustedTimeIndexFromEntries(
  entries: ReadonlyArray<EntryRecord>
): Map<string, TrustedTimeResult> {
  const index = new Map<string, TrustedTimeResult>()
  const eligible = new Set<string>()

  for (const entry of entries) {
    // A schema-4 stamp with subject `entry` binds a Manifest Entry's hash for
    // a `merge`, not an Exhibit's content; it says nothing about any capture.
    if (
      entry.type === 'timestamp' &&
      entry.subject !== 'entry' &&
      typeof entry.captureContentHash === 'string' &&
      typeof entry.tsaToken === 'string'
    ) {
      const contentHash = entry.captureContentHash
      if (index.get(contentHash)?.trustedTime === 'rfc3161') continue
      const stamp = stampFor(entry, contentHash)
      if (stamp) index.set(contentHash, stamp)
    } else if (
      entry.type === 'capture' &&
      typeof entry.contentHash === 'string' &&
      typeof entry.schemaVersion === 'number' &&
      entry.schemaVersion >= 2
    ) {
      eligible.add(entry.contentHash)
    }
  }

  // Eligible v2 captures with no valid timestamp are pending.
  for (const hash of eligible) {
    if (!index.has(hash)) index.set(hash, { trustedTime: 'pending' })
  }
  return index
}
