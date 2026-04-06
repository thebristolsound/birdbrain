import { createWriteStream, createReadStream, writeFileSync, type WriteStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { finished } from 'stream/promises'
import { ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { MAX_MHTML_SIZE } from '@shared/constants'

export interface StreamWriteResult {
  mhtmlPath: string // relative path (caseId/captureId.mhtml)
  hash: string
  sizeBytes: number
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
  body: ReadableStream<Uint8Array>
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
      if (size > MAX_MHTML_SIZE) {
        await closeAndUnlink(writeStream, absPath)
        throw new Error(`MHTML size ${size} exceeds cap of ${MAX_MHTML_SIZE} bytes`)
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

// ---------------------------------------------------------------------------
// Full ingest pipeline
// ---------------------------------------------------------------------------

import * as db from '@main/services/database'
import {
  initManifest,
  appendManifestEntry,
  rollbackManifestEntry,
  verifyManifestChain
} from '@main/services/manifest'
import type { Capture, HashVerification } from '@shared/types'

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

// End-to-end MHTML ingest:
// 1. Stream-write + hash to disk
// 2. Append write-ahead manifest entry (sync fs ops)
// 3. Synchronously insert DB row with manifest fields
// 4. On DB failure: rollback manifest + delete file
export async function ingestMhtmlCapture(params: IngestParams): Promise<IngestResult> {
  const captureId = randomUUID()
  const { mhtmlPath, hash, sizeBytes } = await streamWriteAndHash(
    params.caseId,
    captureId,
    params.stream
  )

  // Write plain text content to disk for the viewer's Text tab
  if (params.textContent) {
    writeFileSync(
      join(getStorageRoot(), params.caseId, `${captureId}.txt`),
      params.textContent,
      'utf-8'
    )
  }

  // Write screenshot to disk
  let screenshotPath: string | undefined
  if (params.screenshot) {
    screenshotPath = join(params.caseId, `${captureId}.png`)
    writeFileSync(join(getStorageRoot(), screenshotPath), params.screenshot)
  }

  const caseDir = join(getStorageRoot(), params.caseId)
  initManifest(caseDir)
  const manifestResult = appendManifestEntry(caseDir, {
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

  try {
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
    rollbackManifestEntry(caseDir, manifestResult.anchorBytes)
    await unlink(join(getStorageRoot(), mhtmlPath)).catch(() => {})
    if (params.textContent) {
      await unlink(join(getStorageRoot(), params.caseId, `${captureId}.txt`)).catch(() => {})
    }
    if (params.screenshot) {
      await unlink(join(getStorageRoot(), params.caseId, `${captureId}.png`)).catch(() => {})
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Verify capture integrity
// ---------------------------------------------------------------------------

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
      reason: 'Capture not found'
    }
  }
  if (capture.format !== 'mhtml' || !capture.mhtmlPath) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
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
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: '',
      status: 'missing',
      reason: 'MHTML file unreadable: ' + String(err)
    }
  }
  const computed = hasher.digest('hex')

  const chain = verifyManifestChain(join(getStorageRoot(), capture.caseId))
  if (!chain.valid) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: computed,
      status: 'chain-broken',
      manifestIndex: capture.manifestIndex,
      chainValid: false,
      reason: chain.reason
    }
  }
  if (computed !== capture.hash) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: computed,
      status: 'tampered',
      manifestIndex: capture.manifestIndex,
      chainValid: true
    }
  }
  return {
    captureId,
    url: capture.url,
    title: capture.title,
    storedHash: capture.hash,
    computedHash: computed,
    status: 'verified',
    manifestIndex: capture.manifestIndex,
    chainValid: true
  }
}
