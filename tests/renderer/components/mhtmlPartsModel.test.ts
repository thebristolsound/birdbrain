import { describe, it, expect } from 'vitest'
import type { MhtmlPartRow } from '@shared/types'
import {
  byteRange,
  COPY_LABELS,
  encodingText,
  htmlPartLabel,
  OFFSET_TITLE,
  PARTS_CAPTION,
  PARTS_COLUMNS,
  partsBanners,
  refusalSentence,
  showValue,
  type ListedParts
} from '@renderer/components/data/mhtmlPartsModel'

function row(overrides: Partial<MhtmlPartRow> = {}): MhtmlPartRow {
  return {
    position: 1,
    htmlPart: 0,
    mainDocument: true,
    contentType: 'text/html',
    transferEncoding: 'binary',
    contentLocation: 'https://example.com/',
    contentId: null,
    offset: 343,
    size: 107,
    sha256: 'a'.repeat(64),
    headersTerminated: true,
    endsAtEndOfFile: false,
    fieldsTruncated: false,
    ...overrides
  }
}

function listed(overrides: Partial<ListedParts> = {}): ListedParts {
  return {
    status: 'listed',
    readAt: '2026-11-10T09:00:00.000Z',
    fileSize: 1086,
    topContentType: 'multipart/related',
    boundary: '----b',
    snapshotLocation: 'https://example.com/',
    fieldsTruncated: false,
    closed: true,
    totalParts: 1,
    unterminatedParts: 0,
    truncated: false,
    parts: [row()],
    ...overrides
  }
}

describe('showValue', () => {
  // Every code point the walker's latin1 decode can yield that would render as nothing or
  // move the text: C0, DEL, C1, the no-break space and the soft hyphen. The backslash is
  // written too, so a stored `\x0a` cannot read as an escaped line feed.
  const escaped = [
    ...Array.from({ length: 0x20 }, (_, code) => code),
    ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i),
    0xa0,
    0xad,
    0x5c
  ]

  it('writes each escaped code point as \\xNN', () => {
    for (const code of escaped) {
      const hex = code.toString(16).padStart(2, '0')
      expect(showValue(`a${String.fromCharCode(code)}b`)).toBe(`a\\x${hex}b`)
    }
  })

  it('leaves every other latin1 code point as it is', () => {
    for (let code = 0; code <= 0xff; code += 1) {
      if (escaped.includes(code)) continue
      const char = String.fromCharCode(code)
      expect(showValue(char)).toBe(char)
    }
  })

  it('rewrites a header value with a line break inside it', () => {
    expect(showValue('https://example.com/\r\nX-Injected: 1')).toBe(
      'https://example.com/\\x0d\\x0aX-Injected: 1'
    )
  })
})

describe('refusalSentence', () => {
  it('names the missing file by its relative path', () => {
    expect(refusalSentence({ reason: 'file-missing', path: 'case1/cap-a.mhtml' })).toBe(
      'The stored MHTML file is not on disk at case1/cap-a.mhtml.'
    )
  })

  it('states the size and the limit of a file too large to read', () => {
    expect(refusalSentence({ reason: 'too-large', size: 209715201, limit: 209715200 })).toBe(
      'The stored file is 209,715,201 bytes, over the 209,715,200-byte limit this tab reads. Nothing was listed.'
    )
  })

  it('gives one sentence for a file with no header block and one with no boundary', () => {
    const sentence =
      'The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list.'
    expect(refusalSentence({ reason: 'no-mime-header' })).toBe(sentence)
    expect(
      refusalSentence({ reason: 'no-boundary', contentType: 'text/html', fieldsTruncated: false })
    ).toBe(sentence)
  })

  it('names the boundary of a file with no part, and says when it was cut', () => {
    expect(refusalSentence({ reason: 'no-parts', boundary: '----b', fieldsTruncated: false })).toBe(
      'The file names boundary ----b but holds no part delimited by it.'
    )
    expect(refusalSentence({ reason: 'no-parts', boundary: '----b', fieldsTruncated: true })).toBe(
      'The file names a boundary starting ----b but holds no part delimited by it.'
    )
  })

  it('escapes the path and the boundary it quotes', () => {
    expect(refusalSentence({ reason: 'file-missing', path: 'a\nb' })).toBe(
      'The stored MHTML file is not on disk at a\\x0ab.'
    )
    expect(refusalSentence({ reason: 'no-parts', boundary: 'x\ty', fieldsTruncated: false })).toBe(
      'The file names boundary x\\x09y but holds no part delimited by it.'
    )
  })
})

