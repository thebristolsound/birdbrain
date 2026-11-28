import { closeSync, openSync, readFileSync, readSync } from 'fs'
import { createHash } from 'crypto'
import type { PackageFile } from '../../packages/evidence-package-contents/index'

// The most of one file an export holds in memory while it hashes or packages it.
export const PACKAGE_FILE_CHUNK_BYTES = 1024 * 1024

function* chunksOf(path: string): Generator<Buffer> {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.allocUnsafe(PACKAGE_FILE_CHUNK_BYTES)
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) return
      yield chunk.subarray(0, read)
    }
  } finally {
    closeSync(fd)
  }
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * A file on disk as a `PackageFile`: hashed here, one chunk at a time, and read
 * again in chunks or whole when it is packaged or reproduced. Throws when the
 * file cannot be read. Synchronous, as a whole read was, so an export that
 * reads its files between its manifest snapshot and its export entry still
 * awaits nothing in between.
 */
export function readPackageFile(path: string): PackageFile {
  const hash = createHash('sha256')
  let sizeBytes = 0
  for (const chunk of chunksOf(path)) {
    hash.update(chunk)
    sizeBytes += chunk.length
  }
  const digest = hash.digest('hex')
  const changed = (): Error =>
    new Error(`${path} changed on disk after the export first read it; no package was written.`)
  return {
    sha256: digest,
    sizeBytes,
    *chunks() {
      const again = createHash('sha256')
      let read = 0
      for (const chunk of chunksOf(path)) {
        again.update(chunk)
        read += chunk.length
        yield chunk
      }
      if (read !== sizeBytes || again.digest('hex') !== digest) throw changed()
    },
    bytes() {
      const bytes = readFileSync(path)
      if (sha256(bytes) !== digest) throw changed()
      return bytes
    }
  }
}
