# Phase 2 — anchored notes

Date: 2026-07-25
Design: `docs/specs/2026-07-24-anchored-notes-report-authoring-design.md` (approved)
Depends on: Phase 1, merged as `49bad66` + `6a1116f`

Working notes for the next session. The spec is the source of truth for *what*
and *why*; this file records where the code actually is, which of the spec's
assumptions were re-checked after Phase 1 landed, and what is still undecided.

## Where things stand

| | |
| --- | --- |
| `7ef22ec` (#219) | Phase 0 — citation invariant test over `report.html` / `certification.html` |
| `49bad66` (#220) | Phase 1 — rich-text notes, schema v26 (`notes.body_doc`) |
| `6a1116f` (#222) | Codex fixes — structural schema validation, derivation on archive import |

`main` is clean. Schema is at `user_version = 26`. Nothing is blocking Phase 2.

Notes now carry a ProseMirror document. `notes.body` is the derived plain text
FTS indexes, produced in main by `noteDocToText` on every write path —
`createNote`, `updateNote`, and `importNoteRows`. `src/shared/noteDoc.ts` holds
the one extension list both processes import.

## Scope

Add the anchor: `anchor_kind` / `anchor_json` on `notes`, the resolution
algorithm, anchor creation from the capture viewer and the data/selector views,
and unresolved-anchor rendering. Notes become anchored. Still no brief — that is
Phase 3.

## Verified against the current tree

The spec was written before Phase 1 landed. These were re-checked on
2026-07-25 and still hold:

- **`finding` anchors must not store `extracted_data.id`.** Re-extraction runs
  `DELETE FROM extracted_data WHERE capture_id = ?`
  (`src/main/services/db/extractedDataRepo.ts:169`) and re-inserts, so every
  surrogate id churns. Anchor by the natural key
  `(capture_id, category, subcategory, value)`, which
  `idx_extracted_data_unique` (`migrations.ts:316`) already enforces.
- **Selector matches need no surrogate.** `selector_matches` has composite
  primary key `(selector_id, capture_id)` (`migrations.ts:119`).
- **`region` anchors reuse the annotation coordinate space.**
  `CaptureAnnotations` normalises against `imageWidth` / `imageHeight`
  (`src/shared/types.ts:412`), so a note region and an annotation shape mean the
  same thing geometrically.

## Decision the spec left implicit: what a text anchor resolves against

The spec says resolution runs "against the capture's extracted text sidecar".
There are now **two** copies of a capture's text, and they are not
interchangeable:

1. **The `.txt` sidecar on disk**, written by `captureStore.writeText`
   (`src/main/services/captureStore.ts:191`) and hashed into `captures.text_hash`
   (`textHash` on the shared type).
2. **The `capture_texts` table**, added in migration v25 as the external-content
   source for `captures_fts`, read via `getCaptureTextContent`
   (`src/main/services/db/captureRepo.ts:244`).

Resolve against **the on-disk sidecar**. It is the artifact with an integrity
hash, and the spec's own rule is that resolution runs against stored bytes. The
table is a convenience copy maintained for search; a text anchor that resolved
against it would be anchored to something nothing verifies.

Worth asserting in a test, because the two will look identical in every
happy-path fixture and only diverge when one of them is wrong — which is exactly
the case an anchor needs to survive.

## Open questions

Two of the spec's three now bite. Neither should be answered by guessing.

1. **Recapture.** When a capture is superseded, do notes anchored to the
   original follow, stay, or fork? `supersedesCaptureId` already links siblings,
   so the information exists. This is a product decision — ask.
2. **Cross-case references.** Current schema says a note belongs to one case.
   A `finding` anchor may want otherwise. Probably defer: nothing in Phase 2
   forces it.
3. *(Phase 3 only)* Standalone brief export.

## Suggested slicing

Three PRs, each leaving the app working. Do not bundle.

1. **Storage + resolution, no UI.** Migration v27 (`anchor_kind`, `anchor_json`),
   the anchor types in `src/shared/`, the resolver in main, and its tests. The
   resolver is pure and deterministic — test it hard here, where it is cheap.
2. **Anchor creation.** Select text in the capture viewer → note; drag a region
   → note; anchor from the selector and data views.
3. **Rendering.** Anchor display on note cards, and the unresolved case.

## The rule that matters most

An unresolved anchor is **never** silently downgraded to a capture-level anchor
and **never** silently dropped. It renders as an explicit statement that the
passage could not be located, alongside the quote as recorded. Same discipline
the exhibit renderer applies to a missing page archive: the gap is the finding.

Resolution order (spec §"Text anchors and resolution"):

1. Exact match at `textOffset` → resolved.
2. Unique exact match of `quote` elsewhere → resolved, offset repaired.
3. Unique match of `prefix + quote + suffix` → resolved.
4. Otherwise → unresolved.

## Verification

```bash
pnpm test
```

The suite needs the Electron runtime for better-sqlite3 — `pnpm test` sets it.
`npx vitest` will fail. To run one file:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/path/to/file.test.ts
```

Full check before opening a PR: `npx tsc --noEmit` on `tsconfig.node.json` and
`tsconfig.web.json`, `npx eslint src tests e2e --ext .ts,.tsx`, and
`npx playwright test` after `pnpm build`.

**Prove new tests are non-vacuous by reintroducing the defect they claim to
catch.** This caught two tests in Phases 0 and 1 that passed against genuinely
broken code. When injecting, target the exact function — `createNote` and
`importNoteRows` share identical argument lines, and a naive search-and-replace
hits the wrong one and reports failures from the wrong cause.

## Known environment noise

- `eslint .` fails on `tmp/pdfs/.venv/**` (a local Python venv, untracked).
  Scope to `src tests e2e extension`.
- Prettier reports files as unformatted when they are only CRLF from the git
  checkout. Diff before reformatting; repo-wide `pnpm format` creates churn in
  ~38 unrelated files.
- The **Dependency audit** CI job caches pnpm but never runs `pnpm install`, so
  its post-run cache save intermittently fails and reddens the check. The audit
  step itself has `continue-on-error: true`. A re-run clears it.
- `ipcHandlers.test.ts > reports failure for the http/pipeline self-tests when
  the server is down` fails locally whenever Birdbrain is running, because port
  19845 is occupied. Not a regression; green in CI.

## Stale, not fixed

`CLAUDE.md` says the schema is "v1-v12". It is v26. Flagged in the spec as a
separate correction; deliberately not folded into a feature PR.
