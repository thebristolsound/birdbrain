import {
  existsSync,
  closeSync,
  fstatSync,
  openSync,
  statSync,
  readFileSync,
  readSync,
  writeSync,
  fsyncSync,
  truncateSync
} from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import type { PackagedArtifact } from '@shared/verify/packageHash'
import type { ChainVerifyResult, CaptureChainEntry } from '@shared/verify'
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

// How many bytes of manifest tail to pull per read. Entries run a few hundred
// bytes, so the first read finds the last line; the loop only widens for a
// pathologically long final line.
const TAIL_READ_BYTES = 64 * 1024

// Scans an accumulated manifest tail backwards for the last non-empty line.
// Returns undefined when more bytes could still change the answer — either
// every line seen so far was blank, or the candidate reaches offset 0 and may
// be the fragment of a longer line still sitting earlier in the file.
//
// Searching for 0x0A at the byte level is safe regardless of encoding: a
// newline byte never occurs inside a multi-byte UTF-8 sequence, so only whole
// lines are ever decoded.
function lastLineInTail(tail: Buffer, atFileStart: boolean): string | undefined {
  let end = tail.length
  while (end > 0) {
    const nl = tail.lastIndexOf(0x0a, end - 1)
    const start = nl + 1
    const line = tail.subarray(start, end).toString('utf-8')
    if (line.trim().length > 0) {
      return start === 0 && !atFileStart ? undefined : line
    }
    if (nl < 0) break
    end = nl
  }
  return undefined
}

// Reads the manifest's last non-empty line without loading the whole file.
// Null when the file holds no non-empty line.
function readLastManifestLine(path: string): string | null {
  const fd = openSync(path, 'r')
  try {
    let end = fstatSync(fd).size
    let tail = Buffer.alloc(0)
    while (end > 0) {
      const start = Math.max(0, end - TAIL_READ_BYTES)
      const chunk = Buffer.alloc(end - start)
      const bytesRead = readSync(fd, chunk, 0, chunk.length, start)
      tail = Buffer.concat([chunk.subarray(0, bytesRead), tail])
      end = start
      const line = lastLineInTail(tail, end === 0)
      if (line !== undefined) return line
    }
    return null
  } finally {
    closeSync(fd)
  }
}

// Reads the last line to determine prevHash + next index.
// Reads from the tail rather than the whole file: this runs on every append, so
// a whole-file read made each capture O(N) in manifest size — O(N^2) over the
// life of a case.
// Deliberately STRICT, unlike readEntries(): an unparseable or wrong-shaped
// tail line throws, so a corrupt manifest can never be read as empty and
// silently restart the chain, and appendManifestEntry can never extend the
// chain from garbage head metadata.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: '', nextIndex: 0 }
  }
  const lastLine = readLastManifestLine(path)
  if (lastLine === null) return { prevHash: '', nextIndex: 0 }
  const parsed: unknown = JSON.parse(lastLine)
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
// trusted-time resolution): unparseable and non-object lines (null, arrays,
// scalars) become {} — inert to every consumer — instead of throwing or
// leaking a value consumers would crash on (`entry.type` on null). The append
// path must NOT use this; getManifestHead is the strict dialect (see its
// comment).
export function readEntries(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line)
        return value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {}
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

// One signed capture entry, as recorded on the chain.
export type ManifestCaptureEntry = Extract<ManifestEntry, { type: 'capture' }>

// One signed genesis-of-custody entry, appended when a case arrives by archive
// import.
export type ManifestImportEntry = Extract<ManifestEntry, { type: 'import' }>

export interface CaptureEntryAtIndex {
  entry: ManifestCaptureEntry
  // Every `import` entry in the SAME verified read. An imported case keeps the
  // source installation's ids on the entries it brought with it, so a caller
  // binding one of those entries to a local row needs the custody records to
  // resolve them — and needs them authenticated by the same chain check, not by
  // a second unverified read.
  imports: ManifestImportEntry[]
}

