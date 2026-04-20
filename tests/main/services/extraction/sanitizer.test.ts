import { describe, it, expect } from 'vitest'
import { sanitizeHtml, MAX_HTML_BYTES } from '@main/services/extraction/sanitizer'

describe('sanitizeHtml', () => {
  // (a) script content must not appear in text
  it('removes script tag content from text', () => {
    const result = sanitizeHtml("<script>alert('x@y.com')</script><p>Hi</p>")
    expect(result.text).toContain('Hi')
    expect(result.text).not.toContain('x@y.com')
  })

  // (b) style tag content must not appear in text
  it('removes style tag content from text', () => {
    const result = sanitizeHtml(
      '<style>.a{background:url(https://evil.example/img.png)}</style><p>Hi</p>'
    )
    expect(result.text).toBe('Hi')
    expect(result.text).not.toContain('url')
  })

  // (c) href attribute is harvested
  it('harvests href attributes and preserves link text', () => {
    const result = sanitizeHtml('<a href="https://example.com/page">link</a>')
    expect(result.attrs.href).toContain('https://example.com/page')
    expect(result.text).toContain('link')
  })

  // (d) cid src is harvested but does not appear in text
  it('harvests cid: src without leaking to text', () => {
    const result = sanitizeHtml('<img src="cid:css-abc@mhtml.blink">')
    expect(result.attrs.src).toContain('cid:css-abc@mhtml.blink')
    // The cid string should not appear as visible text
    expect(result.text).not.toContain('css-abc@mhtml.blink')
  })

  // (e) mailto href is unwrapped into attrs.mailto
  it('extracts mailto address stripping prefix and query', () => {
    const result = sanitizeHtml('<a href="mailto:foo@bar.com?subject=hi">Email</a>')
    expect(result.attrs.mailto).toContain('foo@bar.com')
    expect(result.attrs.href).not.toContain('mailto:foo@bar.com?subject=hi')
  })

  // (f) SVG subtree is removed
  it('removes SVG path data from text', () => {
    const result = sanitizeHtml('<svg><path d="M10.94,75.75 L1.12,33.7"/></svg><p>content</p>')
    expect(result.text).toBe('content')
    expect(result.text).not.toContain('M10.94')
  })

  // (g) javascript: href is filtered out
  it('filters javascript: hrefs from attrs.href', () => {
    const result = sanitizeHtml('<a href="javascript:void(0)">x</a>')
    expect(result.attrs.href).not.toContain('javascript:void(0)')
    expect(result.attrs.href.some((h) => /javascript:/i.test(h))).toBe(false)
  })

  // (h) malformed HTML does not throw
  it('handles malformed HTML without throwing', () => {
    expect(() => sanitizeHtml('<div><span>unclosed')).not.toThrow()
    const result = sanitizeHtml('<div><span>unclosed')
    expect(result.text.length).toBeGreaterThan(0)
  })

  // (i) oversized input is truncated before parsing
  it('truncates oversized input to MAX_HTML_BYTES before parsing', () => {
    // Plain text bigger than the cap, with a sentinel past the cap that must be dropped.
    const filler = 'a'.repeat(MAX_HTML_BYTES)
    const big = filler + '<p>SENTINEL_PAST_CAP</p>'
    const result = sanitizeHtml(big)
    expect(result.text).not.toContain('SENTINEL_PAST_CAP')
  })

  // (j) HTML comments do not leak into text
  it('removes HTML comments from text', () => {
    const result = sanitizeHtml('<!-- email: leak@bad.com --><p>hi</p>')
    expect(result.text).toBe('hi')
    expect(result.text).not.toContain('leak@bad.com')
  })

  // (k) byte-true truncation for multi-byte input
  it('enforces MAX_HTML_BYTES as a byte cap for multi-byte input', () => {
    // '☃' is 3 bytes in UTF-8 but 1 UTF-16 code unit. Enough snowmen to exceed
    // the byte cap while the .length (code units) stays under it.
    const snowmen = '☃'.repeat(MAX_HTML_BYTES) + '<p>SENTINEL_PAST_CAP</p>'
    const result = sanitizeHtml(snowmen)
    expect(result.text).not.toContain('SENTINEL_PAST_CAP')
  })
})
