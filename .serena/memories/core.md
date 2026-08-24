# Birdbrain — Core (Serena entry point)

Serena memories hold **code-navigation facts only**. Everything else lives in tracked docs and is
authoritative over anything here:

- `CLAUDE.md` — commands, architecture, process model, directory map, conventions, testing gates,
  docs layout, agent rules. Read it first; do not duplicate it into memories.
- `CONTEXT.md` — ubiquitous language (Case, Capture, Capture Lifecycle, Selector Lifecycle,
  Persisted Match vs Foreground Match Preview, Manifest, Operator, Capture Server). Owned by the
  `domain-modeling` skill; record decisions as ADRs in `docs/adr/`, not as memories.

## Navigation anchors (where symbols live)
- IPC surface: channels in `src/shared/ipc.ts` (`IPC_CHANNELS`), handlers registered in
  `src/main/ipcHandlers.ts` via `handle()` from `src/main/ipcWrap.ts`; renderer reaches them
  through `window.birdbrain` (typed in `src/renderer/env.d.ts`).
- Data access: `src/main/services/db/` — `core.ts` (`initDatabase`, `getDb`, `withTransaction`,
  `LATEST_SCHEMA_VERSION`), `migrations.ts` (`runMigrations`, only place tables/indexes are
  declared), per-aggregate repos `caseRepo.ts`, `captureRepo.ts`, `tagRepo.ts`, `selectorRepo.ts`,
  `noteRepo.ts`, `extractedDataRepo.ts`, `waybackRefRepo.ts`, plus `dbAdmin.ts`,
  `dbSnapshots.ts`, `diagnosticsRepo.ts`. `getDb` import outside `db/` is lint-blocked.
- Orchestration modules are Lifecycles: `captureLifecycle.ts`, `selectorLifecycle.ts`.
- Renderer query layer: `src/renderer/lib/api/<domain>.ts` (query options + `use<Domain>Mutations`)
  with keys in `api/keys.ts`; `queries.ts` is a re-export barrel being retired (#229).
- Evidence/verification: `src/shared/verify/` (canonicalJson, manifestChain, signature,
  timestampToken) shared by app and `src/verifier/cli.ts`; main-side `manifest.ts`, `hash.ts`,
  `timestamp.ts`/`timestampWorker.ts`, `trustedTime.ts`, `tsaTrust.ts`, `signingKey.ts`,
  `certification.ts`, `tlsCertChain.ts`, `verifyRunbook.ts`.
- Extension: `extension/src/` (background, content, popup, utils/api). Separate Vite config.

## Serena usage notes
- One language server: `typescript` (see `.serena/project.yml`). `website/` has its own
  `node_modules`; symbols there resolve only after `pnpm install` inside `website/`.
- Repo is worked in many git worktrees (`~/.t3/worktrees/birdbrain/*`, `.claude/worktrees/*`).
  `--project-from-cwd` makes each worktree its own Serena project; memories are committed so every
  worktree sees the same set, but the LS cache is per worktree (cold on first call).

## Detail memories
- Build mechanisms not spelled out in CLAUDE.md (verifier SEA injection, extension two-pass
  `BUILD_TARGET=content` build, `postinstall` chain, `asarUnpack` requirement): `mem:build_targets`
- Maltego research (competitor reference for the Link Map / investigation-graph surfaces; where
  the primary-source notes live, durable takeaways, what is volatile): `mem:research/maltego`
- How to write/maintain memories in this project: `mem:memory_maintenance`
