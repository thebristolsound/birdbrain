# The verification procedure as one list of steps

Plan written 2026-10-02 at `main` 802ef13d, from candidate 4 of the architecture review of the same
day (the two sibling plans, `2026-10-02-manifest-chain-reader.md` and
`2026-10-02-database-restore-path.md`, are candidates 1 and 2 on branch
`t3code/improve-codebase-architecture-1`). Every file reference below was read at 802ef13d.

## Problem

An Evidence Package describes its own verification four times. `verify.sh` runs six numbered
steps, `VERIFY.md` explains the same six, the report's "Independent verification instructions"
lists six different ones, and Package Verification (`evidencePackage.ts`) implements the checks in
its own `§7.x` order. Nothing holds the four to one list. A change to what verification checks is
made by hand in each, and the record shows the copies drifting:

- d48ab3fa and f42df50d each edited the TypeScript, the script and the runbook for one rule.
- a588cbb0 changed the key rule in the script, the runbook and the Certification and left the
  report saying every entry verifies under `signing-public-key.pem`; 867b7105 fixed the report a
  day later.
- `tests/main/services/verifyScriptTokenFilter.test.ts` exists only to lift a `jq` filter out of the
  script text and check the runbook contains it.

## Evidence

### One step, several names

| Step | `verify.sh` (`begin`) | `VERIFY.md` heading | Report (`reportHtml.ts:1385-1430`) |
| --- | --- | --- | --- |
| 1 | `:242` file integrity against the unsigned index | `:171` File integrity | 1 rehash each page against `evidence.json` |
| 2 | `:257` entry signatures | `:180` Entry signature | 3 check the entry signatures |
| 3 | `:355` recomputed entry hashes | `:206` Recompute `entryHash` | 2 replay the manifest chain (merged with 4) |
| 4 | `:367` chain linkage | `:225` Chain linkage | 2 |
| 5 | `:389` content bind | `:234` Content bind | 1 and 5 (pages, screenshots) |
| 6 | `:643` timestamp | `:308` Timestamp | 4 validate the timestamp tokens |
| — | not run (header `:70-73` says so) | not described | 6 recompute the package hash |

The report numbers its steps differently from the two documents it sends the reader to. Its
no-anchor alert says "Step 4 therefore requires a root" (`reportHtml.ts:1439`), meaning its own
step 4, the timestamp step, while `VERIFY.md` step 4 is chain linkage. Its step 1 tells the
reader to compare each page to the digest in `evidence.json`, which `VERIFY.md` step 5
(`verifyRunbook.ts:236-238`) says not to trust ("NOT the value in `evidence.json`"). Its step 6
describes a package-hash check that only Package Verification performs. It never mentions
Exhibits of other kinds, Derived Files, the export entry, or the era gate, all of which the script
and runbook check.

### One recipe, two spellings

The same `jq` or shell recipe is written into the script and the runbook separately:

| Recipe | `verify.sh` | `VERIFY.md` | Same text? |
| --- | --- | --- | --- |
| Index check filter `.artifacts[] \| "\(.sha256)  \(.path)"` | `:245` | `:177` | yes |
| Canonical entry body `jq -cS 'del(.entryHash, .signature)' \| tr -d '\n'` | `:232` | `:213` | yes |
| Signed token filter | `:658` | `:337` | **no**: the runbook omits `(.tsaToken \| type) == "string"` |
| Key for an entry | `:265-285`, by line position | `:194-198`, by `.index`; an `import` with no key falls back to the enclosed key | **no** (owned by the chain-reader plan, slice 0) |
| Era read from `evidence.json` | `:432-435`, a `jq` number test | `:116-128`, prose | different forms by design |

Only `EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION` is shared today (`verifyScript.ts:27`,
`verifyRunbook.ts:12`).

### What holds the copies together now

- `tests/main/services/verifyRunbookExecution.test.ts` builds one real package through export,
  runs every `sh` block of `VERIFY.md` against it, and runs `verify.sh` on it and on each
  corrupted copy it builds, asserting the failing step. Two cases (`:462`, `:488`) also run Package
  Verification and assert the two agree; the rest check the script alone.
