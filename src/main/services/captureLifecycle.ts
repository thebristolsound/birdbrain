import { app } from 'electron'
import { createReadStream, createWriteStream, writeFileSync, type WriteStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { finished } from 'stream/promises'
import * as db from '@main/services/database'
import { extractData } from '@main/services/dataExtractor'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import { getInstallationId } from '@main/services/installationId'
import {
  appendManifestEntry,
  initManifest,
  rollbackManifestEntry,
  verifyManifestChain,
  resolveTrustedTime,
  withDeletionEntry,
  ManifestRollback
} from '@main/services/manifest'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { getSettings } from '@main/services/settings'
import { deleteCaptureFiles, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { MAX_MHTML_SIZE } from '@shared/constants'
import type { Capture, HashVerification } from '@shared/types'

export interface StreamWriteResult {
  mhtmlPath: string // relative path (caseId/captureId.mhtml)
  hash: string
  sizeBytes: number
}

export interface IngestParams {
  caseId: string
  url: string
  title: string
  timestamp: string
  stream: ReadableStream<Uint8Array>
  textContent: string
  headers: Record<string, string>
  browserVersion: string
  userAgent: string
  httpStatus: number
  extensionVersion: string
  operatorId: string
  operatorName: string
  toolVersion: string
  screenshot?: Buffer
}

export interface IngestResult {
  capture: Capture
  contentHash: string
}

export interface CaptureLifecycleDeps {
  selectorLifecycle: SelectorLifecycle
  // Non-blocking hand-off to the trusted-timestamp worker (#120). Optional so
  // tests and code paths that don't care about timestamping can omit it.
  enqueueTimestamp?: (captureId: string) => void
}

export interface CaptureLifecycle {
  ingest: (params: IngestParams) => Promise<IngestResult>
  delete: (captureId: string) => Promise<boolean>
  verify: (captureId: string) => Promise<HashVerification>
  reprocessCase: (caseId: string) => Promise<{ processed: number }>
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

async function closeAndUnlink(ws: WriteStream, path: string): Promise<void> {
  if (!ws.destroyed) {
    const closed = new Promise<void>((resolve) => ws.on('close', resolve))
    ws.destroy()
    await closed
  }
  await unlink(path).catch(() => {})
}

// Streams an MHTML upload to disk in a single pass while computing SHA-256.
// Aborts (and removes the partial file) if size exceeds MAX_MHTML_SIZE.
export async function streamWriteAndHash(
  caseId: string,
  captureId: string,
  body: ReadableStream<Uint8Array>,
  maxSizeBytes = MAX_MHTML_SIZE
): Promise<StreamWriteResult> {
  const dir = ensureCaseDir(caseId)
  const absPath = join(dir, `${captureId}.mhtml`)
  const relPath = join(caseId, `${captureId}.mhtml`)

  const writeStream = createWriteStream(absPath)
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
        await closeAndUnlink(writeStream, absPath)
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
    await closeAndUnlink(writeStream, absPath)
    throw err
  }

  return { mhtmlPath: relPath, hash: hasher.digest('hex'), sizeBytes: size }
}

// End-to-end MHTML ingest:
// 1. Stream-write + hash to disk
// 2. Write sidecar files (.txt, .png), append manifest entry, and insert DB row — all in a single
//    error-handling block so any failure rolls back the manifest and deletes all written files
export async function ingestMhtmlCapture(params: IngestParams): Promise<IngestResult> {
  const captureId = randomUUID()
  const { mhtmlPath, hash, sizeBytes } = await streamWriteAndHash(
    params.caseId,
    captureId,
    params.stream
  )

  const caseDir = join(getStorageRoot(), params.caseId)
  const txtAbsPath = join(getStorageRoot(), params.caseId, `${captureId}.txt`)
  const pngRelPath = join(params.caseId, `${captureId}.png`)
  const pngAbsPath = join(getStorageRoot(), pngRelPath)

  let txtWritten = false
  let pngWritten = false
  let manifestResult: ReturnType<typeof appendManifestEntry> | undefined

  try {
    // Write plain text content to disk for the viewer's Text tab
    if (params.textContent) {
      writeFileSync(txtAbsPath, params.textContent, 'utf-8')
      txtWritten = true
    }

    // Write screenshot to disk
    let screenshotPath: string | undefined
    if (params.screenshot) {
      writeFileSync(pngAbsPath, params.screenshot)
      pngWritten = true
      screenshotPath = pngRelPath
    }

    initManifest(caseDir)
    manifestResult = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId,
      caseId: params.caseId,
      url: params.url,
      timestamp: params.timestamp,
      contentHash: hash,
      sizeBytes,
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      toolVersion: params.toolVersion
    })

    const capture = db.insertCapture({
      id: captureId,
      caseId: params.caseId,
      url: params.url,
      title: params.title,
      hash,
      timestamp: params.timestamp,
      headers: JSON.stringify(params.headers),
      textContent: params.textContent,
      format: 'mhtml',
      mhtmlPath,
      screenshotPath,
      sizeBytes,
      manifestIndex: manifestResult.index,
      prevHash: manifestResult.prevHash,
      entryHash: manifestResult.entryHash,
      toolVersion: params.toolVersion,
      extensionVersion: params.extensionVersion,
      browserVersion: params.browserVersion,
      userAgent: params.userAgent,
      httpStatus: params.httpStatus,
      operatorId: params.operatorId,
      operatorName: params.operatorName
    })
    return { capture, contentHash: hash }
  } catch (err) {
    if (manifestResult) {
      rollbackManifestEntry(caseDir, manifestResult.anchorBytes)
    }
    await unlink(join(getStorageRoot(), mhtmlPath)).catch(() => {})
    if (txtWritten) {
      await unlink(txtAbsPath).catch(() => {})
    }
    if (pngWritten) {
      await unlink(pngAbsPath).catch(() => {})
    }
    throw err
  }
}

