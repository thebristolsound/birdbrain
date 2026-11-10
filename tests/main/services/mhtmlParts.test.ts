import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import type { FileHandle } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import type { Capture, MhtmlPartsListing } from '@shared/types'
import { MAX_MHTML_SIZE } from '@shared/constants'
import { readHtmlParts } from '@main/services/htmlParts'
import { listMhtmlParts, MHTML_PARTS_LIMITS, readMhtmlParts } from '@main/services/mhtmlParts'

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const fsPromises = await import('fs/promises')
const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises')

// Known answers for the MHTML Parts tab's reader (#991). Each span runs from the byte after the
// part's header blank line to the line break before the next delimiter. Offsets were read from
// `grep -boa '^.*' mhtml-parts.mhtml`, and each hash was computed on 2026-11-10 outside the code
// under test with `tail -c +$((offset+1)) mhtml-parts.mhtml | head -c <size> | sha256sum`.
// Part 2's hash also equals `printf 'body { color: #333; }' | sha256sum`, the visible body text.
const FIXTURE = resolve(__dirname, 'fixtures/mhtml-parts.mhtml')
const FIXTURE_SIZE = 1691
const KNOWN_PARTS = [
  {
    position: 1,
    htmlPart: 0,
    mainDocument: true,
    contentType: 'text/html; charset=utf-8',
    transferEncoding: 'quoted-printable',
    contentLocation: 'https://example.com/report',
    contentId: null,
    offset: 401,
    size: 157,
    sha256: '10fa9b6e823b076216a6a962887a81106280d19f60edaab2b1fbac9da8386630'
  },
  {
    position: 2,
    htmlPart: null,
    mainDocument: false,
    contentType: 'text/css',
    transferEncoding: '8bit',
    contentLocation: 'https://example.org/style.css',
    contentId: null,
    offset: 696,
    size: 21,
    sha256: '76456d98f0751ade3235db7535beef70b85cfb4a5e179d12006e4ef97eb6aeee'
  },
  {
    position: 3,
    htmlPart: null,
    mainDocument: false,
    contentType: 'image/png',
    transferEncoding: 'base64',
    contentLocation: 'https://example.com/pixel.png',
    contentId: null,
    offset: 858,
    size: 92,
    sha256: '6dfa1ec815436323f9f829fb585bb742fdff550a0019cd2705d8d624e73812e0'
  },
  {
    position: 4,
    htmlPart: 1,
    mainDocument: false,
    contentType: 'text/html; charset=utf-8',
    transferEncoding: 'base64',
    contentLocation: 'https://widgets.example/embed/frame.html',
    contentId: '<frame-1@widgets.example>',
    offset: 1159,
    size: 66,
    sha256: '2f818a641911774eff5dd90c336f812aca40e680f1852d102a1436457dd52e0d'
  },
  {
    position: 5,
    htmlPart: null,
    mainDocument: false,
    contentType: 'image/gif',
    transferEncoding: 'base64',
    contentLocation: null,
    contentId: '<badge@example.org>',
    offset: 1350,
    size: 56,
    sha256: '750dd90405811f7db3c998cd18227b9f355b26fde9529454aeef8c4cf187ecf9'
  },
  {
    position: 6,
    htmlPart: 2,
    mainDocument: false,
    contentType: 'text/html; charset=iso-8859-1',
    transferEncoding: 'binary',
    contentLocation: 'cid:frame-2@widgets.example',
    contentId: null,
    offset: 1565,
    size: 51,
    sha256: 'e151203c517e3e72eeb3a31f58a9ecf974931dbb5b42e62fab6b8a163bd060ef'
  }
]
const WELL_FORMED = { headersTerminated: true, endsAtEndOfFile: false, fieldsTruncated: false }

const READ_AT = '2026-11-10T00:00:00.000Z'

function fixture(): Buffer {
  return readFileSync(FIXTURE)
}

function listed(listing: MhtmlPartsListing | null) {
  if (listing?.status !== 'listed') throw new Error(`expected a listing, got ${listing?.status}`)
  return listing
}

function refusal(listing: MhtmlPartsListing | null) {
  if (listing?.status !== 'refused') throw new Error(`expected a refusal, got ${listing?.status}`)
  return listing.refusal
}

