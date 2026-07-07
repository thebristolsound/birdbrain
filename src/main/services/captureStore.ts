import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { finished } from 'stream/promises'
import { getStorageRoot } from '@main/services/storage'
import { MAX_MHTML_SIZE } from '@shared/constants'

// The Capture Store is the ONLY module that knows where a Capture's bytes live
// on disk and what they are called: {caseId}/{captureId}.{mhtml|html|png|txt}
// plus the {captureId}_thumb.jpg thumbnail. Everything else — ingest, verify,
// delete, extraction, thumbnailing, orphan scanning — goes through it.

export type CaptureArtifactType = 'mhtml' | 'html' | 'png' | 'txt'

export const CAPTURE_ARTIFACT_TYPES: readonly CaptureArtifactType[] = [
  'mhtml',
  'html',
  'png',
  'txt'
]

const THUMBNAIL_SUFFIX = '_thumb.jpg'

export interface ArtifactPaths {
  // Relative path (caseId/captureId.ext) — the form persisted onto capture rows.
  rel: string
  // Absolute path — the form used for file I/O.
  abs: string
}

export interface MhtmlWriteResult {
  rel: string
  abs: string
  hash: string
  sizeBytes: number
}

export interface CaptureStore {
  caseDir: (caseId: string) => string
  artifactPaths: (caseId: string, captureId: string, type: CaptureArtifactType) => ArtifactPaths
  thumbnailPaths: (caseId: string, captureId: string) => ArtifactPaths
  resolveAbsolute: (relPath: string) => string
  writeMhtmlStream: (
    caseId: string,
    captureId: string,
    body: ReadableStream<Uint8Array>,
    maxSizeBytes?: number
  ) => Promise<MhtmlWriteResult>
  writeText: (caseId: string, captureId: string, text: string) => ArtifactPaths
  writeScreenshot: (caseId: string, captureId: string, png: Buffer) => ArtifactPaths
  readArtifact: (caseId: string, captureId: string, type: CaptureArtifactType) => Buffer | null
  readThumbnail: (caseId: string, captureId: string) => Buffer | null
  writeThumbnail: (caseId: string, captureId: string, jpeg: Buffer) => void
  deleteArtifacts: (caseId: string, captureId: string) => void
}

// Recognizes capture artifact filenames inside a case directory, mapping a
// filename back to its capture id (thumbnails strip the _thumb suffix).
export function parseArtifactFilename(fileName: string): { captureId: string } | null {
  const match = fileName.match(/^(.+)\.(html|png|txt|mhtml|jpg)$/)
  if (!match) return null
  return { captureId: match[1].replace(/_thumb$/, '') }
}

async function closeAndUnlink(ws: WriteStream, path: string): Promise<void> {
  if (!ws.destroyed) {
    const closed = new Promise<void>((resolve) => ws.on('close', resolve))
    ws.destroy()
    await closed
  }
  await unlink(path).catch(() => {})
}

export function createCaptureStore(deps: { getRoot: () => string }): CaptureStore {
  const { getRoot } = deps

  function caseDir(caseId: string): string {
    return join(getRoot(), caseId)
  }

  function ensureDir(caseId: string): string {
    const dir = caseDir(caseId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  function artifactPaths(
    caseId: string,
    captureId: string,
    type: CaptureArtifactType
  ): ArtifactPaths {
    const rel = join(caseId, `${captureId}.${type}`)
    return { rel, abs: join(getRoot(), rel) }
  }

  function thumbnailPaths(caseId: string, captureId: string): ArtifactPaths {
    const rel = join(caseId, `${captureId}${THUMBNAIL_SUFFIX}`)
    return { rel, abs: join(getRoot(), rel) }
  }

  function resolveAbsolute(relPath: string): string {
    return join(getRoot(), relPath)
  }

  // Streams an MHTML upload to disk in a single pass while computing SHA-256.
  // Aborts (and removes the partial file) if size exceeds maxSizeBytes.
  async function writeMhtmlStream(
    caseId: string,
    captureId: string,
    body: ReadableStream<Uint8Array>,
    maxSizeBytes = MAX_MHTML_SIZE
  ): Promise<MhtmlWriteResult> {
    ensureDir(caseId)
    const { rel, abs } = artifactPaths(caseId, captureId, 'mhtml')

    const writeStream = createWriteStream(abs)
    const hasher = createHash('sha256')
    let size = 0

    try {
      // Support both Web ReadableStream (getReader) and Node Readable (asyncIterator)
      const iterable: AsyncIterable<Uint8Array> =
        typeof (body as unknown as { getReader?: unknown }).getReader === 'function'
          ? (async function* () {
              const reader = (body as ReadableStream<Uint8Array>).getReader()
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  yield value
                }
              } finally {
                reader.releaseLock()
              }
            })()
          : (body as unknown as AsyncIterable<Uint8Array>)

      for await (const chunk of iterable) {
        size += chunk.byteLength
        if (size > maxSizeBytes) {
          await closeAndUnlink(writeStream, abs)
          throw new Error(`MHTML size ${size} exceeds cap of ${maxSizeBytes} bytes`)
        }
        hasher.update(chunk)
        if (!writeStream.write(chunk)) {
          await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()))
        }
      }
      writeStream.end()
      await finished(writeStream)
    } catch (err) {
      await closeAndUnlink(writeStream, abs)
      throw err
    }

    return { rel, abs, hash: hasher.digest('hex'), sizeBytes: size }
  }

  function writeText(caseId: string, captureId: string, text: string): ArtifactPaths {
    ensureDir(caseId)
    const paths = artifactPaths(caseId, captureId, 'txt')
    writeFileSync(paths.abs, text, 'utf-8')
    return paths
  }

  function writeScreenshot(caseId: string, captureId: string, png: Buffer): ArtifactPaths {
    ensureDir(caseId)
    const paths = artifactPaths(caseId, captureId, 'png')
    writeFileSync(paths.abs, png)
    return paths
  }

  function readArtifact(
    caseId: string,
    captureId: string,
    type: CaptureArtifactType
  ): Buffer | null {
    const { abs } = artifactPaths(caseId, captureId, type)
    if (!existsSync(abs)) return null
    return readFileSync(abs)
  }

  function readThumbnail(caseId: string, captureId: string): Buffer | null {
    const { abs } = thumbnailPaths(caseId, captureId)
    if (!existsSync(abs)) return null
    return readFileSync(abs)
  }

  function writeThumbnail(caseId: string, captureId: string, jpeg: Buffer): void {
    ensureDir(caseId)
    writeFileSync(thumbnailPaths(caseId, captureId).abs, jpeg)
  }

  function deleteArtifacts(caseId: string, captureId: string): void {
    for (const type of CAPTURE_ARTIFACT_TYPES) {
      const { abs } = artifactPaths(caseId, captureId, type)
      if (existsSync(abs)) {
        unlinkSync(abs)
      }
    }
    const thumb = thumbnailPaths(caseId, captureId).abs
    if (existsSync(thumb)) {
      unlinkSync(thumb)
    }
  }

  return {
    caseDir,
    artifactPaths,
    thumbnailPaths,
    resolveAbsolute,
    writeMhtmlStream,
    writeText,
    writeScreenshot,
    readArtifact,
    readThumbnail,
    writeThumbnail,
    deleteArtifacts
  }
}

// Default instance bound lazily to the storage-root singleton. Production code
// uses this; tests inject createCaptureStore({ getRoot: () => tempDir }) or a fake.
export const defaultCaptureStore: CaptureStore = createCaptureStore({ getRoot: getStorageRoot })
