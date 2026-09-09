// Build-time guard for the renderer's Content-Security-Policy.
//
// `src/renderer/index.html` lists `font-src 'self'` with no `data:`, so a font
// Vite inlines under `build.assetsInlineLimit` is refused at load and its
// unicode subset silently falls back to a system font (#512). The renderer
// build sets that limit to 0; this plugin fails the build if an inlined font
// reappears — the only other symptom is a CSP violation logged in the first
// moments of renderer startup, which is exactly the window nothing watches.
//
// Kept out of electron.vite.config.ts so a unit test can import it without
// pulling Vite (and esbuild, which the jsdom test project cannot load) into
// the test's module graph.

// Covers the woff/woff2/ttf/otf mime types Vite emits today plus the legacy EOT
// and x-font- forms, so a font format added later is caught rather than waved
// through by a pattern written for woff2 alone.
const FONT_DATA_URI = /data:(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject))/

// Rollup's bundle types are not reachable from a file outside every tsconfig
// project's include, so the shape is declared structurally: chunks carry
// `code`, assets carry `source`, and a binary asset's Uint8Array source is
// skipped rather than decoded — an emitted font file is not an inlined one.
export type EmittedFile = { type: string; code?: string; source?: string | Uint8Array }

export const filesWithInlinedFonts = (bundle: Record<string, EmittedFile>): string[] =>
  Object.entries(bundle)
    .filter(([, file]) => {
      const text = file.type === 'chunk' ? file.code : file.source
      return typeof text === 'string' && FONT_DATA_URI.test(text)
    })
    .map(([fileName]) => fileName)
    .sort()

export const inlinedFontError = (offenders: string[]): string =>
  `no-inlined-fonts: found a data: font URI in ${offenders.join(', ')}. The renderer CSP ` +
  `(font-src 'self') blocks it at startup, so keep build.assetsInlineLimit at 0 for the ` +
  `renderer rather than widening the policy.`

export const noInlinedFonts = {
  name: 'no-inlined-fonts',
  generateBundle(_options: unknown, bundle: Record<string, EmittedFile>): void {
    const offenders = filesWithInlinedFonts(bundle)
    if (offenders.length > 0) throw new Error(inlinedFontError(offenders))
  }
}
