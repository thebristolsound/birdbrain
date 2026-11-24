/** A Capture's own files, by the type the Case store keeps each under. */
export type CaptureFileType = 'mhtml' | 'png' | 'warc.gz' | 'pdf'

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
  captureFile(capture: { caseId: string; id: string }, type: CaptureFileType): Buffer | null
  /**
   * The file of an Exhibit that is not a Capture, or a Derived File, by its
   * stored path. Null when the file cannot be read, whatever the reason; what
   * a null does to the export is stated on `ExportForm` (#1156, #2225).
   */
  storedFile(storedPath: string): Buffer | null
}

/**
 * The same source, asked for each file once. A second request for a file gets
 * the first answer, a null included, so one export cannot enclose a file under
 * one decision and leave it out under another.
 */
export function readOnce(source: PackageByteSource): PackageByteSource {
  const answers = new Map<string, Buffer | null>()
  const once = (key: string, read: () => Buffer | null): Buffer | null => {
    const known = answers.get(key)
    if (known !== undefined) return known
    const bytes = read()
    answers.set(key, bytes)
    return bytes
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
