import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { generateKeyPairSync, createSign, createVerify } from 'crypto'

const PRIVATE_KEY_FILENAME = 'signing-key.pem'
const PUBLIC_KEY_FILENAME = 'signing-public-key.pem'

// Wrap the private key at rest with Electron's OS credential store (DPAPI /
// Keychain). Falls back to plaintext when safeStorage is unavailable (e.g.
// tests, headless Linux) — same contract as settings.ts.
let _safeStorage: typeof import('electron').safeStorage | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _safeStorage = require('electron').safeStorage
} catch {
  /* not in Electron context (e.g. tests) */
}

let privateKeyPem: string | null = null
let publicKeyPem: string | null = null

function wrapPrivateKey(pem: string): string {
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return 'enc:' + _safeStorage.encryptString(pem).toString('base64')
    }
  } catch {
    /* encryption not available */
  }
  return pem
}

function unwrapPrivateKey(stored: string): string | null {
  if (!stored.startsWith('enc:')) return stored
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return _safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
  } catch {
    /* decryption not available */
  }
  return null
}

// Load the installation signing keypair, generating + persisting it on first
// run. The public key is stored in plaintext so it can feed `openssl`
// verification and later be bundled into exports.
export function initSigningKey(userDataPath: string): void {
  const privPath = join(userDataPath, PRIVATE_KEY_FILENAME)
  const pubPath = join(userDataPath, PUBLIC_KEY_FILENAME)

  if (existsSync(privPath) && existsSync(pubPath)) {
    const unwrapped = unwrapPrivateKey(readFileSync(privPath, 'utf-8'))
    if (!unwrapped) {
      // Fail closed: the keypair exists but the private key could not be
      // unwrapped (OS credential store unavailable). Regenerating here would
      // silently rotate the installation key and invalidate every previously
      // signed manifest entry — refuse instead.
      throw new Error(
        `Failed to unwrap installation signing key at ${privPath} ` +
          `(public key: ${pubPath}). The OS credential store may be ` +
          `unavailable; refusing to generate a new keypair to avoid silently ` +
          `rotating the installation signing key.`
      )
    }
    privateKeyPem = unwrapped
    publicKeyPem = readFileSync(pubPath, 'utf-8')
    return
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  privateKeyPem = privateKey
  publicKeyPem = publicKey
  writeFileSync(privPath, wrapPrivateKey(privateKey), 'utf-8')
  writeFileSync(pubPath, publicKey, 'utf-8')
}

// RSA-SHA256 (PKCS#1 v1.5) signature over the entryHash hex string, base64.
// Verifiable by stock `openssl dgst -sha256 -verify`.
export function signEntryHash(entryHashHex: string): string {
  if (!privateKeyPem) throw new Error('Signing key not initialized')
  return createSign('sha256').update(entryHashHex).sign(privateKeyPem, 'base64')
}

export function verifyEntrySignature(
  entryHashHex: string,
  signatureB64: string,
  publicKeyOverridePem?: string
): boolean {
  const pem = publicKeyOverridePem ?? publicKeyPem
  if (!pem) throw new Error('Signing key not initialized')
  try {
    return createVerify('sha256').update(entryHashHex).verify(pem, signatureB64, 'base64')
  } catch {
    return false
  }
}

export function getPublicKeyPem(): string {
  if (!publicKeyPem) throw new Error('Signing key not initialized')
  return publicKeyPem
}

// For testing - clears cached module state between test cases.
export function resetSigningKey(): void {
  privateKeyPem = null
  publicKeyPem = null
}
