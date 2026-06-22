import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import { parseTimestampToken } from '@shared/verify'
import type { TrustedTime } from '@shared/types'
import * as db from '@main/services/database'
import { getStorageRoot } from '@main/services/storage'

export interface TrustedTimeResult {
  trustedTime: TrustedTime
  // Present only when trustedTime is 'rfc3161'.
  tsaName?: string
  // ISO 8601 of the TSA's asserted time; present only when 'rfc3161'.
  stampedAt?: string
}

// Resolves the per-capture trusted-time axis from the manifest alone (so the DB
// mirror is rebuildable — #120 AC). A capture is identified by its contentHash:
//   - a 'timestamp' entry referencing it, carrying a token whose imprint matches
//     → 'rfc3161' (+ TSA identity and stamped-at from the token)
//   - else a v2+ capture entry with no such timestamp yet → 'pending'
//   - else (v1/grandfathered, or no capture entry) → 'none'
// Pending vs none is the eligibility distinction: v2 captures are expected to be
// stamped (so 'pending' until they are); legacy v1 captures never were.
export function resolveTrustedTime(caseDir: string, contentHash: string): TrustedTimeResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) return { trustedTime: 'none' }

  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)

  let eligible = false
  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (
      entry.type === 'timestamp' &&
      entry.captureContentHash === contentHash &&
      typeof entry.tsaToken === 'string'
    ) {
      try {
        const parsed = parseTimestampToken(Buffer.from(entry.tsaToken, 'base64'))
        // The token must actually attest THIS capture's bytes; a mismatched
        // imprint is not proof of time and is ignored (capture stays pending).
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
    } else if (
      entry.type === 'capture' &&
      entry.contentHash === contentHash &&
      typeof entry.schemaVersion === 'number' &&
      entry.schemaVersion >= 2
    ) {
      eligible = true
    }
  }

  return { trustedTime: eligible ? 'pending' : 'none' }
}

// Resolves the trusted-time axis for EVERY capture in a case in a single manifest
// pass, keyed by contentHash. Use this to rebuild the DB mirror for a whole case
// — calling resolveTrustedTime() per capture would re-read and re-parse the
// manifest O(captures) times (quadratic on a large case). Captures whose hash is
// absent from the returned map are 'none' (legacy/grandfathered).
export function buildTrustedTimeIndex(caseDir: string): Map<string, TrustedTimeResult> {
  const index = new Map<string, TrustedTimeResult>()
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) return index

  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)

  const eligible = new Set<string>()
  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (
      entry.type === 'timestamp' &&
      typeof entry.captureContentHash === 'string' &&
      typeof entry.tsaToken === 'string'
    ) {
      const contentHash = entry.captureContentHash
      if (index.get(contentHash)?.trustedTime === 'rfc3161') continue
      try {
        const parsed = parseTimestampToken(Buffer.from(entry.tsaToken, 'base64'))
        if (parsed.messageImprintHex === contentHash) {
          index.set(contentHash, {
            trustedTime: 'rfc3161',
            tsaName: parsed.tsaName,
            stampedAt: parsed.stampedAt.toISOString()
          })
        }
      } catch {
        // Malformed token — ignore; the capture stays pending.
      }
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

// Read-and-refresh for a single capture: resolves the authoritative trusted-time
// from the manifest and writes it through to the rebuildable DB mirror, returning
// the full result. This is the one place the "manifest is authoritative; the
// mirror is refreshed whenever it is read" rule lives for a single capture —
// callers (verify, the stamp guard) self-heal a stale mirror by calling this
// instead of re-implementing resolve + setCaptureTrustedTime.
export function reconcileCaptureTrustedTime(capture: {
  id: string
  caseId: string
  hash: string
}): TrustedTimeResult {
  const result = resolveTrustedTime(join(getStorageRoot(), capture.caseId), capture.hash)
  db.setCaptureTrustedTime(capture.id, result.trustedTime)
  return result
}

// Read-and-refresh for every MHTML capture in every case: rebuilds the mirror
// column purely from the manifest, so the timestamp queue survives a lost/corrupt
// column (#120 AC). Builds a one-pass index per case (O(captures), not
// O(captures²)) before writing. Non-MHTML captures have no manifest entry and
// are skipped.
export function reconcileAllMirrors(): void {
  for (const c of db.listCases()) {
    const index = buildTrustedTimeIndex(join(getStorageRoot(), c.id))
    for (const cap of db.listCaptures(c.id)) {
      if (cap.format !== 'mhtml') continue
      db.setCaptureTrustedTime(cap.id, index.get(cap.hash)?.trustedTime ?? 'none')
    }
  }
}
