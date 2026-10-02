# The verification procedure as one list of steps

Plan written 2026-10-02 at `main` 802ef13d, from candidate 4 of the architecture review of the same
day (the two sibling plans, `2026-10-02-manifest-chain-reader.md` and
`2026-10-02-database-restore-path.md`, are candidates 1 and 2 on branch
`t3code/improve-codebase-architecture-1`). Revised the same day after an adversarial review (see
"Review disposition"). Every file reference below was read at 802ef13d.

## Problem

An Evidence Package describes its own verification four times. `verify.sh` runs six numbered
steps, `VERIFY.md` explains the same six, the report's "Independent verification instructions"
lists six different ones, and Package Verification (`evidencePackage.ts`) implements the checks in
its own `§7.x` order. Nothing holds the four to one list. A change to what verification checks is
made by hand in each, and the record shows the copies drifting:

- d48ab3fa and f42df50d each edited the TypeScript, the script, and the runbook for one rule.
- a588cbb0 changed the key rule in the script, the runbook, and the Certification, and left the
  report saying every entry verifies under `signing-public-key.pem`; 867b7105 fixed the report a
  day later.
- `VERIFY.md` already cites the wrong step: "what covers them is chain linkage (step 3)"
  (`verifyRunbook.ts:67`), where chain linkage is step 4 (`:225`). The script says the same
  entries are "covered by steps 3, 4 and 6" (`verifyScript.ts:350`).

## Evidence

### One step, several names

| Step | `verify.sh` (`begin`) | `VERIFY.md` heading | Report (`reportHtml.ts:1385-1430`) |
| --- | --- | --- | --- |
| 1 | `:242` file integrity against the unsigned index | `:171` File integrity | 1 rehash each page against `evidence.json` |
| 2 | `:257` entry signatures | `:180` Entry signature | 3 check the entry signatures |
| 3 | `:355` recomputed entry hashes | `:206` Recompute `entryHash` | 2 replay the manifest chain (merged with 4) |
| 4 | `:367` chain linkage | `:225` Chain linkage | 2 |
| 5 | `:389` content bind | `:234` Content bind | 5 match the screenshots (pages only through `evidence.json`) |
| 6 | `:643` timestamp | `:308` Timestamp | 4 validate the timestamp tokens |
| — | not run (header `:70-73` says so) | not described | 6 recompute the package hash |

The report numbers its steps differently from the two documents it sends the reader to, and it
cites theirs too: "`VERIFY.md` step 2" and "`verify.sh` step 2" (`:1397-1398`), "`VERIFY.md` step
6a" (`:1414`). Its no-anchor alert says "Step 4 therefore requires a root" (`:1439`), meaning its
own step 4, the timestamp step, where `VERIFY.md` step 4 is chain linkage. Its step 1 compares each
page against `evidence.json`, as `VERIFY.md` step 1 does, but never says that index is unsigned
(`verifyRunbook.ts:173-174`), and no report step binds a page to its signed entry, which is
`VERIFY.md` step 5's job (`:236-239`). Its step 6 describes a package-hash check that only Package
Verification performs. It does not mention Exhibits of other kinds, Derived Files, or the era
gate.

The same report section renders in the standalone HTML export (`export.ts:796`) as well as inside
packages.

### Step references are prose, everywhere

The two shipped documents cite steps by number in their own prose: about 26 times in the runbook
(for example `:55`, `:67`, `:104`, `:157`, `:188`, `:339`, `:406`) and about 20 times in the
script, most of them inside the shipped text (`:61`, `:72`, `:74`, `:218`, `:230`, `:254`, `:350`,
`:650`, `:725`, `:833`). Step 6 has sub-steps 6a, 6b, and 6c that both cite. A renumbering today
is a search across three files, and `:67` shows a reference can be wrong without any test
noticing.

### One recipe, two spellings

| Recipe | `verify.sh` | `VERIFY.md` | Same text? |
| --- | --- | --- | --- |
| Index check filter `.artifacts[] \| "\(.sha256)  \(.path)"` | `:245` | `:177` | yes |
| Canonical entry body `jq -cS 'del(.entryHash, .signature)' \| tr -d '\n'` | `:232` | `:213` | yes |
| Signed token filter | `:658` | `:337` | **no**: the runbook omits `(.tsaToken \| type) == "string"` |
| Key for an entry | `:265-285`, by line position | `:194-198`, by `.index`; an `import` with no key falls back to the enclosed key | **no** (owned by the chain-reader plan, slice 0) |

Only `EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION` is shared today (`verifyScript.ts:27`,
`verifyRunbook.ts:12`). `verifyScriptTokenFilter.test.ts` lifts the filter out of the script text,
runs `jq` on it (`:39-55`), and checks the runbook spells the subject test (`:57-59`).

### What holds the copies together now

- `verifyRunbookExecution.test.ts` builds one real package through export in `beforeAll`
  (`:165-340`), runs every `sh` block of `VERIFY.md` against it, and runs `verify.sh` on it and on
  each corrupted copy it makes, asserting the failing step. Two cases (`:462`, `:488`) also run
  Package Verification and assert the two agree. It carries its own `runVerifyScript` (`:138`)
  beside the shared one in `tests/helpers/verifyScript.ts`.
