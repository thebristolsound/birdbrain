import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { irohBinding } from '@main/services/sharing/irohTransport'
import {
  NODE_KEY_BYTES,
  NODE_KEY_FILENAME,
  NodeKeyUnreadableError,
  loadOrCreateNodeKey,
  type KeyCipher
} from '@main/services/sharing/nodeKey'

// The transport's node key (#1809): one per installation, kept across
// restarts so the node id every roster records stays this installation's.

// A credential store that reverses the text, standing in for safeStorage.
const reversing: KeyCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...plain].reverse().join('')),
  decryptString: (encrypted) => [...encrypted.toString()].reverse().join('')
}

describe('node key (#1809)', () => {
  let root: string
  let dir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bb-node-key-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const fresh = (name: string): string => mkdtempSync(join(root, `${name}-`))

  it('writes a 32-byte key once and reads the same key back', () => {
    dir = fresh('a')
    const first = loadOrCreateNodeKey(dir, null)
    expect(first).toHaveLength(NODE_KEY_BYTES)
    expect(Buffer.from(loadOrCreateNodeKey(dir, null))).toEqual(Buffer.from(first))
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, NODE_KEY_FILENAME)).mode & 0o777).toBe(0o600)
    }
  })

  it('makes a different key in a fresh user-data directory', () => {
    const a = loadOrCreateNodeKey(fresh('a'), null)
    const b = loadOrCreateNodeKey(fresh('b'), null)
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b))
  })

  it('gives the same node id across restarts and a different one in a fresh directory', () => {
    const binding = irohBinding()
    if (binding === null) return
    const idOf = (key: Uint8Array): string =>
      binding.SecretKey.fromBytes(Array.from(key)).public().toString()
    dir = fresh('a')
    const id = idOf(loadOrCreateNodeKey(dir, null))
    expect(idOf(loadOrCreateNodeKey(dir, null))).toBe(id)
    expect(idOf(loadOrCreateNodeKey(fresh('b'), null))).not.toBe(id)
  })

  it('wraps the key with the credential store when one is available', () => {
    dir = fresh('a')
    const key = loadOrCreateNodeKey(dir, reversing)
    const stored = readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8')
    expect(stored.startsWith('enc:')).toBe(true)
    expect(stored).not.toContain(Buffer.from(key).toString('base64'))
    expect(Buffer.from(loadOrCreateNodeKey(dir, reversing))).toEqual(Buffer.from(key))
  })

  it('stores the key unwrapped when no credential store is available', () => {
    dir = fresh('a')
    const unavailable: KeyCipher = { ...reversing, isEncryptionAvailable: () => false }
    const key = loadOrCreateNodeKey(dir, unavailable)
    expect(readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8')).toBe(
      Buffer.from(key).toString('base64')
    )
  })

  it('never replaces a wrapped key it cannot unwrap', () => {
    dir = fresh('a')
    loadOrCreateNodeKey(dir, reversing)
    const before = readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8')
    expect(() => loadOrCreateNodeKey(dir, null)).toThrow(NodeKeyUnreadableError)
    const refusing: KeyCipher = {
      ...reversing,
      decryptString: () => {
        throw new Error('keychain locked')
      }
    }
    expect(() => loadOrCreateNodeKey(dir, refusing)).toThrow('keychain locked')
    expect(readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8')).toBe(before)
  })

  it('refuses a key file that does not hold 32 bytes of base64', () => {
    dir = fresh('a')
    for (const text of ['', 'AAAA', 'not base64 at all!', Buffer.alloc(33).toString('base64')]) {
      writeFileSync(join(dir, NODE_KEY_FILENAME), text)
      expect(() => loadOrCreateNodeKey(dir, null)).toThrow(NodeKeyUnreadableError)
    }
  })

  it('stores the key unwrapped when the credential store refuses to wrap it', () => {
    const dir = fresh('a')
    const refusing: KeyCipher = {
      ...reversing,
      encryptString: () => {
        throw new Error('keychain locked')
      }
    }
    const key = loadOrCreateNodeKey(dir, refusing)
    expect(readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8')).toBe(
      Buffer.from(key).toString('base64')
    )
  })

  it('wraps a key stored unwrapped once a credential store is available', () => {
    const dir = fresh('a')
    const key = loadOrCreateNodeKey(dir, null)
    expect(Buffer.from(loadOrCreateNodeKey(dir, reversing))).toEqual(Buffer.from(key))
    expect(readFileSync(join(dir, NODE_KEY_FILENAME), 'utf-8').startsWith('enc:')).toBe(true)
    expect(Buffer.from(loadOrCreateNodeKey(dir, reversing))).toEqual(Buffer.from(key))
  })

  it('leaves no partial file beside the key', () => {
    const dir = fresh('a')
    loadOrCreateNodeKey(dir, null)
    expect(readdirSync(dir)).toEqual([NODE_KEY_FILENAME])
  })
})
