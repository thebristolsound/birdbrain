/**
 * Where an export reads the bytes it encloses: the Case directory in the app,
 * a map in a test.
 */
export interface PackageByteSource {
  /**
   * The file of an Exhibit that is not a Capture, or a Derived File, by its
   * stored path. Null when the file cannot be read, whatever the reason: for
   * these files a failed read is a classification, the file is not enclosed,
   * and the export carries on (#1156).
   */
  storedFile(storedPath: string): Buffer | null
}

/**
 * The same source, asked for each file once. A second request for a path gets
 * the first answer, a null included, so one export cannot enclose a file under
 * one decision and leave it out under another.
 */
export function readOnce(source: PackageByteSource): PackageByteSource {
  const storedFiles = new Map<string, Buffer | null>()
  return {
    storedFile: (storedPath) => {
      const known = storedFiles.get(storedPath)
      if (known !== undefined) return known
      const bytes = source.storedFile(storedPath)
      storedFiles.set(storedPath, bytes)
      return bytes
    }
  }
}
