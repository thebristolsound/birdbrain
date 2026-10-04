import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Capture } from '@shared/types'
import { CAPTURE_LINK_BUDGETS, linksFromMhtml, readCaptureLinks } from '@main/services/captureLinks'

// Known answers for the Links tab's parser (#1708 D12, D13).

const CAPTURE_URL = 'https://news.example/story/1'

interface Part {
  location?: string | string[]
  html: string
  type?: string
}

function mhtml(parts: Part[], snapshot?: string): Buffer {
  const lines = [
    'From: <Saved by Blink>',
    ...(snapshot ? [`Snapshot-Content-Location: ${snapshot}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="B"',
    ''
  ]
  for (const { location, html, type = 'text/html' } of parts) {
    lines.push('--B', `Content-Type: ${type}`, 'Content-Transfer-Encoding: binary')
    if (Array.isArray(location))
      lines.push(`Content-Location: ${location[0]}`, ...location.slice(1))
    else if (location) lines.push(`Content-Location: ${location}`)
    lines.push('', html)
  }
  lines.push('--B--', '')
  return Buffer.from(lines.join('\r\n'), 'utf8')
}

function page(body: string, head = ''): string {
  return `<html><head>${head}</head><body>${body}</body></html>`
}

function linksOf(body: string, head = '', location = CAPTURE_URL) {
  return linksFromMhtml(mhtml([{ location, html: page(body, head) }]), CAPTURE_URL).links
}

describe('linksFromMhtml', () => {
  it('resolves relative and absolute links against the part’s own address', () => {
    const links = linksOf('<a href="../other">Other</a><a href="https://elsewhere.example/x">X</a>')
    expect(links.map(({ href, rawHref, kind, frame }) => ({ href, rawHref, kind, frame }))).toEqual(
      [
        { href: 'https://news.example/other', rawHref: '../other', kind: 'http', frame: 'main' },
        {
          href: 'https://elsewhere.example/x',
          rawHref: 'https://elsewhere.example/x',
          kind: 'http',
          frame: 'main'
        }
      ]
    )
    expect(links[0].documentUrl).toBe(CAPTURE_URL)
  })

  it('applies an absolute <base href>', () => {
    const [link] = linksOf('<a href="p">P</a>', '<base href="https://cdn.example/root/">')
    expect(link.href).toBe('https://cdn.example/root/p')
    expect(link.documentUrl).toBe(CAPTURE_URL)
  })

  it('resolves a relative <base href> against the document first', () => {
    const [link] = linksOf('<a href="p">P</a>', '<base href="/sub/">')
    expect(link.href).toBe('https://news.example/sub/p')
  })

  it('reads area links, with their alt as text', () => {
    const [link] = linksOf('<map><area href="/map-target" alt=" Map  region "></map>')
    expect(link).toMatchObject({ href: 'https://news.example/map-target', text: 'Map region' })
  })

  it('takes an image’s alt as the text of an anchor that has none', () => {
    const [link] = linksOf('<a href="/i"><img alt="Logo" src="x.png"></a>')
    expect(link.text).toBe('Logo')
  })

  it('collapses whitespace in anchor text', () => {
    expect(linksOf('<a href="/a">\n  Read   the\tstory </a>')[0].text).toBe('Read the story')
  })

  it.each([
    ['mailto:desk@news.example', 'mailto'],
    ['tel:+15550100', 'tel'],
    ['javascript:alert(1)', 'other'],
    ['ftp://files.example/a', 'other'],
    ['#comments', 'same-page'],
    ['', 'same-page'],
    ['https://news.example/story/1#top', 'same-page']
  ])('classifies %s as %s', (href, kind) => {
    expect(linksOf(`<a href="${href}">t</a>`)[0].kind).toBe(kind)
  })

  it('judges same-page against the link’s own document, not the base', () => {
    const [link] = linksOf('<a href="#x">x</a>', '<base href="https://cdn.example/">')
    expect(link).toMatchObject({ href: 'https://cdn.example/#x', kind: 'http' })
  })

  it('gives each iframe part its own document URL and marks it a subframe', () => {
    const buffer = mhtml(
      [
        { location: CAPTURE_URL, html: page('<a href="/main">m</a>') },
        { location: 'https://widgets.example/frame/w.html', html: page('<a href="next">n</a>') }
      ],
      CAPTURE_URL
    )
    const { links } = linksFromMhtml(buffer, CAPTURE_URL)
    expect(links.map(({ href, frame, documentUrl }) => ({ href, frame, documentUrl }))).toEqual([
      { href: 'https://news.example/main', frame: 'main', documentUrl: CAPTURE_URL },
      {
        href: 'https://widgets.example/frame/next',
        frame: 'subframe',
        documentUrl: 'https://widgets.example/frame/w.html'
      }
    ])
  })

  it('keeps the same href and text in two frames at different addresses as two rows', () => {
    const target = 'https://widgets.example/a.html'
    const buffer = mhtml(
      [
        { location: CAPTURE_URL, html: page('') },
        { location: target, html: page(`<a href="${target}">Go</a>`) },
        { location: 'https://other.example/b.html', html: page(`<a href="${target}">Go</a>`) }
      ],
      CAPTURE_URL
    )
    const { links } = linksFromMhtml(buffer, CAPTURE_URL)
    expect(
      links.map(({ href, text, kind, documentUrl, occurrences }) => ({
        href,
        text,
        kind,
        documentUrl,
        occurrences
      }))
    ).toEqual([
      { href: target, text: 'Go', kind: 'same-page', documentUrl: target, occurrences: 1 },
      {
        href: target,
        text: 'Go',
        kind: 'http',
        documentUrl: 'https://other.example/b.html',
        occurrences: 1
      }
    ])
  })

  it('takes the snapshot’s part as the main document wherever it sits in the file', () => {
    const buffer = mhtml(
      [
        { location: 'https://widgets.example/w.html', html: page('<a href="/w">w</a>') },
        { location: CAPTURE_URL, html: page('<a href="/m">m</a>') }
      ],
      CAPTURE_URL
    )
    expect(linksFromMhtml(buffer, CAPTURE_URL).links.map((l) => [l.href, l.frame])).toEqual([
      ['https://news.example/m', 'main'],
      ['https://widgets.example/w', 'subframe']
    ])
  })

  it('takes the first HTML part as the main document when no snapshot names one', () => {
    const buffer = mhtml([
      { location: 'https://a.example/', html: page('<a href="/1">1</a>') },
      { location: 'https://b.example/', html: page('<a href="/2">2</a>') }
    ])
    expect(linksFromMhtml(buffer, CAPTURE_URL).links.map((l) => l.frame)).toEqual([
      'main',
      'subframe'
    ])
  })

  it('falls back to the Capture’s URL for a cid: or missing location', () => {
    const buffer = mhtml([
      { location: 'cid:frame-1@mhtml.blink', html: page('<a href="x">x</a>') },
      { html: page('<a href="y">y</a>') }
    ])
    const { links } = linksFromMhtml(buffer, CAPTURE_URL)
    expect(links.map((l) => [l.href, l.documentUrl])).toEqual([
      ['https://news.example/story/x', CAPTURE_URL],
      ['https://news.example/story/y', CAPTURE_URL]
    ])
  })

  it('unfolds a Content-Location folded across header lines', () => {
    const buffer = mhtml([
      { location: ['https://folded.example/a/', '\tb/c.html'], html: page('<a href="d">d</a>') }
    ])
    expect(linksFromMhtml(buffer, CAPTURE_URL).links[0]).toMatchObject({
      href: 'https://folded.example/a/b/d',
      documentUrl: 'https://folded.example/a/b/c.html'
    })
  })

  it('collapses identical href, text, frame and document into one row and unions rel', () => {
    const links = linksOf(
      '<a href="/s" rel="Nofollow">S</a><a href="/s" rel="noopener nofollow">S</a>' +
        '<a href="/s">S</a><a href="/s">Different text</a>'
    )
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ occurrences: 3, rel: ['nofollow', 'noopener'] })
    expect(links[1]).toMatchObject({ occurrences: 1, rel: [] })
  })

  it('keeps an unresolvable href as stored', () => {
    const [link] = linksOf('<a href="http://[broken">b</a>')
    expect(link).toMatchObject({ href: 'http://[broken', rawHref: 'http://[broken', kind: 'other' })
  })

  describe('text and host mismatch', () => {
    it.each([
      ['https://bank.example/login', 'https://evil.example/login', true],
      ['bank.example', 'https://evil.example/', true],
      ['www.bank.example', 'https://bank.example/', false],
      ['BANK.EXAMPLE/login', 'https://www.bank.example/x', false],
      ['bücher.example', 'https://xn--bcher-kva.example/', false],
      ['bücher.example', 'https://buecher.example/', true],
      ['Read more', 'https://evil.example/', false],
      ['3.5 stars', 'https://evil.example/', false],
      ['', 'https://evil.example/', false]
    ])('text %s linking to %s mismatches: %s', (text, href, expected) => {
      expect(linksOf(`<a href="${href}">${text}</a>`)[0].textHostMismatch).toBe(expected)
    })

    it('flags a same-page link whose text names another host, and not one naming its own', () => {
      const [deceptive, honest] = linksOf(
        '<a href="#login">bank.example</a><a href="#top">news.example</a>'
      )
      expect(deceptive).toMatchObject({ kind: 'same-page', textHostMismatch: true })
      expect(honest).toMatchObject({ kind: 'same-page', textHostMismatch: false })
    })

    it('does not flag a link that has no host to compare', () => {
      expect(linksOf('<a href="mailto:a@evil.example">bank.example</a>')[0].textHostMismatch).toBe(
        false
      )
    })
  })

  describe('budgets', () => {
    it('stops listing at the row ceiling and says so', () => {
      const body = Array.from({ length: 5 }, (_, i) => `<a href="/${i}">${i}</a>`).join('')
      const result = linksFromMhtml(
        mhtml([{ location: CAPTURE_URL, html: page(body) }]),
        CAPTURE_URL,
        {
          ...CAPTURE_LINK_BUDGETS,
          maxRows: 3
        }
      )
      expect(result.links.map((l) => l.text)).toEqual(['0', '1', '2'])
      expect(result.truncated).toBe(true)
    })

    it('stops reading at the first link past the row ceiling, in that part and later ones', () => {
      const frame = 'https://w.example/'
      const result = linksFromMhtml(
        mhtml(
          [
            { location: CAPTURE_URL, html: page('<a href="/a">a</a>') },
            { location: frame, html: page('<a href="/b">b</a><a href="/c">c</a><a href="/b">b</a>') },
            { location: frame, html: page('<a href="/b">b</a>') }
          ],
          CAPTURE_URL
        ),
        CAPTURE_URL,
        { ...CAPTURE_LINK_BUDGETS, maxRows: 2 }
      )
      expect(result.truncated).toBe(true)
      // /c overflows. The repeats of /b after it, one in the same part and one in the
      // next, are not read, so they are not counted.
      expect(result.links.map(({ text, occurrences }) => [text, occurrences])).toEqual([
        ['a', 1],
        ['b', 1]
      ])
    })

    it('skips an over-size subframe before decoding it, and counts it', () => {
      const buffer = mhtml(
        [
          { location: CAPTURE_URL, html: page('<a href="/m">m</a>') },
          { location: 'https://big.example/', html: page('<a href="/b">b</a>' + 'x'.repeat(500)) }
        ],
        CAPTURE_URL
      )
      const result = linksFromMhtml(buffer, CAPTURE_URL, {
        ...CAPTURE_LINK_BUDGETS,
        maxPartBytes: 200
      })
      expect(result).toMatchObject({
        skippedParts: { tooLarge: 1, overPartCount: 0, overTotalSize: 0 },
        mainDocumentSkipped: false,
        truncated: false
      })
      expect(result.links.map((l) => l.href)).toEqual(['https://news.example/m'])
    })

    it('reports an over-size main document rather than an empty page', () => {
      const buffer = mhtml(
        [
          { location: CAPTURE_URL, html: page('<a href="/m">m</a>' + 'x'.repeat(500)) },
          { location: 'https://w.example/', html: page('<a href="/w">w</a>') }
        ],
        CAPTURE_URL
      )
      const result = linksFromMhtml(buffer, CAPTURE_URL, {
        ...CAPTURE_LINK_BUDGETS,
        maxPartBytes: 200
      })
      expect(result).toMatchObject({
        skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
        mainDocumentSkipped: true
      })
      expect(result.links.map((l) => l.frame)).toEqual(['subframe'])
    })

    it('skips the parts after the part ceiling, main document first in the count', () => {
      const parts = Array.from({ length: 4 }, (_, i) => ({
        location: `https://p${i}.example/`,
        html: page(`<a href="/${i}">${i}</a>`)
      }))
      const result = linksFromMhtml(mhtml(parts, 'https://p2.example/'), CAPTURE_URL, {
        ...CAPTURE_LINK_BUDGETS,
        maxParts: 2
      })
      expect(result.skippedParts).toEqual({ tooLarge: 0, overPartCount: 2, overTotalSize: 0 })
      expect(result.links.map((l) => l.href)).toEqual([
        'https://p2.example/2',
        'https://p0.example/0'
      ])
    })

    it('stops decoding once the parts read reach the total ceiling', () => {
      const parts = Array.from({ length: 3 }, (_, i) => ({
        location: `https://p${i}.example/`,
        html: page(`<a href="/${i}">${i}</a>`)
      }))
      const onePart = page('<a href="/0">0</a>').length
      const result = linksFromMhtml(mhtml(parts), CAPTURE_URL, {
        ...CAPTURE_LINK_BUDGETS,
        maxTotalBytes: onePart * 2
      })
      expect(result.skippedParts).toEqual({ tooLarge: 0, overPartCount: 0, overTotalSize: 1 })
      expect(result.links.map((l) => l.href)).toEqual([
        'https://p0.example/0',
        'https://p1.example/1'
      ])
    })

    it('counts the main document refused by the total ceiling as skipped', () => {
      const buffer = mhtml([{ location: CAPTURE_URL, html: page('<a href="/m">m</a>') }])
      expect(
        linksFromMhtml(buffer, CAPTURE_URL, { ...CAPTURE_LINK_BUDGETS, maxTotalBytes: 10 })
      ).toMatchObject({
        links: [],
        mainDocumentSkipped: true,
        skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 }
      })
    })

    it('ignores non-HTML parts entirely', () => {
      const buffer = mhtml([
        { location: CAPTURE_URL, html: page('<a href="/m">m</a>') },
        { location: 'https://i.example/a.png', html: 'x'.repeat(500), type: 'image/png' }
      ])
      expect(
        linksFromMhtml(buffer, CAPTURE_URL, {
          ...CAPTURE_LINK_BUDGETS,
          maxPartBytes: 200,
          maxTotalBytes: 200
        })
      ).toMatchObject({ skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 } })
    })
  })

  it('answers no links for a buffer that is not an MHTML', () => {
    expect(linksFromMhtml(Buffer.from('not mime'), CAPTURE_URL)).toEqual({
      links: [],
      truncated: false,
      skippedParts: { tooLarge: 0, overPartCount: 0, overTotalSize: 0 },
      mainDocumentSkipped: false
    })
  })
})