- The Package Layout literal guard
  (`src/packages/evidence-package-layout/tests/literalGuard.test.ts:20-28`) covers the script and
  runbook but not `reportHtml.ts` or `certification.ts`. Probed at 802ef13d, adding them would
  flag 9 lines in the report (doc comments, and the prose `<code>pages/</code>`,
  `<code>screenshots/</code>`, `<code>timestamps/</code>` at `:1010`, `:1096`, `:1386`, `:1408`,
  `:1424`) and 1 in the Certification (`:678`). The report also names root files in prose 36 times
  and the Certification 9 times, as literals the guard's quoted-string test does not see.

## Design

### The module

`src/main/services/verifyProcedure.ts` holds the ordered step list and the recipes more than one
rendering uses. It renders nothing itself and imports only the Package Layout.

```ts
export type VerifyStepNumber = 1 | 2 | 3 | 4 | 5 | 6

export interface VerifyStep {
  number: VerifyStepNumber
  /** `begin N '<scriptTitle>'` in verify.sh. */
  scriptTitle: string
  /** `## Step N — <runbookTitle>` in VERIFY.md. */
  runbookTitle: string
}

export const VERIFY_STEPS: readonly VerifyStep[] // in order, numbers 1..6
export function verifyStep(number: VerifyStepNumber): VerifyStep

/** Recipes both shipped documents spell, as the text each embeds. */
export const VERIFY_RECIPES: {
  indexCheckFilter: string // jq program for step 1
  canonicalEntryBody: string // jq | tr pipeline for step 3
}
```

`verify.sh` and `VERIFY.md` read every step number, title and shared recipe from it. Prose that
names a step in another document (the script's step 6b reference to `VERIFY.md` and the report's
`VERIFY.md` step 2) reads the number from `verifyStep` too, so renumbering is one edit.

The report gets a summary per step in slice 4, as a renderer-local table keyed by
`VerifyStepNumber` in `reportHtml.ts`, not a field on `VerifyStep`. It needs the report's context
(`entriesUnderCarriedKeys`, `tsaTrustAnchorBundled`), and a step list that carried HTML would
import the report's types.

### What it does not do

- It does not hold each step's `sh` body or runbook prose. The script's steps share shell state
  (`head_hash` from step 4 feeds step 5, `deleted` and `have_selection` from step 5 feed step 6),
  so cutting the script into per-step strings in another file hides that coupling without
  removing it. The bodies stay in `verifyScript.ts` and `verifyRunbook.ts`.
- It does not generate Package Verification. The TypeScript checks are a second implementation,
  and the seam between it and the shell is held by the conformance table in slice 3, not by
  rendering.
- It does not touch the key rule. The chain-reader plan's slice 0 records that divergence and its
  slice 1 settles it; this plan's conformance table is the harness that slice 0 adds rows to.

### Invariants

1. `VERIFY_STEPS` is the only place a step number is paired with a title. A test asserts the
   script has exactly one `begin N` per step, in order, and the runbook exactly one
   `## Step N` heading per step, in order.
2. Slices 1 and 2 leave the bytes of `VERIFY_SCRIPT` and `VERIFY_RUNBOOK` unchanged. Each PR
   states the before and after SHA-256 of both strings. A later content change is its own slice.
3. Every corruption in the conformance table names the expected verdict of both verifiers. Where
   they differ by design (the script reads only `manifest.jsonl`, does not recompute the package
   hash), the row records the difference and the reason, and the test fails if the difference
   goes away as well as if a new one appears.

## Placement

`src/main/services/verifyProcedure.ts`, beside the three files that import it. Its strings
ship inside every package, so slice 2 adds a blocking-tier row for it to the Include list in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, which `scripts/jev-lens/backstop.mjs`
and the pre-pass reviewer read. A package under `src/packages/` was considered: the Package
Layout is one, but the step list has one consumer family (the shipped documents), all in
`src/main/services`, and a package path is not on the Include list either, so it would need the
same row and add a boundary nothing else needs.

## Slices

Each slice is one PR cut from `main`, green under `pnpm preflight`. Every slice except 3 edits a
blocking-tier file, so each carries `evidence-affecting` and waits for human review.

