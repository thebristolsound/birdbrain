import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import { open, rename, unlink } from 'fs/promises'
import { basename, dirname, extname } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { MAX_MHTML_SIZE } from '@shared/constants'
import type {
  StagingCommitOutcome,
  StagingCommitResult,
  StagingDiscardResult,
  StagingFile
} from '@shared/types'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { withTransaction } from '@main/services/db/core'
import { insertExhibit, nextExhibitNumber } from '@main/services/db/exhibitRepo'
import {
  deleteStagingFile,
  getStagingFile,
  insertStagingFile,
  listStagingFiles
} from '@main/services/db/stagingRepo'
import { withManifestEntry } from '@main/services/manifest'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { resolveToolVersion } from '@main/services/toolVersion'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

// The Staging Pool (ADR-0024, #1148): the one place bytes can sit inside a Case
// directory without being evidence. Upload hashes on arrival and writes no
// Manifest Entry; commit is the only route into the chain and refuses bytes
// that changed since arrival (X13); discard writes nothing (X29). Manual upload
// is the first pooled route, origin `manual-upload`.

export const MANUAL_UPLOAD_ORIGIN = 'manual-upload'

export interface StagingDeps {
  store?: CaptureStore
  // Non-blocking hand-off to the trusted-timestamp worker (X26). Optional so
  // tests that do not care about stamping can omit it.
  enqueueTimestamp?: (exhibitId: string) => void
  // The size ceiling, reused from Captures until a ruling sets one (#1148).
  maxSizeBytes?: number
}

// Kind is permanent once anchored, so it is chosen at commit from the detected
// type (X43): `document` for PDF, `image` for raster images, `attachment` for
// everything else. Magic bytes, never the extension — the extension is a
// claim the uploader made and the bytes are what gets anchored.
export function detectExhibitKind(head: Buffer): string {
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') return 'document'
  const startsWith = (...bytes: number[]) =>
    head.length >= bytes.length && bytes.every((b, i) => head[i] === b)
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image' // PNG
  if (startsWith(0xff, 0xd8, 0xff)) return 'image' // JPEG
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image' // GIF
  if (startsWith(0x42, 0x4d)) return 'image' // BMP
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) return 'image' // TIFF
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image'
  }
  return 'attachment'
}

async function readHead(path: string, bytes = 16): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

// Streams `source` to `destination` in one pass, hashing as it goes, and
// aborts past the size ceiling. An MHTML-sized file is not a buffer worth
// holding, and the hash must be of the bytes that landed.
async function copyHashed(
  source: string,
  destination: string,
  maxSizeBytes: number
): Promise<{ hash: string; sizeBytes: number }> {
  const hasher = createHash('sha256')
  let size = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      if (size > maxSizeBytes) {
        callback(new Error(`File size exceeds the ${maxSizeBytes}-byte ceiling`))
        return
      }
      hasher.update(chunk)
      callback(null, chunk)
    }
  })
  try {
    await pipeline(createReadStream(source), counter, createWriteStream(destination))
  } catch (err) {
    await unlink(destination).catch(() => {})
    throw err
  }
  return { hash: hasher.digest('hex'), sizeBytes: size }
}

async function hashFile(path: string): Promise<string> {
  const hasher = createHash('sha256')
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hasher.update(chunk)
        callback()
      }
    })
  )
  return hasher.digest('hex')
}

// Copies each file into `{caseId}/staging/` under its own id (the original
// name is recorded on the row, never derived from the path — X35), hashes it
// on arrival, and inserts the row. Nothing touches the manifest.
export async function uploadToStaging(
  caseId: string,
  filePaths: string[],
  deps: StagingDeps = {}
): Promise<StagingFile[]> {
  const store = deps.store ?? defaultCaptureStore
  const maxSizeBytes = deps.maxSizeBytes ?? MAX_MHTML_SIZE
  const staged: StagingFile[] = []
  for (const source of filePaths) {
    const id = randomUUID()
    const name = basename(source)
    const { rel, abs } = store.stagingPaths(caseId, id + extname(name))
    mkdirSync(dirname(abs), { recursive: true })
    let copied: { hash: string; sizeBytes: number }
    try {
      copied = await copyHashed(source, abs, maxSizeBytes)
    } catch (err) {
      // The files before this one are pooled and stay pooled; the error says
      // so, because the caller gets no list back from a rejected upload.
      throw new Error(
        `${name}: ${err instanceof Error ? err.message : String(err)}` +
          (staged.length > 0 ? ` (${staged.length} earlier file(s) were added to the pool)` : '')
      )
    }
    const { hash, sizeBytes } = copied
    const kind = detectExhibitKind(await readHead(abs))
    staged.push(
      insertStagingFile({
        id,
        caseId,
        kind,
        origin: MANUAL_UPLOAD_ORIGIN,
        name,
        contentHash: hash,
        path: rel,
        sizeBytes,
        arrivedAt: new Date().toISOString()
      })
    )
  }
  return staged
}

