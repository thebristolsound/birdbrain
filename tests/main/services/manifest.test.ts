import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, getManifestHead } from '@main/services/manifest'
import { appendManifestEntry, rollbackManifestEntry } from '@main/services/manifest'
import { verifyManifestChain } from '@main/services/manifest'
import { createHash } from 'crypto'
import { canonicalStringify } from '@main/services/canonicalJson'
import { statSync } from 'fs'
import { appendFileSync } from 'fs'

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
      schemaVersion: 1
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
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true })
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
    const badLine = JSON.stringify({
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
