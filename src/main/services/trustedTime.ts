import { join } from 'path'
import {
  resolveTrustedTimeFromEntries,
  buildTrustedTimeIndexFromEntries
} from '@shared/verify/trustedTime'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'

export type { TrustedTimeResult }

// Manifest reading is owned by the Manifest module (readManifestSnapshot's
// lenient dialect); the resolution rule itself lives in verify-core
// (`@shared/verify/trustedTime`).

// The Content Hashes the local chain records as its own Capture or Exhibit.
function ownContentHashes(entries: Record<string, unknown>[]): Set<string> {
  const own = new Set<string>()
  for (const { type, contentHash } of entries) {
    if ((type === 'capture' || type === 'exhibit') && typeof contentHash === 'string') {
      own.add(contentHash)
    }
  }
  return own
}

// The entries trusted time is resolved over (#1713): the local chain's, and in a
// Shared Case the `timestamp` entries of every other member and lineage chain
// the walk accepted. A member writes a stamp to its own chain, so another
// member's stamp is only in theirs; a chain the walk did not accept adds
// nothing. Only stamps are taken, so whether a hash is 'pending' or 'none'
// stays the local chain's answer. A hash the local chain records as its own
// Content takes no stamp from another chain: in-app resolution checks a
// token's structure, not its TSA signature, so another member's chain must not
// stand in for this installation's own stamp or stop the worker requesting it.
// `contentHash` narrows the read to one hash, skipping the walk for own Content.
function trustedTimeEntries(caseDir: string, contentHash?: string): Record<string, unknown>[] {
  const manifest = readManifestSnapshot(caseDir)
  const own = ownContentHashes(manifest.entries)
  if (contentHash !== undefined && own.has(contentHash)) return manifest.entries
  const { verification } = readSharedCaseSnapshot(caseDir, manifest)
  if (!verification) return manifest.entries
  const stamps = [...verification.entries]
    .filter(([key]) => key !== verification.localInstallationId)
    .flatMap(([, accepted]) => accepted)
    .filter((entry) => entry.type === 'timestamp' && !own.has(entry.captureContentHash))
  return [...manifest.entries, ...stamps]
}

// Resolves the per-capture trusted-time axis from the Case's chains alone (so the DB mirror remains rebuildable).
/**
 * Resolves the trusted timestamp status for a content hash within a case.
 *
 * @param caseDir - The directory containing the case manifest
 * @param contentHash - The content hash to resolve trusted time for
 * @returns The trusted time result indicating the timestamp status
 */
export function resolveTrustedTime(caseDir: string, contentHash: string): TrustedTimeResult {
  return resolveTrustedTimeFromEntries(trustedTimeEntries(caseDir, contentHash), contentHash)
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
  return buildTrustedTimeIndexFromEntries(trustedTimeEntries(caseDir))
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
  captureRepo.setCaptureTrustedTime(capture.id, result.trustedTime)
  return result
}

// Read-and-refresh for every MHTML capture in every case: rebuilds the mirror
// column purely from the manifest, so the timestamp queue survives a lost/corrupt
// column (#120 AC). Builds a one-pass index per case (O(captures), not
// O(captures²)) before writing. Non-MHTML captures have no manifest entry and
// are skipped.
export function reconcileAllMirrors(): void {
  for (const c of caseRepo.listCases()) {
    const index = buildTrustedTimeIndex(join(getStorageRoot(), c.id))
    for (const cap of captureRepo.listCaptures(c.id)) {
      if (cap.format !== 'mhtml') continue
      captureRepo.setCaptureTrustedTime(cap.id, index.get(cap.hash)?.trustedTime ?? 'none')
    }
  }
}
