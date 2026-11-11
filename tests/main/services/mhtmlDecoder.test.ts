import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  extractHtmlFromMhtml,
  extractHtmlPartsFromMhtml,
  listHtmlPartsInMhtml,
  mainHtmlPartIndex,
  readMhtmlTitle,
  walkMhtml,
  type MhtmlWalk,
  type MhtmlWalkPart
} from '@main/services/mhtmlDecoder'

function mhtml(lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

const MULTIPART_TOP = ['Content-Type: multipart/related; boundary=B', '']

// Archives that are damaged, or not archives, built by hand so each holds one defect.
const MALFORMED = {
  'an empty buffer': Buffer.alloc(0),
  'no boundary': mhtml([
    'Snapshot-Content-Location: https://example.com/a',
    'Content-Type: text/html',
    '',
    '<p>a</p>'
  ]),
  'unterminated headers between two HTML parts': mhtml([
    ...MULTIPART_TOP,
    '--B',
    'Content-Type: text/html',
    'Content-Location: https://example.com/one',
    '',
    '<p>one</p>',
    '--B',
    'Content-Type: text/html',
    'Content-Location: https://example.com/lost',
    '--B',
    'Content-Type: text/html',
    'Content-Location: https://example.com/two',
    '',
    '<p>two</p>',
    '--B--'
  ]),
  'no closing delimiter': mhtml([
    ...MULTIPART_TOP,
    '--B',
    'Content-Type: text/html',
    '',
    '<p>cut short',
    ''
  ]),
  'a delimiter inside a body': mhtml([
    ...MULTIPART_TOP,
    '--B',
    'Content-Type: text/html',
    '',
    '<p>one --B tail</p>',
    '--B',
    'Content-Type: text/html',
    '',
    '<p>two</p>',
    '--B--'
  ])
}
type Malformed = keyof typeof MALFORMED

// `[contentLocation, encodedSize, decoded]` per HTML part, as the decoder at a1762414 read them.
const MALFORMED_HTML_PARTS: Record<
  Malformed,
  { snapshotLocation: string | null; parts: unknown[] }
> = {
  'an empty buffer': { snapshotLocation: null, parts: [] },
  'no boundary': { snapshotLocation: 'https://example.com/a', parts: [] },
  'unterminated headers between two HTML parts': {
    snapshotLocation: null,
    parts: [
      ['https://example.com/one', 10, '<p>one</p>'],
      ['https://example.com/two', 10, '<p>two</p>']
    ]
  },
  'no closing delimiter': { snapshotLocation: null, parts: [[null, 12, '<p>cut short']] },
  'a delimiter inside a body': {
    snapshotLocation: null,
    parts: [
      [null, 7, '<p>one '],
      [null, 10, '<p>two</p>']
    ]
  }
}

describe('extractHtmlFromMhtml', () => {
  it('returns empty string for empty buffer', () => {
    expect(extractHtmlFromMhtml(Buffer.alloc(0))).toBe('')
  })

  it('returns empty string when top-level Content-Type has no boundary', () => {
    const buf = mhtml(['From: Chrome', 'Content-Type: text/html', '', '<html>not multipart</html>'])
    expect(extractHtmlFromMhtml(buf)).toBe('')
  })

  it('decodes a quoted-printable text/html part', () => {
    const buf = mhtml([
      'From: <Saved by Chrome>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="BOUNDARY"; type="text/html"',
      '',
      '--BOUNDARY',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      'Content-Location: https://example.com/',
      '',
      '<!DOCTYPE html><html><body><a href=3D"https://example.com/a">=E2=98=83</a></body></html>',
      '--BOUNDARY--'
    ])
    const html = extractHtmlFromMhtml(buf)
    expect(html).toContain('href="https://example.com/a"')
    // QP-encoded snowman ☃ should be decoded from UTF-8 bytes
    expect(html).toContain('\u2603')
  })

  it('decodes a base64 text/html part', () => {
    const original = '<html><body><p>Hello, world!</p></body></html>'
    const b64 = Buffer.from(original, 'utf-8').toString('base64')
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: base64',
      '',
      b64,
      '--X--'
    ])
    expect(extractHtmlFromMhtml(buf)).toContain('<p>Hello, world!</p>')
  })

  it('treats 7bit/8bit/missing encoding as raw bytes', () => {
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: text/html',
      '',
      '<html><body>raw bytes</body></html>',
      '--X--'
    ])
    expect(extractHtmlFromMhtml(buf)).toContain('<body>raw bytes</body>')
  })

  it('concatenates multiple text/html parts (frames/iframes)', () => {
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html>main frame UA-11111-1</html>',
      '--X',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html>iframe G-ABCDEFGHIJ</html>',
      '--X--'
    ])
    const html = extractHtmlFromMhtml(buf)
    expect(html).toContain('UA-11111-1')
    expect(html).toContain('G-ABCDEFGHIJ')
  })

  it('skips non-text/html parts (images, CSS)', () => {
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html>the page</html>',
      '--X',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      '--X',
      'Content-Type: text/css',
      '',
      'body { color: red; }',
      '--X--'
    ])
    const html = extractHtmlFromMhtml(buf)
    expect(html).toContain('the page')
    expect(html).not.toContain('color: red')
    expect(html).not.toContain('iVBORw0')
  })

  it('honors folded Content-Type header with quoted boundary', () => {
    const buf = mhtml([
      'MIME-Version: 1.0',
      'Content-Type: multipart/related;',
      '\ttype="text/html";',
      '\tboundary="----=_NextPart_000_0000_01D00000.12345678"',
      '',
      '------=_NextPart_000_0000_01D00000.12345678',
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html>folded headers work</html>',
      '------=_NextPart_000_0000_01D00000.12345678--'
    ])
    expect(extractHtmlFromMhtml(buf)).toContain('folded headers work')
  })

  it('decodes quoted-printable soft line breaks (= at end of line)', () => {
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<a href=3D"https://very-long-u=',
      'rl.example.com/path">link</a>',
      '--X--'
    ])
    const html = extractHtmlFromMhtml(buf)
    expect(html).toContain('href="https://very-long-url.example.com/path"')
  })

  it('returns empty string when no text/html part is present', () => {
    const buf = mhtml([
      'Content-Type: multipart/related; boundary=X',
      '',
      '--X',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgo=',
      '--X--'
    ])
    expect(extractHtmlFromMhtml(buf)).toBe('')
  })

  // #1708 split the decoder into a part list that this joins. Its output feeds text
  // extraction, so the split must not move a byte: these digests were taken from the
  // function as it stood before the split. The two news fixtures hold one HTML part
  // each; `fixtures/multi-part.mhtml` holds three, in quoted-printable, base64 and
  // binary latin-1, around an image part, which is the case the join itself decides.
  it.each([
    [
      'fixtures/multi-part.mhtml',
      '40f2d81213451a4f6aad9b32fccc858f96c62e15b7448f150ba68121cf294888'
    ],
    [
      'extraction/fixtures/cnn-iran-synthetic.mhtml',
      'c2be71c4ac61e29d2b9e31356f739f4370635134557d427c5e3bc0c2ebe076fe'
    ],
    [
      'extraction/fixtures/cnn-pope-synthetic.mhtml',
      '11c2c2c3fe095342afe1ae5cf03ef12b71b6003d12d10be91dfa6efa98476abf'
    ]
  ])('extracts %s byte for byte as before the part split', (fixture, digest) => {
    const html = extractHtmlFromMhtml(readFileSync(join(__dirname, fixture)))
    expect(createHash('sha256').update(html, 'utf8').digest('hex')).toBe(digest)
  })
})