function replaceOnce(buffer: Buffer, from: string, to: string): Buffer {
  const text = buffer.toString('latin1')
  const at = text.indexOf(from)
  if (at === -1 || text.indexOf(from, at + 1) !== -1) throw new Error(`not unique: ${from}`)
  return Buffer.from(text.slice(0, at) + to + text.slice(at + from.length), 'latin1')
}

describe('listMhtmlParts known answers', () => {
  it('lists every part of the fixture with its span, hash and HTML-part number', () => {
    const buffer = fixture()
    expect(buffer.length).toBe(FIXTURE_SIZE)
    const result = listed(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))
    expect(result).toEqual({
      status: 'listed',
      readAt: READ_AT,
      fileSize: FIXTURE_SIZE,
      topContentType: 'multipart/related; type="text/html"; boundary="----PartsFixtureBoundary"',
      boundary: '----PartsFixtureBoundary',
      snapshotLocation: 'https://example.com/report',
      fieldsTruncated: false,
      closed: true,
      totalParts: 6,
      unterminatedParts: 0,
      truncated: false,
      parts: KNOWN_PARTS.map((part) => ({ ...part, ...WELL_FORMED }))
    })
  })

  it('agrees with the HTML readers on which part is the main document', () => {
    for (const path of ['fixtures/mhtml-parts.mhtml', 'fixtures/multi-part.mhtml']) {
      const buffer = readFileSync(resolve(__dirname, path))
      const { parts } = listed(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))
      const main = readHtmlParts(buffer, 'https://example.com/').parts.find(
        ({ frame }) => frame === 'main'
      )
      const marked = parts.filter(({ mainDocument }) => mainDocument)
      expect(marked).toHaveLength(1)
      expect(marked[0].htmlPart).toBe(main?.part)
    }
  })

  it('falls back to the first HTML part when no part was saved from the snapshot address', () => {
    const buffer = replaceOnce(
      fixture(),
      'Snapshot-Content-Location: https://example.com/report',
      'Snapshot-Content-Location: https://example.com/elsewhere'
    )
    const { parts } = listed(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))
    expect(
      parts.filter(({ mainDocument }) => mainDocument).map(({ position }) => position)
    ).toEqual([1])
  })
})

describe('listMhtmlParts on malformed input', () => {
  it('reports a file cut short inside part 4 as not closed, with part 4 running to the end', () => {
    const result = listed(listMhtmlParts(fixture().subarray(0, 1180), MHTML_PARTS_LIMITS, READ_AT))
    expect(result.closed).toBe(false)
    expect(result.totalParts).toBe(4)
    expect(result.fileSize).toBe(1180)
    expect(result.parts.map(({ endsAtEndOfFile }) => endsAtEndOfFile)).toEqual([
      false,
      false,
      false,
      true
    ])
    expect(result.parts[3]).toMatchObject({ offset: 1159, size: 21 })
  })

  it('flags a part whose headers never end and keeps the HTML-part numbering', () => {
    const buffer = replaceOnce(fixture(), '\r\n\r\nbody { color', '\r\nbody { color')
    const result = listed(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))
    expect(result.unterminatedParts).toBe(1)
    expect(result.totalParts).toBe(6)
    expect(result.parts[1]).toMatchObject({
      position: 2,
      htmlPart: null,
      headersTerminated: false,
      contentType: null,
      transferEncoding: null,
      contentLocation: null,
      contentId: null,
      offset: 588
    })
    expect(result.parts.map(({ htmlPart }) => htmlPart)).toEqual([0, null, null, 1, null, 2])
  })

  it('refuses an archive whose top header names no boundary', () => {
    const buffer = replaceOnce(fixture(), '\r\n\tboundary="----PartsFixtureBoundary"', '')
    expect(refusal(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))).toEqual({
      reason: 'no-boundary',
      contentType: 'multipart/related; type="text/html";',
      fieldsTruncated: false
    })
  })

  it('refuses an empty buffer and a bare page as having no MIME header block', () => {
    for (const buffer of [Buffer.alloc(0), Buffer.from('<html><body>hi</body></html>')]) {
      const result = listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT)
      expect(result).toEqual({
        status: 'refused',
        readAt: READ_AT,
        refusal: { reason: 'no-mime-header' }
      })
    }
  })

  it('refuses an archive that names a boundary but holds no part delimited by it', () => {
    const buffer = Buffer.from('Content-Type: multipart/related; boundary="B"\r\n\r\n--B--\r\n')
    expect(refusal(listMhtmlParts(buffer, MHTML_PARTS_LIMITS, READ_AT))).toEqual({
      reason: 'no-parts',
      boundary: 'B',
      fieldsTruncated: false
    })
  })
})

