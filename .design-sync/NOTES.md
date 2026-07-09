# design-sync notes — birdbrain-ui

Scope: the 10 self-contained primitives in `src/renderer/components/ui/`
(Button, Badge, Card, Dialog, Input, Textarea, Label, ScrollArea, Tabs,
Skeleton). Birdbrain is an Electron app, **not** a published component library,
so this sync uses the package shape in a non-standard way — read the gotchas
below before re-syncing.

## Build setup (non-obvious)

- **No library dist.** There is no built component entry (`main` is the
  Electron main process). We bundle the real barrel directly:
  `--entry ./src/renderer/components/ui/index.ts`. This makes the converter's
  `PKG_DIR` resolve to the repo root (it walks up to `package.json`) and esbuild
  bundles the TSX sources. `cfg.pkg`/`globalName` are synthetic
  (`birdbrain-ui` / `BirdbrainUI`).
- **`@renderer/*` alias** is resolved by esbuild from `cfg.tsconfig`
  (`tsconfig.web.json`). Needed for `cn` (`@renderer/lib/utils`) and motion
  presets (`@renderer/lib/motion`).
- **Tailwind v4 CSS is pre-compiled.** The components are styled with Tailwind
  v4 `@theme` tokens in `src/renderer/styles/globals.css`; there is no shipped
  stylesheet. Before every build, compile the static closure:
  ```sh
  node .ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs \
    -i src/renderer/styles/globals.css \
    -o .design-sync/.cache/compiled-tailwind.css --optimize
  ```
  `cfg.cssEntry` points at that generated file. `@tailwindcss/cli@4.3.2` is
  installed into the isolated `.ds-sync/` scratch (NOT the repo's package.json).
  Auto source-detection scans the whole worktree, so the closure carries
  birdbrain's full utility + token vocabulary (intended — good for the design
  agent).
- **Fonts are committed.** Inter Variable + JetBrains Mono Variable (weight axis,
  all subsets) are copied from `@fontsource-variable/*` into
  `.design-sync/fonts/{inter,jetbrains-mono}/` and wired via `cfg.extraFonts`.
  Why committed rather than referenced from node_modules: `extraFonts` is bounded
  to the package root (realpath), and a node_modules path (esp. through a
  worktree's symlinked `node_modules`) resolves outside it and is skipped. The
  committed copy is self-contained and reproducible. ~344 KB total.

## Worktree specifics (this run)

- Built inside a git worktree. The worktree has no `node_modules`, so a top-level
  symlink was created: `node_modules -> <main checkout>/node_modules` (gitignored
  via `/node_modules`). On a re-sync **from the main checkout**, no symlink is
  needed — `node_modules` already exists there and all `cfg.*` paths are repo-root
  relative, so they resolve directly.

## Known render warns (triaged legitimate)

- **Dialog** — the per-story review capture (`?story=ConfirmDelete`) renders
  blank. Cause: framer-motion `AnimatePresence` + `presets.modal` start at
  opacity 0 and the per-story capture fires before the mount animation settles.
  The **full-card render** (`_screenshots/general__Dialog.png`, which is what
  `Dialog.html` actually ships) renders the overlay + panel correctly. Graded
  `good` from that authoritative render. Not a defect — if a future capture shows
  Dialog blank in the per-story sheet, it's this same artifact.
- **Skeleton** uses `bg-accent` (indigo) by design — the pulse bars are indigo,
  not grey. Faithful to source, not a styling bug.

## Re-sync risks (watch-list)

- **cssEntry is generated** — you MUST re-run the Tailwind compile command above
  before `resync.mjs`, or the closure is stale/missing. This is the single most
  likely thing to silently break a re-sync.
- **Fonts drift** — the committed `.design-sync/fonts/*` are a point-in-time copy
  of `@fontsource-variable/*`. If those packages are upgraded, re-copy (the copy
  step is in the build-setup section).
- **Source coupling creep** — this sync works only because the 10 `ui/`
  primitives stay free of app infrastructure (IPC/store/router/query). If a
  primitive gains such a dependency, its bundle/preview will break; exclude it via
  `componentSrcMap: {"<Name>": null}` or provide a `cfg.provider`.
- **Group is `general`** — all 10 land in the `general` group (the `ui/` dir is a
  generic container name). Cosmetic; regroup later via per-component docsMap
  category stubs if desired.
- **Styling-superset drift (benign, expected once)** — Tailwind v4 auto
  content-detection scans committed, non-gitignored repo files, which now include
  `.design-sync/conventions.md` (its token-vocabulary table) and
  `.design-sync/previews/*.tsx` (className strings). The ORIGINAL closure (first
  sync, 2026-07-07) was compiled before those files existed, so the first re-sync
  after they were committed recompiles to a **superset** CSS: `styleSha` changes
  and the driver reports `upload.any: true` with `styling: true` **while every
  component is `unchanged`** (`renderHashes` and `bundleSha12` identical). This is
  NOT a defect — it's a one-time convergence; upload the refreshed styling (done
  2026-07-08) and subsequent re-syncs are no-ops. If you ever see `styling: true`
  again with all components unchanged, first check whether a committed file gained
  new utility-class references before suspecting nondeterminism.

## Re-sync command (from the main checkout)

```sh
# 1. recompile the Tailwind closure (REQUIRED — cssEntry is generated)
node .ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs \
  -i src/renderer/styles/globals.css -o .design-sync/.cache/compiled-tailwind.css --optimize
# 2. driver run (add --remote .design-sync/.cache/remote-sync.json after fetching the project's _ds_sync.json)
node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules \
  --entry ./src/renderer/components/ui/index.ts --out ./ds-bundle
```

(Re-stage `.ds-sync/` scripts first: `cp -r <skill>/{package-*,resync}.mjs
<skill>/lib <skill>/storybook .ds-sync/` and `(cd .ds-sync && npm i esbuild
ts-morph @types/react @tailwindcss/cli@4.3.2 playwright@1.61.1)`.)
