import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { HAS_OPENSSL } from '../../helpers/openssl'
import {
  initSigningKey,
  initVerifyOnlyKey,
  signEntryHash,
  verifyEntrySignature,
  getPublicKeyPem,
  resetSigningKey,
  isSigningKeyProtected,
  SigningKeyUnacknowledgedError
} from '@main/services/signingKey'

// A representative entryHash: sha256 hex of some canonical body.
const SAMPLE_HASH = 'a'.repeat(64)

// Tests run via ELECTRON_RUN_AS_NODE with no encryption backend and no real
// dialog to show, so every generation-path test must explicitly acknowledge
// (or explicitly decline) rather than relying on the production default,
// which refuses when there is no GUI to ask through.
const ACK = { confirmUnprotectedKey: () => true }
const DECLINE = { confirmUnprotectedKey: () => false }

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
    initSigningKey(dir, ACK)
    const pem = getPublicKeyPem()
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(pem).toContain('-----END PUBLIC KEY-----')
  })

  it('writes the public key to disk in plaintext', () => {
    initSigningKey(dir, ACK)
    const pubPath = join(dir, 'signing-public-key.pem')
    expect(existsSync(pubPath)).toBe(true)
    expect(readFileSync(pubPath, 'utf-8')).toContain('-----BEGIN PUBLIC KEY-----')
  })
})

describe('signingKey: unprotected-key acknowledgement gate (#414)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to generate a key when the operator declines', () => {
    expect(() => initSigningKey(dir, DECLINE)).toThrow(SigningKeyUnacknowledgedError)
    expect(existsSync(join(dir, 'signing-key.pem'))).toBe(false)
    expect(existsSync(join(dir, 'signing-public-key.pem'))).toBe(false)
  })

  it('refuses by default when there is no dialog to ask through', () => {
    // No deps injected: falls through to the production default, which
    // returns false (refuse) outside a real Electron GUI process — the same
    // safeStorage-unavailable environment vitest runs under.
    expect(() => initSigningKey(dir)).toThrow(SigningKeyUnacknowledgedError)
  })

  it('generates the key once acknowledged, and marks it unprotected', () => {
    initSigningKey(dir, ACK)
    expect(getPublicKeyPem()).toContain('-----BEGIN PUBLIC KEY-----')
    expect(isSigningKeyProtected()).toBe('plaintext')
  })

  it('does not ask again once a key already exists on disk', () => {
    initSigningKey(dir, ACK)
    resetSigningKey()
    // A second init reads the existing (already-acknowledged) key back; a
    // deps that always declines must never be consulted on this path.
    initSigningKey(dir, DECLINE)
    expect(getPublicKeyPem()).toContain('-----BEGIN PUBLIC KEY-----')
  })

  it('logs the acknowledged-unprotected event through the injected hook', () => {
    const logEvent = vi.fn()
    initSigningKey(dir, { confirmUnprotectedKey: () => true, logEvent })
    expect(logEvent).toHaveBeenCalledWith('signingKey.unprotected_key_acknowledged')
  })

  it('logs the declined event through the injected hook before throwing', () => {
    const logEvent = vi.fn()
    expect(() => initSigningKey(dir, { confirmUnprotectedKey: () => false, logEvent })).toThrow(
      SigningKeyUnacknowledgedError
    )
    expect(logEvent).toHaveBeenCalledWith('signingKey.generation_declined')
  })

  // TOCTOU: isEncryptionAvailable() reporting true at the gate does not
  // guarantee wrapPrivateKey's own (separate) safeStorage call succeeds a
  // moment later — e.g. a keyring that locks between the two calls. Tests
  // always run with the real safeStorage unavailable, so overriding just the
  // gate check reproduces exactly that disagreement without mocking Electron.
  it('still asks for acknowledgement when wrapping falls back to plaintext despite the gate reporting encryption available', () => {
    const confirmUnprotectedKey = vi.fn(() => true)
    initSigningKey(dir, { confirmUnprotectedKey, isEncryptionAvailable: () => true })
    expect(confirmUnprotectedKey).toHaveBeenCalledTimes(1)
    expect(isSigningKeyProtected()).toBe('plaintext')
  })

  it('refuses and writes nothing when that TOCTOU acknowledgement is declined', () => {
    const confirmUnprotectedKey = vi.fn(() => false)
    expect(() =>
      initSigningKey(dir, { confirmUnprotectedKey, isEncryptionAvailable: () => true })
    ).toThrow(SigningKeyUnacknowledgedError)
    expect(existsSync(join(dir, 'signing-key.pem'))).toBe(false)
    expect(existsSync(join(dir, 'signing-public-key.pem'))).toBe(false)
  })
})

describe('signingKey: sign / verify', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
    initSigningKey(dir, ACK)
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
    initSigningKey(dir, ACK)
    const pub1 = getPublicKeyPem()
    const sig = signEntryHash(SAMPLE_HASH)

    resetSigningKey()
    // No ACK: the key already exists, so the acknowledgement gate must not
    // fire on this path — only on generating a fresh key.
    initSigningKey(dir)

    expect(getPublicKeyPem()).toBe(pub1)
    // Signature made before the "restart" still verifies → same private key reloaded.
    expect(verifyEntrySignature(SAMPLE_HASH, sig)).toBe(true)
  })

  it('persists the private key as plaintext PKCS#8 when safeStorage is unavailable', () => {
    initSigningKey(dir, ACK)
    const keyPath = join(dir, 'signing-key.pem')
    expect(existsSync(keyPath)).toBe(true)
    // Tests run via ELECTRON_RUN_AS_NODE with no encryption backend, so the
    // service falls back to plaintext at-rest (same contract as settings.ts).
    expect(readFileSync(keyPath, 'utf-8')).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('reports the reloaded key as plaintext-protected on a second init', () => {
    initSigningKey(dir, ACK)
    resetSigningKey()
    initSigningKey(dir)
    expect(isSigningKeyProtected()).toBe('plaintext')
  })

  it('fails closed when an existing key cannot be unwrapped', () => {
    // A wrapped (enc:-prefixed) private key alongside a public key, but no OS
    // credential store to decrypt it. Regenerating would silently rotate the
    // installation key, so init must throw instead.
    writeFileSync(join(dir, 'signing-key.pem'), 'enc:' + Buffer.from('opaque').toString('base64'))
    writeFileSync(join(dir, 'signing-public-key.pem'), '-----BEGIN PUBLIC KEY-----\n')

    expect(() => initSigningKey(dir)).toThrow(/refusing to generate a new keypair/)
  })
})

describe('signingKey: openssl interop', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
    initSigningKey(dir, ACK)
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

describe('signingKey: verify-only key (ADR-0036)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-signkey-'))
    resetSigningKey()
    initSigningKey(dir, ACK)
  })

  afterEach(() => {
    resetSigningKey()
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads the public key and verifies, but refuses to sign', () => {
    const sig = signEntryHash(SAMPLE_HASH)
    const pem = getPublicKeyPem()
    resetSigningKey()

    initVerifyOnlyKey(dir)

    expect(getPublicKeyPem()).toBe(pem)
    expect(verifyEntrySignature(SAMPLE_HASH, sig)).toBe(true)
    expect(() => signEntryHash(SAMPLE_HASH)).toThrow('Signing key not initialized')
  })

  it('drops a private key already loaded in the process', () => {
    initVerifyOnlyKey(dir)

    expect(() => signEntryHash(SAMPLE_HASH)).toThrow('Signing key not initialized')
  })
})
