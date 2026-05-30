import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import {
  initManifest,
  appendManifestEntry,
  resolveTrustedTime,
  buildTrustedTimeIndex,
  verifyManifestChain
} from '@main/services/manifest'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

function hashOf(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function appendCapture(caseDir: string, contentHash: string): void {
  appendManifestEntry(caseDir, {
    type: 'capture',
    captureId: 'cap-' + contentHash.slice(0, 8),
    caseId: 'case-1',
    url: 'https://example.com',
    timestamp: '2026-05-30T09:00:00.000Z',
    contentHash,
    sizeBytes: 100,
    operatorId: 'op-1',
    operatorName: 'Op One',
    toolVersion: '1.0.0'
  })
}

function appendTimestamp(caseDir: string, contentHash: string, tokenB64: string): void {
  appendManifestEntry(caseDir, {
    type: 'timestamp',
    caseId: 'case-1',
    captureContentHash: contentHash,
    timestamp: '2026-05-30T09:05:00.000Z',
    tsaToken: tokenB64,
    operatorId: 'op-1',
    operatorName: 'Op One',
    toolVersion: '1.0.0'
  })
}

describe('resolveTrustedTime', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-tt-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  it('is pending for a v2 capture with no timestamp entry', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)

    const result = resolveTrustedTime(caseDir, contentHash)

    expect(result.trustedTime).toBe('pending')
    expect(result.stampedAt).toBeUndefined()
    expect(result.tsaName).toBeUndefined()
  })

  it('is rfc3161 with TSA identity and stamped-at once a timestamp entry exists', () => {
    const contentHash = hashOf('capture-bytes')
    const genTime = new Date('2026-05-30T09:05:00.000Z')
    appendCapture(caseDir, contentHash)
    const token = buildSyntheticToken({ contentHash, genTime, tsaDnsName: 'tsa.example.com' })
    appendTimestamp(caseDir, contentHash, token.toString('base64'))

    const result = resolveTrustedTime(caseDir, contentHash)

    expect(result.trustedTime).toBe('rfc3161')
    expect(result.tsaName).toBe('tsa.example.com')
    expect(result.stampedAt).toBe(genTime.toISOString())
  })

  it('is none for a content hash with no capture entry', () => {
    const result = resolveTrustedTime(caseDir, hashOf('never-captured'))
    expect(result.trustedTime).toBe('none')
  })

  it('is none for a grandfathered v1 capture entry', () => {
    // Hand-write a legacy v1 line (no signature, schemaVersion 1) — the shape
    // that predates timestamping. It must classify as none, not pending.
    const contentHash = hashOf('legacy-bytes')
    const line =
      JSON.stringify({
        type: 'capture',
        captureId: 'legacy-1',
        caseId: 'case-1',
        url: 'https://old.example.com',
        timestamp: '2025-01-01T00:00:00.000Z',
        contentHash,
        sizeBytes: 10,
        operatorId: 'op-1',
        operatorName: 'Op One',
        toolVersion: '0.1.0',
        index: 0,
        prevHash: '',
        schemaVersion: 1,
        entryHash: 'deadbeef'
      }) + '\n'
    appendFileSync(join(caseDir, 'manifest.jsonl'), line)

    expect(resolveTrustedTime(caseDir, contentHash).trustedTime).toBe('none')
  })

  it('keeps the hash chain valid after appending a timestamp entry', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)
    const token = buildSyntheticToken({
      contentHash,
      genTime: new Date('2026-05-30T09:05:00.000Z')
    })
    appendTimestamp(caseDir, contentHash, token.toString('base64'))

    const chain = verifyManifestChain(caseDir)
    expect(chain.valid).toBe(true)
  })

  it('ignores a timestamp entry whose token imprint does not match the capture', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)
    // Token over a DIFFERENT hash, but the entry claims to reference contentHash.
    const wrongToken = buildSyntheticToken({
      contentHash: hashOf('other-bytes'),
      genTime: new Date('2026-05-30T09:05:00.000Z')
    })
    appendTimestamp(caseDir, contentHash, wrongToken.toString('base64'))

    // A mismatched token is not proof of time for THIS capture → still pending.
    expect(resolveTrustedTime(caseDir, contentHash).trustedTime).toBe('pending')
  })

  it('buildTrustedTimeIndex resolves every capture in one pass', () => {
    const stampedHash = hashOf('idx-stamped')
    const pendingHash = hashOf('idx-pending')
    appendCapture(caseDir, stampedHash)
    appendCapture(caseDir, pendingHash)
    const token = buildSyntheticToken({
      contentHash: stampedHash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(caseDir, stampedHash, token.toString('base64'))

    const index = buildTrustedTimeIndex(caseDir)

    expect(index.get(stampedHash)).toMatchObject({
      trustedTime: 'rfc3161',
      tsaName: 'tsa.example.com'
    })
    expect(index.get(pendingHash)?.trustedTime).toBe('pending')
    expect(index.get(hashOf('absent'))).toBeUndefined()
    // The index must agree with the per-capture resolver it replaces in bulk.
    expect(index.get(stampedHash)?.trustedTime).toBe(
      resolveTrustedTime(caseDir, stampedHash).trustedTime
    )
  })
})
