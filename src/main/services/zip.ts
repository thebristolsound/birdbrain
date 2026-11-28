import { closeSync, openSync, renameSync, rmSync, writeSync } from 'fs'
import { randomBytes } from 'crypto'
import { basename, dirname, join } from 'path'

/**
 * Bytes a zip entry reads chunk by chunk, of a size known before the first
 * chunk. The writer holds one chunk at a time, so a chunk need only stay valid
 * until the next is asked for.
 */
export interface ZipEntrySource {
  sizeBytes: number
  chunks(): Iterable<Buffer>
}

export type ZipEntryData = Buffer | string | ZipEntrySource

interface ZipEntryInput {
  name: string
  data: ZipEntryData
}

interface WrittenEntry {
  name: string
  crc: number
  size: number
  offset: number
}

/** Where the zip's bytes go: appended in order, with a header field rewritten in place. */
interface ZipSink {
  append(bytes: Buffer): void
  rewrite(bytes: Buffer, position: number): void
}

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < CRC_TABLE.length; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[i] = c >>> 0
}

function crc32Update(crc: number, buf: Buffer): number {
  for (const b of buf) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  }
  return crc
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

// The CRC-32 field of a local header, which is written after the entry's bytes.
const LOCAL_HEADER_CRC_OFFSET = 14

function localHeader(entry: WrittenEntry, dt: { time: number; date: number }): Buffer {
  const name = Buffer.from(entry.name, 'utf-8')
  const { time, date } = dt
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(entry.crc, LOCAL_HEADER_CRC_OFFSET)
  header.writeUInt32LE(entry.size, 18)
  header.writeUInt32LE(entry.size, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function centralHeader(entry: WrittenEntry, dt: { time: number; date: number }): Buffer {
  const name = Buffer.from(entry.name, 'utf-8')
  const { time, date } = dt
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.size, 20)
  header.writeUInt32LE(entry.size, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([header, name])
}

function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number
): Buffer {
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entryCount, 8)
  eocd.writeUInt16LE(entryCount, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)
  return eocd
}

function sourceOf(data: ZipEntryData): ZipEntrySource {
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) return data
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8')
  return { sizeBytes: bytes.length, chunks: () => [bytes] }
}

// The one layout both writers below share, so the zip in memory and the zip on
// disk are the same bytes for the same entries.
function emitStoredZip(entries: ZipEntryInput[], sink: ZipSink): void {
  const written: WrittenEntry[] = []
  let offset = 0

  // One timestamp for the whole archive: keeps each entry's local and central
  // headers internally consistent rather than capturing two separate clock reads.
  const dt = dosDateTime(new Date())

  for (const input of entries) {
    const source = sourceOf(input.data)
    const entry: WrittenEntry = {
      name: input.name.replace(/\\/g, '/'),
      crc: 0,
      size: source.sizeBytes,
      offset
    }
    const header = localHeader(entry, dt)
    sink.append(header)
    let crc = 0xffffffff
    let size = 0
    for (const chunk of source.chunks()) {
      crc = crc32Update(crc, chunk)
      size += chunk.length
      sink.append(chunk)
    }
    // The header already states the size, so bytes of any other length would
    // make an entry whose header misdescribes it.
    if (size !== entry.size) {
      throw new Error(`zip: ${entry.name} read ${size} bytes, ${entry.size} expected`)
    }
    entry.crc = (crc ^ 0xffffffff) >>> 0
    const crcField = Buffer.alloc(4)
    crcField.writeUInt32LE(entry.crc, 0)
    sink.rewrite(crcField, offset + LOCAL_HEADER_CRC_OFFSET)
    written.push(entry)
    offset += header.length + size
  }

  const centralOffset = offset
  const centralParts = written.map((entry) => centralHeader(entry, dt))
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  for (const part of centralParts) sink.append(part)
  sink.append(endOfCentralDirectory(written.length, centralSize, centralOffset))
}

export function createStoredZip(entries: ZipEntryInput[]): Buffer {
  const parts: Buffer[] = []
  let total = 0
  // A source may reuse its chunk buffer, so each chunk is copied out before
  // the next is asked for.
  const held = entries.map(({ name, data }) => {
    if (typeof data === 'string' || Buffer.isBuffer(data)) return { name, data }
    const copies: Buffer[] = []
    for (const chunk of data.chunks()) copies.push(Buffer.from(chunk))
    const bytes = Buffer.concat(copies)
    return { name, data: { sizeBytes: data.sizeBytes, chunks: () => [bytes] } }
  })
  emitStoredZip(held, {
    append: (bytes) => {
      parts.push(bytes)
      total += bytes.length
    },
    // The field rewritten is in the header of the entry just written, so the
    // search runs from the end.
    rewrite: (bytes, position) => {
      let end = total
      for (let i = parts.length - 1; i >= 0; i--) {
        const start = end - parts[i].length
        if (position >= start) {
          bytes.copy(parts[i], position - start)
          return
        }
        end = start
      }
      throw new Error(`zip: no byte at offset ${position} to rewrite`)
    }
  })
  return Buffer.concat(parts)
}

function writeAt(fd: number, bytes: Buffer, position: number): void {
  let done = 0
  while (done < bytes.length) {
    done += writeSync(fd, bytes, done, bytes.length - done, position + done)
  }
}

/**
 * The bytes `createStoredZip` returns for the same entries, written to
 * `outputPath` one chunk at a time. They are written under a temporary name
 * beside it and renamed onto it once the last byte is written; a write that
 * fails removes the temporary file and leaves `outputPath` as it was.
 */
export function writeStoredZip(outputPath: string, entries: ZipEntryInput[]): void {
  const partialPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${randomBytes(6).toString('hex')}.partial`
  )
  const fd = openSync(partialPath, 'wx')
  try {
    try {
      let position = 0
      emitStoredZip(entries, {
        append: (bytes) => {
          writeAt(fd, bytes, position)
          position += bytes.length
        },
        rewrite: (bytes, at) => writeAt(fd, bytes, at)
      })
    } finally {
      closeSync(fd)
    }
    renameSync(partialPath, outputPath)
  } catch (err) {
    try {
      rmSync(partialPath, { force: true })
    } catch {
      // A temporary file that cannot be removed does not replace the write's error.
    }
    throw err
  }
}