describe('listMhtmlParts ceilings', () => {
  it('stops listing and hashing at the row ceiling and still counts every part', () => {
    const limits = { ...MHTML_PARTS_LIMITS, maxRows: 4 }
    const result = listed(listMhtmlParts(fixture(), limits, READ_AT))
    expect(result.parts.map(({ position }) => position)).toEqual([1, 2, 3, 4])
    expect(result.totalParts).toBe(6)
    expect(result.truncated).toBe(true)
  })

  it('does not report truncation when the parts exactly fill the ceiling', () => {
    const limits = { ...MHTML_PARTS_LIMITS, maxRows: 6 }
    const result = listed(listMhtmlParts(fixture(), limits, READ_AT))
    expect(result.parts).toHaveLength(6)
    expect(result.truncated).toBe(false)
  })

  it('counts unterminated parts past the row ceiling', () => {
    const buffer = replaceOnce(
      fixture(),
      'Content-ID: <badge@example.org>\r\n\r\n',
      'Content-ID: <badge@example.org>\r\n'
    )
    const result = listed(listMhtmlParts(buffer, { ...MHTML_PARTS_LIMITS, maxRows: 2 }, READ_AT))
    expect(result.unterminatedParts).toBe(1)
  })

  it('cuts a header value at the field cap and flags its row', () => {
    const atCap = listed(
      listMhtmlParts(fixture(), { ...MHTML_PARTS_LIMITS, maxFieldChars: 40 }, READ_AT)
    )
    expect(atCap.parts[3].contentLocation).toBe('https://widgets.example/embed/frame.html')
    expect(atCap.parts[3].fieldsTruncated).toBe(false)

    const result = listed(
      listMhtmlParts(fixture(), { ...MHTML_PARTS_LIMITS, maxFieldChars: 30 }, READ_AT)
    )
    expect(result.parts[3].contentLocation).toBe('https://widgets.example/embed/')
    expect(result.parts.map(({ fieldsTruncated }) => fieldsTruncated)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false
    ])
    // The cut is for display: the main document is still found by the full address.
    expect(result.parts[0].mainDocument).toBe(true)
    expect(result.topContentType).toBe('multipart/related; type="text/')
    expect(result.boundary).toBe('----PartsFixtureBoundary')
    expect(result.fieldsTruncated).toBe(true)
  })

  it('cuts each header field it reports, and the archive fields one by one', () => {
    const limits = { ...MHTML_PARTS_LIMITS, maxFieldChars: 8 }
    const result = listed(listMhtmlParts(fixture(), limits, READ_AT))
    expect(result.parts[0]).toMatchObject({
      contentType: 'text/htm',
      transferEncoding: 'quoted-p',
      contentLocation: 'https://'
    })
    expect(result.parts[3].contentId).toBe('<frame-1')
    expect(result.snapshotLocation).toBe('https://')
    expect(result.boundary).toBe('----Part')

    const archive = (snapshot: string, boundary: string) =>
      Buffer.from(
        `Snapshot-Content-Location: ${snapshot}\r\n` +
          `Content-Type: multipart/related; boundary=${boundary}\r\n\r\n` +
          `--${boundary}\r\n\r\nx\r\n--${boundary}--\r\n`
      )
    const wide = { ...MHTML_PARTS_LIMITS, maxFieldChars: 40 }
    const longSnapshot = listed(
      listMhtmlParts(archive('https://example.com/a-path-longer-than-forty', 'B'), wide, READ_AT)
    )
    expect(longSnapshot.topContentType).toBe('multipart/related; boundary=B')
    expect(longSnapshot.snapshotLocation).toBe('https://example.com/a-path-longer-than-f')
    expect(longSnapshot.fieldsTruncated).toBe(true)

    const narrow = { ...MHTML_PARTS_LIMITS, maxFieldChars: 34 }
    const longBoundary = listed(listMhtmlParts(archive('a', 'BBBBBB'), narrow, READ_AT))
    expect(longBoundary.topContentType).toBe('multipart/related; boundary=BBBBBB')
    expect(longBoundary.boundary).toBe('BBBBBB')
    expect(longBoundary.fieldsTruncated).toBe(false)
    const cutBoundary = listed(
      listMhtmlParts(
        archive('a', 'B'.repeat(40)),
        { ...MHTML_PARTS_LIMITS, maxFieldChars: 38 },
        READ_AT
      )
    )
    expect(cutBoundary.boundary).toBe('B'.repeat(38))
    expect(cutBoundary.totalParts).toBe(1)
    expect(cutBoundary.fieldsTruncated).toBe(true)
  })

  it('cuts and flags the values a refusal reports', () => {
    const limits = { ...MHTML_PARTS_LIMITS, maxFieldChars: 5 }
    expect(
      refusal(listMhtmlParts(Buffer.from('Content-Type: text/plain\r\n\r\nx'), limits, READ_AT))
    ).toEqual({ reason: 'no-boundary', contentType: 'text/', fieldsTruncated: true })
    expect(
      refusal(
        listMhtmlParts(
          Buffer.from('Content-Type: multipart/related; boundary=LONGB\r\n\r\n'),
          {
            ...limits,
            maxFieldChars: 4
          },
          READ_AT
        )
      )
    ).toEqual({ reason: 'no-parts', boundary: 'LONG', fieldsTruncated: true })
  })
})

