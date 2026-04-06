import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { finished } from 'stream/promises'
import { ensureCaseDir } from '@main/services/storage'
import { MAX_MHTML_SIZE } from '@shared/constants'

export interface StreamWriteResult {
  mhtmlPath: string // relative path (caseId/captureId.mhtml)
  hash: string
  sizeBytes: number
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
        writeStream.destroy()
        await unlink(absPath).catch(() => {})
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
    writeStream.destroy()
    await unlink(absPath).catch(() => {})
    throw err
  }

  return { mhtmlPath: relPath, hash: hasher.digest('hex'), sizeBytes: size }
}