- `importedCasePackage.test.ts:551-556`, `:590-597` and `sharedCaseExport.test.ts` assert both
  verifiers on other case shapes.
- The Package Layout literal guard
  (`src/packages/evidence-package-layout/tests/literalGuard.test.ts:20-28`) covers the script and
  runbook but not `reportHtml.ts` or `certification.ts`. Adding them flags 9 lines in the report
  and 1 in the Certification (`:678`); 4 of the report's are `/**` comments the guard does not
  strip. The Certification also spells `signing-public-key.pem` at `:670`.

## Design

### Order of work

The leverage is in the tests and the report, so they come first. The conformance table (slice 1)
is tests only. The report fix (slice 3) is the user-visible change. The step model (slice 4)
comes after, when the references it replaces are known to be right.

### The step model

`src/main/services/verifyProcedure.ts` holds the ordered steps, their sub-steps, and the recipes
both shipped documents spell.

```ts
export type VerifyStepNumber = 1 | 2 | 3 | 4 | 5 | 6
export type VerifySubStep = '6a' | '6b' | '6c'

export interface VerifyStep {
  number: VerifyStepNumber
  /** `begin N '<scriptTitle>'` in verify.sh; never contains `'`. */
  scriptTitle: string
  /** `## Step N — <runbookTitle>` in VERIFY.md. */
  runbookTitle: string
}

export const VERIFY_STEPS: readonly VerifyStep[] // in order, numbers 1..6

/** "step 2", "step 6a", "steps 3, 4 and 6": every citation goes through here. */
export function stepRef(...refs: (VerifyStepNumber | VerifySubStep)[]): string
/** "steps 2 to 4". */
export function stepRange(from: VerifyStepNumber, to: VerifyStepNumber): string

export const VERIFY_RECIPES: {
  indexCheckFilter: string
  canonicalEntryBody: string
}
```

What makes this more than six title pairs is the citation guard: a test, modelled on the Package
Layout literal guard, fails when the shipped text of `verify.sh`, `VERIFY.md`, or the report
section spells `step <digit>` or `Step <digit>` anywhere `stepRef`, `stepRange`, or a step heading
did not produce it. TypeScript comments are exempt; `#` comments inside the script template ship
and are not. With the guard, renumbering a step or inserting one is one edit plus the bodies that
change.

The report's per-step summaries stay in `reportHtml.ts`, keyed by `VerifyStepNumber`, because
they read the report's context (`entriesUnderCarriedKeys`, `tsaTrustAnchorBundled`).

### What it does not do

- It does not hold each step's `sh` body or runbook prose. The script's steps share shell state
  (`head_hash` from step 4 feeds step 5; `deleted` and `have_selection` from step 5 feed step 6),
  so per-step strings in another file would hide that coupling without removing it.
- It does not generate Package Verification. The TypeScript checks are a second implementation,
  and the conformance table holds the seam between it and the shell.
- It does not touch the key rule; the chain-reader plan's slices 0 and 1 own it.

### Invariants

1. A step number is paired with a title only in `VERIFY_STEPS`, and cited only through `stepRef`
   or `stepRange` (the citation guard).
2. Slices 4 and 5 leave the bytes of `VERIFY_SCRIPT`, `VERIFY_RUNBOOK`, the report, and the
   Certification unchanged. Each PR states the SHA-256 of each before and after, rendered from the
   fixture the existing export tests use with the clock fixed.
3. Every row of the conformance table names the expected verdict of both verifiers. Where they
   differ by design (the script reads only `manifest.jsonl` and recomputes no package hash), the
   row records the difference and why, and the test fails if the difference disappears as well as
   if a new one appears.

## Placement

`src/main/services/verifyProcedure.ts`, beside the three files that import it. Its strings ship in
every package, so slice 4 adds a blocking-tier row under "Export, reporting, archive" in the
Include list of `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`. The Why cell must
not contain `|`, because `scripts/jev-lens/backstop.mjs:16-22` splits rows on it. A package under
`src/packages/` would need the same row (no package path is on the list) and adds a boundary for a
module whose consumers all sit in `src/main/services`.

## Slices

Each slice is one PR cut from `main`, green under `pnpm preflight`. Slice 1 touches only `tests/`;
every other slice edits a blocking-tier file, carries `evidence-affecting`, and waits for human
review.

- [ ] **1. Conformance table (tests only).**
  - `tests/helpers/verifyConformance.ts`: `checkConformance(dir)` runs Package Verification and
    `verify.sh` on an unpacked package and returns both verdicts and the steps the script failed.
    It takes a package directory, not a builder, so any test that builds a package can use it.
  - `tests/helpers/verifyScript.ts` gains the env and argument options the execution test's local
    copy has, and that copy goes.
  - In `verifyRunbookExecution.test.ts`, every corruption case states both verdicts through the
    helper, from one table of `{ name, corrupt, binary, script, steps, divergence? }`. The two
    agreement cases fold into it.
  - Later rows from other case shapes (imported, Shared Case, the chain-reader plan's era
    packages) call the same helper from their own files.
  - Linux only, as now: CI's `test` job runs on `ubuntu-latest`, where `/bin/sh` is dash.