// Commits pooled files one at a time, each its own `exhibit` entry (X24) and
// its own transaction, so a refusal on one file leaves the others' outcomes
// intact. Per file: re-hash and refuse changed bytes (X13); move into the
// kind's subdirectory; append the entry inside the write-ahead seam and, in
// the same callback, insert the `exhibits` row and delete the pooled row in one
// transaction; then hand the new Exhibit to the timestamp worker (X26). If the
// seam throws, the entry is rolled back and the file is moved back into the
// pool, so the pool and the chain agree again.
export async function commitStagedFiles(
  caseId: string,
  stagingIds: string[],
  deps: StagingDeps = {}
): Promise<StagingCommitResult> {
  const store = deps.store ?? defaultCaptureStore
  const caseDir = store.caseDir(caseId)
  const outcomes: StagingCommitOutcome[] = []
  for (const stagingId of stagingIds) {
    const row = getStagingFile(stagingId)
    if (!row || row.caseId !== caseId) {
      outcomes.push({ stagingId, status: 'refused', reason: 'not_found' })
      continue
    }
    const pooledAbs = store.resolveAbsolute(row.path)
    if (!existsSync(pooledAbs)) {
      outcomes.push({ stagingId, status: 'refused', reason: 'missing' })
      continue
    }
    const hash = await hashFile(pooledAbs)
    if (hash !== row.contentHash) {
      outcomes.push({ stagingId, status: 'refused', reason: 'changed' })
      continue
    }

    const exhibitId = randomUUID()
    const target = store.exhibitPaths(caseId, row.kind, exhibitId + extname(row.path))
    let moved = false
    try {
      const settings = getSettings()
      const timestamp = new Date().toISOString()
      const exhibitNumber = nextExhibitNumber(caseId)
      mkdirSync(dirname(target.abs), { recursive: true })
      await rename(pooledAbs, target.abs)
      moved = true
      await withManifestEntry(
        caseDir,
        {
          type: 'exhibit',
          exhibitId,
          caseId,
          kind: row.kind,
          origin: row.origin,
          name: row.name,
          exhibitNumber,
          path: target.rel,
          contentHash: row.contentHash,
          sizeBytes: statSync(target.abs).size,
          timestamp,
          operatorId: getInstallationId(),
          operatorName: settings.operatorName ?? '',
          toolVersion: resolveToolVersion()
        },
        (appended) =>
          withTransaction(() => {
            insertExhibit({
              id: exhibitId,
              caseId,
              kind: row.kind,
              origin: row.origin,
              name: row.name,
              contentHash: row.contentHash,
              path: target.rel,
              sizeBytes: row.sizeBytes,
              committedAt: timestamp,
              manifestSeq: appended.index,
              exhibitNumber
            })
            deleteStagingFile(stagingId)
          })
      )
      deps.enqueueTimestamp?.(exhibitId)
      outcomes.push({ stagingId, status: 'committed', exhibitId, exhibitNumber })
    } catch (err) {
      logger.error('staging', 'staging.commit_failed', { stagingId: ident(stagingId) }, err)
      if (moved) {
        // The entry (if any) is already truncated by the seam; put the bytes
        // back so the pool row and the file agree again. A failed move back is
        // its own record: the file then sits in the kind directory with no row.
        await rename(target.abs, pooledAbs).catch((moveErr) =>
          logger.error('staging', 'staging.commit_failed', { stagingId: ident(stagingId) }, moveErr)
        )
      }
      outcomes.push({
        stagingId,
        status: 'failed',
        error: err instanceof Error ? err.name : 'UnknownError'
      })
    }
  }
  return { outcomes }
}

// Removes the file and the row and writes nothing to the manifest (X29): the
// pool is outside the chain, so leaving it is not custody.
//
// The row goes only when the bytes are gone. An unlink that fails for any
// reason but "already absent" (EACCES, EPERM, EBUSY with the file open in a
// viewer) keeps the row and leaves the id out of `discarded`: deleting the
// row over bytes still on disk would leave undeclared bytes inside the Case
// directory, which is the state the pool exists to rule out (ADR-0024).
export async function discardStagedFiles(
  caseId: string,
  stagingIds: string[],
  deps: StagingDeps = {}
): Promise<StagingDiscardResult> {
  const store = deps.store ?? defaultCaptureStore
  const discarded: string[] = []
  for (const stagingId of stagingIds) {
    const row = getStagingFile(stagingId)
    if (!row || row.caseId !== caseId) continue
    try {
      await unlink(store.resolveAbsolute(row.path))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('staging', 'staging.discard_failed', { stagingId: ident(stagingId) }, err)
        continue
      }
    }
    if (deleteStagingFile(stagingId)) discarded.push(stagingId)
  }
  return { discarded }
}

export { listStagingFiles }
