import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'
import {
  resolveTrustedTime,
  buildTrustedTimeIndex,
  reconcileCaptureTrustedTime,
  reconcileAllMirrors
} from '@main/services/trustedTime'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
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

describe('reconcileCaptureTrustedTime / reconcileAllMirrors (DB mirror reconciliation)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-tt-reconcile-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function seedMhtmlCapture(caseId: string, content: string): { id: string; hash: string } {
    const hash = hashOf(content)
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/' + hash.slice(0, 8),
      title: content,
      hash,
      timestamp: '2026-05-30T09:00:00.000Z',
      format: 'mhtml'
    })
    return { id: cap.id, hash }
  }

  function caseWithManifest(name: string): { caseId: string; caseDir: string } {
    const caseId = createCase({ name }).id
    const caseDir = join(getStorageRoot(), caseId)
    ensureCaseDir(caseId)
    initManifest(caseDir)
    return { caseId, caseDir }
  }

  it('self-heals a stale pending mirror to rfc3161 once a stamp lands, returning the result', () => {
    const { caseId, caseDir } = caseWithManifest('Case A')
    const { id, hash } = seedMhtmlCapture(caseId, 'reconcile-stamped')
    appendCapture(caseDir, hash)
    setCaptureTrustedTime(id, 'pending') // mirror behind reality

    const token = buildSyntheticToken({
      contentHash: hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(caseDir, hash, token.toString('base64'))

    const result = reconcileCaptureTrustedTime({ id, caseId, hash })

    expect(result).toMatchObject({ trustedTime: 'rfc3161', tsaName: 'tsa.example.com' })
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it('writes pending to the mirror for an eligible capture with no timestamp yet', () => {
    const { caseId, caseDir } = caseWithManifest('Case B')
    const { id, hash } = seedMhtmlCapture(caseId, 'reconcile-pending')
    appendCapture(caseDir, hash)
    setCaptureTrustedTime(id, 'none') // wrong/stale

    const result = reconcileCaptureTrustedTime({ id, caseId, hash })

    expect(result.trustedTime).toBe('pending')
    expect(getCapture(id)?.trustedTimeStatus).toBe('pending')
  })

  it('reconcileAllMirrors repaints every mhtml capture across cases from the manifest', () => {
    const a = caseWithManifest('A')
    const b = caseWithManifest('B')

    const stamped = seedMhtmlCapture(a.caseId, 'all-stamped')
    const pending = seedMhtmlCapture(a.caseId, 'all-pending')
    const orphan = seedMhtmlCapture(b.caseId, 'all-orphan') // no manifest entry → none
    appendCapture(a.caseDir, stamped.hash)
    appendCapture(a.caseDir, pending.hash)
    const token = buildSyntheticToken({
      contentHash: stamped.hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(a.caseDir, stamped.hash, token.toString('base64'))

    // Corrupt every mirror so the rebuild has to repaint from the manifest.
    for (const id of [stamped.id, pending.id, orphan.id]) setCaptureTrustedTime(id, 'rfc3161')

    reconcileAllMirrors()

    expect(getCapture(stamped.id)?.trustedTimeStatus).toBe('rfc3161')
    expect(getCapture(pending.id)?.trustedTimeStatus).toBe('pending')
    expect(getCapture(orphan.id)?.trustedTimeStatus).toBe('none')
  })

  it('reconcileAllMirrors leaves non-mhtml captures untouched', () => {
    const { caseId } = caseWithManifest('C')
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/html',
      title: 'html cap',
      hash: hashOf('html-bytes'),
      timestamp: '2026-05-30T09:00:00.000Z',
      format: 'html'
    })
    setCaptureTrustedTime(cap.id, 'pending')

    reconcileAllMirrors()

    expect(getCapture(cap.id)?.trustedTimeStatus).toBe('pending')
  })
})
