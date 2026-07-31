import { describe, it, expect } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { verifyManifestChainText, canonicalStringify } from '@shared/verify'

function keypair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
}

function makeEntry(
  body: Record<string, unknown>,
  index: number,
  prevHash: string,
  privateKeyPem: string
): { line: string; entryHash: string } {
  const full = { ...body, index, prevHash, schemaVersion: 2 }
  const canonical = canonicalStringify(full)
  const entryHash = createHash('sha256').update(canonical).digest('hex')
  const signature = createSign('sha256').update(entryHash).sign(privateKeyPem, 'base64')
  return { line: JSON.stringify({ ...full, entryHash, signature }), entryHash }
}

const captureBody = (n: number) => ({
  type: 'capture',
  captureId: `cap-${n}`,
  caseId: 'case-src',
  url: 'https://example.com',
  timestamp: '2026-07-03T00:00:00.000Z',
  contentHash: 'f'.repeat(64),
  sizeBytes: 10,
  operatorId: 'inst-a',
  operatorName: 'Alice',
  toolVersion: '1.0.0'
})

const importBody = (sourcePem: string) => ({
  type: 'import',
  caseId: 'case-dst',
  sourceCaseId: 'case-src',
  sourceInstallationId: 'inst-a',
  sourcePublicKeyPem: sourcePem,
  packageHash: 'a'.repeat(64),
  idMapSha256: 'b'.repeat(64),
  verificationResult: {
    overallValid: true,
    chainValid: true,
    artifactCount: 1,
    artifactFailureCount: 0,
    captureCount: 1,
    captureHashFailureCount: 0
  },
  timestamp: '2026-07-03T01:00:00.000Z',
  operatorId: 'inst-b',
  operatorName: 'Bob',
  toolVersion: '1.0.0'
})

describe('multi-signer manifest chains', () => {
  it('verifies a single-hop imported chain', () => {
    const a = keypair()
    const b = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', a.privateKey)
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const jsonl = [e0.line, e1.line].join('\n')
    expect(verifyManifestChainText(jsonl, { publicKeyPem: b.publicKey }).valid).toBe(true)
  })

  it('rejects a source segment not signed by the embedded source key', () => {
    const a = keypair()
    const b = keypair()
    const mallory = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', mallory.privateKey) // wrong signer
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const result = verifyManifestChainText([e0.line, e1.line].join('\n'), {
      publicKeyPem: b.publicKey
    })
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
  })

  it('verifies a two-hop A→B→C chain and entries appended after import', () => {
    const a = keypair()
    const b = keypair()
    const c = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', a.privateKey)
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const e2 = makeEntry({ ...captureBody(1), caseId: 'case-dst' }, 2, e1.entryHash, b.privateKey)
    const e3 = makeEntry(
      { ...importBody(b.publicKey), sourceCaseId: 'case-dst', caseId: 'case-dst2' },
      3,
      e2.entryHash,
      c.privateKey
    )
    const e4 = makeEntry({ ...captureBody(2), caseId: 'case-dst2' }, 4, e3.entryHash, c.privateKey)
    const jsonl = [e0, e1, e2, e3, e4].map((e) => e.line).join('\n')
    expect(verifyManifestChainText(jsonl, { publicKeyPem: c.publicKey }).valid).toBe(true)
    // and with the WRONG local key the tail segment fails
    expect(verifyManifestChainText(jsonl, { publicKeyPem: b.publicKey }).valid).toBe(false)
  })
})
