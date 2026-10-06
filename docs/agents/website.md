# Documentation site

Paths in this document are repository-root relative.

The public docs site is served by Mintlify at <https://docs.birdbrain.cc> from the content in
`website/content/`. `birdbrain.cc` forwards there. This repository has no build step:
Mintlify's GitHub App deploys `main` after every merge.

`website/content/` holds everything Mintlify reads:

- `docs.json` is the site configuration: theme, colors, navigation, and the links in the header and footer.
- `docs/*.mdx` are the pages. A page's URL is its path without the extension, so
  `docs/tester-guide.mdx` is served at `/docs/tester-guide`.
- `images/` holds the screenshots, `favicon.png` the favicon.

`website/pages-notice/index.html` is the only other file under `website/`. It is not part of
the Mintlify site. `.github/workflows/docs.yml` publishes it to the old GitHub Pages address
<https://thebristolsound.github.io/birdbrain/>, as both `index.html` and `404.html`, so every old
page URL redirects to the same page on the new site.

## Editing content

- **Adding a page means adding it to `navigation` in `docs.json`.** A page missing from the
  navigation is not in the sidebar. Entries carry the `docs/` prefix, because paths are relative
  to `website/content/`.
- **Internal links are root-relative, with no file extension:** `[Download](/docs/download)`.
  Mintlify does not support relative paths or links with a `.mdx` extension in production.
- **Image paths are root-relative to `website/content/`:** `/images/screenshot-case.png`.
  Relative image paths are not supported.
- **Bare `{...}` in prose breaks the page.** MDX parses braces as JSX expressions. Wrap them in
  backticks.

## Checking a change

Run both from inside `website/content/`; neither needs an install in this repository:

- `pnpm dlx mint dev` serves a local preview.
- `pnpm dlx mint broken-links` exits non-zero on any internal link or image that resolves to
  nothing. It does not flag a relative link such as `./download.mdx`, so CI's `docs-build` job
  runs it at a pinned version and then rejects relative links with `grep`, on every pull
  request that touches `website/`.

Use `pnpm dlx`, not `npx`: `npm install` of the CLI hung on 2026-09-29, and `pnpm` skips its
dependency build scripts, which include Scarf install analytics.

## Deployment settings

The Mintlify dashboard holds settings the repository cannot set. Check them there when the
site stops updating:

- **Git settings:** repository `thebristolsound/birdbrain`, branch `main`, and the
  documentation path `/website/content`. A stale `master` branch still exists on origin and predates the site.
- **Custom domain:** `docs.birdbrain.cc`. The DNS records are at Porkbun: two verification
  `TXT` records under `docs`, a `CNAME` from `docs` to `cname.mintlify.builders`, and a URL
  forward from `birdbrain.cc` to `https://docs.birdbrain.cc`.
