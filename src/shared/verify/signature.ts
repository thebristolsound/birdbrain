import { createVerify } from 'crypto'

// RSA-SHA256 (PKCS#1 v1.5) verification of a manifest entry signature. The
// signature covers the entryHash hex string and is base64-encoded — the same
// claim stock `openssl dgst -sha256 -verify` checks. Pure verify-core: the
// caller supplies the public key PEM; there is no module-global key here.
// Fail-closed: any crypto error (malformed PEM/signature) returns false.
export function verifyEntrySignature(
  entryHashHex: string,
  signatureB64: string,
  publicKeyPem: string
): boolean {
  try {
    return createVerify('sha256').update(entryHashHex).verify(publicKeyPem, signatureB64, 'base64')
  } catch {
    return false
  }
}
