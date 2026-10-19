import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// The transport's node key (#1809, the collaborative cases design's open
// question 1). The node id a peer dials is the public half of this key, and
// the Owner's `member-add` records it, so the key must survive restarts: a
// new key would leave every roster naming a node this installation no longer
// is. It sits in its own file beside the signing key and is wrapped with the
// operating system's credential store the way signingKey.ts wraps that key.
// It signs no entry, so an unprotected one needs no acknowledgement.

export const NODE_KEY_FILENAME = 'sharing-node-key'
export const NODE_KEY_BYTES = 32

// Electron's safeStorage, or the part of it this module uses. Passed in, not
// required here, so a test can stand in for the credential store.
export interface KeyCipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

// A key file that is present but cannot be turned back into a key. Never
// replaced by a fresh key: that would change the node id behind every roster.
export class NodeKeyUnreadableError extends Error {
  constructor(path: string, reason: string) {
    super(`${path} holds no usable node key: ${reason}`)
    this.name = 'NodeKeyUnreadableError'
  }
}

function wrap(key: Buffer, cipher: KeyCipher | null): string {
  const plain = key.toString('base64')
  if (cipher?.isEncryptionAvailable()) {
    return 'enc:' + cipher.encryptString(plain).toString('base64')
  }
  return plain
}

function unwrap(stored: string, cipher: KeyCipher | null, path: string): Buffer {
  let plain = stored.trim()
  if (plain.startsWith('enc:')) {
    if (!cipher?.isEncryptionAvailable()) {
      throw new NodeKeyUnreadableError(path, 'the credential store that wrapped it is unavailable')
    }
    try {
      plain = cipher.decryptString(Buffer.from(plain.slice(4), 'base64'))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new NodeKeyUnreadableError(path, `the credential store refused it (${reason})`)
    }
  }
  const key = Buffer.from(plain, 'base64')
  if (key.length !== NODE_KEY_BYTES || key.toString('base64') !== plain) {
    throw new NodeKeyUnreadableError(path, `expected ${NODE_KEY_BYTES} bytes in base64`)
  }
  return key
}

// The stored key, or a new one written first. Any 32 random bytes are an
// ed25519 secret key, so the key is made here and not by the binding.
export function loadOrCreateNodeKey(userDataDir: string, cipher: KeyCipher | null): Uint8Array {
  const path = join(userDataDir, NODE_KEY_FILENAME)
  if (existsSync(path)) return unwrap(readFileSync(path, 'utf-8'), cipher, path)
  const key = randomBytes(NODE_KEY_BYTES)
  writeFileSync(path, wrap(key, cipher), { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
  return key
}
