import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Served from https://thebristolsound.github.io/birdbrain/, so every route and
// asset is prefixed. `basePath` applies in dev too — open /birdbrain/docs locally.
const basePath = '/birdbrain';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  images: { unoptimized: true },
  reactStrictMode: true,
  // Fumadocs resolves its own asset URLs (search index, raw-markdown links) against
  // Vite's `import.meta.env.BASE_URL`, which is always "/" under Next. Re-export the
  // basePath so lib/shared.ts can apply it by hand — see lib/source.ts.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default withMDX(config);
