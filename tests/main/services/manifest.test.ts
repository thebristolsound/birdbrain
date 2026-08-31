import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, getManifestHead } from '@main/services/manifest'
import { appendManifestEntry, rollbackManifestEntry } from '@main/services/manifest'
import { verifyManifestChain, MIN_READER_SCHEMA_VERSION } from '@main/services/manifest'
import { withDeletionEntry, withCaptureEntry, ManifestRollback } from '@main/services/manifest'
import type { AppendResult } from '@main/services/manifest'
import { createHash } from 'crypto'
import { canonicalStringify } from '@shared/verify'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { ManifestEntrySchema } from '@shared/schemas'
import { statSync } from 'fs'
import { appendFileSync } from 'fs'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { saveAnnotations } from '@main/services/annotations'
import { signEntryHash, verifyEntrySignature, getPublicKeyPem } from '@main/services/signingKey'

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

  // #398: the returned line is what the evidence export packages as
  // export-entry.json, so it must be the appended bytes, not a re-serialization.
  it('returns the exact appended line, byte-identical to the file tail', () => {
    const before = statSync(join(tempDir, 'manifest.jsonl')).size
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(result.line).toBe(raw.slice(before))
    expect(result.line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(result.line) as Record<string, unknown>
    expect(parsed.entryHash).toBe(result.entryHash)
  })

  it('entryHash matches SHA-256 of canonical-JSON body', () => {
    const body = {
      ...baseEntry,
      captureId: 'cap-1',
      index: 0,
      prevHash: '',
      schemaVersion: MIN_READER_SCHEMA_VERSION.capture
    }
    const expected = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    expect(result.entryHash).toBe(expected)
  })

  it('hashes screenshotHash/textHash into the body, schema-validates, and chain verifies (#118)', () => {
    const screenshotHash = 'c'.repeat(64)
    const textHash = 'd'.repeat(64)
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1', screenshotHash, textHash })

    const line = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim()
    const parsed = JSON.parse(line)
    expect(parsed.screenshotHash).toBe(screenshotHash)
    expect(parsed.textHash).toBe(textHash)
    // The body (sans signature + entryHash) hashes to entryHash including the new fields.
    const body = { ...parsed }
    const { entryHash } = parsed
    delete body.signature
    delete body.entryHash
    expect(createHash('sha256').update(canonicalStringify(body)).digest('hex')).toBe(entryHash)
    // Shape is accepted by the manifest schema.
    expect(ManifestEntrySchema.safeParse(parsed).success).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('OMITS the sidecar hashes when absent, leaving the legacy canonical body unchanged (#118)', () => {
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    const line = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim()
    const parsed = JSON.parse(line)
    expect('screenshotHash' in parsed).toBe(false)
    expect('textHash' in parsed).toBe(false)
  })

  it('anchors the corroboration-only TLS cert chain, schema-validates, and the body reconstructs to entryHash (#123)', () => {
    const tls = {
      url: 'https://example.com',
      refetchedAt: '2026-04-05T12:00:05.000Z',
      chain: [
        {
          subject: 'CN=example.com',
          issuer: 'CN=Example CA',
          validFrom: 'Jan  1 00:00:00 2026 GMT',
          validTo: 'Jan  1 00:00:00 2027 GMT',
          fingerprint256: 'AA:BB:CC',
          serialNumber: '01',
          subjectAltNames: ['DNS:example.com', 'DNS:www.example.com']
        }
      ]
    }
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1', tls })

    const line = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim()
    const parsed = JSON.parse(line)
    expect(parsed.tls).toEqual(tls)
    // Body (sans signature + entryHash) reconstructs to entryHash including tls —
    // the same reconstruction the verifier performs.
    const body = { ...parsed }
    const { entryHash } = parsed
    delete body.signature
    delete body.entryHash
    expect(createHash('sha256').update(canonicalStringify(body)).digest('hex')).toBe(entryHash)
    // Shape parses under the strict ManifestCaptureEntrySchema.
    expect(ManifestEntrySchema.safeParse(parsed).success).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('anchors a fail-soft TLS error marker and still verifies (#123)', () => {
    const tls = {
      url: 'https://example.com',
      refetchedAt: '2026-04-05T12:00:05.000Z',
      error: 'connect ECONNREFUSED'
    }
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1', tls })
    const parsed = JSON.parse(readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim())
    expect(parsed.tls).toEqual(tls)
    expect(ManifestEntrySchema.safeParse(parsed).success).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('OMITS the tls field when absent, leaving the legacy canonical body unchanged (#123)', () => {
    appendManifestEntry(tempDir, { ...baseEntry, captureId: 'cap-1' })
    const parsed = JSON.parse(readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim())
    expect('tls' in parsed).toBe(false)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-forensic-'))
    initManifest(tempDir)
    await initDatabase(':memory:')
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rolls the manifest back when fn throws an arbitrary error and rethrows', async () => {
    await expect(
      withDeletionEntry(tempDir, baseCtx, () => {
        throw new Error('storage delete failed')
      })
    ).rejects.toThrow('storage delete failed')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw).toBe('')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)
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
    expect(verifyManifestChain(tempDir).valid).toBe(true)

    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-keep')
    expect(JSON.parse(lines[1]).captureId).toBe('cap-next')
  })
})

describe('withCaptureEntry', () => {
  let tempDir: string

  const baseCtx = {
    captureId: 'cap-1',
    caseId: 'case-1',
    url: 'https://example.com',
    timestamp: '2026-04-05T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1234,
    operatorId: 'op-1',
    operatorName: '',
    toolVersion: '0.1.0'
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-capture-entry-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('commits the capture entry and passes the AppendResult to fn', async () => {
    let seen: AppendResult | undefined
    const result = await withCaptureEntry(tempDir, baseCtx, (r) => {
      seen = r
      return 'ok' as const
    })
    expect(result).toBe('ok')
    expect(seen?.index).toBe(0)
    expect(seen?.prevHash).toBe('')
    expect(seen?.entryHash).toMatch(/^[0-9a-f]{64}$/)

    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.type).toBe('capture')
    expect(entry.captureId).toBe('cap-1')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rolls the manifest back to its anchor when fn throws', async () => {
    await expect(
      withCaptureEntry(tempDir, baseCtx, () => {
        throw new Error('db insert failed')
      })
    ).rejects.toThrow('db insert failed')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw).toBe('')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rolls the manifest back when an async fn rejects', async () => {
    await expect(
      withCaptureEntry(tempDir, baseCtx, async () => {
        await new Promise((r) => setImmediate(r))
        throw new Error('async db insert failed')
      })
    ).rejects.toThrow('async db insert failed')

    const raw = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(raw).toBe('')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rollback preserves a prior committed entry untouched (anchorBytes != 0)', async () => {
    await withCaptureEntry(tempDir, { ...baseCtx, captureId: 'cap-keep' }, () => undefined)
    const before = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')

    await expect(
      withCaptureEntry(tempDir, { ...baseCtx, captureId: 'cap-fail' }, () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const after = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
    expect(after).toBe(before)
    const lines = after.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-keep')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('next append after rollback links to the prior committed entry', async () => {
    await withCaptureEntry(tempDir, { ...baseCtx, captureId: 'cap-keep' }, () => undefined)
    const headBefore = getManifestHead(tempDir)

    await expect(
      withCaptureEntry(tempDir, { ...baseCtx, captureId: 'cap-fail' }, () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(getManifestHead(tempDir)).toEqual(headBefore)

    await withCaptureEntry(tempDir, { ...baseCtx, captureId: 'cap-next' }, () => undefined)
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).captureId).toBe('cap-keep')
    expect(JSON.parse(lines[1]).captureId).toBe('cap-next')
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('rollback with anchorBytes=0 empties the manifest', async () => {
    await expect(
      withCaptureEntry(tempDir, baseCtx, () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(statSync(join(tempDir, 'manifest.jsonl')).size).toBe(0)
    expect(getManifestHead(tempDir)).toEqual({ prevHash: '', nextIndex: 0 })
  })

  it('produces a byte-identical entry to the equivalent appendManifestEntry call', async () => {
    // AC#5: the canonical body / entryHash format must not change. Compare the
    // entry the seam writes against a direct appendManifestEntry call.
    const direct = mkdtempSync(join(tmpdir(), 'birdbrain-capture-entry-direct-'))
    try {
      initManifest(direct)
      const expected = appendManifestEntry(direct, { type: 'capture', ...baseCtx })

      const viaSeam = await withCaptureEntry(tempDir, baseCtx, (r) => r)
      expect(viaSeam.entryHash).toBe(expected.entryHash)

      const seamLine = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim()
      const directLine = readFileSync(join(direct, 'manifest.jsonl'), 'utf-8').trim()
      // Signatures are non-deterministic; compare everything except the signature.
      const strip = (l: string) => {
        const { signature: _s, ...rest } = JSON.parse(l)
        void _s
        return rest
      }
      expect(strip(seamLine)).toEqual(strip(directLine))
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('omits method and supersedesCaptureId from the entry body when absent (grandfathering)', async () => {
    await withCaptureEntry(tempDir, baseCtx, () => undefined)
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    expect('method' in entry).toBe(false)
    expect('supersedesCaptureId' in entry).toBe(false)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('anchors method and supersedesCaptureId in the entry body when present', async () => {
    await withCaptureEntry(
      tempDir,
      { ...baseCtx, captureId: 'cap-2', method: 'background', supersedesCaptureId: 'cap-1' },
      () => undefined
    )
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    expect(entry.method).toBe('background')
    expect(entry.supersedesCaptureId).toBe('cap-1')
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('omits duplicateOfCaptureId and duplicatedAt when absent (#827 grandfathering)', async () => {
    await withCaptureEntry(tempDir, baseCtx, () => undefined)
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    // OMITTED, not '' / null: every entry written before #827 must canonicalize
    // to the same bytes it did then, or its chain hash moves and packages
    // exported earlier stop verifying.
    expect('duplicateOfCaptureId' in entry).toBe(false)
    expect('duplicatedAt' in entry).toBe(false)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('anchors duplicateOfCaptureId and duplicatedAt in the entry body when present (#827)', async () => {
    await withCaptureEntry(
      tempDir,
      {
        ...baseCtx,
        captureId: 'cap-2',
        method: 'duplicate',
        duplicateOfCaptureId: 'cap-1',
        duplicatedAt: '2026-08-25T09:00:00.000Z'
      },
      () => undefined
    )
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    const entry = JSON.parse(lines[0])
    expect(entry.method).toBe('duplicate')
    expect(entry.duplicateOfCaptureId).toBe('cap-1')
    expect(entry.duplicatedAt).toBe('2026-08-25T09:00:00.000Z')
    // The new fields are inside the signed body, so a reader who strips them
    // gets a different entryHash — the derivation cannot be edited away.
    const body = { ...entry }
    delete body.signature
    delete body.entryHash
    expect(createHash('sha256').update(canonicalStringify(body)).digest('hex')).toBe(entry.entryHash)
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('readCaptureEntryAt returns the capture entry at an index, and nothing else (#827)', async () => {
    const { readCaptureEntryAt } = await import('@main/services/manifest')
    await withCaptureEntry(tempDir, baseCtx, () => undefined)
    appendManifestEntry(tempDir, {
      type: 'deletion',
      captureId: baseCtx.captureId,
      caseId: baseCtx.caseId,
      timestamp: '2026-08-25T09:00:00.000Z',
      contentHash: baseCtx.contentHash,
      operatorId: baseCtx.operatorId,
      operatorName: baseCtx.operatorName,
      toolVersion: baseCtx.toolVersion
    })

    expect(readCaptureEntryAt(tempDir, 0)?.entry.captureId).toBe(baseCtx.captureId)
    // A deletion entry is not a capture entry: a caller asking for anchored
    // capture facts must get nothing rather than a wrong-shaped object.
    expect(readCaptureEntryAt(tempDir, 1)).toBeUndefined()
    expect(readCaptureEntryAt(tempDir, 7)).toBeUndefined()
  })

  it('readCaptureEntryAt verifies the chain over the same snapshot it reads (#827)', async () => {
    const { readCaptureEntryAt } = await import('@main/services/manifest')
    await withCaptureEntry(tempDir, baseCtx, () => undefined)
    expect(readCaptureEntryAt(tempDir, 0)?.entry.url).toBe(baseCtx.url)

    // Rewrite the entry in place without re-chaining: still schema-valid, but
    // the recorded entryHash no longer matches. A caller's earlier chain
    // verification read different bytes, so the anchored-facts reader must
    // verify the exact snapshot it hands values out of — a rewrite between the
    // two reads yields nothing rather than unauthenticated url/timestamp.
    const path = join(tempDir, 'manifest.jsonl')
    const entry = JSON.parse(readFileSync(path, 'utf-8').trim()) as Record<string, unknown>
    entry.url = 'https://attacker.example/'
    writeFileSync(path, JSON.stringify(entry) + '\n')
    expect(readCaptureEntryAt(tempDir, 0)).toBeUndefined()
  })

  it('KAT: the writer still produces the exact pre-#827 chain hash for a pre-#827 entry', async () => {
    // The hex is frozen from before duplication provenance existed: the entry
    // the writer produced for exactly these fields hashed to it then, and must
    // hash to it now. The entry is produced by `withCaptureEntry` — not
    // re-stated as a literal — so this fails on any change to what a plain
    // capture entry contains, including the #827 regression of writing
    // duplicateOfCaptureId/duplicatedAt unconditionally: every package
    // exported before such a change would stop verifying.
    const written = await withCaptureEntry(
      tempDir,
      {
        captureId: 'cap-kat',
        caseId: 'case-kat',
        url: 'https://example.com/kat',
        timestamp: '2026-04-05T12:00:00.000Z',
        contentHash: 'a'.repeat(64),
        sizeBytes: 1234,
        operatorId: 'op-kat',
        operatorName: 'Operator',
        toolVersion: '1.0.0'
      },
      (r) => r
    )
    expect(written.entryHash).toBe(
      'c076682228ff6f44fafd46ae08d4bb1081ce9b7fbfeda53620228a8cdde8d238'
    )
    // The same hex from the stored line, recomputed the way a verifier does —
    // pinning the derivation as well as the writer.
    const entry = JSON.parse(readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8').trim())
    const { signature: _sig, entryHash, ...body } = entry
    void _sig
    expect(entryHash).toBe(written.entryHash)
    expect(createHash('sha256').update(canonicalStringify(body)).digest('hex')).toBe(
      'c076682228ff6f44fafd46ae08d4bb1081ce9b7fbfeda53620228a8cdde8d238'
    )
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
    // v2+ entries must carry a valid signature; legacy v1 entries stay unsigned.
    const version = typeof extra.schemaVersion === 'number' ? extra.schemaVersion : 1
    const line =
      version >= 2
        ? { ...body, entryHash, signature: signEntryHash(entryHash) }
        : { ...body, entryHash }
    appendFileSync(join(tempDir, 'manifest.jsonl'), JSON.stringify(line) + '\n')
    return entryHash
  }

  it('reads up to MANIFEST_SCHEMA_VERSION 3', () => {
    // Bumped to 3 by the Exhibit model (ADR-0023): this build READS the
    // `exhibit`, `derivation` and `renumber` entry types. What it WRITES is a
    // separate question, pinned by MIN_READER_SCHEMA_VERSION below.
    expect(MANIFEST_SCHEMA_VERSION).toBe(3)
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
    // A grandfathered v1 capture is not eligible — absent from the index → none.
    expect(result.trustedTimes.get('a'.repeat(64))).toBeUndefined()
  })

  it('ChainVerifyResult resolves an empty trusted-time index for an empty manifest', () => {
    expect(verifyManifestChain(tempDir).trustedTimes.size).toBe(0)
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

  it('writes per-entry schemaVersion at the type’s minimum reader version on append', () => {
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
    // NOT MANIFEST_SCHEMA_VERSION, which is the highest version this build can
    // READ. A capture entry's shape is unchanged by schema 3, so it is stamped
    // 2 and a verifier already in a recipient's hands keeps reading it (X25).
    expect(entry.schemaVersion).toBe(MIN_READER_SCHEMA_VERSION.capture)
    expect(entry.schemaVersion).toBe(2)
    expect(entry.schemaVersion).toBeLessThanOrEqual(MANIFEST_SCHEMA_VERSION)
  })

  it('excludes signature from entryHash so re-signing a v2 entry still verifies', () => {
    // Append a normal v2 entry, then re-sign its entryHash and re-inject the
    // signature. The signature must NOT participate in entryHash (same rule as
    // entryHash itself), so swapping it for an equally-valid signature leaves
    // the chain verifying. (Under G2, the injected signature is now actually
    // checked, so it must be a real signature over this entry's entryHash.)
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
    entry.signature = signEntryHash(entry.entryHash)
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

  it('accepts a capture entry with headers under the strict schema (#119)', () => {
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
      schemaVersion: 2,
      entryHash: 'e'.repeat(64)
    }
    const withHeaders = { ...base, headers: { server: 'nginx', 'content-type': 'text/html' } }
    expect(ManifestEntrySchema.safeParse(withHeaders).success).toBe(true)

    // Non-string header values are rejected by the strict record schema.
    const badHeaders = { ...base, headers: { server: 123 } }
    expect(ManifestEntrySchema.safeParse(badHeaders).success).toBe(false)

    // Omitting headers still parses (legacy/headerless entries).
    expect(ManifestEntrySchema.safeParse(base).success).toBe(true)
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

describe('manifest signing enforcement (G2)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-sign-enforce-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const base = {
    type: 'capture' as const,
    caseId: 'case-1',
    timestamp: '2026-05-01T00:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1,
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0'
  }

  const readEntry = (lineIdx = 0): Record<string, unknown> => {
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    return JSON.parse(lines[lineIdx])
  }

  const overwrite = (entry: Record<string, unknown>): void => {
    writeFileSync(join(tempDir, 'manifest.jsonl'), JSON.stringify(entry) + '\n')
  }

  it('signs every appended entry with a signature verifiable over its entryHash', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const entry = readEntry()
    expect(typeof entry.signature).toBe('string')
    expect(verifyEntrySignature(entry.entryHash as string, entry.signature as string)).toBe(true)
  })

  it('rejects a v2 entry that was re-hashed after tampering but not re-signed', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const entry = readEntry()
    entry.url = 'https://evil'
    const { entryHash: _e, signature, ...body } = entry
    void _e
    const rehashed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    overwrite({ ...body, entryHash: rehashed, signature })
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Invalid signature')
  })

  it('rejects a v2 entry that has no signature', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const { signature: _s, ...unsigned } = readEntry()
    void _s
    overwrite(unsigned)
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Invalid signature')
  })

  it('rejects a v2 entry whose signature is well-formed base64 but invalid', () => {
    appendManifestEntry(tempDir, { ...base, captureId: 'c1', url: 'https://a' })
    const entry = readEntry()
    entry.signature = Buffer.from('not a real signature').toString('base64')
    overwrite(entry)
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Invalid signature')
  })
})

describe('manifest export audit entry (#124)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-export-entry-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const exportEntry = {
    type: 'export' as const,
    caseId: 'case-1',
    timestamp: '2026-06-01T12:00:00.000Z',
    operatorId: 'install-123',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    packageHash: 'd'.repeat(64),
    verificationResult: {
      overallValid: true,
      captureCount: 2,
      verifiedCount: 2,
      tamperedCount: 0,
      missingCount: 0
    }
  }

  const readEntry = (lineIdx: number): Record<string, unknown> => {
    const lines = readFileSync(join(tempDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    return JSON.parse(lines[lineIdx])
  }

  it('round-trips an export variant and links to the prior head', () => {
    appendManifestEntry(tempDir, {
      type: 'capture',
      captureId: 'cap-0',
      caseId: 'case-1',
      url: 'https://example.com/0',
      timestamp: '2026-06-01T11:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 100,
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.4.0'
    })
    const head = getManifestHead(tempDir)
    const result = appendManifestEntry(tempDir, exportEntry)

    const entry = readEntry(1)
    expect(entry.type).toBe('export')
    expect(entry.index).toBe(head.nextIndex)
    expect(entry.prevHash).toBe(head.prevHash)
    expect(entry.packageHash).toBe(exportEntry.packageHash)
    expect(entry.verificationResult).toEqual(exportEntry.verificationResult)
    expect(entry.schemaVersion).toBe(MIN_READER_SCHEMA_VERSION.export)
    expect(typeof entry.signature).toBe('string')
    expect(verifyEntrySignature(result.entryHash, entry.signature as string)).toBe(true)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('verifies a chain ending in an export entry', () => {
    appendManifestEntry(tempDir, exportEntry)
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it('fails verification when the export packageHash is tampered (Entry hash mismatch)', () => {
    appendManifestEntry(tempDir, exportEntry)
    const entry = readEntry(0)
    entry.packageHash = 'e'.repeat(64)
    writeFileSync(join(tempDir, 'manifest.jsonl'), JSON.stringify(entry) + '\n')
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Entry hash mismatch')
  })

  it('fails verification when the export signature is tampered (Invalid signature)', () => {
    appendManifestEntry(tempDir, exportEntry)
    const entry = readEntry(0)
    entry.signature = Buffer.from('not a real signature').toString('base64')
    writeFileSync(join(tempDir, 'manifest.jsonl'), JSON.stringify(entry) + '\n')
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
    expect(result.reason).toBe('Invalid signature')
  })

  it('schema accepts a well-formed export entry', () => {
    appendManifestEntry(tempDir, exportEntry)
    const entry = readEntry(0)
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
  })

  it('schema rejects an export entry missing packageHash', () => {
    appendManifestEntry(tempDir, exportEntry)
    const entry = readEntry(0)
    delete entry.packageHash
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(false)
  })

  it('schema rejects an export entry with an unknown extra key (.strict)', () => {
    appendManifestEntry(tempDir, exportEntry)
    const entry = readEntry(0)
    entry.surprise = 'nope'
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(false)
  })
})

describe('manifest archive-export and import entries', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-archive-entry-'))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('appends and verifies archive-export and import entries', () => {
    initManifest(tempDir)
    appendManifestEntry(tempDir, {
      type: 'archive-export',
      caseId: 'case-1',
      timestamp: new Date().toISOString(),
      operatorId: 'inst-1',
      operatorName: 'Op',
      toolVersion: '1.0.0',
      packageHash: 'a'.repeat(64)
    })
    appendManifestEntry(tempDir, {
      type: 'import',
      caseId: 'case-2',
      sourceCaseId: 'case-1',
      sourceInstallationId: 'inst-0',
      sourcePublicKeyPem: getPublicKeyPem(),
      packageHash: 'b'.repeat(64),
      idMapSha256: 'c'.repeat(64),
      verificationResult: {
        overallValid: true,
        chainValid: true,
        artifactCount: 3,
        artifactFailureCount: 0,
        captureCount: 1,
        captureHashFailureCount: 0
      },
      timestamp: new Date().toISOString(),
      operatorId: 'inst-1',
      operatorName: 'Op',
      toolVersion: '1.0.0'
    })
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })
})
