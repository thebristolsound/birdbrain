import { describe, it, expect } from 'vitest'
import { extractHtmlFromMhtml } from '@main/services/mhtmlDecoder'

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
})