// Reads the capture entry recorded at `index` together with the case's custody
// records, or undefined when the chain does not verify, the line at that
// position is missing, unparseable, not a capture entry, or carries a different
// index than the position it sits at.
//
// For callers that need a capture's ORIGINAL anchored facts (#827 duplication
// re-anchors url/timestamp/headers/tls into a fresh entry): the `captures` row
// mirrors those fields but is hand-editable through Settings → Database, and
// re-signing an edited mirror would launder it into the chain. The chain is
// verified over the SAME snapshot the entry is read from — one read, like
// deletionReconciliation — so a caller's earlier verification of a separate
// read cannot vouch for values a rewrite slipped in between the two reads.
export function readCaptureEntryAt(
  caseDir: string,
  index: number
): CaptureEntryAtIndex | undefined {
  const snapshot = readManifestSnapshot(caseDir)
  const raw = snapshot.entries[index]
  if (raw === undefined) return undefined
  const chain = verifyManifestChainText(snapshot.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  })
  if (!chain.valid) return undefined
  const parsed = ManifestEntrySchema.safeParse(raw)
  if (!parsed.success || parsed.data.type !== 'capture' || parsed.data.index !== index) {
    return undefined
  }
  const imports: ManifestImportEntry[] = []
  for (const line of snapshot.entries) {
    if (line.type !== 'import') continue
    const parsedImport = ManifestEntrySchema.safeParse(line)
    if (parsedImport.success && parsedImport.data.type === 'import') imports.push(parsedImport.data)
  }
  return { entry: parsed.data, imports }
}

// A file packaged into an export (evidence .zip or .birdbrain archive), as
// recorded in the package's artifact index.
// The artifact index type and THE packageHash recipe both live in
// @shared/verify/packageHash so the standalone verifier can recompute the hash
// to bind evidence.json's artifact list to the signed export entry (#836).
// Re-exported here so every existing producer keeps importing them from
// manifest.ts, which owns packaging.
export type { PackagedArtifact } from '@shared/verify/packageHash'
export { packageHash } from '@shared/verify/packageHash'

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
      // Duplication provenance (#827). `duplicateOfCaptureId` names the capture
      // whose stored bytes were copied and `duplicatedAt` when the copy was
      // made — the entry's own `timestamp` still describes when the page was
      // observed, which the copy did not do. OMITTED when absent so every
      // pre-existing entry's canonical body — and chain hash — is unchanged.
      duplicateOfCaptureId?: string
      duplicatedAt?: string
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
      // Selection scope (#398, ADR-0009): a selection-scoped export records the
      // exported capture ids on its signed entry. OMITTED (never ''/[]/null) on
      // case-scoped exports so legacy and case-scoped entries' canonical bodies
      // — and chain hashes — are unchanged.
      scope?: 'selection'
      captureIds?: string[]
      // Export class (#399, ADR-0010): a Working Copy export is recorded on the
      // chain — the audit trail must not go silent for a non-evidentiary
      // extraction — but marked as one. OMITTED (never 'evidence'/null) on
      // evidence exports so their entries' canonical bodies are unchanged.
      exportClass?: 'working-copy'
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
  // The exact JSONL line appended (trailing newline included). The evidence
  // export packages its own export entry's line as export-entry.json (#398), so
  // the packaged copy is byte-identical to the live manifest's line rather than
  // a re-serialization that could drift.
  line: string
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

  return { index: nextIndex, prevHash, entryHash, anchorBytes, line }
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
  // Duplication provenance (#827); omitted from the manifest body when absent
  // to preserve legacy canonical bodies.
  duplicateOfCaptureId?: string
  duplicatedAt?: string
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
      ...(ctx.duplicateOfCaptureId !== undefined
        ? { duplicateOfCaptureId: ctx.duplicateOfCaptureId }
        : {}),
      ...(ctx.duplicatedAt !== undefined ? { duplicatedAt: ctx.duplicatedAt } : {}),
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

export type { ChainVerifyResult, CaptureChainEntry }

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
    return {
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    }
  }
  const raw = readFileSync(path, 'utf-8')
  return verifyManifestChainText(raw, { publicKeyPem: getPublicKeyPem() })
}
