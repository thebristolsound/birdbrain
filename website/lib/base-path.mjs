// Single source of truth for the GitHub Pages sub-path.
//
// The site is published at https://thebristolsound.github.io/birdbrain/, so every
// route and asset is served under this prefix. Next applies it automatically to
// `next/link` and `next/image`, but anything that builds a URL by hand — notably the
// static search index fetch — has to prepend it explicitly.
//
// This lives in a .mjs file so that next.config.mjs and the TypeScript app code can
// both import the same value.
export const basePath = '/birdbrain'