- [ ] **2. Fix the runbook's wrong step citation.** `verifyRunbook.ts:67` cites chain linkage as
  step 3; it becomes "the recomputed entry hashes and chain linkage (steps 3 and 4)" to match the
  script at `:350`. One line of shipped text.
- [ ] **3. The report lists the shipped steps.**
  - One item per step of `VERIFY.md`, in its order and numbering.
  - Step 1 says the index is unsigned; a step 5 item binds pages, screenshots, Exhibits of other
    kinds, and Derived Files to their signed entries.
  - The package-hash check moves out of the numbered list into a sentence naming Package
    Verification as the only check that performs it.
  - The no-anchor alert cites step 6.
  - A test asserts the report's item count and order match the runbook's `## Step` headings.
  - `reportCitationInvariants.test.ts` adds `export-entry.json` to its companion files
    (`:94-104`).
  - Updates the prose pins in `importedCasePackage.test.ts:121-140` and
    `export.test.ts:2390`, `:2434`.
  - Changes the bytes of every new report and standalone report; existing packages keep theirs.
- [ ] **4. The step model (byte-identical).** Add `verifyProcedure.ts`; the script, runbook, and
  report read step numbers, titles, citations, and the two shared recipes from it; the citation
  guard; the Include list row. Recipes keep the doubled backslashes the templates use today
  (`'\\n'`, `\\(`), or use `String.raw`: in a plain string `'\('` is `(` and `'\n'` is a newline.
- [ ] **5. The layout guard covers the report and Certification (byte-identical).** Add both to
  `CONSUMERS`, strip `/**` lines the way `//`, `#`, and `*` lines are stripped, and read directory
  and root file names from the Package Layout, including the Certification's `:670` and `:678`.
- [ ] **6. Close recorded divergences, one PR each.** First: the runbook's token filter gains the
  `tsaToken` type test, both documents read it from `VERIFY_RECIPES`, and
  `verifyScriptTokenFilter.test.ts` reads the recipe instead of lifting it from the script. Further
  rows come from what slice 1 records.

## Tests

- **New:** `tests/helpers/verifyConformance.ts` and the table (slice 1); the report-order test
  (slice 3); the citation guard and a `scriptTitle` quote test (slice 4).
- **Moves:** the two agreement cases (`verifyRunbookExecution.test.ts:462`, `:488`) into the table.
- **Changes:** prose pins in `importedCasePackage.test.ts` and `export.test.ts`, and the companion
  list in `reportCitationInvariants.test.ts` (slice 3).
- **Unchanged floor:** `verifyRunbookExecution.test.ts` executes the generated runbook, so it
  checks slices 2, 4, and 6; `tests/verifier/binary.test.ts`; the frozen `pre-scope-package`
  fixture, whose shipped `report.html` is never regenerated.

## Risks

- **Overlap with the chain-reader plan.** Both edit `verifyScript.ts` and `verifyRunbook.ts`; its
  slice 6 edits `reportHtml.ts`, which collides with slice 3 here. Its slice 0 needs the
  conformance helper, which is why the helper takes a directory rather than one fixed package.
- **Report wording is a shipped statement.** Slice 3 rewrites what a reader is told to do. It
  follows `VERIFY.md`, which the report already defers to, but it is an evidence change.
- **The Package Layout has no Include list row.** `verify.sh` paths come from
  `src/packages/evidence-package-layout/shell.ts`, which no tier covers. Out of scope here; listed
  in slice 4's PR body.

## Open questions for the maintainer

1. Slice 3 drops the package-hash check from the report's numbered steps because neither shipped
   document performs it. Should the report keep it as a seventh numbered step, marked as the
   Birdbrain verifier's check only?
2. The script and runbook title each step differently ("entry signatures" against "Entry signature
   (`schemaVersion` 2 and above)"). Should a later slice unify them, which changes the bytes of
   both shipped documents, or keep both forms in the step list?

## Review disposition

1. Accepted. Step citations number about 46 across the two files; the model gains sub-steps,
   `stepRef`, `stepRange`, and a citation guard, and `:67` became slice 2.
2. Accepted. The escaping advice was wrong; slice 4 keeps doubled backslashes or `String.raw`.
3. Accepted. The helper takes a package directory; other shapes call it from their own files.
4. Accepted. Order changed to tests, then the report, then the model; the guard is what gives the
   model depth.
5. Accepted. Token-filter test, export-entry mention, prose-pin files, companion list, step 1
   wording, and the standalone export corrected.
6. Accepted. Row placement and the `|` constraint stated; the Package Layout gap listed in Risks.
7. Accepted. Fixed clock for the byte check; `:670` added.
8. Accepted. `scriptTitle` quote test added; the import claim dropped.
9. Accepted. Chain-reader slice 6 added to Risks.
