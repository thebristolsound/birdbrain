import { describe, expect, it } from 'vitest'
import {
  filesWithInlinedFonts,
  inlinedFontError,
  noInlinedFonts
} from '../scripts/no-inlined-fonts'

// The renderer CSP has no `data:` in `font-src`, so an inlined font is dead
// weight that announces itself only as a console violation during startup
// (#512). This plugin fails the build instead.
describe('filesWithInlinedFonts', () => {
  const css = (source: string) => ({ type: 'asset', source })
  const chunk = (code: string) => ({ type: 'chunk', code })

  it('passes a bundle whose fonts are emitted as files', () => {
    expect(
      filesWithInlinedFonts({
        'assets/index.css': css('@font-face{src:url("assets/inter-latin.woff2")}'),
        'assets/index.js': chunk('const logo="assets/logo.png"')
      })
    ).toEqual([])
  })

  it('names a stylesheet that inlines a woff2 font', () => {
    expect(
      filesWithInlinedFonts({
        'assets/index.css': css('@font-face{src:url("data:font/woff2;base64,d09GMg==")}')
      })
    ).toEqual(['assets/index.css'])
  })

  it('names a chunk that inlines a font, sorted with the other offenders', () => {
    expect(
      filesWithInlinedFonts({
        'assets/index.js': chunk('const f="data:font/ttf;base64,AAEAAA=="'),
        'assets/index.css': css('@font-face{src:url("data:font/woff;base64,d09GRg==")}')
      })
    ).toEqual(['assets/index.css', 'assets/index.js'])
  })

  it('catches the legacy eot and x-font mime types', () => {
    expect(
      filesWithInlinedFonts({
        'assets/eot.css': css('src:url(data:application/vnd.ms-fontobject;base64,AAA=)'),
        'assets/xfont.css': css('src:url(data:application/x-font-ttf;base64,AAA=)')
      })
    ).toEqual(['assets/eot.css', 'assets/xfont.css'])
  })

  // An emitted .woff2 is an asset whose source is binary. Decoding it would
  // find the font's own bytes, not a data: URI, so it is skipped by type.
  it('ignores binary asset sources', () => {
    expect(
      filesWithInlinedFonts({
        'assets/inter-latin.woff2': { type: 'asset', source: new Uint8Array([0x77, 0x4f, 0x46]) }
      })
    ).toEqual([])
  })

  // `data:image/...` sits inside the renderer CSP's `img-src 'self' data:`, and
  // screenshots and thumbnails are rendered that way at runtime.
  it('ignores inlined images, which the CSP does allow', () => {
    expect(
      filesWithInlinedFonts({
        'assets/index.css': css('background:url("data:image/png;base64,iVBORw0K")')
      })
    ).toEqual([])
  })
})

describe('noInlinedFonts plugin', () => {
  it('lets a clean bundle through', () => {
    expect(() =>
      noInlinedFonts.generateBundle(undefined, {
        'assets/index.css': { type: 'asset', source: 'body{color:red}' }
      })
    ).not.toThrow()
  })

  it('throws, naming the offending file and the policy that blocks it', () => {
    expect(() =>
      noInlinedFonts.generateBundle(undefined, {
        'assets/index.css': { type: 'asset', source: 'src:url(data:font/woff2;base64,d09GMg==)' }
      })
    ).toThrow(/assets\/index\.css.*font-src 'self'/s)
  })

  it('reports every offender in one message', () => {
    expect(inlinedFontError(['a.css', 'b.js'])).toContain('a.css, b.js')
  })
})
