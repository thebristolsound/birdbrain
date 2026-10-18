import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { extractHtmlFromMhtml, listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import { linksFromMhtml } from '@main/services/captureLinks'
import { CAPTURE_LINK_BUDGETS, type CaptureLinkBudgets } from '@main/services/htmlParts'
import { EXTRACTION_RULES, extractData } from '@main/services/dataExtractor'
import * as iocAdapter from '@main/services/extraction/iocAdapter'
import * as validators from '@main/services/extraction/validators'
import {
  BLOCK_MARKERS,
  extractFields,
  FIELD_EXTRACTOR_VERSION,
  headerFieldsFromText,
  type ExtractedField,
  type FieldExtraction,
  type FieldSources
} from '@main/services/search/fieldExtractor'
import { fieldLabel, HEADER_FIELDS } from '@shared/searchFields'

// Known answers for the Case search field extractor (docs/plans/2026-10-09-case-
// retrieval-first-slice.md, D3 and D4, and docs/plans/2026-10-10-case-investigation-
// engine.md, E11). Every field's offsets must slice back to its value in the string they
// index: the decoded part, or the Extracted Text.

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
  return extract({
    captureUrl: CAPTURE_URL,
    mhtml: mhtml([{ location: CAPTURE_URL, html: page(body, head) }]),
    html: null,
    text: null
  })
}

function pick(fields: ExtractedField[]) {
  return fields.map(({ field, value, norm }) => ({ field, value, norm }))
}

// The fields `fields/1` recorded: the two link fields and the first ten headers, which
// the HEADER_FIELDS pin below keeps first. Its expectations read the same under fields/2.
const FIELDS_1 = new Set([
  'link.href',
  'link.alt',
  ...HEADER_FIELDS.slice(0, 10).map((name) => `header.${name.toLowerCase()}`)
])

function fields1(fields: ExtractedField[]): ExtractedField[] {
  return fields.filter((f) => FIELDS_1.has(f.field))
}

function only(fields: ExtractedField[], ...names: string[]): ExtractedField[] {
  return fields.filter((f) => names.includes(f.field))
}

// Invented values in the shapes ioc-extractor 8.2.0 matches; none is a real wallet.
const BTC = '1QuackMereDeskFictionWa77etXyz8'
const ETH = `0x${'ab12cd34ef'.repeat(4)}`
const XMR = `4A${'QuiMereDeskFictionWa77etNotRea1'.repeat(3)}`

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

// Every field, sliced from the string it indexes, is its value: the decoded part for
// an html-part field (a legacy page's file read as UTF-8 for part 0), the text for a
// text field. Every test checks it: through these two wrappers, or, in the row-ceiling
// test, which reads fields directly so its slice spy counts only the extractor, by
// calling this check itself once the spy is removed.
function expectSpansSliceBack(sources: FieldSources, fields: ExtractedField[]): void {
  if (fields.length === 0) return
  const parts = sources.mhtml
    ? listHtmlPartsInMhtml(sources.mhtml).parts.map((part) => part.decode())
    : sources.html
      ? [sources.html.toString('utf8')]
      : []
  for (const field of fields) {
    const indexed = field.source === 'text' ? sources.text : parts[field.part ?? -1]
    expect(indexed?.slice(field.startOffset, field.endOffset)).toBe(field.value)
  }
}

function extract(sources: FieldSources, budgets?: CaptureLinkBudgets): FieldExtraction {
  const extraction = extractFields(sources, budgets)
  expectSpansSliceBack(sources, extraction.fields)
  return extraction
}

