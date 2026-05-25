import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, getManifestHead } from '@main/services/manifest'
import { appendManifestEntry, rollbackManifestEntry } from '@main/services/manifest'
import { verifyManifestChain } from '@main/services/manifest'
import { withDeletionEntry, ManifestRollback } from '@main/services/manifest'
import { createHash } from 'crypto'
import { canonicalStringify } from '@main/services/canonicalJson'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import { statSync } from 'fs'
import { appendFileSync } from 'fs'
import { initDatabase, closeDatabase, createCase, insertCapture } from '@main/services/database'
import { saveAnnotations } from '@main/services/annotations'

describe('manifest init/getHead', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-manifest-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates manifest file on first init', () => {
    initManifest(tempDir)
    expect(existsSync(join(tempDir, 'manifest.jsonl'))).toBe(true)
  })

  it('returns empty head for new manifest', () => {
    initManifest(tempDir)
    const head = getManifestHead(tempDir)
    expect(head.prevHash).toBe('')
    expect(head.nextIndex).toBe(0)
  })

  it('is idempotent - does not truncate existing manifest', () => {
    initManifest(tempDir)
    const path = join(tempDir, 'manifest.jsonl')
    writeFileSync(path, '{"hello":"world"}\n')
    initManifest(tempDir)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('hello')
  })
})

describe('manifest append', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-append-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const baseEntry = {
    type: 'capture' as const,
    caseId: 'case-1',
    url: 'https://example.com',
    timestamp: '2026-04-05T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1234,
    operatorId: 'op-1',
    operatorName: '',
    toolVersion: '0.1.0'
  }

  it('appends a capture entry with correct index and linking', () => {
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    expect(result.index).toBe(0)
    expect(result.prevHash).toBe('')
    expect(result.entryHash).toMatch(/^[0-9a-f]{64}$/)

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw.trim().split('\n')).toHaveLength(1)
  })

  it('links subsequent entries via prevHash = previous entryHash', () => {
    const first = appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    const second = appendManifestEntry(tempDir, {
      ...baseEntry,
      captureId: 'cap-2',
      url: 'https://example.com/2',
      timestamp: '2026-04-05T12:01:00.000Z',
      contentHash: 'b'.repeat(64),
      sizeBytes: 2345
    })
    expect(second.index).toBe(1)
    expect(second.prevHash).toBe(first.entryHash)
    expect(second.entryHash).not.toBe(first.entryHash)
  })

  it('rollbackManifestEntry truncates back to anchor byte', () => {
    const anchor = statSync(join(tempDir, 'manifest.jsonl')).size
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    const afterAppend = statSync(join(tempDir, 'manifest.jsonl')).size
    expect(afterAppend).toBeGreaterThan(anchor)

    rollbackManifestEntry(tempDir, anchor)
    expect(statSync(join(tempDir, 'manifest.jsonl')).size).toBe(anchor)
  })

  it('entryHash matches SHA-256 of canonical-JSON body', () => {
    const body = {
      ...baseEntry,
      captureId: 'cap-1',
      index: 0,
      prevHash: '',
      schemaVersion: MANIFEST_SCHEMA_VERSION
    }
    const expected = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    expect(result.entryHash).toBe(expected)
  })
})

describe('manifest verifyManifestChain', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-verify-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const base = {
    type: 'capture' as const,
    caseId: 'case-1',
    timestamp: '2026-04-05T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1,
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0'
  }

  it('returns valid=true for empty manifest', () => {
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('returns valid=true for a well-formed chain', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    appendManifestEntry(tempDir, {
      ...base,
      captureId: 'c2',
      url: 'https://b',
      timestamp: '2026-04-05T12:01:00.000Z',
      contentHash: 'b'.repeat(64)
    })
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('detects tampering by mutating an entry', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const path = join(tempDir, 'manifest.jsonl')
    const raw = readFileSync(path, 'utf-8')
    writeFileSync(path, raw.replace('https://a', 'https://evil'))
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
  })

  it('rejects entries with invalid shape', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    // Append a line that parses as JSON but is missing required fields
    const badLine = JSON.stringify({ type: 'capture', foo: 'bar' }) + '\n'
    appendFileSync(join(tempDir, 'manifest.jsonl'), badLine)
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid entry shape')
  })

  it('detects broken link between entries', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const badLine =
      JSON.stringify({
        type: 'capture',
        captureId: 'c2',
        caseId: 'case-1',
        url: 'https://b',
        timestamp: '2026-04-05T12:01:00.000Z',
        contentHash: 'b'.repeat(64),
        sizeBytes: 2,
        operatorId: 'op',
        operatorName: '',
        toolVersion: '0.1.0',
        index: 1,
        prevHash: 'wrong-hash',
        schemaVersion: 1,
        entryHash: 'anything'
      }) + '\n'
    appendFileSync(join(tempDir, 'manifest.jsonl'), badLine)
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
  })
})

