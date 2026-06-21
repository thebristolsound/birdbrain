import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { HAS_OPENSSL } from '../../helpers/openssl'
import {
  initSigningKey,
  signEntryHash,
  verifyEntrySignature,
  getPublicKeyPem,
  resetSigningKey
} from '@main/services/signingKey'

// A representative entryHash: sha256 hex of some canonical body.
const SAMPLE_HASH = 'a'.repeat(64)

describe('signingKey: keypair generation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates an RSA public key PEM on first init', () => {
    initSigningKey(dir)
    const pem = getPublicKeyPem()
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(pem).toContain('-----END PUBLIC KEY-----')
  })

  it('writes the public key to disk in plaintext', () => {
    initSigningKey(dir)
    const pubPath = join(dir, 'signing-public-key.pem')
    expect(existsSync(pubPath)).toBe(true)
    expect(readFileSync(pubPath, 'utf-8')).toContain('-----BEGIN PUBLIC KEY-----')
  })
})

describe('signingKey: sign / verify', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
    initSigningKey(dir)
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it('produces a base64 signature that verifies against the same hash', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    expect(typeof sig).toBe('string')
    expect(sig.length).toBeGreaterThan(0)
    expect(verifyEntrySignature(SAMPLE_HASH, sig)).toBe(true)
  })

  it('rejects a signature checked against a different hash', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    expect(verifyEntrySignature('b'.repeat(64), sig)).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    const tampered = Buffer.from(sig, 'base64')
    tampered[0] ^= 0xff
    expect(verifyEntrySignature(SAMPLE_HASH, tampered.toString('base64'))).toBe(false)
  })

  it('verifies against an explicitly supplied public key PEM', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    const pem = getPublicKeyPem()
    expect(verifyEntrySignature(SAMPLE_HASH, sig, pem)).toBe(true)
  })
})

describe('signingKey: persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reuses the existing keypair across a second init (survives restart)', () => {
    initSigningKey(dir)
    const pub1 = getPublicKeyPem()
    const sig = signEntryHash(SAMPLE_HASH)

    resetSigningKey()
    initSigningKey(dir)

    expect(getPublicKeyPem()).toBe(pub1)
    // Signature made before the "restart" still verifies → same private key reloaded.
    expect(verifyEntrySignature(SAMPLE_HASH, sig)).toBe(true)
  })

  it('persists the private key as plaintext PKCS#8 when safeStorage is unavailable', () => {
    initSigningKey(dir)
    const keyPath = join(dir, 'signing-key.pem')
    expect(existsSync(keyPath)).toBe(true)
    // Tests run via ELECTRON_RUN_AS_NODE with no encryption backend, so the
    // service falls back to plaintext at-rest (same contract as settings.ts).
    expect(readFileSync(keyPath, 'utf-8')).toContain('-----BEGIN PRIVATE KEY-----')
  })
})

describe('signingKey: openssl interop', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
    initSigningKey(dir)
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(!HAS_OPENSSL)('signature verifies under stock `openssl dgst -sha256 -verify`', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    const pubPath = join(dir, 'signing-public-key.pem')
    const hashPath = join(dir, 'entryhash.txt')
    const sigPath = join(dir, 'sig.bin')
    writeFileSync(hashPath, SAMPLE_HASH) // exact signed bytes, no trailing newline
    writeFileSync(sigPath, Buffer.from(sig, 'base64'))

    const out = execFileSync(
      'openssl',
      ['dgst', '-sha256', '-verify', pubPath, '-signature', sigPath, hashPath],
      { encoding: 'utf-8' }
    )
    expect(out).toContain('Verified OK')
  })
})
