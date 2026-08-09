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

Both answered 2026-07-26. Recorded here because neither is derivable from the
code, and both were deliberately left unencoded in slice 1.

1. **Recapture — notes STAY.** ~~When a capture is superseded, do notes anchored
   to the original follow, stay, or fork?~~ A note stays on the capture it was
   written against. It does not follow the supersession chain and does not fork.
   The design's central claim is that anchoring happens at the moment of
   observation; moving an anchor onto a capture the investigator never looked at
   is the drift the feature exists to prevent. Slice 1 encodes no opinion on
   this — the resolver takes a capture and its stored text and knows nothing of
   supersession — so the decision lands in slice 2.
2. **Cross-case references — single case only.** ~~Current schema says a note
   belongs to one case.~~ An anchor's target must belong to the note's own case,
   validated on **all four** write paths — `createNote`, `updateNote`,
   `importNoteRows`, and `dbAdmin`'s `createRow` / `updateRow`. Database Admin
   is easy to forget and is a genuine fourth path: it already validates anchor
   *structure* (added in #232) but would happily accept a structurally valid
   cross-case `captureId`. `collectCaseData` packages only the
   note's own case, so a cross-case anchor would export dangling. **Implemented
   in #234.** The two cautions recorded at decision time both held: rejecting
   at write time is not reversible (existing violating rows are left as-is,
   not migrated), and the existence check runs against ids ALREADY remapped by
   `remapAnchorIds`, which is why it does not fail on import ordering —
   `insertImportedRows` (`caseArchive.ts`) already inserts captures and
   selectors before notes, so by the time a note's anchor is validated, a
   same-archive target it references is already present under the new case id.
3. *(Phase 3 only)* Standalone brief export.

## Suggested slicing

Three PRs, each leaving the app working. Do not bundle.

1. ~~**Storage + resolution, no UI.**~~ **Merged as #232 → `596f0592`.**
   Migration v27, the anchor types in `src/shared/noteAnchor.ts`, the resolver in
   `src/main/services/noteAnchorResolver.ts`, and 52 tests.
2. **Anchor creation.** Select text in the capture viewer → note; drag a region
   → note; anchor from the selector and data views.
3. **Rendering.** Anchor display on note cards, and the unresolved case.

### What slice 1 actually shipped

Larger than planned, almost entirely from review. Eleven findings across three
reviewers; ten fixed, two deferred to #234.

- **Five resolution outcomes, not the spec's two.** `resolved` / `unresolved` /
  `no-stored-text` / `integrity-failed` / `capture-missing`. The ladder below
  ends in a binary, but the schema can produce four more situations and
  collapsing them makes false statements — "the passage could not be located in
  the stored text" is untrue of a capture that has no stored text, and untrue of
  one that was deleted.
- **`basis: 'hash-verified' | 'unattested'`** on the two outcomes that read text.
  A pre-v19 capture has a `.txt` sidecar with `text_hash = NULL`, so its text is
  readable but nothing attests to it.
- **Anchor ids are remapped on archive import.** `remapAnchorIds` moves embedded
  `captureId` / `selectorId` through `ctx.mapId`. Without it, an id collision
  made an imported note cite a capture already in the destination.
- **`CASE_ARCHIVE_SCHEMA_VERSION` is now 2**, so a pre-v27 release refuses an
  anchor-bearing archive rather than importing it with every anchor stripped.
- **Database Admin validates `notes.anchor_json` and derives `anchor_kind`.**
  `notes` is in `ALLOWED_TABLES` and previously validated column names only.

Two review findings were **not** fixed in slice 1, both P1, both tracked
as `#234`: binding text verification to the manifest digest rather than
the `captures.text_hash` mirror (`verifyCapture` trusts the same mirror,
so both call sites must move together), and the anchor-target case
validation above.
**Both landed in #234**, along with the smaller, related dangling-`selectorId`
outcome (a `resolveSelectorMatchAnchor` alongside the existing
`capture-missing`). See the design doc's "Text anchors and resolution" section
for the trust-boundary statement and open question 1's answer.

## The rule that matters most

An unresolved anchor is **never** silently downgraded to a capture-level anchor
and **never** silently dropped. It renders as an explicit statement that the
passage could not be located, alongside the quote as recorded. Same discipline
the exhibit renderer applies to a missing page archive: the gap is the finding.

This rule earned its keep during slice 1's review. A reviewer proposed clearing
both anchor columns when the anchored capture is deleted — reasonable-sounding,
and a silent drop. It was declined, and the `capture-missing` outcome added
instead, so the dangling state is *detectable* without destroying the record
that the note ever cited anything. A note citing deleted evidence is a finding;
a note that never appears to have cited anything conceals one. The spec already
answers this for `brief_blocks` — "a visible gap, not vanish from the argument"
— which is worth quoting back at the next reviewer who proposes a cleanup.

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

`CLAUDE.md` says the schema is "v1-v12". It is **v27** as of #232. Flagged in
the spec as a separate correction; deliberately not folded into a feature PR,
and still not done.

## Notes for slice 2

- **Every new test must be proven non-vacuous** by reintroducing the defect it
  claims to catch. This is not ceremony: across slice 1's four review rounds,
  each round found defects in the *previous* round's fixes. The pattern was
  always the same — the first fix addressed the reported instance rather than
  the class. Budget for a second pass on every fix.
- The review rounds that found the most were the ones reading for *invariants
  the code claims about itself*. Two findings were comments asserting guarantees
  that were false when written.
- `main` moved ahead during slice 1 (wayback corroboration domain renamed out of
  "archive", #256). Rebase before starting rather than after.
