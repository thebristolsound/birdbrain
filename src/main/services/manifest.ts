import {
  existsSync,
  closeSync,
  openSync,
  statSync,
  readFileSync,
  writeSync,
  fsyncSync,
  truncateSync
} from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { canonicalStringify } from '@main/services/canonicalJson'
import { ManifestEntrySchema } from '@shared/schemas'
import { signEntryHash, verifyEntrySignature } from '@main/services/signingKey'
import { parseTimestampToken } from '@main/services/timestamp'
import type { TrustedTime } from '@shared/types'

export type { TrustedTime }

export interface ManifestHead {
  prevHash: string
  nextIndex: number
}

// Ensures the manifest file exists for a given case directory.
export function initManifest(caseDir: string): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) {
    const fd = openSync(path, 'a')
    closeSync(fd)
  }
}

// Reads the last line to determine prevHash + next index.
// O(N) on manifest size but only called once per append; manifests are small.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: '', nextIndex: 0 }
  }
  const raw = readFileSync(path, 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { prevHash: '', nextIndex: 0 }
  const last = JSON.parse(lines[lines.length - 1]) as {
    index: number
    entryHash: string
  }
  return { prevHash: last.entryHash, nextIndex: last.index + 1 }
}

export type ManifestEntryInput =
  | {
      type: 'capture'
      captureId: string
      caseId: string
      url: string
      timestamp: string
      contentHash: string
      sizeBytes: number
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      type: 'deletion'
      captureId: string
      caseId: string
      timestamp: string
      contentHash: string
      operatorId: string
      operatorName: string
      toolVersion: string
      reason?: string
    }
  | {
      // Append-only trusted-time anchor (#120). References a capture entry's
      // contentHash and carries the RFC 3161 token (base64). The capture path
      // never blocks on the TSA — this entry is appended later, by the worker.
      type: 'timestamp'
      caseId: string
      captureContentHash: string
      timestamp: string
      tsaToken?: string
      operatorId: string
      operatorName: string
      toolVersion: string
    }

export interface AppendResult {
  index: number
  prevHash: string
  entryHash: string
  anchorBytes: number
}

// Write-ahead append: compute hash, append JSONL line, fsync.
// Caller must call rollbackManifestEntry(anchorBytes) if a later step fails.
export function appendManifestEntry(caseDir: string, entry: ManifestEntryInput): AppendResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  const anchorBytes = existsSync(path) ? statSync(path).size : 0
  const { prevHash, nextIndex } = getManifestHead(caseDir)

  const body: Record<string, unknown> = {
    ...entry,
    index: nextIndex,
    prevHash,
    schemaVersion: MANIFEST_SCHEMA_VERSION
  }
  const canonical = canonicalStringify(body)
  const entryHash = createHash('sha256').update(canonical).digest('hex')
  // Sign the entryHash (G2). The signature is excluded from the canonical body
  // — it covers entryHash, it does not participate in it — so verification can
  // strip it back out and recompute the same hash.
  const signature = signEntryHash(entryHash)
  const fullEntry = { ...body, entryHash, signature }
  const line = JSON.stringify(fullEntry) + '\n'

  const fd = openSync(path, 'a')
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  return { index: nextIndex, prevHash, entryHash, anchorBytes }
}

// Truncates the manifest file back to the byte offset captured before append.
// Used to roll back a write-ahead append when a downstream step fails.
export function rollbackManifestEntry(caseDir: string, anchorBytes: number): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  truncateSync(path, anchorBytes)
}

// Thrown by the callback passed to `withDeletionEntry` to signal "the side
// effect didn't happen, please roll the manifest back". The wrapper catches
// it, rolls back, and rethrows it as a control-flow signal; the outer call
// site checks `err instanceof ManifestRollback` to translate that into
// a clean failure result instead of treating it as an unexpected error.
export class ManifestRollback extends Error {
  constructor(message = 'manifest rollback requested') {
    super(message)
    this.name = 'ManifestRollback'
  }
}

export interface DeletionEntryContext {
  captureId: string
  caseId: string
  contentHash: string
  operatorId: string
  operatorName: string
  toolVersion: string
  reason?: string
}

// Wraps a deletion side-effect in the manifest's write-ahead/rollback invariant.
// Appends a deletion entry, runs `fn`, and either commits (fn succeeded) or
// rolls the manifest back to its prior anchor (fn threw or its returned Promise
// rejected). Ensures the manifest never records a deletion that didn't actually
// happen. Async because `fn` may return a Promise — sync callbacks still work.
export async function withDeletionEntry<T>(
  caseDir: string,
  ctx: DeletionEntryContext,
  fn: () => T | Promise<T>
): Promise<T> {
  initManifest(caseDir)
  const result = appendManifestEntry(caseDir, {
    type: 'deletion',
    captureId: ctx.captureId,
    caseId: ctx.caseId,
    timestamp: new Date().toISOString(),
    contentHash: ctx.contentHash,
    operatorId: ctx.operatorId,
    operatorName: ctx.operatorName,
    toolVersion: ctx.toolVersion,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {})
  })
  try {
    return await fn()
  } catch (err) {
    rollbackManifestEntry(caseDir, result.anchorBytes)
    throw err
  }
}

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

export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
  trustedTime: TrustedTime
}

// Re-reads the manifest, recomputes each entryHash, and checks linkage.
// Returns the zero-based index of the first broken entry if any.
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { valid: true, trustedTime: 'none' }
  }
  const raw = readFileSync(path, 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  let expectedPrev = ''
  let expectedIndex = 0

  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i])
    } catch {
      return { valid: false, brokenAt: i, reason: 'Invalid JSON', trustedTime: 'none' }
    }
    const schemaResult = ManifestEntrySchema.safeParse(parsed)
    if (!schemaResult.success) {
      return { valid: false, brokenAt: i, reason: 'Invalid entry shape', trustedTime: 'none' }
    }
    // `signature` (v2+) is computed over `entryHash` and, like `entryHash`
    // itself, is EXCLUDED from the canonical body. Destructure both out before
    // recomputing so a present-or-absent signature never affects the hash.
    //
    // LOAD-BEARING: hash recomputation must continue to exclude both
    // `entryHash` and `signature`. That exclusion is what keeps legacy v1
    // hashes stable and ensures the v2 signature does not change the canonical
    // bytes being hashed.
    const { entryHash, signature, ...body } = schemaResult.data
    if (body.index !== expectedIndex) {
      return { valid: false, brokenAt: i, reason: 'Index mismatch', trustedTime: 'none' }
    }
    if (body.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: 'Chain link broken', trustedTime: 'none' }
    }
    const recomputed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    if (recomputed !== entryHash) {
      return { valid: false, brokenAt: i, reason: 'Entry hash mismatch', trustedTime: 'none' }
    }
    // Signature enforcement (G2): v2+ entries must carry a cryptographically
    // valid signature over their entryHash. Legacy v1 entries are grandfathered
    // — they predate signing and present as integrity-verified without one.
    if (body.schemaVersion >= 2 && !(signature && verifyEntrySignature(entryHash, signature))) {
      return { valid: false, brokenAt: i, reason: 'Invalid signature', trustedTime: 'none' }
    }
    expectedPrev = entryHash
    expectedIndex++
  }
  // Integrity-verified. Trusted-time resolution (rfc3161/pending) is #120; all
  // entries in this slice are grandfathered as 'none' — not a failure.
  return { valid: true, trustedTime: 'none' }
}