describe('readMhtmlParts', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
    vi.mocked(fsPromises.open).mockImplementation(actualFs.open)
  })

  function capture(overrides: Partial<Capture>): Capture {
    return { id: 'c1', caseId: 'k1', url: 'https://example.com/report', ...overrides } as Capture
  }

  function caseDir(bytes: Buffer = fixture()) {
    dir = mkdtempSync(join(tmpdir(), 'mhtml-parts-'))
    writeFileSync(join(dir, 'c1.mhtml'), bytes)
    const root = dir
    return { root, store: { resolveAbsolute: (rel: string) => join(root, rel) } }
  }

  const stored = capture({ format: 'mhtml', mhtmlPath: 'c1.mhtml' })

  // The test's own handle wrapper sees every read the reader makes through the handle it opened.
  function watchNextOpen(onHandle: (handle: FileHandle) => void) {
    vi.mocked(fsPromises.open).mockImplementationOnce(async (...args) => {
      const handle = await actualFs.open(...args)
      onHandle(handle)
      return handle
    })
  }

  it('lists the stored file the store resolves', async () => {
    const { store } = caseDir()
    const before = new Date().toISOString()
    const result = listed(await readMhtmlParts(stored, store))
    const after = new Date().toISOString()
    expect(result.parts.map(({ sha256 }) => sha256)).toEqual(KNOWN_PARTS.map((p) => p.sha256))
    expect(result.fileSize).toBe(FIXTURE_SIZE)
    expect(result.readAt >= before && result.readAt <= after).toBe(true)
  })

  it('answers null when there is no Capture or no stored MHTML to read', async () => {
    const { store } = caseDir()
    expect(await readMhtmlParts(null, store)).toBeNull()
    expect(await readMhtmlParts(undefined, store)).toBeNull()
    expect(await readMhtmlParts(capture({ format: 'html', mhtmlPath: 'c1.mhtml' }), store)).toBe(
      null
    )
    expect(await readMhtmlParts(capture({ format: 'mhtml' }), store)).toBeNull()
  })

  it('states a stored file that is not on disk', async () => {
    const { store } = caseDir()
    const result = await readMhtmlParts(
      capture({ format: 'mhtml', mhtmlPath: 'gone.mhtml' }),
      store
    )
    expect(refusal(result)).toEqual({ reason: 'file-missing', path: 'gone.mhtml' })
  })

  it('reports a failure to open for any reason other than a missing file', async () => {
    const { store } = caseDir()
    vi.mocked(fsPromises.open).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'EACCES' })
    )
    await expect(readMhtmlParts(stored, store)).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('reports a failure to read a path that opens but is not a file', async () => {
    const { root } = caseDir()
    const store = { resolveAbsolute: () => root }
    await expect(readMhtmlParts(stored, store)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('refuses a file over the limit before reading any byte of it', async () => {
    const { store } = caseDir()
    const reads: string[] = []
    let closed = false
    watchNextOpen((handle) => {
      for (const method of ['read', 'readFile', 'readv', 'createReadStream'] as const) {
        vi.spyOn(handle, method).mockImplementation(() => {
          reads.push(method)
          throw new Error(`${method} called`)
        })
      }
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        closed = true
        return close()
      })
    })
    const limits = { ...MHTML_PARTS_LIMITS, maxFileBytes: FIXTURE_SIZE - 1 }
    expect(refusal(await readMhtmlParts(stored, store, limits))).toEqual({
      reason: 'too-large',
      size: FIXTURE_SIZE,
      limit: FIXTURE_SIZE - 1
    })
    expect(reads).toEqual([])
    expect(closed).toBe(true)
  })

  it('lists a file exactly at the limit', async () => {
    const { store } = caseDir()
    const limits = { ...MHTML_PARTS_LIMITS, maxFileBytes: FIXTURE_SIZE }
    expect(listed(await readMhtmlParts(stored, store, limits)).fileSize).toBe(FIXTURE_SIZE)
  })

  it('refuses a file that grew past the limit after it was measured', async () => {
    const { root, store } = caseDir()
    const grownBy = 4096
    watchNextOpen((handle) => {
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
        const measured = await stat()
        appendFileSync(join(root, 'c1.mhtml'), Buffer.alloc(grownBy, 0x41))
        return measured
      })
    })
    const limits = { ...MHTML_PARTS_LIMITS, maxFileBytes: FIXTURE_SIZE + 100 }
    expect(refusal(await readMhtmlParts(stored, store, limits))).toEqual({
      reason: 'too-large',
      size: FIXTURE_SIZE + grownBy,
      limit: FIXTURE_SIZE + 100
    })
  })

  it('lists the whole file when it grew after it was measured but stays under the limit', async () => {
    const { root, store } = caseDir()
    const tail = Buffer.from('more epilogue\r\n')
    watchNextOpen((handle) => {
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
        const measured = await stat()
        appendFileSync(join(root, 'c1.mhtml'), tail)
        return measured
      })
    })
    const result = listed(await readMhtmlParts(stored, store))
    expect(result.fileSize).toBe(FIXTURE_SIZE + tail.length)
    expect(result.totalParts).toBe(6)
  })

  it('reads on to the end when the file grew to more than twice its measured size', async () => {
    const { root, store } = caseDir()
    const tail = Buffer.alloc(FIXTURE_SIZE * 3, 0x41)
    watchNextOpen((handle) => {
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
        const measured = await stat()
        appendFileSync(join(root, 'c1.mhtml'), tail)
        return measured
      })
    })
    const result = listed(await readMhtmlParts(stored, store))
    expect(result.fileSize).toBe(FIXTURE_SIZE + tail.length)
  })

  it('refuses a file that grew to one byte past the limit after it was measured', async () => {
    const { root, store } = caseDir()
    watchNextOpen((handle) => {
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
        const measured = await stat()
        appendFileSync(join(root, 'c1.mhtml'), Buffer.from('\r\n'))
        return measured
      })
    })
    const limits = { ...MHTML_PARTS_LIMITS, maxFileBytes: FIXTURE_SIZE + 1 }
    expect(refusal(await readMhtmlParts(stored, store, limits))).toEqual({
      reason: 'too-large',
      size: FIXTURE_SIZE + 2,
      limit: FIXTURE_SIZE + 1
    })
  })

  it('counts every part of a file with thousands of them', async () => {
    const parts = Array.from({ length: 3000 }, (_, i) => `--B\r\n\r\npart ${i}\r\n`).join('')
    const big = Buffer.from(`Content-Type: multipart/related; boundary=B\r\n\r\n${parts}--B--\r\n`)
    const { store } = caseDir(big)
    const result = listed(await readMhtmlParts(stored, store))
    expect(result.fileSize).toBe(big.length)
    expect(result.totalParts).toBe(3000)
    expect(result.closed).toBe(true)
  })

  it('keeps the default limit at the stored-page cap', () => {
    expect(MHTML_PARTS_LIMITS).toEqual({
      maxFileBytes: MAX_MHTML_SIZE,
      maxRows: 5000,
      maxFieldChars: 2048
    })
  })

  it('writes nothing in the Case directory', async () => {
    const { root, store } = caseDir()
    writeFileSync(join(root, 'c1.txt'), 'text')
    const snapshot = () =>
      readdirSync(root)
        .sort()
        .map((name) => {
          const { size, mtimeMs } = statSync(join(root, name))
          return [name, size, mtimeMs]
        })
    const before = snapshot()
    listed(await readMhtmlParts(stored, store))
    await readMhtmlParts(capture({ format: 'mhtml', mhtmlPath: 'gone.mhtml' }), store)
    expect(snapshot()).toEqual(before)
  })
})
