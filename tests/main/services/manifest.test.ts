import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, getManifestHead } from '@main/services/manifest'
import { appendManifestEntry, rollbackManifestEntry } from '@main/services/manifest'
import { createHash } from 'crypto'
import { canonicalStringify } from '@main/services/canonicalJson'
import { statSync } from 'fs'

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
