import { describe, it, expect, vi } from 'vitest'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import { linksFromMhtml } from '@main/services/captureLinks'
import { CAPTURE_LINK_BUDGETS } from '@main/services/htmlParts'
import {
  BLOCK_MARKERS,
  extractFields,
  FIELD_EXTRACTOR_VERSION,
  headerFieldsFromText,
  type ExtractedField
} from '@main/services/search/fieldExtractor'
import { fieldLabel, HEADER_FIELDS } from '@shared/searchFields'

// Known answers for the Case search field extractor (docs/plans/2026-10-09-case-
// retrieval-first-slice.md, D3 and D4). Every field's offsets must slice back to its
// value in the string they index: the decoded part, or the Extracted Text.

const CAPTURE_URL = 'https://brindle-forum.example.org/thread/88'

interface Part {
  location?: string
  html: string
  encoding?: 'binary' | 'quoted-printable'
}

function mhtml(parts: Part[], snapshot?: string): Buffer {
  const lines = [
    'From: <Saved by Blink>',
    ...(snapshot ? [`Snapshot-Content-Location: ${snapshot}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="B"',
    ''
  ]
  for (const { location, html, encoding = 'binary' } of parts) {
    lines.push('--B', 'Content-Type: text/html', `Content-Transfer-Encoding: ${encoding}`)
    if (location) lines.push(`Content-Location: ${location}`)
    lines.push('', html)
  }
  lines.push('--B--', '')
  return Buffer.from(lines.join('\r\n'), 'utf8')
}

function page(body: string, head = ''): string {
  return `<html><head>${head}</head><body>${body}</body></html>`
}

function fromPage(body: string, head = '') {
  return extractFields({
    captureUrl: CAPTURE_URL,
    mhtml: mhtml([{ location: CAPTURE_URL, html: page(body, head) }]),
    html: null,
    text: null
  })
}

function pick(fields: ExtractedField[]) {
  return fields.map(({ field, value, norm }) => ({ field, value, norm }))
}

// Every html-part field slices back to its value in the part the current decoder
// returns, which is what the exact check will compare.
function expectSpansInParts(buffer: Buffer, fields: ExtractedField[]): void {
  const { parts } = listHtmlPartsInMhtml(buffer)
  for (const field of fields) {
    expect(field.source).toBe('html-part')
    const decoded = parts[field.part ?? -1].decode()
    expect(decoded.slice(field.startOffset, field.endOffset)).toBe(field.value)
  }
}

function expectSpansInText(text: string, fields: ExtractedField[]): void {
  for (const field of fields) {
    expect(field).toMatchObject({ source: 'text', part: null })
    expect(text.slice(field.startOffset, field.endOffset)).toBe(field.value)
  }
}

describe('extractFields: links', () => {
  it('records each href as stored and resolved, one field per occurrence', () => {
    const { fields } = fromPage(
      '<a href="/notices/week-11">a</a><a href="/notices/week-11">b</a>' +
        '<a href="https://Northgate-Ledger.EXAMPLE.com/Pay">c</a>'
    )
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: '/notices/week-11',
        norm: 'https://brindle-forum.example.org/notices/week-11'
      },
      {
        field: 'link.href',
        value: '/notices/week-11',
        norm: 'https://brindle-forum.example.org/notices/week-11'
      },
      {
        field: 'link.href',
        value: 'https://Northgate-Ledger.EXAMPLE.com/Pay',
        norm: 'https://northgate-ledger.example.com/Pay'
      }
    ])
    expect(fields[0].startOffset).not.toBe(fields[1].startOffset)
  })

  it('resolves against <base>, and keeps an href that does not parse as written', () => {
    const { fields } = fromPage(
      '<a href="ledger/7">a</a><a href=" http://[bad ">b</a>',
      '<base href="https://mirror.example.net/archive/">'
    )
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: 'ledger/7',
        norm: 'https://mirror.example.net/archive/ledger/7'
      },
      { field: 'link.href', value: ' http://[bad ', norm: 'http://[bad' }
    ])
  })

  it("records an href written with no value as an empty span at the attribute's end", () => {
    const html = page('<a href>x</a>')
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: Buffer.from(html),
      text: null
    })
    const end = html.indexOf('href') + 'href'.length
    expect(fields).toMatchObject([
      { value: '', norm: CAPTURE_URL, startOffset: end, endOffset: end }
    ])
  })

  it("records an image link's alt and an area's href and alt", () => {
    const { fields } = fromPage(
      '<a href="https://northgate-ledger.example.com/"><img src="x.png" alt="Quillmere  payments\n desk"></a>' +
        '<map><area href="/desk" alt="Remittance desk"><area href="/blank"></map>' +
        '<a href="/plain"><img src="y.png" alt=""></a>'
    )
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: 'https://northgate-ledger.example.com/',
        norm: 'https://northgate-ledger.example.com/'
      },
      { field: 'link.alt', value: 'Quillmere  payments\n desk', norm: 'Quillmere payments desk' },
      { field: 'link.href', value: '/desk', norm: 'https://brindle-forum.example.org/desk' },
      { field: 'link.alt', value: 'Remittance desk', norm: 'Remittance desk' },
      { field: 'link.href', value: '/blank', norm: 'https://brindle-forum.example.org/blank' },
      { field: 'link.href', value: '/plain', norm: 'https://brindle-forum.example.org/plain' }
    ])
  })

  it('keeps entities and quoting as stored in value, and reads them in norm', () => {
    const html = page(
      '<a  HREF = \'/p?a=1&amp;b=2\' >a</a>\r\n<a href=bare.html><img alt="Pay &amp; desk"></a>'
    )
    const buffer = mhtml([{ location: CAPTURE_URL, html }])
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: buffer,
      html: null,
      text: null
    })
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: '/p?a=1&amp;b=2',
        norm: 'https://brindle-forum.example.org/p?a=1&b=2'
      },
      {
        field: 'link.href',
        value: 'bare.html',
        norm: 'https://brindle-forum.example.org/thread/bare.html'
      },
      { field: 'link.alt', value: 'Pay &amp; desk', norm: 'Pay & desk' }
    ])
    expectSpansInParts(buffer, fields)
  })

  it('reads the main document first and an embedded frame after, each with its file position', () => {
    const buffer = mhtml(
      [
        { location: 'https://frames.example.net/inner', html: page('<a href="/in-frame">f</a>') },
        { location: CAPTURE_URL, html: page('<a href="/in-main">m</a>') }
      ],
      CAPTURE_URL
    )
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: buffer,
      html: null,
      text: null
    })
    expect(fields.map(({ norm, part }) => ({ norm, part }))).toEqual([
      { norm: 'https://brindle-forum.example.org/in-main', part: 1 },
      { norm: 'https://frames.example.net/in-frame', part: 0 }
    ])
    expectSpansInParts(buffer, fields)
  })

  it('takes offsets in the decoded text of a quoted-printable part', () => {
    const qp =
      '<html><body><p>caf=C3=A9 =E2=80=94</p><a href=3D"https://northgate-ledger.exa=\r\nmple.com/pay">x</a></body></html>'
    const buffer = mhtml([{ location: CAPTURE_URL, html: qp, encoding: 'quoted-printable' }])
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: buffer,
      html: null,
      text: null
    })
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: 'https://northgate-ledger.example.com/pay',
        norm: 'https://northgate-ledger.example.com/pay'
      }
    ])
    expectSpansInParts(buffer, fields)
  })

  it('reads a legacy HTML Capture as part 0', () => {
    const html = page('<a href="/old">o</a>')
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: Buffer.from(html),
      text: null
    })
    expect(fields).toEqual([
      {
        field: 'link.href',
        value: '/old',
        norm: 'https://brindle-forum.example.org/old',
        source: 'html-part',
        part: 0,
        startOffset: html.indexOf('/old'),
        endOffset: html.indexOf('/old') + 4
      }
    ])
  })

  // The version names the default budgets as well as the rules, so a change to the shared
  // budgets fails here until the version moves with it.
  it('pins the default budgets the extractor version was built with', () => {
    expect(FIELD_EXTRACTOR_VERSION).toBe('fields/1')
    expect(CAPTURE_LINK_BUDGETS).toEqual({
      maxPartBytes: 8 * 1024 * 1024,
      maxParts: 64,
      maxTotalBytes: 32 * 1024 * 1024,
      maxRows: 5000
    })
  })

  it('refuses the same parts as the Links tab under each lowered budget', () => {
    const frames = mhtml(
      [
        {
          location: 'https://frames.example.net/a',
          html: page(`<a href="/a">a</a>${'x'.repeat(300)}`)
        },
        { location: CAPTURE_URL, html: page('<a href="/main">m</a>') },
        { location: 'https://frames.example.net/b', html: page('<a href="/b">b</a>') }
      ],
      CAPTURE_URL
    )
    for (const lowered of [
      { maxPartBytes: 200 },
      { maxPartBytes: 10 },
      { maxParts: 1 },
      { maxTotalBytes: 200 }
    ]) {
      const budgets = { ...CAPTURE_LINK_BUDGETS, ...lowered }
      const links = linksFromMhtml(frames, CAPTURE_URL, budgets)
      const extracted = extractFields(
        { captureUrl: CAPTURE_URL, mhtml: frames, html: null, text: null },
        budgets
      )
      const { tooLarge, overPartCount, overTotalSize } = extracted.skippedParts
      expect(tooLarge + overPartCount + overTotalSize).toBeGreaterThan(0)
      expect(extracted.skippedParts).toEqual(links.skippedParts)
      expect(extracted.mainDocumentSkipped).toBe(links.mainDocumentSkipped)
      const linked = new Set(links.links.map((link) => link.href))
      expect(extracted.fields.map((f) => f.norm).filter((norm) => !linked.has(norm))).toEqual([])
    }
  })

  it('counts the parts the budgets refuse, and flags a refused main document', () => {
    const big = page(`<a href="/big">b</a>${'x'.repeat(200)}`)
    const frames = mhtml(
      [
        { location: CAPTURE_URL, html: page('<a href="/main">m</a>') },
        { location: 'https://frames.example.net/a', html: big }
      ],
      CAPTURE_URL
    )
    const budgets = { ...CAPTURE_LINK_BUDGETS, maxPartBytes: 100 }
    const refused = extractFields(
      { captureUrl: CAPTURE_URL, mhtml: frames, html: null, text: null },
      budgets
    )
    expect(refused.fields.map((f) => f.norm)).toEqual(['https://brindle-forum.example.org/main'])
    expect(refused.skippedParts).toEqual({ tooLarge: 1, overPartCount: 0, overTotalSize: 0 })
    expect(refused.mainDocumentSkipped).toBe(false)

    const main = mhtml([{ location: CAPTURE_URL, html: big }])
    expect(
      extractFields({ captureUrl: CAPTURE_URL, mhtml: main, html: null, text: null }, budgets)
    ).toMatchObject({ fields: [], mainDocumentSkipped: true })
    const legacy = Buffer.from(big)
    const decode = vi.spyOn(legacy, 'toString')
    expect(
      extractFields({ captureUrl: CAPTURE_URL, mhtml: null, html: legacy, text: null }, budgets)
    ).toMatchObject({ fields: [], mainDocumentSkipped: true })
    expect(decode).not.toHaveBeenCalled()
  })

  it('applies the part count and total size budgets to a legacy HTML Capture', () => {
    const html = page('<a href="/main">m</a>')
    const sources = { captureUrl: CAPTURE_URL, mhtml: null, html: Buffer.from(html), text: null }
    for (const budgets of [
      { ...CAPTURE_LINK_BUDGETS, maxParts: 0 },
      { ...CAPTURE_LINK_BUDGETS, maxTotalBytes: 10 }
    ]) {
      expect(extractFields(sources, budgets)).toMatchObject({
        fields: [],
        mainDocumentSkipped: true
      })
    }
  })

  it('stops scanning header blocks at the row ceiling', () => {
    const block = 'From: a@example.net\nMessage-ID: <1@example.net>\n\n'
    const text = block.repeat(5000)
    const slice = vi.spyOn(String.prototype, 'slice')
    try {
      const capped = extractFields(
        { captureUrl: CAPTURE_URL, mhtml: null, html: null, text },
        { ...CAPTURE_LINK_BUDGETS, maxRows: 2 }
      )
      expect(capped.fields).toHaveLength(2)
      expect(capped.truncated).toBe(true)
      expect(slice.mock.calls.length).toBeLessThan(100)
    } finally {
      slice.mockRestore()
    }
  })

  it('stops at the row ceiling and says so', () => {
    const buffer = mhtml([
      {
        location: CAPTURE_URL,
        html: page('<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a>')
      }
    ])
    const sources = { captureUrl: CAPTURE_URL, mhtml: buffer, html: null, text: null }
    const capped = extractFields(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 2 })
    expect(capped.fields.map((f) => f.value)).toEqual(['/1', '/2'])
    expect(capped.truncated).toBe(true)
    expect(extractFields(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 3 }).truncated).toBe(false)
  })
})

const HEADER_PAGE = [
  'This page is fictional.',
  'Show original',
  'Return-Path: <bounce-7731@relay.corvane-post.example.net>',
  'Received: from relay.corvane-post.example.net (relay.corvane-post.example.net [192.0.2.14])',
  '\tby mx.ostrander.example.net; Tue, 3 Mar 2026 09:14:02 +0000',
  'From: "Marsh, Lena"',
  ' <L.Marsh@Ostrander.EXAMPLE.net>',
  'Reply-To: l.marsh.remit@corvane-post.example.net, Desk (remittance) <desk@corvane-post.example.net>',
  'Subject: Remittance details',
  'Message-ID: <4471.remit@ostrander.example.net>',
  'X-Originating-IP: [198.51.100.23]',
  '',
  'Body text follows.'
]

describe('headerFieldsFromText', () => {
  it('lists the headers the spec names, in one place', () => {
    expect(HEADER_FIELDS).toEqual([
      'From',
      'Reply-To',
      'Sender',
      'Return-Path',
      'Message-ID',
      'In-Reply-To',
      'Organization',
      'Newsgroups',
      'NNTP-Posting-Host',
      'X-Originating-IP'
    ])
  })

  it('lists the names that mark a run of header lines as a block', () => {
    expect([...BLOCK_MARKERS]).toEqual([
      'from',
      'reply-to',
      'sender',
      'message-id',
      'path',
      'received'
    ])
  })

  it('gives every field it records a search bar label', () => {
    const header = HEADER_FIELDS.map((name) => `${name}: x@example.org`).join('\n')
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: Buffer.from(page('<a href="/a"><img alt="Pay"></a>')),
      text: header
    })
    const recorded = new Set(fields.map((f) => f.field))
    expect(recorded.size).toBe(HEADER_FIELDS.length + 2)
    expect([...recorded].filter((field) => fieldLabel(field) === field)).toEqual([])
    expect(fieldLabel('header.message-id')).toBe('Message-ID header')
  })

  it('reads a block with folded lines, one field per address, with LF line ends', () => {
    const text = HEADER_PAGE.join('\n')
    const fields = headerFieldsFromText(text)
    expect(pick(fields)).toEqual([
      {
        field: 'header.return-path',
        value: '<bounce-7731@relay.corvane-post.example.net>',
        norm: 'bounce-7731@relay.corvane-post.example.net'
      },
      {
        field: 'header.from',
        value: '"Marsh, Lena"\n <L.Marsh@Ostrander.EXAMPLE.net>',
        norm: 'l.marsh@ostrander.example.net'
      },
      {
        field: 'header.reply-to',
        value: 'l.marsh.remit@corvane-post.example.net',
        norm: 'l.marsh.remit@corvane-post.example.net'
      },
      {
        field: 'header.reply-to',
        value: 'Desk (remittance) <desk@corvane-post.example.net>',
        norm: 'desk@corvane-post.example.net'
      },
      {
        field: 'header.message-id',
        value: '<4471.remit@ostrander.example.net>',
        norm: '<4471.remit@ostrander.example.net>'
      },
      { field: 'header.x-originating-ip', value: '[198.51.100.23]', norm: '[198.51.100.23]' }
    ])
    expectSpansInText(text, fields)
  })

  it('gives the same fields with CRLF line ends, at offsets into that text', () => {
    const text = HEADER_PAGE.join('\r\n')
    const fields = headerFieldsFromText(text)
    expect(fields.map((f) => f.norm)).toEqual(
      headerFieldsFromText(HEADER_PAGE.join('\n')).map((f) => f.norm)
    )
    expect(fields[1].value).toBe('"Marsh, Lena"\r\n <L.Marsh@Ostrander.EXAMPLE.net>')
    expectSpansInText(text, fields)
  })

  it('reads every listed header in a Usenet block marked by Path', () => {
    const text = [
      'Path: news.example.org!not-for-mail',
      'Sender: Quillmere Desk <desk@quillmere-supplies.example.com>',
      'Newsgroups: misc.test,  alt.test',
      'In-Reply-To: <a1@quillmere-supplies.example.com>',
      'Organization: Quillmere   Supplies',
      'NNTP-Posting-Host: posting.example.org'
    ].join('\n')
    const fields = headerFieldsFromText(text)
    expect(fields.map(({ field, norm }) => [field, norm])).toEqual([
      ['header.sender', 'desk@quillmere-supplies.example.com'],
      ['header.newsgroups', 'misc.test, alt.test'],
      ['header.in-reply-to', '<a1@quillmere-supplies.example.com>'],
      ['header.organization', 'Quillmere Supplies'],
      ['header.nntp-posting-host', 'posting.example.org']
    ])
    expectSpansInText(text, fields)
  })

  it('reads nothing from a lone From: line in prose, or from a run with no marker', () => {
    expect(
      headerFieldsFromText(
        'The letter was signed\nFrom: Lena Marsh <lena@example.net>\nand nothing else.'
      )
    ).toEqual([])
    expect(headerFieldsFromText('Status: open\nPriority: high\nOrganization: Quillmere')).toEqual(
      []
    )
  })

  it('reads a short block, and skips an empty value and an empty address', () => {
    const fields = headerFieldsFromText('From: Lena Marsh\nReply-To:\nReturn-Path: <>')
    expect(pick(fields)).toEqual([
      { field: 'header.from', value: 'Lena Marsh', norm: 'lena marsh' }
    ])
  })

  it('keeps the spaces in a quoted local part, and drops its line breaks', () => {
    const text = 'From: <"First Last"@Example.com>\nReply-To: <"first\n last"@example.com>'
    expect(headerFieldsFromText(text).map((f) => f.norm)).toEqual([
      '"first last"@example.com',
      '"first last"@example.com'
    ])
  })
})

describe('extractFields: text and page together', () => {
  it('lists the header fields first, then the links', () => {
    const text = 'From: a@example.net\nMessage-ID: <1@example.net>'
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: mhtml([{ location: CAPTURE_URL, html: page('<a href="/x">x</a>') }]),
      html: null,
      text
    })
    expect(fields.map((f) => f.field)).toEqual(['header.from', 'header.message-id', 'link.href'])
  })

  it('returns nothing, and refuses nothing, when there is no source', () => {
    expect(extractFields({ captureUrl: CAPTURE_URL, mhtml: null, html: null, text: null })).toEqual(
      {
        fields: [],
        skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
        mainDocumentSkipped: false,
        truncated: false
      }
    )
  })
})