function headersOf(text: string): ExtractedField[] {
  const fields = headerFieldsFromText(text)
  expectSpansSliceBack({ captureUrl: CAPTURE_URL, mhtml: null, html: null, text }, fields)
  return fields
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

  it('resolves a relative <base href> against the document first', () => {
    const { fields } = fromPage('<a href="ledger/7">a</a>', '<base href="/archive/">')
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: 'ledger/7',
        norm: 'https://brindle-forum.example.org/archive/ledger/7'
      }
    ])
  })

  it("records an href written with no value as an empty span at the attribute's end", () => {
    const html = page('<a href>x</a>')
    const { fields } = extract({
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
    expect(pick(fields1(fields))).toEqual([
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
    const { fields } = extract({
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
    const { fields } = extract({
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
    const { fields } = extract({
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
    const { fields } = extract({
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

  // The version names the default budgets as well as the rules. A change to the shared
  // budgets fails here, and whoever edits these values moves the version with them.
  it('pins the default budgets the extractor version was built with', () => {
    expect(FIELD_EXTRACTOR_VERSION).toBe('fields/2')
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
      const extracted = extract(
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
    const refused = extract(
      { captureUrl: CAPTURE_URL, mhtml: frames, html: null, text: null },
      budgets
    )
    expect(refused.fields.map((f) => f.norm)).toEqual(['https://brindle-forum.example.org/main'])
    expect(refused.skippedParts).toEqual({ tooLarge: 1, overPartCount: 0, overTotalSize: 0 })
    expect(refused.mainDocumentSkipped).toBe(false)

    const main = mhtml([{ location: CAPTURE_URL, html: big }])
    expect(
      extract({ captureUrl: CAPTURE_URL, mhtml: main, html: null, text: null }, budgets)
    ).toMatchObject({ fields: [], mainDocumentSkipped: true })
    const legacy = Buffer.from(big)
    const decode = vi.spyOn(legacy, 'toString')
    expect(
      extract({ captureUrl: CAPTURE_URL, mhtml: null, html: legacy, text: null }, budgets)
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
      expect(extract(sources, budgets)).toMatchObject({
        fields: [],
        mainDocumentSkipped: true
      })
    }
  })

  it('stops scanning header blocks at the row ceiling', () => {
    const block = 'From: a@example.net\nMessage-ID: <1@example.net>\n\n'
    const text = block.repeat(5000)
    const sources = { captureUrl: CAPTURE_URL, mhtml: null, html: null, text }
    const budgets = { ...CAPTURE_LINK_BUDGETS, maxRows: 2 }
    const slice = vi.spyOn(String.prototype, 'slice')
    let capped: FieldExtraction
    try {
      // Read without the wrapper, whose own slicing would count against the spy.
      capped = extractFields(sources, budgets)
      expect(slice.mock.calls.length).toBeLessThan(100)
    } finally {
      slice.mockRestore()
    }
    expect(capped.fields).toHaveLength(2)
    expect(capped.truncated).toBe(true)
    expectSpansSliceBack(sources, capped.fields)
  })

  it('stops at the row ceiling on an image link alt text too', () => {
    const buffer = mhtml([
      { location: CAPTURE_URL, html: page('<a href="/1"><img alt="One"></a>') }
    ])
    const capped = extractFields(
      { captureUrl: CAPTURE_URL, mhtml: buffer, html: null, text: null },
      { ...CAPTURE_LINK_BUDGETS, maxRows: 1 }
    )
    expect(capped.fields.map((f) => f.field)).toEqual(['link.href'])
    expect(capped.truncated).toBe(true)
  })

  it('stops at the row ceiling and says so', () => {
    const buffer = mhtml([
      {
        location: CAPTURE_URL,
        html: page('<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a>')
      }
    ])
    const sources = { captureUrl: CAPTURE_URL, mhtml: buffer, html: null, text: null }
    const capped = extract(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 2 })
    expect(capped.fields.map((f) => f.value)).toEqual(['/1', '/2'])
    expect(capped.truncated).toBe(true)
    expect(extract(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 3 }).truncated).toBe(false)
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
      'X-Originating-IP',
      'To',
      'Cc',
      'Path',
      'References'
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
    const header = [
      ...HEADER_FIELDS.filter((name) => name !== 'Path' && name !== 'References').map(
        (name) => `${name}: x@hollis-mail.example.org`
      ),
      'Path: news.example.org!not-for-mail',
      'References: <1@hollis-mail.example.org>',
      '',
      'Pay at https://ledger.example.org/pay'
    ].join('\n')
    const { fields } = extract({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: Buffer.from(
        page(`<a href="/a"><img src="a.png" alt="Pay"></a><p>GTM-QX4R7T ${ETH}</p>`)
      ),
      text: header
    })
    const recorded = new Set(fields.map((f) => f.field))
    // Each header, the two link fields, and the five page and text kinds fields/2 adds.
    expect(recorded.size).toBe(HEADER_FIELDS.length + 7)
    expect([...recorded].filter((field) => fieldLabel(field) === field)).toEqual([])
    expect(fieldLabel('header.message-id')).toBe('Message-ID header')
  })

  it('labels the kinds fields/2 adds', () => {
    expect(
      [
        'header.to',
        'header.cc',
        'header.path',
        'header.references',
        'image.src',
        'text.address',
        'text.url',
        'id.tracking',
        'id.crypto'
      ].map(fieldLabel)
    ).toEqual([
      'To header',
      'Cc header',
      'Path header',
      'References header',
      'Image address',
      'Email address in page text',
      'Web address in page text',
      'Tracking code',
      'Cryptocurrency address'
    ])
  })

  it('reads a block with folded lines, one field per address, with LF line ends', () => {
    const text = HEADER_PAGE.join('\n')
    const fields = headersOf(text)
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
    const fields = headersOf(text)
    expect(fields.map((f) => f.norm)).toEqual(headersOf(HEADER_PAGE.join('\n')).map((f) => f.norm))
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
    const fields = headersOf(text)
    expect(fields1(fields).map(({ field, norm }) => [field, norm])).toEqual([
      ['header.sender', 'desk@quillmere-supplies.example.com'],
      ['header.newsgroups', 'misc.test, alt.test'],
      ['header.in-reply-to', '<a1@quillmere-supplies.example.com>'],
      ['header.organization', 'Quillmere Supplies'],
      ['header.nntp-posting-host', 'posting.example.org']
    ])
    expectSpansInText(text, fields)
  })

  it('keeps a block going past a header name with an underscore, as with a hyphen', () => {
    for (const name of ['X-Spam_score', 'X-Spam-score']) {
      const text = [
        'Received: from a.example (a.example [192.0.2.1])',
        `${name}: 5.1`,
        'From: Lena <lena@example.net>',
        '',
        'body'
      ].join('\n')
      const fields = headerFieldsFromText(text)
      expect(pick(only(fields, 'header.from'))).toEqual([
        { field: 'header.from', value: 'Lena <lena@example.net>', norm: 'lena@example.net' }
      ])
      expectSpansInText(text, fields)
    }
  })

  it('reads nothing from a lone From: line in prose, or from a run with no marker', () => {
    expect(
      headersOf('The letter was signed\nFrom: Lena Marsh <lena@example.net>\nand nothing else.')
    ).toEqual([])
    expect(headersOf('Status: open\nPriority: high\nOrganization: Quillmere')).toEqual([])
  })

  it('reads a short block, and skips an empty value and an empty address', () => {
    const fields = headersOf('From: Lena Marsh\nReply-To:\nReturn-Path: <>')
    expect(pick(fields)).toEqual([
      { field: 'header.from', value: 'Lena Marsh', norm: 'lena marsh' }
    ])
  })

  it('keeps the spaces in a quoted local part, and drops its line breaks', () => {
    const text = 'From: <"First Last"@Example.com>\nReply-To: <"first\n last"@example.com>'
    expect(headersOf(text).map((f) => f.norm)).toEqual([
      '"first last"@example.com',
      '"first last"@example.com'
    ])
  })
})

describe('extractFields: text and page together', () => {
  it('lists the header fields first, then the links', () => {
    const text = 'From: a@example.net\nMessage-ID: <1@example.net>'
    const { fields } = extract({
      captureUrl: CAPTURE_URL,
      mhtml: mhtml([{ location: CAPTURE_URL, html: page('<a href="/x">x</a>') }]),
      html: null,
      text
    })
    expect(fields.map((f) => f.field)).toEqual(['header.from', 'header.message-id', 'link.href'])
  })

  it('returns nothing, and refuses nothing, when there is no source', () => {
    expect(extract({ captureUrl: CAPTURE_URL, mhtml: null, html: null, text: null })).toEqual({
      fields: [],
      skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
      mainDocumentSkipped: false,
      truncated: false
    })
  })
})

describe('extractFields: the headers fields/2 adds', () => {
  it('reads To and Cc one record per mailbox, and References one per identifier', () => {
    const text = [
      'From: Wren Hollis <wren@hollis-mail.example.org>',
      'To: "Pike, Rowan" <R.Pike@Lantern.example.org>, desk@quillmere.example.com',
      'Cc: Imogen Hale',
      ' <ihale@lantern.example.org>',
      'Message-ID: <77.reply@hollis-mail.example.org>',
      'References: <12.first@lantern.example.org>',
      '\t<34.second@lantern.example.org> <>'
    ].join('\n')
    const fields = headerFieldsFromText(text)
    expect(pick(only(fields, 'header.to', 'header.cc', 'header.references'))).toEqual([
      {
        field: 'header.to',
        value: '"Pike, Rowan" <R.Pike@Lantern.example.org>',
        norm: 'r.pike@lantern.example.org'
      },
      {
        field: 'header.to',
        value: 'desk@quillmere.example.com',
        norm: 'desk@quillmere.example.com'
      },
      {
        field: 'header.cc',
        value: 'Imogen Hale\n <ihale@lantern.example.org>',
        norm: 'ihale@lantern.example.org'
      },
      {
        field: 'header.references',
        value: '<12.first@lantern.example.org>',
        norm: '<12.first@lantern.example.org>'
      },
      {
        field: 'header.references',
        value: '<34.second@lantern.example.org>',
        norm: '<34.second@lantern.example.org>'
      }
    ])
    expectSpansInText(text, fields)
  })

  it('reads the mailboxes of a group, without its name or closing semicolon', () => {
    const text = [
      'From: Lena <lena@harrow.example.net>',
      'To: undisclosed-recipients:;',
      'Cc: Desk team: A@Harrow.example.net, b@harrow.example.net;',
      '',
      'body'
    ].join('\n')
    const fields = headerFieldsFromText(text)
    expect(pick(only(fields, 'header.to', 'header.cc'))).toEqual([
      { field: 'header.cc', value: 'A@Harrow.example.net', norm: 'a@harrow.example.net' },
      { field: 'header.cc', value: 'b@harrow.example.net', norm: 'b@harrow.example.net' }
    ])
    expectSpansInText(text, fields)
  })

  it('reads each site in a Path, and nothing from the tail, an empty entry or a bare diagnostic', () => {
    const text = [
      'Path: News.Harrow.example.net!.POSTED.posting.example.org!!feed.example.org!',
      ' relay.example.com!.SEEN!not-for-mail',
      'From: Jun Sato <calloway@harrow.example.net>'
    ].join('\n')
    const fields = headerFieldsFromText(text)
    expect(pick(only(fields, 'header.path'))).toEqual([
      { field: 'header.path', value: 'News.Harrow.example.net', norm: 'news.harrow.example.net' },
      { field: 'header.path', value: 'posting.example.org', norm: 'posting.example.org' },
      { field: 'header.path', value: 'feed.example.org', norm: 'feed.example.org' },
      { field: 'header.path', value: 'relay.example.com', norm: 'relay.example.com' }
    ])
    expectSpansInText(text, fields)
    // A Path of one entry holds only its tail.
    expect(
      only(headerFieldsFromText('Path: lone-site\nFrom: a@b.example.net'), 'header.path')
    ).toEqual([])
  })
})

describe('extractFields: the page identifiers fields/2 adds', () => {
  function fromParts(html: string, head = '') {
    const buffer = mhtml([{ location: CAPTURE_URL, html: page(html, head) }])
    const extraction = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: buffer,
      html: null,
      text: null
    })
    expectSpansInParts(buffer, extraction.fields)
    return extraction
  }

  it('records every image source, in a link or not, resolved, and no data: or empty source', () => {
    const { fields } = fromParts(
      '<a href="/pay"><img src="img/desk.png" alt="Pay"></a>' +
        '<img src=" https://Cdn.Northgate-Ledger.example.com/a.png ">' +
        '<img src="data:image/png;base64,AAAA"><img src="">',
      '<base href="https://mirror.example.net/archive/">'
    )
    expect(pick(fields)).toEqual([
      {
        field: 'link.href',
        value: '/pay',
        norm: 'https://mirror.example.net/pay'
      },
      { field: 'link.alt', value: 'Pay', norm: 'Pay' },
      {
        field: 'image.src',
        value: 'img/desk.png',
        norm: 'https://mirror.example.net/archive/img/desk.png'
      },
      {
        field: 'image.src',
        value: ' https://Cdn.Northgate-Ledger.example.com/a.png ',
        norm: 'https://cdn.northgate-ledger.example.com/a.png'
      }
    ])
  })

  it('records the tracking codes the extraction rules and extractIocs() find, scripts included', () => {
    const { fields } = fromParts(
      '<script>gtag("config", "G-QM7R2K4W9X"); fbq(\'init\', \'204871365920471\');</script>' +
        '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-QX4R7T"></script>' +
        '<p>Ads AW-123456789, analytics UA-31415926-2, publisher ca-pub-2718281828459045.</p>'
    )
    expect(pick(only(fields, 'id.tracking')).map(({ value, norm }) => [value, norm])).toEqual([
      ['G-QM7R2K4W9X', 'G-QM7R2K4W9X'],
      ['204871365920471', '204871365920471'],
      ['GTM-QX4R7T', 'GTM-QX4R7T'],
      ['AW-123456789', 'AW-123456789'],
      ['UA-31415926-2', 'UA-31415926-2'],
      ['pub-2718281828459045', 'pub-2718281828459045']
    ])
  })

  it('reads a Facebook Pixel call only within the rule window after its fbq', () => {
    const near = "fbq('init', '204871365920471')"
    const far = `fbq('init',${' '.repeat(120)}'204871365920472')`
    const { fields } = fromParts(`<script>${near}; ${far}</script>`)
    expect(only(fields, 'id.tracking').map((f) => f.value)).toEqual(['204871365920471'])
  })

  it('gives one record when two patterns find the same span', () => {
    vi.spyOn(iocAdapter, 'extractIocs').mockReturnValue([
      { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'G-QM7R2K4W9X' }
    ])
    try {
      const { fields } = fromParts('<script>gtag("config", "G-QM7R2K4W9X")</script>')
      expect(only(fields, 'id.tracking').map((f) => f.value)).toEqual(['G-QM7R2K4W9X'])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('records each cryptocurrency address, and none inside a longer token', () => {
    const { fields } = fromParts(
      `<p>Send to ${BTC} or ${ETH}.</p><p>Monero: ${XMR}</p><p>Again ${BTC}, and x${ETH}</p>`
    )
    expect(only(fields, 'id.crypto').map((f) => f.value)).toEqual([BTC, ETH, XMR, BTC])
  })

  it('gives no record for a value extractIocs() returns that the part does not hold', () => {
    vi.spyOn(iocAdapter, 'extractIocs').mockReturnValue([
      { category: 'Cryptocurrency', subcategory: 'Bitcoin Address', value: BTC }
    ])
    try {
      const { fields } = fromParts('<p>No wallet here.</p>')
      expect(only(fields, 'id.crypto')).toEqual([])
    } finally {
      vi.restoreAllMocks()
    }
  })

  // A spread of every returned value's length (`Math.min(...lengths)`) overflowed the
  // stack at about 125,000 values, before the row ceiling, and the build wrote a failed
  // row with no records for the Capture.
  it('reads a part whose extractIocs() returns 200,000 distinct values', () => {
    const values = Array.from({ length: 200_000 }, (_, i) => `UA-${10_000_000 + i}-1`)
    vi.spyOn(iocAdapter, 'extractIocs').mockReturnValue(
      values.map((value) => ({ category: 'Tracking Code', subcategory: 'Google Analytics', value }))
    )
    try {
      const { fields, truncated } = fromParts(`<p>${values[0]} and ${values[199_999]}</p>`)
      expect(only(fields, 'id.tracking').map((f) => f.value)).toEqual([values[0], values[199_999]])
      expect(truncated).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('extractFields: the page text identifiers fields/2 adds', () => {
  function fromText(text: string) {
    const extraction = extractFields({ captureUrl: CAPTURE_URL, mhtml: null, html: null, text })
    expectSpansInText(text, extraction.fields)
    return extraction
  }

  it('records each email address in the text, header lines included, in lower case', () => {
    const text = [
      'From: Wren Hollis <Wren@Hollis-Mail.example.org>',
      'Message-ID: <a1@hollis-mail.example.org>',
      '',
      'Write to Wren@Hollis-Mail.example.org, or to desk@quillmere.example.com.',
      'Not an address: someone@example.com, nor wren@hollis-mail.example.organisation.'
    ].join('\n')
    const { fields } = fromText(text)
    // A Message-ID written like an address reads as one, as extractData() reads it.
    expect(pick(only(fields, 'text.address'))).toEqual([
      {
        field: 'text.address',
        value: 'Wren@Hollis-Mail.example.org',
        norm: 'wren@hollis-mail.example.org'
      },
      {
        field: 'text.address',
        value: 'a1@hollis-mail.example.org',
        norm: 'a1@hollis-mail.example.org'
      },
      {
        field: 'text.address',
        value: 'Wren@Hollis-Mail.example.org',
        norm: 'wren@hollis-mail.example.org'
      },
      {
        field: 'text.address',
        value: 'desk@quillmere.example.com',
        norm: 'desk@quillmere.example.com'
      }
    ])
    // The header line keeps its own record beside the address one.
    expect(only(fields, 'header.from').map((f) => f.norm)).toEqual(['wren@hollis-mail.example.org'])
  })

  it('finds an address only where it stands whole, not at the start of a longer one', () => {
    const text =
      'Write to bob@harrow.example.net or to bob@harrow.example.net.au, ' +
      'or bob@harrow.example.net-mail.example.org today.'
    const { fields } = fromText(text)
    expect(only(fields, 'text.address').map((f) => [f.value, f.startOffset])).toEqual([
      ['bob@harrow.example.net', 9],
      ['bob@harrow.example.net.au', 38],
      ['bob@harrow.example.net-mail.example.org', 68]
    ])
  })

  it("reads a local part with the characters extractIocs() reads, such as ' and !", () => {
    const text = "Mail to o'neil@harrow.example.net, or to x!bob@harrow.example.net now."
    const { fields } = fromText(text)
    expect(only(fields, 'text.address').map((f) => [f.value, f.startOffset])).toEqual([
      ["o'neil@harrow.example.net", 8],
      ['x!bob@harrow.example.net', 41]
    ])
  })

  it('records no address written with [at], which extractIocs() returns rewritten', () => {
    const { fields, truncated } = fromText('Write to wren[at]hollis-mail.example.org today.')
    expect(only(fields, 'text.address')).toEqual([])
    expect(truncated).toBe(false)
  })

  it('records each web address, keeping its fragment and leaving off closing punctuation', () => {
    const text = [
      'See https://Ledger.example.org/a#/x/1, then https://ledger.example.org:443/b.',
      'Notes (https://ledger.example.org/c_(d)) and https://ledger.example.org/e).',
      'Ask at http://desk.example.net? Not https:// alone, nor xhttps://ledger.example.org/f'
    ].join('\n')
    const { fields } = fromText(text)
    expect(only(fields, 'text.url').map(({ value, norm }) => [value, norm])).toEqual([
      ['https://Ledger.example.org/a#/x/1', 'https://ledger.example.org/a#/x/1'],
      ['https://ledger.example.org:443/b', 'https://ledger.example.org/b'],
      ['https://ledger.example.org/c_(d)', 'https://ledger.example.org/c_(d)'],
      ['https://ledger.example.org/e', 'https://ledger.example.org/e'],
      ['http://desk.example.net', 'http://desk.example.net/']
    ])
  })
})

describe('extractFields: reading order under fields/2', () => {
  const text = [
    'From: a@hollis-mail.example.org',
    'Message-ID: <1@hollis-mail.example.org>',
    '',
    'See https://ledger.example.org/a and write to b@hollis-mail.example.org.'
  ].join('\n')
  const sources = {
    captureUrl: CAPTURE_URL,
    mhtml: mhtml([
      {
        location: CAPTURE_URL,
        html: page(
          '<a href="/1">1</a><a href="/2"><img src="x.png" alt="Two"></a><p>GTM-QX4R7T</p>'
        )
      }
    ]),
    html: null,
    text
  }

  it('reads the fields/1 kinds, then the page identifiers, then the text identifiers', () => {
    const { fields, truncated } = extractFields(sources)
    expectSpansSliceBack(sources, fields)
    expect(fields.map((f) => f.field)).toEqual([
      'header.from',
      'header.message-id',
      'link.href',
      'link.href',
      'link.alt',
      'image.src',
      'id.tracking',
      'text.address',
      'text.address',
      'text.address',
      'text.url'
    ])
    expect(truncated).toBe(false)
  })

  it('keeps every fields/1 record at the row ceiling and drops the later kinds first', () => {
    const atFive = extractFields(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 5 })
    expect(atFive.fields).toEqual(fields1(extractFields(sources).fields))
    expect(atFive.truncated).toBe(true)
    expectSpansSliceBack(sources, atFive.fields)
    const atSeven = extractFields(sources, { ...CAPTURE_LINK_BUDGETS, maxRows: 7 })
    expect(atSeven.fields.slice(5).map((f) => f.field)).toEqual(['image.src', 'id.tracking'])
    expect(atSeven.truncated).toBe(true)
    expectSpansSliceBack(sources, atSeven.fields)
  })

  it('reads the headers fields/2 adds in block order, so they can reach the ceiling first', () => {
    const headed = {
      ...sources,
      text: 'To: a@hollis-mail.example.org, b@hollis-mail.example.org\nFrom: c@hollis-mail.example.org'
    }
    const capped = extractFields(headed, { ...CAPTURE_LINK_BUDGETS, maxRows: 2 })
    expect(capped.fields.map((f) => f.field)).toEqual(['header.to', 'header.to'])
    expect(capped.truncated).toBe(true)
    expectSpansSliceBack(headed, capped.fields)
  })
})

// Fixtures 1, 2 and 12 of the engine evaluation Case (docs/plans/2026-10-10-case-
// investigation-engine.md, E14), built by hand until that Case exists.
describe('extractFields: engine fixtures 1, 2 and 12', () => {
  it('fixture 1: a newsreader header and a page tying M. Calloway to the same address', () => {
    const newsreader = [
      'This page is fictional.',
      'Path: news.harrow.example.net!feed.lantern.example.org!not-for-mail',
      'From: Jun Sato <calloway@harrow.example.net>',
      'Newsgroups: misc.fictional.ledgers',
      'NNTP-Posting-Host: posting.harrow.example.net',
      '',
      'Ledger notes for the week.'
    ].join('\n')
    const tie = 'M. Calloway signs the ledger notes as calloway@harrow.example.net each week.'
    const header = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: null,
      text: newsreader
    })
    const page2 = extractFields({ captureUrl: CAPTURE_URL, mhtml: null, html: null, text: tie })
    expectSpansInText(newsreader, header.fields)
    expectSpansInText(tie, page2.fields)
    const norms = (fields: ExtractedField[], name: string) => only(fields, name).map((f) => f.norm)
    expect(norms(header.fields, 'header.from')).toEqual(['calloway@harrow.example.net'])
    expect(norms(header.fields, 'header.path')).toEqual([
      'news.harrow.example.net',
      'feed.lantern.example.org'
    ])
    expect(norms(header.fields, 'header.nntp-posting-host')).toEqual(['posting.harrow.example.net'])
    expect(norms(page2.fields, 'text.address')).toEqual(norms(header.fields, 'header.from'))
  })

  it("fixture 2: an image link to another Capture's URL", () => {
    const other = 'https://quillmere-gazette.example.net/notices/14'
    const buffer = mhtml([
      {
        location: CAPTURE_URL,
        html: page(
          `<a href="${other}"><img src="https://cdn.northgate-ledger.example.com/banner.png" ` +
            'alt="Quillmere notice 14"></a>'
        )
      }
    ])
    const { fields } = extractFields({
      captureUrl: CAPTURE_URL,
      mhtml: buffer,
      html: null,
      text: null
    })
    expectSpansInParts(buffer, fields)
    expect(fields.map(({ field, norm }) => [field, norm])).toEqual([
      ['link.href', other],
      ['link.alt', 'Quillmere notice 14'],
      ['image.src', 'https://cdn.northgate-ledger.example.com/banner.png']
    ])
  })

  it('fixture 12: two links on a hash-routed site that differ only in the fragment', () => {
    const { fields } = fromPage(
      '<a href="https://ledger.example.org/#/accounts/1">a</a>' +
        '<a href="https://ledger.example.org/#/accounts/2">b</a>'
    )
    expect(only(fields, 'link.href').map((f) => f.norm)).toEqual([
      'https://ledger.example.org/#/accounts/1',
      'https://ledger.example.org/#/accounts/2'
    ])
  })
})

// The extractor imports extractData()'s Tracking Code patterns, which are global and
// keep state between calls, so it must leave them as it found them (E11).
describe('extractData beside extractFields', () => {
  it.each(['cnn-pope-synthetic.mhtml', 'cnn-iran-synthetic.mhtml'])(
    'gives the same output on %s before and after extractFields() runs',
    (name) => {
      const buffer = readFileSync(resolve(__dirname, 'extraction', 'fixtures', name))
      const html = extractHtmlFromMhtml(buffer)
      const before = extractData(html)
      const { fields } = extractFields({
        captureUrl: CAPTURE_URL,
        mhtml: buffer,
        html: null,
        text: null
      })
      expect(fields.length).toBeGreaterThan(0)
      expectSpansInParts(buffer, fields)
      for (const { patterns } of EXTRACTION_RULES) {
        for (const pattern of patterns) expect(pattern.lastIndex).toBe(0)
      }
      expect(extractData(html)).toEqual(before)
    }
  )
})

// The three inputs the review of #1899 measured, which took 57.8 s, 10.6 s and 8.4 s of
// wall time at a load average of 40 to 56 before each new kind was read in one pass that
// stops at the row ceiling. Each test checks what is recorded and counts the calls the
// scans make, which no clock affects; a time bound would fail on a loaded runner.
describe('extractFields: inputs that once took seconds', () => {
  function counted(run: () => unknown): { has: number; slice: number } {
    const has = vi.spyOn(Set.prototype, 'has')
    const slice = vi.spyOn(String.prototype, 'slice')
    try {
      run()
      return { has: has.mock.calls.length, slice: slice.mock.calls.length }
    } finally {
      has.mockRestore()
      slice.mockRestore()
    }
  }

  it('reads a web address followed by 40,000 closing brackets in one pass', () => {
    const sources: FieldSources = {
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: null,
      text: `see http://a${')'.repeat(40_000)} end`
    }
    const { fields } = extractFields(sources)
    expect(pick(fields)).toEqual([{ field: 'text.url', value: 'http://a', norm: 'http://a/' }])
    expectSpansSliceBack(sources, fields)
    // The brackets are counted once, with no copy of the address made per bracket.
    expect(counted(() => extractFields(sources)).slice).toBeLessThan(10)
  })

  it('stops reading addresses at the row ceiling, among 16,000', () => {
    const sources = (n: number): FieldSources => ({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: null,
      text: Array.from({ length: n }, (_, i) => `user${i}@host${i}.example.net`).join(' ')
    })
    const { fields, truncated } = extractFields(sources(16_000))
    expect(only(fields, 'text.address')).toHaveLength(CAPTURE_LINK_BUDGETS.maxRows)
    expect(truncated).toBe(true)
    expectSpansSliceBack(sources(16_000), fields)
    // Twice the addresses, the same work: nothing past the ceiling is read.
    expect(counted(() => extractFields(sources(16_000)))).toEqual(
      counted(() => extractFields(sources(8_000)))
    )
    const valid = vi.spyOn(validators, 'isValidEmail')
    try {
      extractFields(sources(16_000))
      expect(valid.mock.calls.length).toBeLessThanOrEqual(CAPTURE_LINK_BUDGETS.maxRows + 1)
    } finally {
      valid.mockRestore()
    }
  })

  it('stops reading tracking codes at the row ceiling, in a 280 KB part of 20,000', () => {
    const sources = (n: number): FieldSources => ({
      captureUrl: CAPTURE_URL,
      mhtml: null,
      html: Buffer.from(
        page(Array.from({ length: n }, (_, i) => `UA-${10_000_000 + i}-1`).join(' '))
      ),
      text: null
    })
    expect(sources(20_000).html?.byteLength).toBeGreaterThan(280_000)
    const { fields, truncated } = extractFields(sources(20_000))
    expect(only(fields, 'id.tracking')).toHaveLength(CAPTURE_LINK_BUDGETS.maxRows)
    expect(truncated).toBe(true)
    expectSpansSliceBack(sources(20_000), fields)
    expect(counted(() => extractFields(sources(20_000)))).toEqual(
      counted(() => extractFields(sources(10_000)))
    )
  })
})
