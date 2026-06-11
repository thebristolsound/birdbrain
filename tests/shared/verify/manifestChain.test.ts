import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { verifyManifestChainText } from '@shared/verify'
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
      trustedTime: 'none'
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
      trustedTime: 'none'
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
      trustedTime: 'none'
    })
    expect(core).toEqual(app)
  })

  it('agree on an empty manifest', () => {
    writeFileSync(manifestPath, '', 'utf-8')
    expect(verifyManifestChain(caseDir)).toEqual({ valid: true, trustedTime: 'none' })
    expect(verifyManifestChainText('', { publicKeyPem: getPublicKeyPem() })).toEqual({
      valid: true,
      trustedTime: 'none'
    })
  })
})
