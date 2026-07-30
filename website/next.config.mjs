import { createMDX } from 'fumadocs-mdx/next'
import { fileURLToPath } from 'node:url'
import { basePath } from './lib/base-path.mjs'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  // This site is a deliberately isolated sub-project with its own lockfile. Without
  // this, Turbopack walks up, finds the Electron app's lockfile, and infers the repo
  // root as the workspace root.
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url))
  },
  // Static HTML export — GitHub Pages serves the `out/` directory as-is.
  output: 'export',
  basePath,
  // Emits `docs/foo/index.html` instead of `docs/foo.html`, which any static host
  // resolves unambiguously. Without it, direct entry to an extensionless route
  // depends on host-specific .html fallback behaviour.
  trailingSlash: true,
  reactStrictMode: true,
  // `next/image` optimization needs a server; static export has none.
  images: { unoptimized: true }
}

export default withMDX(config)