- [ ] **1. The layout guard covers the report and Certification (byte-identical).**
  - Add `reportHtml.ts` and `certification.ts` to `CONSUMERS`.
  - Strip `/**` comment lines in the guard the way it already strips `//`, `#` and `*` lines.
  - Read the directory names in the report's prose and the Certification's key label from the
    Package Layout (`CAPTURE_PACKAGE_DIRECTORY`, `SCREENSHOT_PACKAGE_DIRECTORY`,
    `TIMESTAMP_PACKAGE_DIRECTORY`, `PACKAGE_ROOT_FILES.signingPublicKey`).
  - Check: a report and a Certification rendered from a fixed fixture are byte-identical before
    and after.
- [ ] **2. The step list (byte-identical).** Add `verifyProcedure.ts`; `verify.sh` and `VERIFY.md`
  read step numbers, titles and the two shared recipes from it; the Include list row; the
  invariant 1 test. `verifyScriptTokenFilter.test.ts` keeps its runbook assertion until slice 5
  makes the filter a shared recipe.
- [ ] **3. The conformance table (tests only).** `tests/helpers/verifyConformance.ts` builds the
  package `verifyRunbookExecution.test.ts` builds, applies a named corruption, and runs both
  Package Verification and `verify.sh`. One table row per corruption the execution test already
  covers, each with both verdicts and the step the script names. The two existing agreement cases
  move into the table. Linux only, as now: CI's `test` job runs on `ubuntu-latest`, where
  `/bin/sh` is dash.
- [ ] **4. The report lists the shipped steps.** The report's instructions render one item per
  `VERIFY_STEPS` entry, in that order and numbering, from a summary table in `reportHtml.ts`, and
  the package-hash check moves out of the numbered list into a sentence naming Package
  Verification as the only check that performs it. The no-anchor alert cites step 6. Step 1's
  advice points at the signed entry, as `VERIFY.md` step 5 does. Changes the bytes of every new
  report; existing packages keep theirs.
- [ ] **5. Close recorded divergences, one PR each.** First: the runbook's token filter gains the
  `tsaToken` type test and both documents read it from `VERIFY_RECIPES`, which retires the lift in
  `verifyScriptTokenFilter.test.ts`. Further rows come from what slice 3 records.

## Tests

- **New:** the invariant 1 test (slice 2); `tests/helpers/verifyConformance.ts` and its table
  (slice 3).
- **Moves:** the two agreement cases in `verifyRunbookExecution.test.ts` (`:462`, `:488`) into the
  table.
- **Changes:** `reportLayoutInvariants.test.ts` and `importedCasePackage.test.ts` assert report
  prose; slice 4 updates them to the new step wording.
- **Unchanged floor:** `verifyRunbookExecution.test.ts` (it executes the generated text, so it
  checks slices 1 and 2 for free), `tests/verifier/binary.test.ts`, the frozen
  `pre-scope-package` fixture, whose shipped `report.html` is never regenerated.

## Risks

- **Template escaping.** The recipes contain backslashes that the current template literals
  double (`'\\n'` in source is `\n` in the shipped script). A constant interpolated into a
  template is inserted verbatim, so each recipe is written with single backslashes in a plain
  string. Invariant 2's byte check catches a mistake.
- **Overlap with the chain-reader plan.** Both plans edit `verifyScript.ts` and `verifyRunbook.ts`
  and both want a TypeScript-to-shell conformance run. Slice 3 here is the shared harness; whichever
  plan lands second rebases onto it.
- **Report wording is a shipped statement.** Slice 4 rewrites what a reader is told to do. It
  follows `VERIFY.md`, which is the authority the report already defers to, but a reviewer should
  read it as an evidence change.

## Open questions for the maintainer

1. Slice 4 drops the package-hash check from the report's numbered steps because neither shipped
   document performs it. Should the report instead keep it numbered as a seventh step, marked as
   the Birdbrain verifier's check only?
2. The script and runbook title each step differently ("entry signatures" versus "Entry signature
   (`schemaVersion` 2 and above)"). Should a later slice unify the titles, which changes the bytes
   of both shipped documents, or keep both forms in the step list?
