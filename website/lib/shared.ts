// Single-sourced from next.config.mjs, which re-exports `basePath` via `env`.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const siteOrigin = 'https://thebristolsound.github.io';

export const appName = 'Birdbrain';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'thebristolsound',
  repo: 'birdbrain',
  branch: 'main',
};
