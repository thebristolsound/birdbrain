import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  createWriteStream
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { Readable, Writable } from 'stream'
import { createCaptureStore, parseArtifactFilename } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'

// Wrap createWriteStream so a single test can substitute a failing stream;
// everything else in 'fs' stays real.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, createWriteStream: vi.fn(actual.createWriteStream) }
})

// The store is created with an injected root getter — no initStorage — proving
// the storage-root seam is injectable (#142 AC#6).
describe('captureStore', () => {
  let tempDir: string
  let store: CaptureStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-store-'))
    store = createCaptureStore({ getRoot: () => tempDir })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('path resolution', () => {
    it('returns rel/abs pairs matching the on-disk layout for every artifact type', () => {
      for (const type of ['mhtml', 'html', 'png', 'txt'] as const) {
        const paths = store.artifactPaths('case-1', 'cap-1', type)
        expect(paths.rel).toBe(join('case-1', `cap-1.${type}`))
        expect(paths.abs).toBe(join(tempDir, 'case-1', `cap-1.${type}`))
      }
    })

    it('returns thumbnail paths with the _thumb.jpg suffix', () => {
      const paths = store.thumbnailPaths('case-1', 'cap-1')
      expect(paths.rel).toBe(join('case-1', 'cap-1_thumb.jpg'))
      expect(paths.abs).toBe(join(tempDir, 'case-1', 'cap-1_thumb.jpg'))
    })

    it('resolves a DB-row relative path to an absolute path', () => {
      expect(store.resolveAbsolute(join('case-1', 'cap-1.mhtml'))).toBe(
        join(tempDir, 'case-1', 'cap-1.mhtml')
      )
    })

    it('returns the absolute case directory', () => {
      expect(store.caseDir('case-1')).toBe(join(tempDir, 'case-1'))
    })
  })

  describe('writeMhtmlStream', () => {
    it('writes stream to disk and returns SHA-256 + size', async () => {
      const content = Buffer.from('hello mhtml world')
      const stream = Readable.from([content])
      const result = await store.writeMhtmlStream(
        'case-x',
        'cap-x',
        stream as unknown as ReadableStream<Uint8Array>
      )
      expect(result.hash).toBe(createHash('sha256').update(content).digest('hex'))
      expect(result.sizeBytes).toBe(content.length)
      expect(result.rel).toBe(join('case-x', 'cap-x.mhtml'))
      expect(result.abs).toBe(join(tempDir, 'case-x', 'cap-x.mhtml'))

      const onDisk = readFileSync(join(tempDir, 'case-x', 'cap-x.mhtml'))
      expect(onDisk.equals(content)).toBe(true)
    })

    it('aborts and deletes partial file when size cap exceeded', async () => {
      const oneMb = Buffer.alloc(1024 * 1024, 0x41)
      async function* gen() {
        for (let i = 0; i < 3; i++) yield oneMb
      }
      const stream = Readable.from(gen())
      await expect(
        store.writeMhtmlStream(
          'case-x',
          'cap-big',
          stream as unknown as ReadableStream<Uint8Array>,
          2 * 1024 * 1024
        )
      ).rejects.toThrow(/size.*exceed/i)
      expect(existsSync(join(tempDir, 'case-x', 'cap-big.mhtml'))).toBe(false)
    })

    it('rejects instead of hanging when the stream errors during a backpressure wait', async () => {
      // highWaterMark 1 forces write() to return false (backpressure wait);
      // the write callback then fails before 'drain' can ever fire.
      const failing = new Writable({
        highWaterMark: 1,
        write(_chunk, _enc, cb) {
          queueMicrotask(() => cb(new Error('disk gone')))
        }
      })
      vi.mocked(createWriteStream).mockReturnValueOnce(
        failing as unknown as ReturnType<typeof createWriteStream>
      )

      async function* gen() {
        yield Buffer.alloc(64)
        yield Buffer.alloc(64)
      }
      await expect(
        store.writeMhtmlStream(
          'case-x',
          'cap-err',
          Readable.from(gen()) as unknown as ReadableStream<Uint8Array>
        )
      ).rejects.toThrow('disk gone')
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
      const result = await store.writeMhtmlStream(
        'case-x',
        'cap-big-ok',
        stream as unknown as ReadableStream<Uint8Array>
      )
      expect(result.hash).toBe(expected.digest('hex'))
      expect(result.sizeBytes).toBe(64 * 1024 * 10)
    })
  })

  describe('sidecar writes', () => {
    it('writes text and returns the DB-format relative path', () => {
      const paths = store.writeText('case-1', 'cap-1', 'extracted text')
      expect(paths.rel).toBe(join('case-1', 'cap-1.txt'))
      expect(readFileSync(paths.abs, 'utf-8')).toBe('extracted text')
    })

    it('writes screenshot bytes and returns the DB-format relative path', () => {
      const png = Buffer.from('fake-png-bytes')
      const paths = store.writeScreenshot('case-1', 'cap-1', png)
      expect(paths.rel).toBe(join('case-1', 'cap-1.png'))
      expect(readFileSync(paths.abs).equals(png)).toBe(true)
    })

    it('creates the case directory on demand', () => {
      store.writeText('fresh-case', 'cap-1', 'x')
      expect(existsSync(join(tempDir, 'fresh-case', 'cap-1.txt'))).toBe(true)
    })
  })

  describe('reads', () => {
    it('round-trips artifacts through readArtifact', () => {
      store.writeText('case-1', 'cap-1', 'some text')
      expect(store.readArtifact('case-1', 'cap-1', 'txt')?.toString('utf-8')).toBe('some text')
    })

    it('returns null for missing artifacts', () => {
      expect(store.readArtifact('case-1', 'cap-none', 'mhtml')).toBeNull()
      expect(store.readThumbnail('case-1', 'cap-none')).toBeNull()
    })

    it('round-trips thumbnails', () => {
      const jpeg = Buffer.from('fake-jpeg')
      store.writeThumbnail('case-1', 'cap-1', jpeg)
      expect(store.readThumbnail('case-1', 'cap-1')?.equals(jpeg)).toBe(true)
      expect(existsSync(join(tempDir, 'case-1', 'cap-1_thumb.jpg'))).toBe(true)
    })
  })

  describe('deleteArtifacts', () => {
    it('removes every artifact extension plus the thumbnail', () => {
      const dir = join(tempDir, 'case-1')
      mkdirSync(dir, { recursive: true })
      for (const name of ['cap-1.mhtml', 'cap-1.html', 'cap-1.png', 'cap-1.txt']) {
        writeFileSync(join(dir, name), 'x')
      }
      writeFileSync(join(dir, 'cap-1_thumb.jpg'), 'x')
      writeFileSync(join(dir, 'cap-2.mhtml'), 'other capture untouched')

      store.deleteArtifacts('case-1', 'cap-1')

      expect(existsSync(join(dir, 'cap-1.mhtml'))).toBe(false)
      expect(existsSync(join(dir, 'cap-1.html'))).toBe(false)
      expect(existsSync(join(dir, 'cap-1.png'))).toBe(false)
      expect(existsSync(join(dir, 'cap-1.txt'))).toBe(false)
      expect(existsSync(join(dir, 'cap-1_thumb.jpg'))).toBe(false)
      expect(existsSync(join(dir, 'cap-2.mhtml'))).toBe(true)
    })

    it('is a no-op when nothing exists', () => {
      expect(() => store.deleteArtifacts('case-none', 'cap-none')).not.toThrow()
    })
  })
})

describe('parseArtifactFilename', () => {
  it('maps artifact filenames to their capture id', () => {
    expect(parseArtifactFilename('cap-1.mhtml')).toEqual({ captureId: 'cap-1' })
    expect(parseArtifactFilename('cap-1.html')).toEqual({ captureId: 'cap-1' })
    expect(parseArtifactFilename('cap-1.png')).toEqual({ captureId: 'cap-1' })
    expect(parseArtifactFilename('cap-1.txt')).toEqual({ captureId: 'cap-1' })
  })

  it('strips the _thumb suffix from thumbnails', () => {
    expect(parseArtifactFilename('cap-1_thumb.jpg')).toEqual({ captureId: 'cap-1' })
  })

  it('treats plain .jpg files as artifacts (matching orphan-scan behavior)', () => {
    expect(parseArtifactFilename('cap-1.jpg')).toEqual({ captureId: 'cap-1' })
  })

  it('ignores non-artifact filenames', () => {
    expect(parseArtifactFilename('manifest.jsonl')).toBeNull()
    expect(parseArtifactFilename('notes.md')).toBeNull()
  })
})