describe('listHtmlPartsInMhtml and extractHtmlPartsFromMhtml', () => {
  const twoParts = mhtml([
    'From: <Saved by Blink>',
    'Snapshot-Content-Location: https://example.com/page',
    'Content-Type: multipart/related; boundary="B"; type="text/html"',
    '',
    '--B',
    'Content-Type: text/html',
    'Content-ID: <frame-1@mhtml.blink>',
    'Content-Location: https://example.com/',
    ' very/long/frame.html',
    '',
    '<p>frame</p>',
    '--B',
    'Content-Type: image/png',
    'Content-Location: https://example.com/i.png',
    '',
    'PNG',
    '--B',
    'Content-Type: text/html',
    'Content-Transfer-Encoding: base64',
    'Content-Location: https://example.com/page',
    '',
    Buffer.from('<p>main</p>').toString('base64'),
    '--B--'
  ])

  it('lists each html part with its location, in file order, and joins to the old output', () => {
    expect(extractHtmlPartsFromMhtml(twoParts)).toEqual([
      { contentLocation: 'https://example.com/very/long/frame.html', html: '<p>frame</p>' },
      { contentLocation: 'https://example.com/page', html: '<p>main</p>' }
    ])
    expect(extractHtmlFromMhtml(twoParts)).toBe('<p>frame</p>\n<p>main</p>')
  })

  it('reports the snapshot location and each part’s stored size before decoding it', () => {
    const { snapshotLocation, parts } = listHtmlPartsInMhtml(twoParts)
    expect(snapshotLocation).toBe('https://example.com/page')
    expect(parts.map((part) => part.encodedSize)).toEqual([
      '<p>frame</p>'.length,
      Buffer.from('<p>main</p>').toString('base64').length
    ])
  })

  it('answers no parts and no snapshot for something that is not an MHTML', () => {
    expect(listHtmlPartsInMhtml(Buffer.alloc(0))).toEqual({ snapshotLocation: null, parts: [] })
    expect(listHtmlPartsInMhtml(mhtml(['Content-Type: text/html', '', 'x'])).parts).toEqual([])
  })
})

