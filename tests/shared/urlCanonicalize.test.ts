import { describe, it, expect } from 'vitest'
import { canonicalizeUrl, resolveCaptureForUrl } from '@shared/urlCanonicalize'

describe('canonicalizeUrl', () => {
  it('drops the fragment', () => {
    expect(canonicalizeUrl('https://example.com/page#section-2')).toBe('https://example.com/page')
    expect(canonicalizeUrl('https://example.com/#top')).toBe('https://example.com/')
  })

  it('drops trailing slashes but keeps the root path', () => {
    expect(canonicalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b')
    expect(canonicalizeUrl('https://example.com/a/b//')).toBe('https://example.com/a/b')
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com/')
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('lowercases scheme and host, drops default ports, keeps path case', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM:443/Path')).toBe('https://example.com/Path')
    expect(canonicalizeUrl('http://example.com:80/a')).toBe('http://example.com/a')
    expect(canonicalizeUrl('http://example.com:8080/a')).toBe('http://example.com:8080/a')
  })

  it('drops embedded credentials', () => {
    expect(canonicalizeUrl('https://user:pass@example.com/a')).toBe('https://example.com/a')
  })

  it('keeps the query string verbatim, including parameter order', () => {
    expect(canonicalizeUrl('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&c=2')
    expect(canonicalizeUrl('https://example.com/a?c=2&b=1')).not.toBe(
      canonicalizeUrl('https://example.com/a?b=1&c=2')
    )
  })

  it('drops a bare "?" with no query', () => {
    expect(canonicalizeUrl('https://example.com/a?')).toBe('https://example.com/a')
  })

  it('keeps http and https distinct, and does not strip www', () => {
    expect(canonicalizeUrl('http://example.com/')).not.toBe(canonicalizeUrl('https://example.com/'))
    expect(canonicalizeUrl('https://www.example.com/')).not.toBe(
      canonicalizeUrl('https://example.com/')
    )
  })

  // Redirects are never followed: canonicalization is pure string work on the
  // final URL the extension reports, so a redirect source stays distinct from
  // its target.
  it('never equates a redirect source with its target', () => {
    expect(canonicalizeUrl('https://sho.rt/x')).not.toBe(
      canonicalizeUrl('https://example.com/landing')
    )
  })

  it('canonicalizes unparseable input to itself, trimmed', () => {
    expect(canonicalizeUrl('  not a url  ')).toBe('not a url')
  })
})

describe('resolveCaptureForUrl', () => {
  const candidate = (id: string, url: string, timestamp: string) => ({ id, url, timestamp })

  it('returns null when nothing matches canonically', () => {
    const candidates = [candidate('a', 'https://example.com/other', '2026-01-01T00:00:00.000Z')]
    expect(resolveCaptureForUrl('https://example.com/page', candidates)).toBeNull()
  })

  it('matches across fragment and trailing-slash differences', () => {
    const candidates = [candidate('a', 'https://example.com/page/', '2026-01-01T00:00:00.000Z')]
    expect(resolveCaptureForUrl('https://example.com/page#frag', candidates)?.id).toBe('a')
  })

  it('resolves several captures of one URL to the most recent', () => {
    const candidates = [
      candidate('old', 'https://example.com/page', '2026-01-01T00:00:00.000Z'),
      candidate('new', 'https://example.com/page/', '2026-02-01T00:00:00.000Z'),
      candidate('mid', 'https://example.com/page#x', '2026-01-15T00:00:00.000Z')
    ]
    expect(resolveCaptureForUrl('https://example.com/page', candidates)?.id).toBe('new')
  })

  it('breaks timestamp ties by the greater id, whatever the input order', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    const forward = [
      candidate('aaa', 'https://example.com/page', ts),
      candidate('bbb', 'https://example.com/page', ts)
    ]
    const reversed = [...forward].reverse()
    expect(resolveCaptureForUrl('https://example.com/page', forward)?.id).toBe('bbb')
    expect(resolveCaptureForUrl('https://example.com/page', reversed)?.id).toBe('bbb')
  })

  it('preserves extra fields on the winning candidate', () => {
    const candidates = [
      {
        id: 'a',
        url: 'https://example.com/page',
        timestamp: '2026-01-01T00:00:00.000Z',
        title: 'Page'
      }
    ]
    expect(resolveCaptureForUrl('https://example.com/page', candidates)?.title).toBe('Page')
  })
})
