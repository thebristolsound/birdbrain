import { basename, join } from 'path'
import {
  resolveTrustedTimeFromEntries,
  buildTrustedTimeIndexFromEntries
} from '@shared/verify/trustedTime'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import type { Exhibit } from '@shared/types'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import type { ManifestSnapshot, SharedCaseSnapshot } from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

export type { TrustedTimeResult }

// Manifest reading is owned by the Manifest module (readManifestSnapshot's
// lenient dialect); the resolution rule itself lives in verify-core
// (`@shared/verify/trustedTime`).

// The Content Hashes a chain records as its own Capture or Exhibit.
function recordedContentHashes(entries: Record<string, unknown>[]): Set<string> {
  const own = new Set<string>()
  for (const { type, contentHash } of entries) {
    if ((type === 'capture' || type === 'exhibit') && typeof contentHash === 'string') {
      own.add(contentHash)
    }
  }
  return own
}

// Who recorded a Content Hash, from its Exhibit rows: another member's
// installation id, null for this installation, undefined when no row names one
// author (no row, or rows naming different authors).
type AuthorOf = (contentHash: string) => string | null | undefined

function authorsOf(exhibits: readonly AuthoredExhibit[]): AuthorOf {
  const authors = new Map<string, string | null | undefined>()
  for (const { contentHash, authorInstallationId } of exhibits) {
    const known = authors.has(contentHash)
    const prior = authors.get(contentHash)
    authors.set(
      contentHash,
      known && prior !== authorInstallationId ? undefined : authorInstallationId
    )
  }
  return (contentHash) => authors.get(contentHash)
}

// Whether a chain key in the walk's result is `author`'s: a member chain is
// keyed by installation id, a lineage chain by `<sourceCaseId>/<installationId>`.
function chainOf(key: string, author: string): boolean {
  return key === author || key.endsWith(`/${author}`)
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
// For the same reason the first valid stamp is taken in this order: the local
// chain's; then, when the hash's Exhibit row names another member as author,
// that member's chain's; then those of any chain that records the hash in its
// own Capture or Exhibit entry; then the rest; walk order within each group.
// So when the row names an author whose chain holds a valid stamp, only a
// local stamp is shown ahead of it. When the row names no other member, or the
// author's chain holds no valid stamp, walk order picks among the other
// chains, and one that records the hash can still supply a forged token.
// `contentHash` narrows the read to one hash, skipping the walk for own Content.
function trustedTimeEntries(
  caseDir: string,
  authorOf: AuthorOf,
  contentHash?: string
): Record<string, unknown>[] {
  const manifest = readManifestSnapshot(caseDir)
  const own = recordedContentHashes(manifest.entries)
  if (contentHash !== undefined && own.has(contentHash)) return manifest.entries
  const verification = sharedCaseVerification(caseDir, manifest)
  if (!verification) return manifest.entries
  const ranked: Record<string, unknown>[][] = [[], [], []]
  for (const [key, accepted] of verification.entries) {
    if (key === verification.localInstallationId) continue
    const recorded = recordedContentHashes(accepted)
    for (const entry of accepted) {
      if (entry.type !== 'timestamp') continue
      const { captureContentHash: hash } = entry
      if (own.has(hash)) continue
      const author = authorOf(hash)
      const rank = author && chainOf(key, author) ? 0 : recorded.has(hash) ? 1 : 2
      ranked[rank].push(entry)
    }
  }
  return [...manifest.entries, ...ranked.flat()]
}

// The Shared Case walk, or none when the other chains cannot be read: the Case
// then resolves from the local chain alone, as before #1713, rather than the
// error reaching the startup rebuild and stopping the app from opening.
function sharedCaseVerification(
  caseDir: string,
  manifest: ManifestSnapshot
): SharedCaseSnapshot['verification'] {
  try {
    return readSharedCaseSnapshot(caseDir, manifest).verification
  } catch (err) {
    logger.error(
      'trustedTime',
      'trustedTime.shared_chains_unreadable',
      { caseId: ident(basename(caseDir)) },
      err
    )
    return undefined
  }
}

// Resolves the per-capture trusted-time axis from the Case's chains alone (so the DB mirror remains rebuildable).
/**
 * Resolves the trusted timestamp status for a content hash within a case.
 *
 * @param caseDir - The directory containing the case manifest
 * @param contentHash - The content hash to resolve trusted time for
 * @param authorInstallationId - The Exhibit row's recorded author: null for
 *   this installation, undefined when there is no row
 * @returns The trusted time result indicating the timestamp status
 */
export function resolveTrustedTime(
  caseDir: string,
  contentHash: string,
  authorInstallationId?: string | null
): TrustedTimeResult {
  const authorOf: AuthorOf = (hash) => (hash === contentHash ? authorInstallationId : undefined)
  return resolveTrustedTimeFromEntries(
    trustedTimeEntries(caseDir, authorOf, contentHash),
    contentHash
  )
}

export type AuthoredExhibit = Pick<Exhibit, 'contentHash' | 'authorInstallationId'>

// Resolves the trusted-time axis for EVERY capture in a case in a single manifest
// pass, keyed by contentHash. Use this to rebuild the DB mirror for a whole case
// — calling resolveTrustedTime() per capture would re-read and re-parse the
// manifest O(captures) times (quadratic on a large case). Captures whose hash is
/**
 * Builds a trusted-time lookup index for a case.
 *
 * @param caseDir - The case storage directory
 * @param exhibits - The Case's Exhibit rows, whose recorded authors pick the
 *   chain a remote stamp is preferred from
 * @returns A `Map` keyed by content hash, with `TrustedTimeResult` values. Content hashes absent from the map are implicitly `'none'`.
 */
export function buildTrustedTimeIndex(
  caseDir: string,
  exhibits: readonly AuthoredExhibit[] = []
): Map<string, TrustedTimeResult> {
  return buildTrustedTimeIndexFromEntries(trustedTimeEntries(caseDir, authorsOf(exhibits)))
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
  const result = resolveTrustedTime(
    join(getStorageRoot(), capture.caseId),
    capture.hash,
    getExhibit(capture.id)?.authorInstallationId
  )
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
    const index = buildTrustedTimeIndex(join(getStorageRoot(), c.id), listExhibits(c.id))
    for (const cap of captureRepo.listCaptures(c.id)) {
      if (cap.format !== 'mhtml') continue
      captureRepo.setCaptureTrustedTime(cap.id, index.get(cap.hash)?.trustedTime ?? 'none')
    }
  }
}