// What text extraction, the claim check, the Links tab and the received-evidence title read.
// Every value below was taken from the decoder at a1762414, before the walker that lists every
// part existed, so a change to the walk that moves any of them fails here.
describe('what the HTML part readers see', () => {
  const read = (buffer: Buffer): { snapshotLocation: string | null; parts: unknown[] } => {
    const { snapshotLocation, parts } = listHtmlPartsInMhtml(buffer)
    return {
      snapshotLocation,
      parts: parts.map(({ contentLocation, encodedSize, decode }) => [
        contentLocation,
        encodedSize,
        createHash('sha256').update(decode(), 'utf8').digest('hex')
      ])
    }
  }

  it.each([
    [
      'fixtures/multi-part.mhtml',
      'https://example.com/page',
      [
        [
          'https://example.com/page',
          107,
          '81a2668c098c7a868a0110578eed301d5979aad9ebba2f085bafb3924a5c276e'
        ],
        [
          'https://widgets.example/frame/one.html',
          62,
          'e1aedc6ce0a803af5c27e059caf7d47cdc071a0abf41699fa705b12a939a562f'
        ],
        [
          'cid:frame-2@mhtml.blink',
          47,
          '980a80b777fada3192bdd03dbcbad49e4fd475dbe2cf1d62b4e85c9167660827'
        ]
      ],
      null
    ],
    [
      'fixtures/mhtml-parts.mhtml',
      'https://example.com/report',
      [
        [
          'https://example.com/report',
          157,
          '77688eb16da1d4735e485e8da79a7539f1b364ff0a975dcc198caf6ef77460e0'
        ],
        [
          'https://widgets.example/embed/frame.html',
          66,
          'ca3adae7c817f71979e1a5db8dc9bfb76c0a48d866a726eea5fc376e267cd6de'
        ],
        [
          'cid:frame-2@widgets.example',
          51,
          'c859751b8b3b5b1bcceb37accbe80a1ddae74299c5327a5dd7882e298f3eb488'
        ]
      ],
      'Quarterly widget report'
    ],
    [
      'extraction/fixtures/cnn-iran-synthetic.mhtml',
      'https://www.cnn.com/2024/04/19/world/iran-nuclear-cyber',
      [
        [
          'https://www.cnn.com/2024/04/19/world/iran-nuclear-cyber',
          1911,
          'c2be71c4ac61e29d2b9e31356f739f4370635134557d427c5e3bc0c2ebe076fe'
        ]
      ],
      'Iran-Linked Threat Actor Targets Nuclear Negotiators'
    ],
    [
      'extraction/fixtures/cnn-pope-synthetic.mhtml',
      'https://www.cnn.com/2024/04/19/tech/pope-cybersecurity',
      [
        [
          'https://www.cnn.com/2024/04/19/tech/pope-cybersecurity',
          1705,
          '11c2c2c3fe095342afe1ae5cf03ef12b71b6003d12d10be91dfa6efa98476abf'
        ]
      ],
      'Pope Addresses Global Cybersecurity Summit at Vatican'
    ]
  ])('%s keeps its HTML parts and title', (fixture, snapshotLocation, parts, title) => {
    const buffer = readFileSync(join(__dirname, fixture))
    expect(read(buffer)).toEqual({ snapshotLocation, parts })
    expect(readMhtmlTitle(buffer)).toBe(title)
  })

  it.each(Object.entries(MALFORMED_HTML_PARTS))('%s keeps its HTML parts', (name, expected) => {
    const { snapshotLocation, parts } = listHtmlPartsInMhtml(MALFORMED[name as Malformed])
    expect({
      snapshotLocation,
      parts: parts.map(({ contentLocation, encodedSize, decode }) => [
        contentLocation,
        encodedSize,
        decode()
      ])
    }).toEqual(expected)
  })
})

