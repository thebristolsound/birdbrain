import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import {
  resolveTrustedTimeFromEntries,
  buildTrustedTimeIndexFromEntries
} from '@shared/verify/trustedTime'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import * as db from '@main/services/database'
import { getStorageRoot } from '@main/services/storage'

export type { TrustedTimeResult }

// Reads and leniently parses a case manifest into entry records. The
// resolution rule itself lives in verify-core (`@shared/verify/trustedTime`);
/**
 * Parses manifest entries from the case's manifest file.
 *
 * @param caseDir - The case directory containing the manifest file
 * @returns An array of parsed manifest entries. Unparseable lines are silently skipped. Returns an empty array if the manifest file does not exist or is empty.
 */
function readManifestEntries(caseDir: string): Record<string, unknown>[] {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) return []
  const out: Record<string, unknown>[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (line.trim().length === 0) continue
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // Skip unparseable lines (same lenience as the bulk index).
    }
  }
  return out
}

// Resolves the per-capture trusted-time axis from the manifest alone (so the DB
/**
 * Resolves the trusted timestamp status for a content hash within a case.
 *
 * @param caseDir - The directory containing the case manifest
 * @param contentHash - The content hash to resolve trusted time for
 * @returns The trusted time result indicating the timestamp status
 */
export function resolveTrustedTime(caseDir: string, contentHash: string): TrustedTimeResult {
  return resolveTrustedTimeFromEntries(readManifestEntries(caseDir), contentHash)
}

// Resolves the trusted-time axis for EVERY capture in a case in a single manifest
// pass, keyed by contentHash. Use this to rebuild the DB mirror for a whole case
// — calling resolveTrustedTime() per capture would re-read and re-parse the
// manifest O(captures) times (quadratic on a large case). Captures whose hash is
/**
 * Builds a trusted-time lookup index for a case.
 *
 * @param caseDir - The case storage directory
 * @returns A `Map` keyed by content hash, with `TrustedTimeResult` values. Content hashes absent from the map are implicitly `'none'`.
 */
export function buildTrustedTimeIndex(caseDir: string): Map<string, TrustedTimeResult> {
  return buildTrustedTimeIndexFromEntries(readManifestEntries(caseDir))
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
