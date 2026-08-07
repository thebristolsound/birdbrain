# Dependency advisory baseline — 2026-08-05

Source: #267 ("Guard registry publication and triage known dependency advisories"), derived
from the July 27, 2026 public-repository readiness assessment
(`docs/specs/2026-07-27-public-repository-readiness-assessment.md`).

This records every high-severity `pnpm audit` finding present at the time of #267, the affected
dependency, whether it ships in the packaged app or the published docs site, and the disposition
applied or proposed. Dispositions marked "proposed" are not self-certified — they are decided by
maintainer review on the PR that introduced this doc (per the #267 re-triage).

## Root (`package.json` / `pnpm-lock.yaml`)

`pnpm audit --audit-level high` reported 10 distinct high-severity advisories before this change,
all reached exclusively through devDependencies (electron-builder, `@vitest/coverage-v8`,
`shadcn`, `jsdom`, `node-gyp`) — none of them are direct `dependencies`, so none are shipped in
the packaged Electron app (electron-builder's dependency pruning only bundles `dependencies`, not
`devDependencies`).

| Advisory | Package | Path | Disposition |
|---|---|---|---|
| GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 | `brace-expansion` (1.x, 2.x, 5.x) | `@vitest/coverage-v8` and `electron-builder`'s `@electron/asar` | **Fixed** — `pnpm-workspace.yaml` overrides pin each major line to its patched floor (`^1.1.18`, `^2.1.4`, `^5.0.9`). |
| GHSA-v2hh-gcrm-f6hx, GHSA-7p8r-x3mc-p8w7 | `fast-uri` | `electron-builder > app-builder-lib > ajv` | **Fixed** — override to `^3.1.5`. |
| GHSA-p2f4-r6v6-j797 | `builder-util-runtime` | `electron-builder`'s squirrel-windows peer subtree (stale resolution) | **Fixed** — override to `^9.7.0`; electron-builder's own `dependencies` already require this version, the override just collapses the duplicate stale resolution. |
| GHSA-7g7r-gx96-252g | `app-builder-lib` | `electron-builder-squirrel-windows@25.1.8`'s own peer dependency on the pre-26.15 `app-builder-lib` | **Fixed** — override to `^26.15.0`. Verified `pnpm install` still resolves cleanly with no unmet-peer warnings (electron-builder-squirrel-windows itself stays at 25.1.8; only its `app-builder-lib` dependency moves). We do not build the Windows Squirrel target (`package.json`'s `build.win.target` is `nsis`), so this module is not exercised even if the newer `app-builder-lib` changed its internals. |
| GHSA-r28c-9q8g-f849 | `postcss` | `shadcn`'s own `postcss` dependency | **Fixed** — override to `^8.5.23` (also closes a second, moderate, incomplete-fix advisory on the same package). |
| GHSA-4cwx-7wf7-3272 | `undici` | `jsdom` (direct devDependency) and `node-gyp` pull `undici@6`; `shadcn`'s `@dotenvx/dotenvx` dependency pulls `undici@7` — cross-user information disclosure via degenerate private cache directives | **Fixed** — `pnpm-workspace.yaml` pins both major lines separately (`undici@6: ^6.28.0`, `undici@7: ^7.29.0`) since the two consumers resolve different majors. |
| GHSA-mwp4-54f8-5fhr | `ip-address` | `shadcn`'s bundled `@modelcontextprotocol/sdk` → `express-rate-limit` → `express` — `Address4` decodes leading-zero octets as decimal while resolvers decode them as octal, enabling SSRF/trust-boundary bypass | **Fixed** — override to `^10.3.1`. |

Result: `pnpm audit --audit-level high` against the root lockfile is now clean (0 high, 3
moderate — see below).

Moderate findings observed but **out of scope** for this issue (acceptance criteria are scoped to
high-severity): `@hono/node-server` via `shadcn`'s bundled MCP SDK (dev-only), `tar` via
electron-builder (dev-only; the existing `tar` override predates this issue and covers a
different, non-security reason), and `hono` itself (direct runtime dependency, moderate CORS
ReDoS in `hono@4.12.27`, fixed in `4.12.34`) — noted here for visibility, not fixed in this PR.

## `website/` (`website/package.json` / `website/pnpm-lock.yaml`)

`pnpm audit --audit-level high` reported 5 distinct high-severity advisories (own isolated
workspace, own lockfile):

| Advisory | Package | Path | Disposition |
|---|---|---|---|
| GHSA-7p8r-x3mc-p8w7 | `fast-uri` | `serve > ajv` (the `serve` devDependency backs the local `pnpm start` script only; not part of the static export shipped to GitHub Pages) | **Fixed** — override to `^3.1.5`. |
| GHSA-rgw5-rvv9-x895 | `brace-expansion` | `serve > serve-handler > minimatch` (same `serve`, dev-only) | **Fixed** — override to `^1.1.18`. |
| GHSA-r28c-9q8g-f849 | `postcss` | `next`'s own exact-pinned `postcss@8.4.31` dependency | **Fixed** — override to `^8.5.23`. `next build` (Turbopack, static export) verified successful after the override; no observed regression from bumping past next's exact pin. |
| GHSA-6g55-p6wh-862q | `postcss` | Same `next`-pinned `postcss@8.4.31` dependency — a second, distinct advisory (arbitrary file read via attacker-controlled `sourceMappingURL` in CSS comments) on the same resolved version | **Fixed incidentally** — closed by the same `postcss: ^8.5.23` override chosen for GHSA-r28c-9q8g-f849; no separate action was needed. |
| GHSA-f88m-g3jw-g9cj | `sharp` (libvips CVE-2026-33327/33328/35590/35591) | `next`'s **optional** `sharp` dependency (`^0.34.5`, image-optimization backend) | **Proposed: not reachable, not fixed.** `website/next.config.mjs` sets `images: { unoptimized: true }` under `output: 'export'` — Next's image-optimization code path (the only caller of `sharp`) never runs for this site. Bumping `sharp` to the patched `>=0.35.0` line is also outside next's declared `^0.34.5` optional-dependency range, so forcing it would run an untested combination for a dependency that is not exercised. **This is a proposed disposition, not a self-certified one** — maintainer review on this PR should confirm the `unoptimized: true` reachability argument before this is treated as accepted-risk. |

The outstanding `sharp` finding is carried in CI as a narrow, dated exception (see
`.github/workflows/security.yml`): `pnpm audit --ignore GHSA-f88m-g3jw-g9cj` for the `website/`
audit step only, with a revisit-by date. It is not silenced via `pnpm-workspace.yaml`'s
`auditConfig.ignoreCves` — that key was tested against pnpm 10.28.2 and does not suppress
advisories that carry no assigned CVE (this one has only a GHSA id), so the CLI flag is what
actually takes effect.

## Registry-publication guard

`package.json` now carries `"private": true`. `npm pack --dry-run` still produces a tarball
under `private: true` (`npm pack` does not consult the `private` field — only `npm
publish`/`pnpm publish` do), so it does not itself demonstrate the guard; it is included in the
PR only as evidence of what the (unrestricted) package contents currently look like. The guard
itself is enforced in CI: `.github/workflows/security.yml`'s `publish-guard` job fails the build
if `package.json`'s `private` field is ever removed or set to `false`. `npm publish --dry-run`
was independently confirmed (in this same investigation) to **not** honor the `private` field at
all under npm 10.8.2 — dry-run skips that check entirely and still builds/would-publish the
tarball — so an `npm`-based dry-run check would have been a false sense of guard; the CI job
checks the manifest field directly instead.
