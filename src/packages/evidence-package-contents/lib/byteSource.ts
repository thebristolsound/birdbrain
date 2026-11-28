import { createHash } from 'crypto'

/** A Capture's own files, by the type the Case store keeps each under. */
export type CaptureFileType = 'mhtml' | 'png' | 'warc.gz' | 'pdf'

/**
 * One file an export may enclose, as its first read found it: the SHA-256 and
 * size of those bytes, and the bytes again on request. A file read from disk
 * is not held in memory between the two: `chunks` and `bytes` read it again and
 * throw when what they read is not what the first read hashed, so a package
 * cannot enclose bytes other than those its index describes.
 */
export interface PackageFile {
  readonly sha256: string
  readonly sizeBytes: number
  /** The bytes in order. A chunk stays valid only until the next is asked for. */
  chunks(): Iterable<Buffer>
  /** The bytes whole. */
  bytes(): Buffer
}

/** A file whose bytes are already in memory. */
export function packageFileOf(bytes: Buffer): PackageFile {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    chunks: () => [bytes],
    bytes: () => bytes
  }
}

/**
 * Where an export reads the bytes it encloses: the Case directory in the app,
 * a map in a test.
 */
export interface PackageByteSource {
  /**
   * One of a Capture's own files. Null when the Capture holds no such file.
   * Throws when the file exists and cannot be read: that fails the export,
   * which writes no package, and is never a package narrowed without saying so.
   */
  captureFile(capture: { caseId: string; id: string }, type: CaptureFileType): PackageFile | null
  /**
   * The file of an Exhibit that is not a Capture, or a Derived File, by its
   * stored path. Null when the file cannot be read, whatever the reason; what
   * a null does to the export is stated on `ExportForm` (#1156, #2225).
   */
  storedFile(storedPath: string): PackageFile | null
}

/**
 * The same source, asked for each file once. A second request for a file gets
 * the first answer, a null included, so one export cannot enclose a file under
 * one decision and leave it out under another.
 */
export function readOnce(source: PackageByteSource): PackageByteSource {
  const answers = new Map<string, PackageFile | null>()
  const once = (key: string, read: () => PackageFile | null): PackageFile | null => {
    const known = answers.get(key)
    if (known !== undefined) return known
    const file = read()
    answers.set(key, file)
    return file
  }
  return {
    captureFile: (capture, type) =>
      once(JSON.stringify(['capture', capture.caseId, capture.id, type]), () =>
        source.captureFile(capture, type)
      ),
    storedFile: (storedPath) =>
      once(JSON.stringify(['stored', storedPath]), () => source.storedFile(storedPath))
  }
}
