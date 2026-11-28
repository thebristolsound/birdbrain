import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PACKAGE_FILE_CHUNK_BYTES, readPackageFile } from '@main/services/packageFile'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

function counterBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + (i >>> 10)) & 0xff
  return bytes
}

describe('readPackageFile', () => {
  let dir: string
  let path: string
  const bytes = counterBytes(3 * PACKAGE_FILE_CHUNK_BYTES + 1234)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-package-file-'))
    path = join(dir, 'page.mhtml')
    writeFileSync(path, bytes)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('states the hash and size of the bytes on disk', () => {
    const file = readPackageFile(path)
    expect({ sha256: file.sha256, sizeBytes: file.sizeBytes }).toEqual({
      sha256: sha256(bytes),
      sizeBytes: bytes.length
    })
  })

  it('reads the bytes again in order, no chunk larger than the chunk size', () => {
    const file = readPackageFile(path)
    const sizes: number[] = []
    const copies: Buffer[] = []
    for (const chunk of file.chunks()) {
      sizes.push(chunk.length)
      copies.push(Buffer.from(chunk))
    }

    expect(sizes).toEqual([
      PACKAGE_FILE_CHUNK_BYTES,
      PACKAGE_FILE_CHUNK_BYTES,
      PACKAGE_FILE_CHUNK_BYTES,
      1234
    ])
    expect(Buffer.concat(copies).equals(bytes)).toBe(true)
    expect(file.bytes().equals(bytes)).toBe(true)
  })

  it('refuses bytes changed in place after the first read', () => {
    const file = readPackageFile(path)
    const changed = Buffer.from(bytes)
    changed[PACKAGE_FILE_CHUNK_BYTES + 5] ^= 0xff
    writeFileSync(path, changed)
    const message = `${path} changed on disk after the export first read it; no package was written.`

    expect(() => [...file.chunks()]).toThrow(message)
    expect(() => file.bytes()).toThrow(message)
  })

  it('refuses a file that grew after the first read', () => {
    const file = readPackageFile(path)
    appendFileSync(path, 'more')

    expect(() => [...file.chunks()]).toThrow(/changed on disk after the export first read it/)
  })

  it('throws when the file cannot be read', () => {
    expect(() => readPackageFile(join(dir, 'absent.mhtml'))).toThrow(/ENOENT/)
  })
})
