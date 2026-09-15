# Documentation site

Paths in this document are repository-root relative.

`website/` is the public docs site — Next.js 16 + Fumadocs UI/MDX, statically exported and published to GitHub Pages at <https://thebristolsound.github.io/birdbrain/> by `.github/workflows/docs.yml`.

**It is a deliberately isolated sub-project.** It has its own `package.json`, `pnpm-lock.yaml`, and `node_modules`. The repo root does have a `pnpm-workspace.yaml`, but **only** to hold the pnpm settings that used to live in the `pnpm` field of `package.json` (`onlyBuiltDependencies`, `overrides`, `supportedArchitectures`) — pnpm 10.28 stopped reading them there. It deliberately has no `packages:` key, so nothing is registered as a workspace member and `website/` stays isolated. Do not add one.

`website/pnpm-workspace.yaml` enforces that isolation from the other side: it makes `website/` its own workspace root, so a `pnpm` command run inside `website/` stops there instead of walking up and inheriting the root's `overrides` and `onlyBuiltDependencies`. It also carries the site's own `allowBuilds` approvals (esbuild, sharp). Consequences:

- Run its commands from inside `website/`: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm types:check`. A root `pnpm install` does not touch it.
- The root toolchain ignores it: `eslint.config.js` lists `website/`, `pnpm format` is scoped to `src/`+`extension/`, the root tsconfigs only include `src/**`, and `build.files` in the root `package.json` excludes `website/**/*` so it never ships inside the packaged app.
- `next.config.mjs` pins `turbopack.root` to `website/`, or Turbopack finds the root lockfile and infers the wrong workspace root.

Content lives in `website/content/docs/` (`.mdx` + `meta.json`), images in `website/public/assets/`. Things worth knowing before editing content:

- **Bare `{...}` in prose breaks the build.** MDX parses braces as JSX expressions, so `{source}` or `{a, b}` in body text is a compile error. Wrap them in backticks.
- **Internal doc links need the `./name.mdx` form.** `createRelativeLink` only rewrites hrefs starting with `./` or `../`; a bare slug is emitted as-is and resolves wrong under `trailingSlash: true`.
- **Image paths are `public/`-relative** (`/assets/x.png`). Fumadocs turns them into `next/image` imports, so `basePath` is applied for you — do not hardcode `/birdbrain/`.
- Anything that builds a URL by hand does need the prefix; import `basePath` from `website/lib/base-path.mjs` (that is why the static search client passes `from`).

### Mintlify mirror (evaluation)

A Mintlify deployment (`birdbrain`) renders the same MDX as a second, read-only mirror while
the platform is being evaluated. GitHub Pages remains the published site — Mintlify is not
wired into CI and nothing in the root toolchain depends on it.

`website/content/docs.json` is its config. Note the placement: it is a **sibling** of
`content/docs/`, not inside it. `defineDocs({ dir: 'content/docs' })` globs JSON files under
that directory into the Fumadocs meta collection, so a `docs.json` placed *in* `content/docs/`
risks being parsed as a meta node and breaking `pnpm build`. Keep it one level up.

**The deployment's git source must be configured by hand in the Mintlify dashboard — the repo
cannot set it.** Two fields matter:

- **Deploy branch: `main`.** The default branch was renamed from `master`, and a stale `master`
  still exists on origin. It predates `website/`, so a deployment left pointing at it sees a
  repo with no docs in it at all.
- **Content directory: `website/content`.** This is what makes `docs.json` discoverable given
  the placement above, and it is why every entry in `navigation.groups[].pages` carries a
  `docs/` prefix — those paths are relative to the content directory, not to `docs.json`.

Two known gaps in the mirror, both inherent to serving one content tree through two renderers:

- **Cross-page links render dead on Mintlify.** The 23 internal links use the `./name.mdx`
  form that Fumadocs' `createRelativeLink` requires; Mintlify wants extensionless
  root-relative paths. No single syntax satisfies both — fixing one breaks the other.
- **Screenshots 404 on Mintlify.** `screenshots.mdx` references `/assets/*.png`, served by
  Next from `website/public/assets/`. Mintlify resolves assets from its own content root and
  has no `public/` convention, so the images fall outside what it can see.

Adding a page means updating **both** `content/docs/meta.json` and `docs.json` — a page missing
from either is silently dropped from that site's sidebar.