describe('manifest x annotations forensic invariants', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-forensic-'))
    initManifest(tempDir)
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('saving annotations does not modify the manifest file or break the chain', () => {
    const c = createCase({ name: 'Forensic' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: '2026-04-25T12:00:00.000Z'
    })
    appendManifestEntry(tempDir, {
      type: 'capture',
      caseId: c.id,
      captureId: cap.id,
      url: 'https://example.com',
      timestamp: '2026-04-25T12:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })

    const manifestPath = join(tempDir, 'manifest.jsonl')
    const before = readFileSync(manifestPath, 'utf-8')

    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'rect', id: 'r', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }],
      imageWidth: 100,
      imageHeight: 100
    })

    const after = readFileSync(manifestPath, 'utf-8')
    expect(after).toBe(before)
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })
})

describe('withDeletionEntry', () => {
  let tempDir: string

  const baseCtx = {
    captureId: 'cap-1',
    caseId: 'case-1',
    contentHash: 'a'.repeat(64),
    operatorId: 'op-1',
    operatorName: '',
    toolVersion: '0.1.0'
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-deletion-entry-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('commits the deletion entry when fn returns', async () => {
    const result = await withDeletionEntry(tempDir, baseCtx, () => 'ok' as const)
    expect(result).toBe('ok')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.type).toBe('deletion')
    expect(entry.captureId).toBe('cap-1')
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('rolls the manifest back when fn throws ManifestRollback', async () => {
    const before = existsSync(join(tempDir, 'manifest.jsonl'))
      ? statSync(join(tempDir, 'manifest.jsonl')).size
      : 0

    await expect(
      withDeletionEntry(tempDir, baseCtx, () => {
        throw new ManifestRollback()
      })
    ).rejects.toThrow(ManifestRollback)

    const after = statSync(join(tempDir, 'manifest.jsonl')).size
    expect(after).toBe(before)
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('rolls the manifest back when fn throws an arbitrary error and rethrows', async () => {
    await expect(
      withDeletionEntry(tempDir, baseCtx, () => {
        throw new Error('storage delete failed')
      })
    ).rejects.toThrow('storage delete failed')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw).toBe('')
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('rolls the manifest back when an async fn rejects', async () => {
    await expect(
      withDeletionEntry(tempDir, baseCtx, async () => {
        await new Promise((r) => setImmediate(r))
        throw new Error('async storage delete failed')
      })
    ).rejects.toThrow('async storage delete failed')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw).toBe('')
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('commits the deletion entry when an async fn resolves', async () => {
    const result = await withDeletionEntry(tempDir, baseCtx, async () => {
      await new Promise((r) => setImmediate(r))
      return 'async-ok' as const
    })
    expect(result).toBe('async-ok')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-1')
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('rollback preserves a prior committed entry untouched', async () => {
    // Commit one entry first
    await withDeletionEntry(tempDir, { ...baseCtx, captureId: 'cap-keep' }, () => undefined)
    const before = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')

    // Attempt a second deletion that fails
    await expect(
      withDeletionEntry(tempDir, { ...baseCtx, captureId: 'cap-fail' }, () => {
        throw new ManifestRollback()
      })
    ).rejects.toThrow(ManifestRollback)

    const after = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(after).toBe(before)
    const lines = after.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-keep')
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })
  })

  it('next append after rollback links to the prior committed entry, not the rolled-back one', async () => {
    const first = await withDeletionEntry(
      tempDir,
      { ...baseCtx, captureId: 'cap-keep' },
      () => 'ok' as const
    )
    expect(first).toBe('ok')
    const headBefore = getManifestHead(tempDir)

    await expect(
      withDeletionEntry(tempDir, { ...baseCtx, captureId: 'cap-fail' }, () => {
        throw new ManifestRollback()
      })
    ).rejects.toThrow(ManifestRollback)

    // After rollback, head should be unchanged
    const headAfter = getManifestHead(tempDir)
    expect(headAfter).toEqual(headBefore)

    // A subsequent successful append should chain from the kept entry
    await withDeletionEntry(tempDir, { ...baseCtx, captureId: 'cap-next' }, () => undefined)
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true, trustedTime: 'none' })

    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-keep')
    expect(JSON.parse(lines[1]).captureId).toBe('cap-next')
  })
})

describe('manifest schema v2 + grandfathering', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema-v2-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Hand-builds a chain-linked entry at the current head, computing entryHash
  // over the canonical body exactly the way appendManifestEntry would, and
  // appends it. Mirrors a manifest produced by an older app version.
  function appendRawEntry(extra: Record<string, unknown>): string {
    const { prevHash, nextIndex } = getManifestHead(tempDir)
    const body = { ...extra, index: nextIndex, prevHash }
    const entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    appendFileSync(join(tempDir, 'manifest.jsonl'), JSON.stringify({ ...body, entryHash }) + '\n')
    return entryHash
  }

  it('bumps MANIFEST_SCHEMA_VERSION to 2', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(2)
  })

  it('verifies a legacy v1 entry on chain + entryHash only (no signature)', () => {
    appendRawEntry({
      type: 'capture',
      captureId: 'v1-cap',
      caseId: 'case-1',
      url: 'https://legacy',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 10,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.0.9',
      schemaVersion: 1
    })
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(true)
    expect(result.trustedTime).toBe('none')
  })

  it('ChainVerifyResult defaults trustedTime to none', () => {
    expect(verifyManifestChain(tempDir).trustedTime).toBe('none')
  })

  it('passes a mixed v1/v2 chain through verifyManifestChain', () => {
    // Legacy v1 entry written by an older app (no signature)
    appendRawEntry({
      type: 'capture',
      captureId: 'v1-cap',
      caseId: 'case-1',
      url: 'https://legacy',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 10,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.0.9',
      schemaVersion: 1
    })
    // Current app appends a v2 entry on top
    appendManifestEntry(tempDir, {
      type: 'capture',
      captureId: 'v2-cap',
      caseId: 'case-1',
      url: 'https://current',
      timestamp: '2026-05-01T00:00:00.000Z',
      contentHash: 'b'.repeat(64),
      sizeBytes: 20,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(JSON.parse(lines[0]).schemaVersion).toBe(1)
    expect(JSON.parse(lines[1]).schemaVersion).toBe(2)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('writes per-entry schemaVersion equal to MANIFEST_SCHEMA_VERSION on append', () => {
    appendManifestEntry(tempDir, {
      type: 'capture',
      captureId: 'cap-1',
      caseId: 'case-1',
      url: 'https://a',
      timestamp: '2026-05-01T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    const entry = JSON.parse(readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim())
    expect(entry.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
  })

  it('excludes signature from entryHash so a v2 entry verifies with a signature present', () => {
    // Append a normal v2 entry, then inject a signature field into the line.
    // The signature must NOT participate in entryHash (same rule as entryHash
    // itself), so the chain must still verify after injection.
    appendManifestEntry(tempDir, {
      type: 'capture',
      captureId: 'cap-sig',
      caseId: 'case-1',
      url: 'https://signed',
      timestamp: '2026-05-01T00:00:00.000Z',
      contentHash: 'c'.repeat(64),
      sizeBytes: 5,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    const path = join(tempDir, 'manifest.jsonl')
    const entry = JSON.parse(readFileSync(path, 'utf-8').trim())
    entry.signature = 'ed25519:deadbeef'
    writeFileSync(path, JSON.stringify(entry) + '\n')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('accepts and round-trips a timestamp entry through the schema', () => {
    const tsEntry = {
      type: 'timestamp',
      caseId: 'case-1',
      captureContentHash: 'a'.repeat(64),
      timestamp: '2026-05-01T00:00:00.000Z',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      index: 0,
      prevHash: '',
      schemaVersion: 2,
      entryHash: 'f'.repeat(64)
    }
    const parsed = ManifestEntrySchema.safeParse(tsEntry)
    expect(parsed.success).toBe(true)
  })

  it('passes a chain that includes an appended timestamp entry', () => {
    const captureHash = createHash('sha256').update('content').digest('hex')
    appendManifestEntry(tempDir, {
      type: 'capture',
      captureId: 'cap-1',
      caseId: 'case-1',
      url: 'https://a',
      timestamp: '2026-05-01T00:00:00.000Z',
      contentHash: captureHash,
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0'
    })
    appendRawEntry({
      type: 'timestamp',
      caseId: 'case-1',
      captureContentHash: captureHash,
      timestamp: '2026-05-01T00:01:00.000Z',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      schemaVersion: 2
    })
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('does not retro-modify existing v1 entries when verifying', () => {
    appendRawEntry({
      type: 'capture',
      captureId: 'v1-cap',
      caseId: 'case-1',
      url: 'https://legacy',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 10,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.0.9',
      schemaVersion: 1
    })
    const path = join(tempDir, 'manifest.jsonl')
    const before = readFileSync(path, 'utf-8')
    const sizeBefore = statSync(path).size
    verifyManifestChain(tempDir)
    verifyManifestChain(tempDir)
    expect(readFileSync(path, 'utf-8')).toBe(before)
    expect(statSync(path).size).toBe(sizeBefore)
  })

  it('rejects out-of-range schemaVersion values (0, 99, 1.5)', () => {
    // schemaVersionField is bounded: int, min 1, max MANIFEST_SCHEMA_VERSION.
    // Negatives, floats, NaN, and unknown-future versions must fail-closed.
    const base = {
      type: 'capture' as const,
      captureId: 'cap',
      caseId: 'case-1',
      url: 'https://a',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      index: 0,
      prevHash: '',
      entryHash: 'e'.repeat(64)
    }
    expect(ManifestEntrySchema.safeParse({ ...base, schemaVersion: 0 }).success).toBe(false)
    expect(ManifestEntrySchema.safeParse({ ...base, schemaVersion: 99 }).success).toBe(false)
    expect(ManifestEntrySchema.safeParse({ ...base, schemaVersion: 1.5 }).success).toBe(false)
  })
})

// Existing tests exercise rollback only through the `withDeletionEntry`
// wrapper, which handles the anchor capture and rollback automatically.
// The bare `rollbackManifestEntry(caseDir, anchorBytes)` API is the seam
// that ingest paths (e.g. captureLifecycle.ingestMhtmlCapture) use directly
// after a DB insert or sidecar write fails, so it gets its own coverage here.
describe('rollbackManifestEntry (direct API)', () => {
  let tempDir: string
  const capEntry = (i: number) => ({
    type: 'capture' as const,
    captureId: `cap-${i}`,
    caseId: 'case-rb',
    url: `https://example.com/${i}`,
    timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
    contentHash: 'a'.repeat(64),
    sizeBytes: 100 + i,
    operatorId: 'op',
    operatorName: 'Op',
    toolVersion: '0.1.0'
  })

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-rollback-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('truncates manifest back to anchorBytes after a single append', () => {
    const path = join(tempDir, 'manifest.jsonl')
    const result = appendManifestEntry(tempDir, capEntry(0))
    expect(statSync(path).size).toBeGreaterThan(result.anchorBytes)

    rollbackManifestEntry(tempDir, result.anchorBytes)
    expect(statSync(path).size).toBe(result.anchorBytes)
    expect(getManifestHead(tempDir)).toEqual({ prevHash: '', nextIndex: 0 })
  })

  it('rollback then re-append produces a valid single-entry chain', () => {
    const first = appendManifestEntry(tempDir, capEntry(0))
    rollbackManifestEntry(tempDir, first.anchorBytes)

    const reAppended = appendManifestEntry(tempDir, capEntry(0))
    expect(reAppended.index).toBe(0)
    expect(reAppended.prevHash).toBe('')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rolling back entry B leaves entry A intact and chain still verifies', () => {
    const a = appendManifestEntry(tempDir, capEntry(0))
    const b = appendManifestEntry(tempDir, capEntry(1))
    expect(b.index).toBe(1)

    rollbackManifestEntry(tempDir, b.anchorBytes)

    const head = getManifestHead(tempDir)
    expect(head.nextIndex).toBe(1)
    expect(head.prevHash).toBe(a.entryHash)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rollback with anchorBytes=0 empties the manifest', () => {
    const path = join(tempDir, 'manifest.jsonl')
    appendManifestEntry(tempDir, capEntry(0))
    appendManifestEntry(tempDir, capEntry(1))
    expect(statSync(path).size).toBeGreaterThan(0)

    rollbackManifestEntry(tempDir, 0)
    expect(statSync(path).size).toBe(0)
    expect(getManifestHead(tempDir)).toEqual({ prevHash: '', nextIndex: 0 })
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('successive rollbacks unwind the chain to an empty manifest', () => {
    const a = appendManifestEntry(tempDir, capEntry(0))
    const b = appendManifestEntry(tempDir, capEntry(1))

    rollbackManifestEntry(tempDir, b.anchorBytes)
    rollbackManifestEntry(tempDir, a.anchorBytes)

    expect(statSync(join(tempDir, 'manifest.jsonl')).size).toBe(0)
    expect(getManifestHead(tempDir)).toEqual({ prevHash: '', nextIndex: 0 })
  })
})
