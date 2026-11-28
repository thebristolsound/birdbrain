import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createStoredZip, writeStoredZip, type ZipEntrySource } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import { seededBytes } from '../../helpers/seededBytes'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

// The known answer's bytes, as they were when the answer was taken. They repeat every 65,536
// bytes, the chunk size below, so the chunked tests use seededBytes instead.
function counterBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >>> 8)) & 0xff
  return bytes
}

const KNOWN_ENTRIES = () => [
  { name: 'export-entry.json', data: '{"type":"export"}\n' },
  { name: 'pages\\cap-1.mhtml', data: counterBytes(300_000) },
  { name: 'empty.txt', data: Buffer.alloc(0) },
  { name: 'notes/é.md', data: '# Notes — é\n' }
]

const CHUNK = 64 * 1024

/**
 * `bytes` as a source that hands out one reused buffer per chunk, as a file read from disk
 * does, and calls `onPull` before each chunk after the first with the bytes handed out so far.
 */
function chunkedSource(bytes: Buffer, onPull: (handedOut: number) => void = () => {}) {
  return {
    sizeBytes: bytes.length,
    *chunks() {
      const reused = Buffer.alloc(CHUNK)
      for (let at = 0; at < bytes.length; at += CHUNK) {
        if (at > 0) onPull(at)
        const length = bytes.copy(reused, 0, at, Math.min(at + CHUNK, bytes.length))
        yield reused.subarray(0, length)
      }
    }
  } satisfies ZipEntrySource
}

describe('stored zip', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-zip-'))
    vi.useFakeTimers({ toFake: ['Date'] })
    // Local time, as the DOS timestamps are, so the answer holds in any time zone.
    vi.setSystemTime(new Date(2026, 10, 28, 13, 45, 30))
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  // The answer was taken from createStoredZip as it stood before writeStoredZip existed
  // (#932), so it pins the layout both writers now share.
  it('writes the known bytes for a fixed set of entries and clock', () => {
    const zip = createStoredZip(KNOWN_ENTRIES())
    expect({ size: zip.length, sha256: sha256(zip) }).toEqual({
      size: 300467,
      sha256: '704fdad4ef7c0f1fa98b40ddca7450d60f9995d37327a19f0ee05df01d6eb6e2'
    })
  })

  it('uses chunked test bytes that differ from one chunk to the next', () => {
    const large = seededBytes(4 * CHUNK)
    const chunks = [0, 1, 2, 3].map((n) =>
      large.subarray(n * CHUNK, (n + 1) * CHUNK).toString('hex')
    )
    expect(new Set(chunks).size).toBe(4)
  })

  it('writes to disk the bytes it builds in memory, a chunked entry included', () => {
    // Over 50 chunks of one reused buffer, ending on a partial chunk.
    const large = seededBytes(50 * CHUNK + 12_345)
    const entries = [...KNOWN_ENTRIES(), { name: 'pages/large.mhtml', data: large }]
    const out = join(dir, 'out.zip')

    writeStoredZip(out, [
      ...KNOWN_ENTRIES(),
      { name: 'pages/large.mhtml', data: chunkedSource(large) }
    ])

    const written = readFileSync(out)
    expect(written.equals(createStoredZip(entries))).toBe(true)
    expect(readStoredZip(written).get('pages/large.mhtml')?.equals(large)).toBe(true)
  })

  it('builds the same bytes in memory from a chunked entry as from a buffer', () => {
    const large = seededBytes(3 * CHUNK + 7)
    const zip = createStoredZip([{ name: 'a.bin', data: chunkedSource(large) }])

    expect(readStoredZip(zip).get('a.bin')?.equals(large)).toBe(true)
    expect(zip.equals(createStoredZip([{ name: 'a.bin', data: large }]))).toBe(true)
  })

  it('writes each chunk to disk before it asks for the next', () => {
    const large = seededBytes(20 * CHUNK)
    const header = 30 + 'pages/large.mhtml'.length
    const onDisk: number[] = []
    writeStoredZip(join(dir, 'out.zip'), [
      {
        name: 'pages/large.mhtml',
        data: chunkedSource(large, (handedOut) => {
          const [partial] = readdirSync(dir).filter((name) => name.endsWith('.partial'))
          onDisk.push(statSync(join(dir, partial)).size - header - handedOut)
        })
      }
    ])

    // Every byte handed out was on disk when the next chunk was asked for.
    expect(onDisk).toHaveLength(19)
    expect(onDisk.every((behind) => behind === 0)).toBe(true)
  })

  it('leaves nothing at the output path, and no temporary file, when a read fails', () => {
    const out = join(dir, 'out.zip')
    const failing: ZipEntrySource = {
      sizeBytes: 3 * CHUNK,
      *chunks() {
        yield Buffer.alloc(CHUNK)
        throw new Error('EIO: read failed')
      }
    }

    expect(() =>
      writeStoredZip(out, [
        { name: 'a.txt', data: 'a' },
        { name: 'b.bin', data: failing }
      ])
    ).toThrow('EIO: read failed')
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports the read error when the temporary file cannot be removed either', () => {
    const out = join(dir, 'out.zip')
    let partial = ''
    const failing: ZipEntrySource = {
      sizeBytes: 3 * CHUNK,
      *chunks() {
        yield Buffer.alloc(CHUNK)
        // A directory where the temporary file was, which removing a file refuses.
        partial = join(
          dir,
          readdirSync(dir).find((name) => name.endsWith('.partial'))!
        )
        unlinkSync(partial)
        mkdirSync(partial)
        throw new Error('EIO: read failed')
      }
    }

    expect(() => writeStoredZip(out, [{ name: 'b.bin', data: failing }])).toThrow(
      'EIO: read failed'
    )
    expect(() => rmSync(partial, { force: true })).toThrow()
  })

  it('leaves a file already at the output path as it was when the write fails', () => {
    const out = join(dir, 'out.zip')
    writeFileSync(out, 'an earlier export')
    const short: ZipEntrySource = { sizeBytes: 10, chunks: () => [Buffer.from('four')] }

    expect(() => writeStoredZip(out, [{ name: 'short.bin', data: short }])).toThrow(
      'zip: short.bin read 4 bytes, 10 expected'
    )
    expect(readdirSync(dir)).toEqual(['out.zip'])
    expect(readFileSync(out, 'utf-8')).toBe('an earlier export')
  })

  it('refuses an entry that reads more bytes than it declared', () => {
    const long: ZipEntrySource = { sizeBytes: 2, chunks: () => [Buffer.from('three')] }
    expect(() => createStoredZip([{ name: 'long.bin', data: long }])).toThrow(
      'zip: long.bin read 5 bytes, 2 expected'
    )
  })

  it('replaces a file already at the output path when the write succeeds', () => {
    const out = join(dir, 'out.zip')
    writeFileSync(out, 'an earlier export')

    writeStoredZip(out, KNOWN_ENTRIES())

    expect(readFileSync(out).equals(createStoredZip(KNOWN_ENTRIES()))).toBe(true)
    expect(readdirSync(dir)).toEqual(['out.zip'])
  })
})
