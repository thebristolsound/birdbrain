import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { verifyManifestChainText, canonicalStringify } from '@shared/verify'
import { MANIFEST_FILENAME } from '@shared/constants'

// PR1 guard (#122): the app's verifyManifestChain(caseDir) is a thin fs
// wrapper over the shared core's verifyManifestChainText. These tests pin the
// agreement on the SAME fixture chain — valid and tampered — so any future
// divergence between the app path and the core (the drift the extraction
// exists to prevent) fails loudly.

function makeCaptureEntry(n: number) {
  return {
    type: 'capture' as const,
    captureId: `cap-${n}`,
    caseId: 'case-1',
    url: `https://example.com/${n}`,
    timestamp: '2026-06-01T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1000 + n,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0'
  }
}

describe('verifyManifestChain (app) vs verifyManifestChainText (core)', () => {
  let caseDir: string
  let manifestPath: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-verify-core-'))
    manifestPath = join(caseDir, MANIFEST_FILENAME)
    initManifest(caseDir)
    appendManifestEntry(caseDir, makeCaptureEntry(0))
    appendManifestEntry(caseDir, makeCaptureEntry(1))
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: 'cap-0',
      caseId: 'case-1',
      timestamp: '2026-06-01T13:00:00.000Z',
      contentHash: 'a'.repeat(64),
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      reason: 'duplicate'
    })
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId: 'case-1',
      captureContentHash: 'a'.repeat(64),
      timestamp: '2026-06-01T14:00:00.000Z',
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0'
    })
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  function coreResult() {
    return verifyManifestChainText(readFileSync(manifestPath, 'utf-8'), {
      publicKeyPem: getPublicKeyPem()
    })
  }

  it('agree on a valid mixed-entry chain', () => {
    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app.valid).toBe(true)
    expect(core).toEqual(app)
  })

  it('resolves the real trusted-time axis (no hardcoded none)', () => {
    // The fixture's surviving capture (cap-1) is a v2 capture with a timestamp
    // entry that carries NO tsaToken → eligible-but-unstamped → pending.
    const core = coreResult()
    expect(core.valid).toBe(true)
    expect(core.trustedTimes.get('a'.repeat(64))?.trustedTime).toBe('pending')
    // The app wrapper resolves the same axis from the same bytes.
    expect(verifyManifestChain(caseDir).trustedTimes.get('a'.repeat(64))?.trustedTime).toBe(
      'pending'
    )
  })

  it('agree on a tampered entry body (Entry hash mismatch)', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    lines[1] = lines[1].replace('https://example.com/1', 'https://evil.example.com/1')
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 1,
      reason: 'Entry hash mismatch',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on a stripped v2 signature (Invalid signature)', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    const entry = JSON.parse(lines[2]) as Record<string, unknown>
    delete entry.signature
    lines[2] = JSON.stringify(entry)
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 2,
      reason: 'Invalid signature',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on a broken chain link', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    const entry = JSON.parse(lines[3]) as Record<string, unknown>
    entry.prevHash = 'f'.repeat(64)
    lines[3] = JSON.stringify(entry)
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 3,
      reason: 'Chain link broken',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on an empty manifest', () => {
    writeFileSync(manifestPath, '', 'utf-8')
    expect(verifyManifestChain(caseDir)).toEqual({
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map()
    })
    expect(verifyManifestChainText('', { publicKeyPem: getPublicKeyPem() })).toEqual({
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map()
    })
  })

  it('exposes each verified capture entry hash keyed by its manifest index', () => {
    const core = coreResult()
    expect(core.valid).toBe(true)
    // The fixture appends captures at index 0 and 1 (deletion at 2, timestamp at 3).
    expect(core.captureHashesByIndex.get(0)).toBe('a'.repeat(64))
    expect(core.captureHashesByIndex.get(1)).toBe('a'.repeat(64))
    expect(core.captureHashesByIndex.has(2)).toBe(false)
    expect(core.captureHashesByIndex.has(3)).toBe(false)
  })

  // #X-1: a signature-free v1 entry that FOLLOWS a signed v2 entry is a
  // downgrade forgery — its hash links recompute without any private key, so
  // without the guard the tampered chain would re-verify as valid.
  it('rejects a v1 entry that follows a v2 entry (schema downgrade)', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n').filter((l) => l.trim())
    const entry = JSON.parse(lines[1]) as Record<string, unknown>
    // Forge a legitimate-looking v1 entry: drop the signature, downgrade the
    // version, and recompute the entryHash over the canonical body (excluding
    // entryHash + signature, exactly as the verifier does). prevHash is
    // unchanged and entry 1 is last among the two captures we rewrite, so links
    // stay intact — the ONLY thing wrong is the downgrade.
    delete entry.signature
    entry.schemaVersion = 1
    const { entryHash: _oldHash, ...body } = entry
    void _oldHash
    entry.entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    lines[1] = JSON.stringify(entry)
    // Truncate to just the two capture entries so the rewritten v1 entry is the
    // tail (the deletion/timestamp entries linked off the old entryHash).
    writeFileSync(manifestPath, lines.slice(0, 2).join('\n') + '\n', 'utf-8')

    const result = verifyManifestChainText(readFileSync(manifestPath, 'utf-8'), {
      publicKeyPem: getPublicKeyPem()
    })
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Schema version downgrade')
  })
})
