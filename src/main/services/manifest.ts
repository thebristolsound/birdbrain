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
import type {
  TrustedTime,
  ArchiveVerificationResult,
  CaptureMethod,
  ConsentSuppression
} from '@shared/types'
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
// Deliberately STRICT, unlike readEntries(): an unparseable or wrong-shaped
// tail line throws, so a corrupt manifest can never be read as empty and
// silently restart the chain, and appendManifestEntry can never extend the
// chain from garbage head metadata.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: '', nextIndex: 0 }
  }
  const raw = readFileSync(path, 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { prevHash: '', nextIndex: 0 }
  const parsed: unknown = JSON.parse(lines[lines.length - 1])
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid manifest tail entry')
  }
  const last = parsed as { index?: unknown; entryHash?: unknown }
  if (
    typeof last.index !== 'number' ||
    !Number.isSafeInteger(last.index) ||
    last.index < 0 ||
    typeof last.entryHash !== 'string' ||
    last.entryHash.length === 0
  ) {
    throw new Error('Invalid manifest tail entry')
  }
  return { prevHash: last.entryHash, nextIndex: last.index + 1 }
}

export interface ManifestHeadRef {
  index: number
  entryHash: string
}

export interface ManifestSnapshot {
  jsonl: Buffer
  entries: Record<string, unknown>[]
  head: ManifestHeadRef | null
}

// Lenient line parser for read-only consumers (the export snapshot,
// trusted-time resolution): unparseable lines become {} — inert to every
// consumer — instead of throwing. The append path must NOT use this;
// getManifestHead is the strict dialect (see its comment).
export function readEntries(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return {}
      }
    })
}

// Head reference (last entry's index + entryHash) over leniently-read entries.
// Null when the manifest is empty or its last line is unreadable — consumers
// render that as an explicit gap rather than omitting the reference.
export function head(entries: Record<string, unknown>[]): ManifestHeadRef | null {
  const last = entries.at(-1) as { index?: number; entryHash?: string } | undefined
  return typeof last?.index === 'number' && typeof last.entryHash === 'string'
    ? { index: last.index, entryHash: last.entryHash }
    : null
}

// One read of a case manifest, to be shared by every consumer of that read:
// raw bytes (for bundling), lenient entries, and the head reference. Callers
// that need more than one of these must take a single snapshot — reading twice
// would let the timestamp worker append between the reads, so the consumers
// could describe different manifest states.
export function readManifestSnapshot(caseDir: string): ManifestSnapshot {
  const path = join(caseDir, MANIFEST_FILENAME)
  const jsonl = existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
  const entries = readEntries(jsonl.toString('utf-8'))
  return { jsonl, entries, head: head(entries) }
}

// A file packaged into an export (evidence .zip or .birdbrain archive), as
// recorded in the package's artifact index.
export interface PackagedArtifact {
  path: string
  sha256: string
  sizeBytes: number
}

