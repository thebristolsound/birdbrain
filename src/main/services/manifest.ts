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
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import type { ChainVerifyResult } from '@shared/verify'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import type { TrustedTime } from '@shared/types'
import type { TlsCertChainResult } from '@main/services/tlsCertChain'

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
      // Optional content-addressed integrity for the screenshot and extracted
      // text sidecars (#118). OMITTED (never '' / null) when absent so legacy and
      // no-screenshot entries' canonical bodies — and therefore their chain
      // hashes — are unchanged.
      screenshotHash?: string
      textHash?: string
      // Captured HTTP response headers (#119), normalized to lowercase keys with
      // multi-value joins. OMITTED (never {} / null) when absent so legacy and
      // headerless entries' canonical bodies — and chain hashes — are unchanged.
      headers?: Record<string, string>
      // Corroboration-only TLS cert chain re-fetched after storage (#123). NOT
      // bound to the captured transaction. OMITTED when not re-fetched so legacy /
      // cert-less entries' canonical bodies — and chain hashes — are unchanged.
      tls?: TlsCertChainResult
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
  | {
      // Signed audit record of an evidence-package export (#124). `packageHash`
      // is sha256(canonicalStringify(sortedArtifacts)) from evidence.json — it
      // commits to every packaged file's content WITHOUT covering the final
      // .zip (which would be circular, since this entry lives in the bundled
      // manifest). `appendManifestEntry` adds index/prevHash/entryHash/signature.
      type: 'export'
      caseId: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
      packageHash: string
      verificationResult: ExportVerificationResult
    }

export interface ExportVerificationResult {
  overallValid: boolean
  captureCount: number
  verifiedCount: number
  tamperedCount: number
  missingCount: number
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

// Core write-ahead/rollback seam. Appends `entry`, runs `fn` with the resulting
// AppendResult, and either commits (fn succeeded) or rolls the manifest back to
// its prior anchor (fn threw or its returned Promise rejected). Ensures the
// manifest never records a side effect that didn't actually happen. Async
// because `fn` may return a Promise — sync callbacks still work.
async function withManifestEntry<T>(
  caseDir: string,
  entry: ManifestEntryInput,
  fn: (result: AppendResult) => T | Promise<T>
): Promise<T> {
  initManifest(caseDir)
  const result = appendManifestEntry(caseDir, entry)
  try {
    return await fn(result)
  } catch (err) {
    rollbackManifestEntry(caseDir, result.anchorBytes)
    throw err
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
export async function withDeletionEntry<T>(
  caseDir: string,
  ctx: DeletionEntryContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return withManifestEntry(
    caseDir,
    {
      type: 'deletion',
      captureId: ctx.captureId,
      caseId: ctx.caseId,
      timestamp: new Date().toISOString(),
      contentHash: ctx.contentHash,
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      toolVersion: ctx.toolVersion,
      ...(ctx.reason !== undefined ? { reason: ctx.reason } : {})
    },
    fn
  )
}

export interface CaptureEntryContext {
  captureId: string
  caseId: string
  url: string
  timestamp: string
  contentHash: string
  // Optional sidecar integrity hashes (#118); omitted from the manifest body
  // when undefined to preserve legacy canonical bodies.
  screenshotHash?: string
  textHash?: string
  // Captured HTTP response headers (#119); omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  headers?: Record<string, string>
  // Corroboration-only TLS cert chain (#123); omitted from the manifest body
  // when absent to preserve legacy canonical bodies.
  tls?: TlsCertChainResult
  sizeBytes: number
  operatorId: string
  operatorName: string
  toolVersion: string
}

// Wraps an ingest side-effect (sidecar writes + DB insert) in the manifest's
// write-ahead/rollback invariant. `fn` receives the AppendResult so the caller
// can persist index/prevHash/entryHash on the DB row. Ensures the manifest never
// records a capture that didn't actually land.
export async function withCaptureEntry<T>(
  caseDir: string,
  ctx: CaptureEntryContext,
  fn: (result: AppendResult) => T | Promise<T>
): Promise<T> {
  return withManifestEntry(
    caseDir,
    {
      type: 'capture',
      captureId: ctx.captureId,
      caseId: ctx.caseId,
      url: ctx.url,
      timestamp: ctx.timestamp,
      contentHash: ctx.contentHash,
      ...(ctx.screenshotHash !== undefined ? { screenshotHash: ctx.screenshotHash } : {}),
      ...(ctx.textHash !== undefined ? { textHash: ctx.textHash } : {}),
      ...(ctx.headers !== undefined ? { headers: ctx.headers } : {}),
      ...(ctx.tls !== undefined ? { tls: ctx.tls } : {}),
      sizeBytes: ctx.sizeBytes,
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      toolVersion: ctx.toolVersion
    },
    fn
  )
}

export type { ChainVerifyResult }

// Re-reads the manifest and verifies the hash chain — recomputed entryHashes,
// linkage, v2+ signatures — against this installation's public key. Thin fs
// wrapper; the chain algorithm lives in the shared verify-core (#122) so the
// app and the standalone verifier can never drift.
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { valid: true, trustedTimes: new Map() }
  }
  const raw = readFileSync(path, 'utf-8')
  return verifyManifestChainText(raw, { publicKeyPem: getPublicKeyPem() })
}
