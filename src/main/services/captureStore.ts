import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'fs'
import { copyFile, unlink } from 'fs/promises'
import { basename, join } from 'path'
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

// Per-kind storage layout (ADR-0023, X4). Captures stay flat in `{caseId}/` —
// moving them would be a migration of every existing Case for no verifier gain
// — and each new kind gets its own subdirectory. Derived Files sit beside their
// parent with a suffix, as `_thumb.jpg` already does.
//
// A kind absent from this map stores flat, which is what `capture` does.
export const EXHIBIT_KIND_SUBDIRECTORIES: Readonly<Record<string, string>> = {
  attachment: 'attachments',
  image: 'images',
  document: 'documents'
}

// The Staging Pool (ADR-0024). Bytes here are NOT covered by the chain; the
// orphan scan and the storage-size read know the directory so pooled files are
// neither deleted as strays nor omitted from the Case's size.
export const STAGING_SUBDIRECTORY = 'staging'

// Every subdirectory a Case directory may hold. Single source of truth for the
// scanners: a new kind adds itself here and both of them follow.
export const CASE_SUBDIRECTORIES: readonly string[] = [
  ...Object.values(EXHIBIT_KIND_SUBDIRECTORIES),
  STAGING_SUBDIRECTORY
]

// Where a capture delete parks its files between staging and purge (#1786):
// `{caseId}/.pending-delete/{captureId}/`, each file under its original name.
// Deliberately absent from CASE_SUBDIRECTORIES: it is transient bookkeeping,
// not part of the Case layout, so the orphan scan leaves it alone and only
// the delete path and its recovery touch it.
export const PENDING_DELETE_DIRECTORY = '.pending-delete'

// A staged file could not be moved back to its original path, so the files
// are NOT where they were before the delete began. They are still on disk in
// the staging directory; recovery restores them.
export class StagedRestoreError extends Error {
  constructor(captureId: string, cause: unknown) {
    super(`could not restore staged artifacts for capture ${captureId}`, { cause })
    this.name = 'StagedRestoreError'
  }
}

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

// One artifact copied onto a second capture id (#827). `hash` and `sizeBytes`
// describe the bytes that LANDED at the destination, read back from disk, so a
// caller can anchor them without trusting the source row's recorded values.
export interface CopiedArtifact {
  rel: string
  hash: string
  sizeBytes: number
}

export interface CopiedArtifacts {
  // Keyed by artifact type; a type the source capture does not have is absent.
  artifacts: Partial<Record<CaptureArtifactType, CopiedArtifact>>
  // The thumbnail is a derived preview with no hash of its own, so it is
  // reported as copied-or-not rather than as an artifact.
  thumbnail: boolean
}

export interface CaptureStore {
  caseDir: (caseId: string) => string
  artifactPaths: (caseId: string, captureId: string, type: CaptureArtifactType) => ArtifactPaths
  thumbnailPaths: (caseId: string, captureId: string) => ArtifactPaths
  // Where an Exhibit of `kind` stores `fileName` inside a Case. Flat for
  // `capture`, in the kind's subdirectory otherwise.
  exhibitPaths: (caseId: string, kind: string, fileName: string) => ArtifactPaths
  // Where a pooled file stores `fileName` (ADR-0024).
  stagingPaths: (caseId: string, fileName: string) => ArtifactPaths
  resolveAbsolute: (relPath: string) => string
  // Whether a storage-root-relative path is on disk. The inventory's
  // existence column; `''` and undefined answer false rather than resolving to
  // the storage root itself.
  existsRelative: (relPath: string | null | undefined) => boolean
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
  copyArtifacts: (
    caseId: string,
    sourceCaptureId: string,
    targetCaptureId: string
  ) => Promise<CopiedArtifacts>
  deleteArtifacts: (caseId: string, captureId: string) => void
  // The reversible delete (#1786). `stageArtifacts` renames every artifact and
  // the thumbnail into the capture's staging directory; if a rename fails it
  // moves the staged files back and rethrows, or throws StagedRestoreError when
  // that restore fails too. `restoreStaged` moves staged files back to their
  // original paths. `purgeStaged` removes the staging directory for good.
  stageArtifacts: (caseId: string, captureId: string) => void
  restoreStaged: (caseId: string, captureId: string) => void
  purgeStaged: (caseId: string, captureId: string) => void
  // Capture ids with a staging directory left in the Case, for recovery.
  listStagedDeletes: (caseId: string) => string[]
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