describe('readCaptureLinks', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  function capture(overrides: Partial<Capture>): Capture {
    return { id: 'c1', caseId: 'k1', url: CAPTURE_URL, title: 't', ...overrides } as Capture
  }

  it('reads the Capture’s stored MHTML through the store', async () => {
    dir = mkdtempSync(join(tmpdir(), 'capture-links-'))
    writeFileSync(
      join(dir, 'c1.mhtml'),
      mhtml([{ location: CAPTURE_URL, html: page('<a href="/a">a</a>') }])
    )
    const store = { resolveAbsolute: (rel: string) => join(dir as string, rel) }
    const result = await readCaptureLinks(capture({ mhtmlPath: 'c1.mhtml' }), store)
    expect(result?.links[0].href).toBe('https://news.example/a')
  })

  it('answers null when there is no MHTML to read', async () => {
    const store = { resolveAbsolute: (rel: string) => join(tmpdir(), 'absent-dir-1708', rel) }
    expect(await readCaptureLinks(undefined, store)).toBeNull()
    expect(await readCaptureLinks(capture({}), store)).toBeNull()
    expect(await readCaptureLinks(capture({ mhtmlPath: 'gone.mhtml' }), store)).toBeNull()
  })

  it('reports a read that fails for any reason other than a missing file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'capture-links-'))
    const store = { resolveAbsolute: () => dir as string }
    await expect(readCaptureLinks(capture({ mhtmlPath: 'a-directory' }), store)).rejects.toThrow()
  })
})
