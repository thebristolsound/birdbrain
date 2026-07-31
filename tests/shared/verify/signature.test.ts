import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createSign } from 'crypto'
import { verifyEntrySignature } from '@shared/verify/signature'

// verify-core signature check (#122). RSA-SHA256 PKCS#1 v1.5 over the entryHash
// hex string. These tests hit the genuine-verify path and, critically, the
// fail-closed catch: any malformed PEM/signature must return false, never throw
// — a throw here would abort the whole chain walk on adversarial input.

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const HASH = 'a'.repeat(64)

function sign(hashHex: string): string {
  return createSign('sha256').update(hashHex).sign(privateKey, 'base64')
}

describe('verifyEntrySignature', () => {
  it('verifies a genuine RSA-SHA256 signature over the entryHash hex', () => {
    expect(verifyEntrySignature(HASH, sign(HASH), publicKeyPem)).toBe(true)
  })

  it('rejects a valid signature checked against a different entryHash', () => {
    expect(verifyEntrySignature('b'.repeat(64), sign(HASH), publicKeyPem)).toBe(false)
  })

  it('rejects a signature bit-flipped after signing', () => {
    const tampered = Buffer.from(sign(HASH), 'base64')
    tampered[0] ^= 0xff
    expect(verifyEntrySignature(HASH, tampered.toString('base64'), publicKeyPem)).toBe(false)
  })

  it('rejects a signature made by a different key (wrong signer)', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const foreignSig = createSign('sha256').update(HASH).sign(other.privateKey, 'base64')
    expect(verifyEntrySignature(HASH, foreignSig, publicKeyPem)).toBe(false)
  })

  it('fails closed (returns false, no throw) on a malformed public key PEM', () => {
    expect(verifyEntrySignature(HASH, sign(HASH), 'not a valid pem')).toBe(false)
  })

  it('fails closed on an empty public key PEM', () => {
    expect(verifyEntrySignature(HASH, sign(HASH), '')).toBe(false)
  })

  it('fails closed on a garbage / non-base64 signature', () => {
    expect(verifyEntrySignature(HASH, '@@@ not base64 @@@', publicKeyPem)).toBe(false)
  })

  it('fails closed on an empty signature', () => {
    expect(verifyEntrySignature(HASH, '', publicKeyPem)).toBe(false)
  })
})