async function computeVerification(
  capture: NonNullable<ReturnType<typeof db.getCapture>>
): Promise<HashVerification> {
  // Trusted time is ORTHOGONAL to integrity, so resolve it once up front and
  // attach it to every result regardless of the integrity outcome. Derived from
  // the manifest alone; a legacy/un-stamped capture simply reports none/pending.
  const tt = resolveTrustedTime(join(getStorageRoot(), capture.caseId), capture.hash)
  const trusted = { trustedTime: tt.trustedTime, tsaName: tt.tsaName, stampedAt: tt.stampedAt }

  const base = {
    captureId: capture.id,
    url: capture.url,
    title: capture.title,
    storedHash: capture.hash,
    ...trusted
  }

  if (capture.format !== 'mhtml' || !capture.mhtmlPath) {
    return {
      ...base,
      computedHash: '',
      status: 'legacy',
      reason: 'Legacy HTML capture (pre-MHTML era)'
    }
  }

  const absPath = join(getStorageRoot(), capture.mhtmlPath)
  const hasher = createHash('sha256')
  try {
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(absPath)
      rs.on('data', (chunk) => hasher.update(chunk))
      rs.on('end', () => resolve())
      rs.on('error', reject)
    })
  } catch (err) {
    return {
      ...base,
      computedHash: '',
      status: 'missing',
      reason: 'MHTML file unreadable: ' + String(err)
    }
  }
  const computed = hasher.digest('hex')

  const chain = verifyManifestChain(join(getStorageRoot(), capture.caseId))
  if (!chain.valid) {
    return {
      ...base,
      computedHash: computed,
      status: 'chain-broken',
      manifestIndex: capture.manifestIndex,
      chainValid: false,
      reason: chain.reason
    }
  }
  if (computed !== capture.hash) {
    return {
      ...base,
      computedHash: computed,
      status: 'tampered',
      manifestIndex: capture.manifestIndex,
      chainValid: true
    }
  }
  return {
    ...base,
    computedHash: computed,
    status: 'verified',
    manifestIndex: capture.manifestIndex,
    chainValid: true
  }
}

