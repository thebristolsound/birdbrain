interface ZipEntryInput {
  name: string
  data: Buffer | string
}

interface WrittenEntry {
  name: string
  crc: number
  size: number
  offset: number
}

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < CRC_TABLE.length; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const b of buf) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

function localHeader(
  entry: WrittenEntry,
  data: Buffer,
  dt: { time: number; date: number }
): Buffer {
  const name = Buffer.from(entry.name, 'utf-8')
  const { time, date } = dt
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(entry.crc, 14)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
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

export function createStoredZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = []
  const written: WrittenEntry[] = []
  let offset = 0

  // One timestamp for the whole archive: keeps each entry's local and central
  // headers internally consistent rather than capturing two separate clock reads.
  const dt = dosDateTime(new Date())

  for (const input of entries) {
    const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data, 'utf-8')
    const entry: WrittenEntry = {
      name: input.name.replace(/\\/g, '/'),
      crc: crc32(data),
      size: data.length,
      offset
    }
    const header = localHeader(entry, data, dt)
    localParts.push(header, data)
    written.push(entry)
    offset += header.length + data.length
  }

  const centralOffset = offset
  const centralParts = written.map((entry) => centralHeader(entry, dt))
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)

  return Buffer.concat([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(written.length, centralSize, centralOffset)
  ])
}
