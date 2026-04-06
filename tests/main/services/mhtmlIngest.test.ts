import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { initStorage } from '@main/services/storage'
import { streamWriteAndHash } from '@main/services/mhtmlIngest'

describe('streamWriteAndHash', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-ingest-'))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes stream to disk and returns SHA-256 + size', async () => {
    const content = Buffer.from('hello mhtml world')
    const stream = Readable.from([content])
    const result = await streamWriteAndHash(
      'case-x',
      'cap-x',
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(createHash('sha256').update(content).digest('hex'))
    expect(result.sizeBytes).toBe(content.length)
    expect(result.mhtmlPath).toBe(join('case-x', 'cap-x.mhtml'))

    const onDisk = readFileSync(join(tempDir, 'case-x', 'cap-x.mhtml'))
    expect(onDisk.equals(content)).toBe(true)
  })

  it('aborts and deletes partial file when size cap exceeded', async () => {
    const oneMb = Buffer.alloc(1024 * 1024, 0x41)
    async function* gen() {
      for (let i = 0; i < 210; i++) yield oneMb
    }
    const stream = Readable.from(gen())
    await expect(
      streamWriteAndHash('case-x', 'cap-big', stream as unknown as ReadableStream<Uint8Array>)
    ).rejects.toThrow(/size.*exceed/i)
    expect(existsSync(join(tempDir, 'case-x', 'cap-big.mhtml'))).toBe(false)
  })

  it('hashes large streams in a single pass', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x7a)
    const expected = createHash('sha256')
    async function* gen() {
      for (let i = 0; i < 10; i++) {
        expected.update(chunk)
        yield chunk
      }
    }
    const stream = Readable.from(gen())
    const result = await streamWriteAndHash(
      'case-x',
      'cap-big-ok',
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(expected.digest('hex'))
    expect(result.sizeBytes).toBe(64 * 1024 * 10)
  })
})
