import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  extractHtmlFromMhtml,
  extractHtmlPartsFromMhtml,
  listHtmlPartsInMhtml
} from '@main/services/mhtmlDecoder'

function mhtml(lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n'), 'utf-8')
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
