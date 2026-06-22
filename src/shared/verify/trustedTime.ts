import type { TrustedTime } from '@shared/types'
import { parseTimestampToken } from './timestampToken'

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
// A mismatched or malformed imprint is not proof of time and is ignored.
function stampFor(entry: EntryRecord, contentHash: string): TrustedTimeResult | undefined {
  if (
    entry.type !== 'timestamp' ||
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

function isEligibleCapture(entry: EntryRecord, contentHash: string): boolean {
  return (
    entry.type === 'capture' &&
    entry.contentHash === contentHash &&
    typeof entry.schemaVersion === 'number' &&
    entry.schemaVersion >= 2
  )
}

// Resolves the trusted-time axis for a single capture from the parsed entries.
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
// (legacy/grandfathered, or no capture entry).
export function buildTrustedTimeIndexFromEntries(
  entries: ReadonlyArray<EntryRecord>
): Map<string, TrustedTimeResult> {
  const index = new Map<string, TrustedTimeResult>()
  const eligible = new Set<string>()

  for (const entry of entries) {
    if (
      entry.type === 'timestamp' &&
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