  function exhibitPaths(caseId: string, kind: string, fileName: string): ArtifactPaths {
    const subdir = EXHIBIT_KIND_SUBDIRECTORIES[kind]
    const rel = subdir ? join(caseId, subdir, fileName) : join(caseId, fileName)
    return { rel, abs: join(getRoot(), rel) }
  }

  function stagingPaths(caseId: string, fileName: string): ArtifactPaths {
    const rel = join(caseId, STAGING_SUBDIRECTORY, fileName)
    return { rel, abs: join(getRoot(), rel) }
  }

  function resolveAbsolute(relPath: string): string {
    return join(getRoot(), relPath)
  }

  function existsRelative(relPath: string | null | undefined): boolean {
    if (!relPath) return false
    return existsSync(join(getRoot(), relPath))
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

    // Record stream errors as they surface: 'drain' never fires on an errored
    // stream, so the backpressure wait below must also wake on 'error' or a
    // mid-write failure would hang the ingest forever (and crash the process
    // as an unhandled 'error' event).
    let streamError: Error | undefined
    writeStream.on('error', (err) => {
      streamError = err
    })

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
        if (streamError) throw streamError
        size += chunk.byteLength
        if (size > maxSizeBytes) {
          throw new Error(`MHTML size ${size} exceeds cap of ${maxSizeBytes} bytes`)
        }
        hasher.update(chunk)
        if (!writeStream.write(chunk)) {
          await new Promise<void>((resolve) => {
            const onDrain = (): void => {
              writeStream.off('error', onError)
              resolve()
            }
            const onError = (): void => {
              writeStream.off('drain', onDrain)
              resolve()
            }
            writeStream.once('drain', onDrain)
            writeStream.once('error', onError)
          })
          if (streamError) throw streamError
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

  // Streams the destination back to compute its digest, rather than hashing the
  // buffer that was written: it is the file on disk a later verify will read,
  // and an MHTML runs to MAX_MHTML_SIZE, which is not a buffer worth holding.
  async function hashFile(path: string): Promise<string> {
    const hasher = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(path)
      rs.on('data', (chunk) => hasher.update(chunk))
      rs.on('end', () => resolve())
      rs.on('error', reject)
    })
    return hasher.digest('hex')
  }

  async function copyArtifact(
    caseId: string,
    sourceCaptureId: string,
    targetCaptureId: string,
    type: CaptureArtifactType
  ): Promise<CopiedArtifact | undefined> {
    const source = artifactPaths(caseId, sourceCaptureId, type)
    if (!existsSync(source.abs)) return undefined
    ensureDir(caseId)
    const target = artifactPaths(caseId, targetCaptureId, type)
    // Async on purpose: an MHTML runs to MAX_MHTML_SIZE, and a synchronous copy
    // would block the main process (UI and capture server) for the duration.
    await copyFile(source.abs, target.abs)
    return {
      rel: target.rel,
      hash: await hashFile(target.abs),
      sizeBytes: statSync(target.abs).size
    }
  }