// Streams the MHTML file from disk, recomputes SHA-256, and checks the manifest chain.
export async function verifyCapture(captureId: string): Promise<HashVerification> {
  const capture = db.getCapture(captureId)
  if (!capture) {
    return {
      captureId,
      url: '',
      title: '',
      storedHash: '',
      computedHash: '',
      status: 'missing',
      reason: 'Capture not found',
      trustedTime: 'none'
    }
  }

  const result = await computeVerification(capture)

  // Persist so the UI can rehydrate across remounts/sessions and export can read
  // a stable snapshot without re-hashing when nothing has changed on disk. The
  // trusted-time mirror is refreshed here too, self-healing if the worker is
  // behind (e.g. a stamp landed in the manifest but the mirror still says pending).
  db.setCaptureVerification(captureId, {
    status: result.status,
    computedHash: result.computedHash,
    verifiedAt: new Date().toISOString()
  })
  db.setCaptureTrustedTime(captureId, result.trustedTime)

  return result
}

export function createCaptureLifecycle(deps: CaptureLifecycleDeps): CaptureLifecycle {
  function runDataExtraction(captureId: string, caseId: string, url: string): void {
    try {
      const html = readExtractionHtml(caseId, captureId)
      if (html) {
        const extracted = extractData(html)
        db.insertExtractedData(captureId, caseId, url, extracted)
      }
    } catch (err) {
      console.error('captureLifecycle: data extraction failed for capture', captureId, err)
    }
  }

  function runPostCaptureWork(
    captureId: string,
    caseId: string,
    url: string,
    textContent: string | undefined
  ): void {
    setImmediate(() => {
      try {
        if (textContent) {
          deps.selectorLifecycle.runActiveSelectorsForCapture(captureId, caseId, textContent)
        }
      } catch (err) {
        console.error('captureLifecycle: selector matching failed for capture', captureId, err)
      }

      runDataExtraction(captureId, caseId, url)
    })
  }

  return {
    async ingest(params) {
      const result = await ingestMhtmlCapture(params)
      // Hand off to the trusted-timestamp worker without blocking the capture.
      deps.enqueueTimestamp?.(result.capture.id)
      runPostCaptureWork(result.capture.id, params.caseId, params.url, params.textContent)
      return result
    },

    async delete(captureId) {
      const capture = db.getCapture(captureId)
      if (!capture) return false

      if (capture.format === 'mhtml') {
        const caseDir = join(getStorageRoot(), capture.caseId)
        try {
          await withDeletionEntry(
            caseDir,
            {
              captureId,
              caseId: capture.caseId,
              contentHash: capture.hash,
              operatorId: getInstallationId(),
              operatorName: getSettings().operatorName ?? '',
              toolVersion: getToolVersion()
            },
            () => {
              // Files first, DB row second. If the filesystem unlink throws,
              // the manifest rolls back with both DB and files intact (full retry).
              // If the DB delete fails after files are gone, the manifest still
              // rolls back and the user sees a broken capture row they can retry —
              // strictly better than the inverse, where a filesystem failure
              // after the DB delete would leave permanently orphaned files.
              deleteCaptureFiles(capture.caseId, captureId)
              const deleted = db.deleteCapture(captureId)
              if (!deleted) throw new ManifestRollback()
            }
          )
          return true
        } catch (err) {
          if (err instanceof ManifestRollback) return false
          throw err
        }
      }

      const deleted = db.deleteCapture(captureId)
      if (deleted) deleteCaptureFiles(capture.caseId, captureId)
      return deleted
    },

    verify(captureId) {
      return verifyCapture(captureId)
    },

    async reprocessCase(caseId) {
      const captures = db.listCaptures(caseId)
      for (const cap of captures) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        // Swallow per-capture errors so one bad capture doesn't poison the batch.
        try {
          // Always clear first so legacy rows don't linger when a capture has no
          // readable source file anymore.
          db.deleteExtractedDataForCapture(cap.id)
          runDataExtraction(cap.id, caseId, cap.url)
        } catch (err) {
          console.error('captureLifecycle: reprocess failed for capture', cap.id, err)
        }
      }
      return { processed: captures.length }
    }
  }
}