describe('partsBanners', () => {
  it('shows none for a closed, whole listing with every header terminated', () => {
    expect(partsBanners(listed())).toEqual([])
  })

  it('says the list may be incomplete when the closing boundary is missing', () => {
    expect(partsBanners(listed({ closed: false }))).toEqual([
      {
        id: 'unclosed',
        text: 'The file ends without its closing boundary. The last part runs to the end of the file and may be cut short, so this list may be incomplete.'
      }
    ])
  })

  it('states where the row ceiling stopped the list', () => {
    const parts = Array.from({ length: 5000 }, (_, i) => row({ position: i + 1 }))
    expect(partsBanners(listed({ truncated: true, totalParts: 7250, parts }))).toEqual([
      { id: 'ceiling', text: 'Listing stops at 5,000 of 7,250 parts.' }
    ])
  })

  it('counts the parts whose headers never end, in the singular and the plural', () => {
    expect(partsBanners(listed({ unterminatedParts: 1 }))).toEqual([
      {
        id: 'unterminated',
        text: '1 part has no blank line ending its headers. Its type and encoding cannot be read, and the HTML readers skip it.'
      }
    ])
    expect(partsBanners(listed({ unterminatedParts: 3 }))).toEqual([
      {
        id: 'unterminated',
        text: '3 parts have no blank line ending their headers. Their type and encoding cannot be read, and the HTML readers skip them.'
      }
    ])
  })

  it('says header values were cut, from the archive header or from any row', () => {
    const text =
      'Some header values are too long to show in full and are cut short. A row with a cut value offers no Content-Location copy.'
    expect(partsBanners(listed({ fieldsTruncated: true }))).toEqual([{ id: 'fields-cut', text }])
    expect(partsBanners(listed({ parts: [row({ fieldsTruncated: true })] }))).toEqual([
      { id: 'fields-cut', text }
    ])
  })

  it('shows every banner that applies, in order', () => {
    expect(
      partsBanners(
        listed({ closed: false, truncated: true, unterminatedParts: 2, fieldsTruncated: true })
      ).map(({ id }) => id)
    ).toEqual(['unclosed', 'ceiling', 'unterminated', 'fields-cut'])
  })
})

describe('the table labels', () => {
  it('heads the hash column as computed now', () => {
    expect(PARTS_COLUMNS.sha256).toBe('SHA-256 (computed now)')
    expect(Object.values(PARTS_COLUMNS)).toEqual([
      '#',
      'HTML part',
      'Content-Location',
      'Content-Type',
      'Encoding',
      'Offset',
      'Size',
      'SHA-256 (computed now)',
      'Copy'
    ])
  })

  it('gives the recipe for checking a part outside the app on the offset header', () => {
    expect(OFFSET_TITLE).toBe(
      'The byte offset in the file where the hashed span starts. To check a part outside Birdbrain, run tail -c +$((offset+1)) <file> | head -c <size> | sha256sum with its offset and size.'
    )
  })

  it('states that only the whole file is anchored', () => {
    expect(PARTS_CAPTION).toBe(
      "Only the whole MHTML file is anchored in the manifest, and Verify checks it against its Content Hash. Each part's SHA-256 is computed now, over the part's bytes as stored before transfer decoding, and is not anchored."
    )
  })

  it('copies the hash with a label that says it is not anchored', () => {
    expect(COPY_LABELS).toEqual({
      sha256: 'SHA-256 (computed now, not anchored)',
      contentLocation: 'Content-Location',
      byteRange: 'byte range'
    })
  })

  it('numbers HTML parts as search hits do, and leaves other parts blank', () => {
    expect(htmlPartLabel(row({ htmlPart: 0 }))).toBe('part 0')
    expect(htmlPartLabel(row({ htmlPart: 2 }))).toBe('part 2')
    expect(htmlPartLabel(row({ htmlPart: null }))).toBe('')
  })

  it('writes an absent encoding as (none)', () => {
    expect(encodingText(row({ transferEncoding: null }))).toBe('(none)')
    expect(encodingText(row({ transferEncoding: 'base64' }))).toBe('base64')
    expect(encodingText(row({ transferEncoding: 'bin\nary' }))).toBe('bin\\x0aary')
  })

  it('writes the byte range as offset and length', () => {
    expect(byteRange(row({ offset: 1010, size: 47 }))).toBe('offset 1010 length 47')
  })
})
