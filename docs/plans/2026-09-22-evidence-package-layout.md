# Evidence Package layout held once

Settled in a grilling session on 2026-09-22 from the architecture review of 2026-09-21.
Not started. Blocking-tier evidence path (export, verification), so the PR carries
`evidence-affecting` and waits for human review.

## Decision

One module decides where every member of an Evidence Package sits and what it is named. The
writer, Package Verification and the Verify Runbook read it; none of them spell a path.

Today `src/shared/verify/exhibitBinding.ts` decides this for non-Capture Exhibits and Derived
Files, and stops at `CAPTURE_PACKAGE_DIRECTORY = 'pages'`. Capture paths are template
literals at `export.ts:1152, :1254, :1379, :1584` (pages), `:1182, :1585` (screenshots),
`:1539` (timestamps); `evidencePackage.ts:1101` restates the page path; `verifyScript.ts`
restates all three in bash; `verifyRunbook.ts` restates them as a Markdown table. Root
filenames are spread over `constants.ts`, `verifyScript.ts`, `tsaTrust.ts` and literals in
`export.ts` and `evidencePackage.ts`.

## Rulings

1. **Placement.** First tenant of `src/packages/`: `src/packages/evidence-package-layout/`.
   Imported by relative path, as the packages README prescribes. Pure strings in and out: no
   `fs`, no `path.join`, so the SEA verifier bundle picks it up unchanged.
2. **Ownership.** Capture page, screenshot and Timestamp Token paths; the existing Exhibit and
   Derived File path rules; `inCasePath`; and the root filename set. Not the Case-directory
   on-disk layout, which `captureStore.ts` keeps: a non-Capture path is a function of its
   storage path, and the module takes that as input.
3. **Working Copy** stays out. It is not a verifiable object (ADR-0010) and has one consumer.
   `buildWorkingCopyZip` keeps its literals with a comment pointing at the export-class
   adapter candidate from the same review.
4. **Shell and runbook.** `verify.sh` calls sh helpers the module renders
   (`capture_page_path`, `screenshot_path`, `timestamp_token_path`, `in_case_path`). The
   runbook interpolates constants into its prose and table; the `{captureId}` placeholders are
   prose and stay.
5. **Old export sites go.** Every importer of `VERIFY_SCRIPT_FILENAME`, `TSA_ROOT_FILENAME`,
   `TSA_INTERMEDIATES_FILENAME`, `CAPTURE_PACKAGE_DIRECTORY` and `inCasePath` moves to the
   package; no re-exports. `MANIFEST_FILENAME` stays in `constants.ts` because it also names
   the on-disk Manifest; the package references it.
6. **No ADR.** Nothing here reverses a prior decision. The literal-guard test is the record.

## Interface

`index.ts`:

- `capturePagePath(captureId)`, `screenshotPath(digest)`, `timestampTokenPath(exhibitId)`
- `exhibitPackageDirectory(kind, storagePath)`, `exhibitPackagePath(storagePath)`,
  `derivedFilePackagePath(parentDirectory, storagePath)`, `inCasePath(storagePath)`
- `CAPTURE_PACKAGE_DIRECTORY`, `SCREENSHOT_PACKAGE_DIRECTORY`, `TIMESTAMP_PACKAGE_DIRECTORY`
- `PACKAGE_ROOT_FILES` (frozen): `manifest`, `report`, `certification`, `signingPublicKey`,
  `verifyRunbook`, `verifyScript`, `evidenceIndex`, `exportEntry`, `tsaRoot`,
  `tsaIntermediates`

`shell.ts`:

- `renderShellPathHelpers()`: the sh function block `verify.sh` embeds
- `renderRunbookLayoutRows()`: the Markdown table rows for the runbook's contents section

`bindDerivedFile` and `matchDerivationEntries` stay in `exhibitBinding.ts` and import the
package.

## Tests

All through the two entry points.

1. **Equivalence.** Each TS path function against its rendered sh helper, run through
   `/bin/sh` and `/bin/bash` over a table of ids, digests, kinds and Windows-style storage
   paths. Extends the `verifyScriptPaths.test.ts` pattern, which moves into the package.
2. **Literal guard.** Fails when `pages/`, `screenshots/`, `timestamps/` or a root filename
   appears as a string literal in `export.ts`, `evidencePackage.ts`, `verifyScript.ts`,
   `verifyRunbook.ts` or `exhibits.ts`. The `noConsole.test.ts` shape.
3. **Byte identity.** `tests/shared/verify/fixtures/pre-scope-package`, `export.test.ts`,
   `verifyRunbookExecution.test.ts` and `tests/verifier/binary.test.ts` run unchanged.

## Steps

- [ ] Create the package: `index.ts`, `shell.ts`, `lib/`, `tests/`; move `inCasePath` and the
      directory constants out of `exhibitBinding.ts`.
- [ ] Add the equivalence test and the literal guard; both red against the current tree.
- [ ] Move `export.ts`, `evidencePackage.ts`, `exhibits.ts`, `verifyScript.ts`,
      `verifyRunbook.ts`, `tsaTrust.ts`, `caseArchive.ts`, `deletionReconciliation.ts`,
      `manifest.ts` and the fifteen test importers onto the package; delete the old exports.
- [ ] `pnpm lint:boundaries`, `pnpm preflight`.
- [ ] Draft PR labelled `agent-authored`, `evidence-affecting`.

## Files touched

New: 6 under `src/packages/evidence-package-layout/`. Changed: 10 under `src/`, 15 under
`tests/`, `CONTEXT.md`. Over the ten-file bar of ADR-0016, so execution waits for approval.