  // Byte-for-byte copy of every artifact a capture owns onto a second capture
  // id in the same case (#827). The two captures never share a file: the copy
  // is what makes the duplicate independently verifiable and independently
  // deletable.
  async function copyArtifacts(
    caseId: string,
    sourceCaptureId: string,
    targetCaptureId: string
  ): Promise<CopiedArtifacts> {
    const artifacts: Partial<Record<CaptureArtifactType, CopiedArtifact>> = {}
    for (const type of CAPTURE_ARTIFACT_TYPES) {
      const copied = await copyArtifact(caseId, sourceCaptureId, targetCaptureId, type)
      if (copied) artifacts[type] = copied
    }
    const sourceThumb = thumbnailPaths(caseId, sourceCaptureId).abs
    const thumbnail = existsSync(sourceThumb)
    if (thumbnail) {
      ensureDir(caseId)
      await copyFile(sourceThumb, thumbnailPaths(caseId, targetCaptureId).abs)
    }
    return { artifacts, thumbnail }
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

  function pendingDeleteRoot(caseId: string): string {
    return join(caseDir(caseId), PENDING_DELETE_DIRECTORY)
  }

  function stagedDir(caseId: string, captureId: string): string {
    return join(pendingDeleteRoot(caseId), captureId)
  }

  // Every path a capture's files may occupy, artifacts then thumbnail.
  function ownedPaths(caseId: string, captureId: string): string[] {
    return [
      ...CAPTURE_ARTIFACT_TYPES.map((type) => artifactPaths(caseId, captureId, type).abs),
      thumbnailPaths(caseId, captureId).abs
    ]
  }

  function restoreStaged(caseId: string, captureId: string): void {
    const dir = stagedDir(caseId, captureId)
    if (!existsSync(dir)) return
    // Attempt every file before reporting, so one locked file does not leave
    // the others parked as well.
    let firstError: unknown
    for (const name of readdirSync(dir)) {
      try {
        renameSync(join(dir, name), join(caseDir(caseId), name))
      } catch (err) {
        firstError ??= err
      }
    }
    if (firstError !== undefined) throw new StagedRestoreError(captureId, firstError)
    rmdirSync(dir)
  }

  function stageArtifacts(caseId: string, captureId: string): void {
    const dir = stagedDir(caseId, captureId)
    const moved: Array<{ from: string; to: string }> = []
    try {
      for (const from of ownedPaths(caseId, captureId)) {
        if (!existsSync(from)) continue
        mkdirSync(dir, { recursive: true })
        // Same directory tree, same filesystem: each rename is atomic, and
        // unlike an unlink it can be undone.
        const to = join(dir, basename(from))
        renameSync(from, to)
        moved.push({ from, to })
      }
    } catch (err) {
      // Undo exactly what this call moved, newest first.
      let restoreError: unknown
      for (const { from, to } of moved.reverse()) {
        try {
          renameSync(to, from)
        } catch (e) {
          restoreError ??= e
        }
      }
      if (restoreError !== undefined) throw new StagedRestoreError(captureId, restoreError)
      try {
        rmdirSync(dir)
      } catch {
        // Never created, or still holding files an earlier recovery could not
        // restore; the next recovery handles those.
      }
      throw err
    }
  }

  function purgeStaged(caseId: string, captureId: string): void {
    rmSync(stagedDir(caseId, captureId), { recursive: true, force: true })
  }

  function listStagedDeletes(caseId: string): string[] {
    const root = pendingDeleteRoot(caseId)
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  }

  return {
    caseDir,
    artifactPaths,
    thumbnailPaths,
    exhibitPaths,
    stagingPaths,
    resolveAbsolute,
    existsRelative,
    writeMhtmlStream,
    writeText,
    writeScreenshot,
    readArtifact,
    readThumbnail,
    writeThumbnail,
    copyArtifacts,
    deleteArtifacts,
    stageArtifacts,
    restoreStaged,
    purgeStaged,
    listStagedDeletes
  }
}

// Default instance bound lazily to the storage-root singleton. Production code
// uses this; tests inject createCaptureStore({ getRoot: () => tempDir }) or a fake.
export const defaultCaptureStore: CaptureStore = createCaptureStore({ getRoot: getStorageRoot })
