// Minimal reader for zips produced by createStoredZip (method 0 / stored only).
// Locates the end-of-central-directory record, walks the central directory,
// and slices each entry's data out via its local header. Anything else —
// compression, zip64, multi-disk — is out of contract and throws.
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

function invalid(): never {
  throw new Error('Not a valid Birdbrain archive')
}

export function readStoredZip(zipData: Buffer): Map<string, Buffer> {
  // EOCD is the last 22 bytes when there is no comment; scan backwards to
  // tolerate a trailing comment anyway.
  let eocd = -1
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) invalid()
  const entryCount = zipData.readUInt16LE(eocd + 10)
  const centralOffset = zipData.readUInt32LE(eocd + 16)

  const entries = new Map<string, Buffer>()
  let offset = centralOffset
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > zipData.length || zipData.readUInt32LE(offset) !== CENTRAL_SIG) invalid()
    const method = zipData.readUInt16LE(offset + 10)
    const size = zipData.readUInt32LE(offset + 24)
    const nameLength = zipData.readUInt16LE(offset + 28)
    const extraLength = zipData.readUInt16LE(offset + 30)
    const commentLength = zipData.readUInt16LE(offset + 32)
    const localOffset = zipData.readUInt32LE(offset + 42)
    if (method !== 0) invalid()
    // Bound the variable-length fields before slicing: Buffer.subarray silently
    // clamps out-of-range indices, so a truncated buffer would yield a garbled
    // name instead of failing. Reject unsafe names here too (defense-in-depth
    // against zip-slip) — this reader parses user-supplied, possibly hostile
    // archives, so it should not depend on consumers to sanitize entry names.
    if (offset + 46 + nameLength + extraLength + commentLength > zipData.length) invalid()
    const name = zipData.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8')
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) invalid()

    if (localOffset + 30 > zipData.length || zipData.readUInt32LE(localOffset) !== LOCAL_SIG)
      invalid()
    const localNameLength = zipData.readUInt16LE(localOffset + 26)
    const localExtraLength = zipData.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + size > zipData.length) invalid()
    entries.set(name, zipData.subarray(dataStart, dataStart + size))

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