describe('walkMhtml', () => {
  const walk = (buffer: Buffer): { summary: MhtmlWalk; parts: MhtmlWalkPart[] } => {
    const parts: MhtmlWalkPart[] = []
    const summary = walkMhtml(buffer, (part) => parts.push(part))
    return { summary, parts }
  }

  // Offsets, sizes and digests computed outside the code under test, on 2026-11-10, with
  // `tail -c +$((offset+1)) multi-part.mhtml | head -c <size> | sha256sum`. The delimiter lines
  // start at 187, 452, 598, 860 and 1059 (`grep -abo -- ------MultiPartBoundary`). Part 2's
  // digest also equals `printf 'iVBORw0KGgo=' | sha256sum`, the body as it reads in the file.
  it('reports every part of multi-part.mhtml at its known offsets, sizes and digests', () => {
    const buffer = readFileSync(join(__dirname, 'fixtures/multi-part.mhtml'))
    const { summary, parts } = walk(buffer)
    expect(summary).toEqual({
      status: 'walked',
      topContentType: 'multipart/related; type="text/html"; boundary="----MultiPartBoundary"',
      snapshotLocation: 'https://example.com/page',
      boundary: '----MultiPartBoundary',
      closed: true,
      totalParts: 4
    })
    expect(
      parts.map((part) => ({
        ...part,
        sha256: createHash('sha256')
          .update(buffer.subarray(part.bodyStart, part.bodyEnd))
          .digest('hex')
      }))
    ).toEqual([
      {
        partStart: 212,
        partEnd: 452,
        bodyStart: 343,
        bodyEnd: 450,
        headersTerminated: true,
        html: true,
        contentType: 'text/html; charset=utf-8',
        transferEncoding: 'quoted-printable',
        contentLocation: 'https://example.com/page',
        contentId: null,
        sha256: '51e139ae51b1f7f100083f3536d21e615f4f25e831f15fe93abb93519265ce18'
      },
      {
        partStart: 477,
        partEnd: 598,
        bodyStart: 584,
        bodyEnd: 596,
        headersTerminated: true,
        html: false,
        contentType: 'image/png',
        transferEncoding: 'base64',
        contentLocation: 'https://example.com/i.png',
        contentId: null,
        sha256: '929e08d597feae564ce98003c4a47ff5239a5b93681d186eda3a9871e5b62644'
      },
      {
        partStart: 623,
        partEnd: 860,
        bodyStart: 796,
        bodyEnd: 858,
        headersTerminated: true,
        html: true,
        contentType: 'text/html; charset=utf-8',
        transferEncoding: 'base64',
        contentLocation: 'https://widgets.example/frame/one.html',
        contentId: '<frame-1@mhtml.blink>',
        sha256: 'd692e65d337705a1df44f2dbb2d64cd737f7f9cf9475343d9528b165357c79c1'
      },
      {
        partStart: 885,
        partEnd: 1059,
        bodyStart: 1010,
        bodyEnd: 1057,
        headersTerminated: true,
        html: true,
        contentType: 'text/html; charset=iso-8859-1',
        transferEncoding: 'binary',
        contentLocation: 'cid:frame-2@mhtml.blink',
        contentId: null,
        sha256: '70f8f1e8349c1f9638ab19a7fda4e0ddcc9a9738dafd9acaec39d6a1ca544044'
      }
    ])
  })

  it.each([
    ['fixtures/multi-part.mhtml', 4],
    ['fixtures/mhtml-parts.mhtml', 6],
    ['extraction/fixtures/cnn-iran-synthetic.mhtml', 3],
    ['extraction/fixtures/cnn-pope-synthetic.mhtml', 3]
  ])('%s: its HTML parts line up one to one with the HTML part list', (fixture, totalParts) => {
    const buffer = readFileSync(join(__dirname, fixture))
    const { summary, parts } = walk(buffer)
    expect(summary.totalParts).toBe(totalParts)
    expect(parts).toHaveLength(totalParts)
    expect(
      parts
        .filter(({ headersTerminated, html }) => headersTerminated && html)
        .map(({ contentLocation, bodyStart, bodyEnd }) => [contentLocation, bodyEnd - bodyStart])
    ).toEqual(
      listHtmlPartsInMhtml(buffer).parts.map(({ contentLocation, encodedSize }) => [
        contentLocation,
        encodedSize
      ])
    )
  })

  it.each(Object.keys(MALFORMED))(
    '%s: its HTML parts line up one to one with the HTML part list',
    (name) => {
      const buffer = MALFORMED[name as Malformed]
      expect(
        walk(buffer)
          .parts.filter(({ headersTerminated, html }) => headersTerminated && html)
          .map(({ contentLocation, bodyStart, bodyEnd }) => [contentLocation, bodyEnd - bodyStart])
      ).toEqual(
        listHtmlPartsInMhtml(buffer).parts.map(({ contentLocation, encodedSize }) => [
          contentLocation,
          encodedSize
        ])
      )
    }
  )

  it('tells a buffer with no header block from one with no boundary', () => {
    expect(walk(MALFORMED['an empty buffer'])).toEqual({
      summary: {
        status: 'no-mime-header',
        topContentType: null,
        snapshotLocation: null,
        boundary: null,
        closed: false,
        totalParts: 0
      },
      parts: []
    })
    expect(walk(Buffer.from('<html><body>a page</body></html>')).summary.status).toBe(
      'no-mime-header'
    )
    expect(walk(MALFORMED['no boundary'])).toEqual({
      summary: {
        status: 'no-boundary',
        topContentType: 'text/html',
        snapshotLocation: 'https://example.com/a',
        boundary: null,
        closed: false,
        totalParts: 0
      },
      parts: []
    })
  })

  it('reports a part whose headers never end, and keeps the HTML numbering around it', () => {
    const buffer = MALFORMED['unterminated headers between two HTML parts']
    const { summary, parts } = walk(buffer)
    expect(summary).toMatchObject({ status: 'walked', closed: true, totalParts: 3 })
    expect(parts.map(({ headersTerminated }) => headersTerminated)).toEqual([true, false, true])
    const [, lost] = parts
    expect(lost).toMatchObject({
      html: false,
      contentType: null,
      transferEncoding: null,
      contentLocation: null,
      contentId: null,
      bodyStart: lost.partStart,
      bodyEnd: lost.partEnd - 2
    })
    expect(buffer.subarray(lost.bodyStart, lost.bodyEnd).toString('latin1')).toBe(
      'Content-Type: text/html\r\nContent-Location: https://example.com/lost'
    )
    expect(listHtmlPartsInMhtml(buffer).parts.map((part) => part.decode())).toEqual([
      '<p>one</p>',
      '<p>two</p>'
    ])
  })

  it('reports an archive with no closing delimiter as not closed, its last part at the end', () => {
    const buffer = MALFORMED['no closing delimiter']
    const { summary, parts } = walk(buffer)
    expect(summary).toMatchObject({ status: 'walked', closed: false, totalParts: 1 })
    expect(parts[0].partEnd).toBe(buffer.length)
  })

  it('reports a boundary with no part after it as closed with no parts', () => {
    const { summary, parts } = walk(mhtml([...MULTIPART_TOP, '--B--', '']))
    expect(summary).toMatchObject({ status: 'walked', boundary: 'B', closed: true, totalParts: 0 })
    expect(parts).toEqual([])
  })

  // The delimiter match is not anchored to a line start, so the checks split this body, and the
  // walk shows the parts the checks read.
  it('splits a body at a delimiter inside it, as the HTML readers do', () => {
    const buffer = MALFORMED['a delimiter inside a body']
    const { summary, parts } = walk(buffer)
    expect(summary).toMatchObject({ closed: true, totalParts: 3 })
    expect(parts.map(({ headersTerminated, html }) => [headersTerminated, html])).toEqual([
      [true, true],
      [false, false],
      [true, true]
    ])
    expect(buffer.subarray(parts[1].bodyStart, parts[1].bodyEnd).toString('latin1')).toBe(
      ' tail</p>'
    )
  })

  // Only two hyphens after the boundary close the archive; the a1762414 decoder read on past one.
  it('does not close the archive at a delimiter followed by a single hyphen', () => {
    const buffer = mhtml([
      ...MULTIPART_TOP,
      '--B',
      'Content-Type: text/html',
      '',
      '<p>one --B-x</p>',
      '--B',
      'Content-Type: text/html',
      '',
      '<p>two</p>',
      '--B--'
    ])
    expect(walk(buffer).summary).toMatchObject({ closed: true, totalParts: 3 })
    expect(listHtmlPartsInMhtml(buffer).parts.map((part) => part.decode())).toEqual([
      '<p>one ',
      '<p>two</p>'
    ])
  })

  // The a1762414 decoder reads this archive the same way: one HTML part whose headers end at the
  // first LF LF, ahead of a CRLF CRLF pair later in its body.
  it('ends LF-only headers at the first blank line, inside the part', () => {
    const buffer = Buffer.from(
      [
        'Content-Type: multipart/related; boundary=B',
        '',
        '--B',
        'Content-Type: text/html',
        '',
        '<p>lf</p>\r\n\r\n<p>after</p>',
        '--B',
        'Content-Type: image/gif',
        '--B--'
      ].join('\n'),
      'latin1'
    )
    const { parts } = walk(buffer)
    expect(parts.map(({ headersTerminated, html }) => [headersTerminated, html])).toEqual([
      [true, true],
      [false, false]
    ])
    expect(listHtmlPartsInMhtml(buffer).parts.map((part) => part.decode())).toEqual([
      '<p>lf</p>\r\n\r\n<p>after</p>'
    ])
  })

  // With the header search running to the end of the file, the cost was the number of parts
  // times the file size: this walk took about 7 s on 2026-11-10 before the search was bounded.
  it('walks 20,000 parts with no LF LF pair in linear time', () => {
    const part = [
      '--B',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      '',
      'A'.repeat(140)
    ]
    const buffer = mhtml([
      ...MULTIPART_TOP,
      ...Array.from({ length: 20_000 }, () => part).flat(),
      '--B--'
    ])
    expect(buffer.length).toBeGreaterThan(4_000_000)
    const started = performance.now()
    expect(walkMhtml(buffer, () => {}).totalParts).toBe(20_000)
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})

describe('mainHtmlPartIndex', () => {
  const at = (contentLocation: string | null) => ({ contentLocation })

  it('picks the HTML part saved from the snapshot location', () => {
    expect(
      mainHtmlPartIndex('https://example.com/b', [
        at('https://example.com/a'),
        at('https://example.com/b')
      ])
    ).toBe(1)
  })

  it('falls back to the first HTML part when none was saved from the snapshot location', () => {
    expect(
      mainHtmlPartIndex('https://example.com/c', [at('https://example.com/a'), at(null)])
    ).toBe(0)
    expect(mainHtmlPartIndex(null, [at(null), at(null)])).toBe(0)
  })

  it('answers null when there is no HTML part', () => {
    expect(mainHtmlPartIndex('https://example.com/a', [])).toBeNull()
  })
})

describe('readMhtmlTitle', () => {
  const page = (title: string): string[] => [
    '--B',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<html><head><title>${title}</title></head><body>x</body></html>`,
    '--B--'
  ]
  const top = 'Content-Type: multipart/related; boundary=B'

  it('reads a plain Subject header', () => {
    const buf = mhtml(['Subject: Harbour Street ledger', top, '', ...page('Other')])
    expect(readMhtmlTitle(buf)).toBe('Harbour Street ledger')
  })

  it('decodes a UTF-8 Q word folded across two lines', () => {
    const buf = mhtml([
      'Subject: =?utf-8?Q?Caf=C3=A9_on_the?=',
      ' =?utf-8?Q?_quay?=',
      top,
      '',
      ...page('Other')
    ])
    expect(readMhtmlTitle(buf)).toBe('Café on the quay')
  })

  it('decodes a B word', () => {
    const b64 = Buffer.from('Ledger – März', 'utf-8').toString('base64')
    const buf = mhtml([`Subject: =?UTF-8?B?${b64}?=`, top, '', ...page('Other')])
    expect(readMhtmlTitle(buf)).toBe('Ledger – März')
  })

  it('falls back to the first page title, decoding its entities', () => {
    const buf = mhtml([top, '', ...page('  Bread &amp; salt\n &#8211; &#x41;  ')])
    expect(readMhtmlTitle(buf)).toBe('Bread & salt – A')
  })

  it('returns null when neither a Subject nor a title exists', () => {
    const buf = mhtml([top, '', '--B', 'Content-Type: text/html', '', '<p>x</p>', '--B--'])
    expect(readMhtmlTitle(buf)).toBeNull()
    expect(readMhtmlTitle(Buffer.alloc(0))).toBeNull()
  })

  // Review finding 3 on this PR: an empty Subject read the next header line as the title.
  it.each(['Subject: ', 'Subject:', 'Subject:\t'])(
    'falls back to the page title when the Subject is blank (%j)',
    (blank) => {
      const fixture = join(__dirname, 'extraction/fixtures/cnn-iran-synthetic.mhtml')
      const raw = readFileSync(fixture, 'latin1')
      const emptied = raw.replace(/^Subject: [^\r\n]*/m, blank)
      expect(emptied).not.toBe(raw)
      expect(readMhtmlTitle(Buffer.from(raw, 'latin1'))).toBe(
        'Iran-Linked Threat Actor Targets Nuclear Negotiators'
      )
      expect(readMhtmlTitle(Buffer.from(emptied, 'latin1'))).toBe(
        'Iran Nuclear Talks and Network Intrusions - Synthetic News'
      )
    }
  )

  it('reads a Subject whose value starts on a folded line', () => {
    const buf = mhtml(['Subject:', '  Harbour Street ledger', top, '', ...page('Other')])
    expect(readMhtmlTitle(buf)).toBe('Harbour Street ledger')
  })

  // Review finding 4 on this PR: the search for the first `<title>` was quadratic in the number
  // of `<title` tags never closed, and took 12.7 s on a 320 KB page in the review.
  it.each([
    ['opening tags with no closing tag', '<title>x'],
    ['opening tags that never end', '<title x']
  ])('reads a 4 MB page of %s in linear time', (_, token) => {
    const html = `<html><head></head><body><script>var s="${token.repeat(500_000)}"</script></body></html>`
    const buf = mhtml([
      'From: <Saved by Blink>',
      top,
      '',
      '--B',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--B--'
    ])
    expect(buf.length).toBeGreaterThan(4_000_000)
    const started = performance.now()
    expect(readMhtmlTitle(buf)).toBeNull()
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