// THE packageHash recipe — the single authoritative statement of it. Every
// producer (evidence export, case-archive export) and checker (archive
// inspect) calls this function; do not restate the recipe elsewhere.
//
// packageHash commits to every packaged file's content via the artifact list:
// sort the artifacts by path (for determinism), then
// sha256(canonicalStringify(sortedArtifacts)). It deliberately does NOT hash
// the final zip: the hash feeds a signed manifest entry that ships inside that
// very zip, so hashing the zip would be circular. The package's own index file
// (evidence.json / package.json), which carries this hash, is likewise
// excluded from the artifact list.
export function packageHash(artifacts: PackagedArtifact[]): string {
  const sorted = [...artifacts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return createHash('sha256').update(Buffer.from(canonicalStringify(sorted), 'utf-8')).digest('hex')
}

export interface ArtifactAccumulator {
  // Zip entries in add() order, ready for createStoredZip.
  entries: Array<{ name: string; data: Buffer | string }>
  // The artifact index packageHash() is computed over.
  artifacts: PackagedArtifact[]
  // Records a file into both lists and returns its sha256.
  add: (name: string, value: Buffer | string) => string
}

// The shared packaging accumulator: every file added through it lands in the
// zip AND in the artifact index, so the index cannot silently omit a packaged
// file. Index files themselves are pushed onto `entries` directly (never
// through add) — see packageHash() for why they stay out of the artifact list.
export function createArtifactAccumulator(): ArtifactAccumulator {
  const entries: Array<{ name: string; data: Buffer | string }> = []
  const artifacts: PackagedArtifact[] = []
  const add = (name: string, value: Buffer | string): string => {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8')
    const digest = createHash('sha256').update(buf).digest('hex')
    entries.push({ name, data: buf })
    artifacts.push({ path: name, sha256: digest, sizeBytes: buf.length })
    return digest
  }
  return { entries, artifacts, add }
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
      // Recapture provenance (#recapture); omitted from the manifest body when
      // absent to preserve legacy canonical bodies.
      method?: CaptureMethod
      supersedesCaptureId?: string
      // Consent-overlay suppression active in the rendering session. OMITTED
      // when absent so pre-existing entries' canonical bodies — and chain
      // hashes — are unchanged.
      consentSuppression?: ConsentSuppression
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
      // is computed by packageHash() above over evidence.json's artifact list.
      // `appendManifestEntry` adds index/prevHash/entryHash/signature.
      type: 'export'
      caseId: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
      packageHash: string
      verificationResult: ExportVerificationResult
    }
  | {
      // Signed audit record of a case-archive export (.birdbrain). `packageHash`
      // is computed by packageHash() above over package.json's artifact list.
      type: 'archive-export'
      caseId: string
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
      packageHash: string
    }
  | {
      // Signed genesis-of-custody record appended when a case archive is
      // imported. Continues the source chain (prevHash = source head).
      // sourcePublicKeyPem is the key that signed every entry BEFORE this one
      // (back to the previous import boundary) — verify-core switches keys at
      // these entries.
      type: 'import'
      caseId: string
      sourceCaseId: string
      sourceInstallationId: string
      sourcePublicKeyPem: string
      packageHash: string
      idMapSha256: string
      verificationResult: ArchiveVerificationResult
      timestamp: string
      operatorId: string
      operatorName: string
      toolVersion: string
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
  // Recapture provenance (#recapture); omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  method?: CaptureMethod
  supersedesCaptureId?: string
  // Consent-overlay suppression provenance; omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  consentSuppression?: ConsentSuppression
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
      ...(ctx.method !== undefined ? { method: ctx.method } : {}),
      ...(ctx.supersedesCaptureId !== undefined
        ? { supersedesCaptureId: ctx.supersedesCaptureId }
        : {}),
      ...(ctx.consentSuppression !== undefined
        ? { consentSuppression: ctx.consentSuppression }
        : {}),
      sizeBytes: ctx.sizeBytes,
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      toolVersion: ctx.toolVersion
    },
    fn
  )
}

export type { ChainVerifyResult }

// Main-process consumers verifying manifest text that is NOT this case dir's
// live file (e.g. archive inspect, against the archive's own bundled key) go
// through this re-export, so chain verification is always reached via the
// Manifest module. The algorithm itself lives in the shared verify-core.
export { verifyManifestChainText }

// Re-reads the manifest and verifies the hash chain — recomputed entryHashes,
// linkage, v2+ signatures — against this installation's public key. Thin fs
// wrapper; the chain algorithm lives in the shared verify-core (#122) so the
/**
 * Verifies the integrity and authenticity of the manifest hash chain.
 *
 * An empty or missing manifest is considered valid.
 *
 * @param caseDir - The case directory containing the manifest file
 * @returns A result indicating whether the manifest chain is valid and the verified trusted times
 */
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { valid: true, trustedTimes: new Map(), captureHashesByIndex: new Map() }
  }
  const raw = readFileSync(path, 'utf-8')
  return verifyManifestChainText(raw, { publicKeyPem: getPublicKeyPem() })
}
