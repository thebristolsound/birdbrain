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
      screenshotHash?: string
      textHash?: string
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
      type: 'timestamp'
      caseId: string
      timestamp: string
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
  const fullEntry = { ...body, entryHash }
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

export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
}

// Re-reads the manifest, recomputes each entryHash, and checks linkage.
// Returns the zero-based index of the first broken entry if any.
// Grandfathering: v1 entries are verified for chain + entryHash only (no signature expected).
// v2+ entries would require valid signatures (placeholder for future implementation).
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { valid: true }
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
      return { valid: false, brokenAt: i, reason: 'Invalid JSON' }
    }
    const schemaResult = ManifestEntrySchema.safeParse(parsed)
    if (!schemaResult.success) {
      return { valid: false, brokenAt: i, reason: 'Invalid entry shape' }
    }
    const entry = schemaResult.data
    // Extract entryHash and signature which shouldn't be in the body hash
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entryHash, signature, ...body } = entry
    if (body.index !== expectedIndex) {
      return { valid: false, brokenAt: i, reason: 'Index mismatch' }
    }
    if (body.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: 'Chain link broken' }
    }
    const recomputed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    if (recomputed !== entryHash) {
      return { valid: false, brokenAt: i, reason: 'Entry hash mismatch' }
    }
    // Grandfathering: v1 entries don't require signature validation
    // v2+ entries would require signature validation (placeholder for future implementation)
    // For now, we accept entries with or without signatures as valid
    expectedPrev = entryHash
    expectedIndex++
  }
  return { valid: true }
}
