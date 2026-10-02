# One reader for the Manifest

Written 2026-10-02 from an architecture review lead, revised the same day after an adversarial
review (see "Review disposition"). Not started. Most slices touch a blocking-tier path, so they
carry `evidence-affecting` and wait for human review.

## Problem

The rules for reading a Manifest live in several modules, and each copy answers a slightly
different question over a slightly different input. When one copy is fixed, the others keep the
old answer: #1657 needed two PRs (a588cbb0, 867b7105) for one symptom, and PR #1672's body lists
three cases that still fail Package Verification.

The deepening is one module in verify-core that reads a Case's chains once and answers the
questions export, the Data screen, and Package Verification ask of them. `verify.sh` and the
Verify Runbook stay separate adapters, held to the module by a conformance test.

## Confirmed evidence

Line numbers are at `802ef13d`.

### Which key verifies which Manifest Entry

On a chain that passes, every copy agrees: an entry verifies under the `sourcePublicKeyPem` of the
first `import` entry after it, else the local key.

- `src/shared/verify/manifestChain.ts:353` (`keyFor`).
- `manifestChain.ts:326-334`, phase C of the newer-schema path. **Not a plain copy:** it adds the
  unreadable entry's own `import` key as a boundary, which `keyFor` lacks. That extra boundary is
  what keeps a genuine imported segment from reading as tampered (X25).
- `src/main/services/exhibits.ts:159` (`signerSegments`).
- `src/main/services/export.ts:1319` (`signingKeyRanges`, from a588cbb0).
- `src/main/services/verifyScript.ts:259-307` (`key_for`, `key_run_note` in `verify.sh` step 2).
- `src/main/services/verifyRunbook.ts:192-196` (`VERIFY.md` step 2). It picks boundaries by the
  entry's `.index` field, not line position, and an `import` with no key falls back to the
  enclosed key.
- `src/main/services/reportHtml.ts:1395` states the rule in prose.
- `src/shared/verify/sharedCase.ts:515-524` verifies a fork's source history under the last
  `import` entry's key.

Divergences, all on chains that fail: an `import` with no string key is skipped by
`signingKeyRanges`, becomes an empty-key boundary in `verify.sh`, and falls back to the enclosed
key in `VERIFY.md`; `.index` and line position differ only when the index is wrong.

**Fingerprints differ on every chain.** `exhibits.ts:136` hashes the key's DER
SubjectPublicKeyInfo. The Certification (`export.ts:1323`), `verify.sh` (`:299-307`), and
`VERIFY.md` (`verifyRunbook.ts:199`, `sha256sum entry-key.pem`) hash the PEM text. The PEM-text
hash is the contract every shipped package already states; only the Data screen differs.

### Detecting a Shared Case

`manifest.ts:252` (`isSharedCase`) and `evidencePackage.ts:423-429` test the same signals. The app
reads every written line; the verifier reads the prefix before a break. They differ only on a
chain that fails.

### The active set of Exhibits

`export.ts:335` (`resolveUnreconciledChainCaptures`) counts every `deletion`; `evidencePackage.ts:
496-505` counts one only from the chain that authored the Exhibit. Export passes only the local
chain's lines (`export.ts:702-705`) and only reads `capture` entries, so over that input both
rules give one set. The copies disagree on scope: export skips `exhibit` entries and other
members' chains, and reads past a break. `verify.sh` (`verifyScript.ts:449`) reads only
`manifest.jsonl`.

### Row id to chain id

`captureLifecycle.ts:630-683` (`entryDescribesRow`, `readAnchoredIdMap`) binds a renamed row
through `import-id-map.json`, read only when its digest matches the signed `import` entry's
`idMapSha256`, and only for a case id the custody records name (`:636-641`). It refuses inference
on purpose: a row's index is editable on the Database screen, and an edited index can land on
another Capture's entry over the same bytes (`:1099-1113`). `export.ts:911` (`resolveChainNames`)
infers the chain id from index and Content Hash for naming package files, and refuses an id
another row holds or two renamed rows claim.

Writers and readers that still use the row id where the chain uses another (numbered as in PR
#1672's body, not the commit message):

- A deletion of a renamed row signs a `deletion` naming the new id (failure 1).
- The thumbnail backfill signs a `derivation` naming the new id (failure 2), and its dedup keys on
  the row id (`exhibitBackfill.ts:357`).
- `deletionReconciliation.ts:136-147` matches `deletion.captureId` to row ids.
- `resolveEntrySignatures` (`export.ts:289`) looks up by row id, so a renamed row reads `no-entry`
  (#1472).

### Admitting a Timestamp Token

Fixed in 44662740: both token loops (`export.ts:1397`, `:1933`) call `stampFor`. The loop exists
twice.

### Entries read without types

Export folds `Record<string, unknown>` lines at `export.ts:97`, `:289`, `:335`, `:866`, `:911`,
`:1319`, and `:1995`, with no chain check first. Lines past a break reach the report,
`evidence.json`, and the Certification, and so do lines past an entry from a newer schema. That
second case matters: `caseArchive.ts:426-517` imports a Case whose chain holds a newer-schema
entry and reports `verifierTooOld`, and a Shared Case member can run a newer build. Today a newer
verifier passes such a package because export enclosed every Exhibit.

## Interface sketch

Two layers. A pure verify-core module does no file reads. A main-side adapter reads the files.

```ts
// src/shared/verify/chainView.ts
export interface ChainInput {
  jsonl: string // the local Manifest
  localPem: string // trust anchor; never a key read from the Manifest
  others: SharedCaseMemberChain[] // [] when not shared
  lineage: SharedCaseLineage[] // [] when not forked
  idMapPayload: unknown | null // parsed import-id-map.json; digest-checked inside
  rows: CaseRow[] // every row of the Case: id, caseId, kind, index, Content Hash
  onTooOld: 'stop' | 'read-written' // see invariant 3
}

export interface ChainView {
  local: ChainVerifyResult // the local chain's verdict, unchanged
  shared: SharedCaseVerifyResult | null // findings, roster, exclusions, lineage; null when not run
  entries: readonly ManifestEntry[] // typed; the fact scope invariant 3 defines
  factsIncludeUnread: boolean // true when onTooOld read past an unreadable entry
  signerRuns(): SignerRun[]
  activeExhibits(): ActiveExhibit[]
  exhibitNumber(chainId: string): number | undefined
  chainName(rowId: string): ChainName | undefined // { id, path, via }
  binds(entry: { caseId: string; rowId: string }, rowId: string): boolean
  stamp(contentHash: string): { result: TrustedTimeResult; tokenEntryIndex?: number }
  entrySignature(chainId: string): 'signed' | 'unsigned-legacy' | 'no-entry'
}

export function keyFor(boundaries: Boundary[], localPem: string, index: number): string
export function readChain(input: ChainInput): ChainView

// src/main/services/manifest.ts, the adapter
export function readCaseChain(caseDir: string, localPem: string, rows: CaseRow[]): ChainView
```

`SignerRun` carries `fromIndex`, `toIndex`, `pem`, `carriedByImportAt`, `pemSha256`, and
`spkiSha256`. `ChainName.via` is `'own' | 'id-map' | 'inferred'`.

Write-side answers stay outside the view. `nextExhibitNumber` (`captureLifecycle.ts:301`,
`:1159`, `staging.ts:218`, `exhibitBackfill.ts:318`) and the backfill's prior-derivation read ask
whether something was ever written, run on every new Exhibit, and verify nothing today. They keep calling
`highestIssuedExhibitNumber` and their lenient reads directly.

### Invariants

1. One function computes the key rule: `keyFor(boundaries, localPem, i)`. Phase C passes its
   boundaries plus the unreadable entry's key; pass 2 passes the parsed boundaries.
2. `local` is the local chain's verdict alone. The Shared Case walk runs only when `local.valid`,
   and its findings stay in `shared`, as in `evidencePackage.ts:430-478`.
3. Fact scope: on a pass, every entry. On a break, the prefix before `brokenAt`. On an unreadable
   newer-schema entry, the prefix when `onTooOld` is `'stop'`, and every written line, with
   `factsIncludeUnread` set, when it is `'read-written'`. The view never truncates silently.
4. `binds` accepts only `via: 'own' | 'id-map'`, and only for a case id the custody records name.
   `chainName` may answer `'inferred'`, for naming package files only.
5. `chainName` resolves over every row in `input.rows`, so it can refuse an id another row holds
   or two renamed rows claim.
6. A deletion removes an Exhibit only when its authoring chain wrote the deletion, or no chain
   authored it.
7. `exhibitNumber` is the last assignment in chain order, as in Package Verification and
   `verify.sh` (`verifyScript.ts:557-590`).
8. `chainView.ts` imports no `fs`, `node:fs`, `path`, `@main/*`, or native module. A per-file
   test enforces this: `importHygiene.test.ts` bans only `electron`, `better-sqlite3`, `keytar`,
   `hono`, and `@main`, and the verifier bundle allows `fs`.

Package Verification's `shippedEntries` (`evidencePackage.ts:357-363`), which §7.2b and §7.4
compare against the shipped head, stays outside the view.

### Error modes

- Chain content never throws; it becomes a verdict.
- An id map whose digest matches no `import` entry is ignored.
- `keyFor` throws `RangeError` for an index outside the chain.

## Placement

Ruled (ruling 1): `src/shared/verify/chainView.ts`, exported through the verify-core barrel. Every
change to `src/shared/verify/**` hits the blocking tier of the include list (the "Include list"
section of `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`), which the pre-pass
reviewer enforces (`.claude/agents/birdbrain-reviewer.md:78-90`);
`scripts/jev-lens/backstop.mjs` reads the same list as an advisory shadow lens (ADR-0031).
`src/packages/**` is not on that list, and neither is `evidence-package-layout`. The renderer
cannot import verify-core, so the Data screen gets its answers through `getManifestSnapshot`.

## Behaviour changes

No slice changes Package Verification's or `verify.sh`'s verdict on any package already exported.

| Divergence | Answer taken | Effect |
| --- | --- | --- |
| Export reads past a break | Ruled: stop at the break and count the lines left out (ruling 2) | Re-exporting a broken-chain Case lists fewer Exhibits and drops the Certification's key ranges together |
| Export reads past a newer-schema entry | Ruled (ruling 5): read every written line and disclose (`'read-written'`), never truncate | Today's contents plus a disclosure line. Truncating would make a newer verifier FAIL coverage on a genuine package |
| Signer fingerprint | PEM-text hash everywhere packages go; Data screen too (ruling 4) | None in packages |
| Unreconciled list scope | New `evidence.json` field covering `exhibit` entries and every member's chain; `unreconciledChainCaptureIds` unchanged; index schema to 3 (`schemas.ts:960-967` says bump on shape change; no verifier reads the field) | Re-exports gain a field |
| Entry signature by row id | Look up by chain id | Fixes #1472 |

Working Copies read `chainIdByCaptureId` and `fileExhibits` (`export.ts:1710-1852`), so slices 4
and 5 change a Working Copy's entry-signature and naming exactly as they change an Evidence
Package's. A Working Copy does not read the unreconciled list.

The writers that sign entries for renamed rows are a separate ticket, not a slice here (see
"Separate ticket").

## Slices

Each slice is one PR, cut from `main`, green under `pnpm preflight` on its own.

- [ ] **0. Fixtures and conformance (tests only, no include-list hit).**
  - Freeze one byte-for-byte Evidence Package per era beside `pre-scope-package`: all-v1
    unsigned; import-carrying from before a588cbb0; schema 3; schema 4 Shared Case; one holding
    a newer-schema entry, modelled on `manifestSchema4TooOld.test.ts`. The Evidence Profile is
    unpublished (`CONTEXT.md:287`), so these eras are the axes backward verification has today:
    entry schema 1 to 4, `evidence.json` schema 1 and 2, the export-entry cutoff
    (`schemas.ts:982`), and signed or unsigned.
  - Build whole packages, not bare chains, for: native; two-hop import; adjacent imports; a
    renamed import with its id map; a Shared Case with a deletion in another member's chain; a
    broken chain with a deletion past the break; a `renumber` after an `exhibit`; a rejected
    Timestamp Token beside an accepted one.
  - Pin each copy's current answer as characterization tests, and record per fixture where
    `verify.sh` and `VERIFY.md` are expected to differ from the TypeScript (they read the whole
    `manifest.jsonl` and no member chains).
  - Run `verify.sh` step 2 and the `VERIFY.md` step 2 block (as `verifyRunbookExecution.test.ts`
    does) and compare their key runs. Linux only: CI's `test` job runs on `ubuntu-latest`
    (`ci.yml:191`), `/bin/sh` is dash there, the BSD `shasum` branches never run, and `jq` is
    required (`tests/helpers/jq.ts`).
- [ ] **1. One key rule (blocking: `src/shared/verify/**`).** Extract
      `keyFor(boundaries, localPem, i)` in `manifestChain.ts`; phase C passes the unreadable
      entry's key as an extra boundary. Edits the chain walk, so it carries the frozen-package
      byte-identity list and the newer-schema cases in `manifestChain.test.ts`.
- [ ] **2. Add `chainView.ts` (blocking).** `readChain` delegating to `verifyManifestChainText`,
      `verifySharedCaseReplica`, `exhibitNumberSequences`, and `stampFor`, with the per-file
      import ban. No caller moves.
- [ ] **3. Adapter and the Data screen (blocking: `manifest.ts`, `exhibits.ts`).**
      `readCaseChain`; `signerSegments` reads `signerRuns()`. The Certification keeps
      `signingKeyRanges` until slice 4, so the two documents stay consistent on a broken chain.
- [ ] **4. Export reads the view (blocking: `export.ts`).** Typed entries, `signerRuns()` for the
      Certification, entry signatures by chain id, one token loop, `onTooOld: 'read-written'`
      with disclosure, and the break rule from ruling 2. Byte identity on every
      passing-chain export test and frozen package.
- [ ] **5. Chain names and bindings (blocking: `export.ts`, `captureLifecycle.ts`,
      `exhibits.ts`).** `resolveChainNames` becomes `chainName`; `entryDescribesRow` becomes
      `binds` at all three call sites (duplicate, `verifyExhibit`, derivation parent), with
      inference never accepted there.
- [ ] **6. Unreconciled list (blocking: `export.ts`, `schemas.ts`, `reportHtml.ts`).** New
      field from `activeExhibits()`, index schema 3.
- [ ] **7. Remaining readers (blocking: `manifest.ts`, `evidencePackage.ts`).** `isSharedCase`
      and Package Verification's §7.2 fold read the view. Verdicts byte-identical on the frozen
      packages, `preScopeFixture.test.ts`, `evidencePackage.test.ts`, `manifestSchema3.test.ts`,
      `manifestSchema4.test.ts`, `manifestSchema4TooOld.test.ts`, and
      `tests/verifier/binary.test.ts`.

Slices 1 and 7 both edit Package Verification. Slices 2 to 7 depend on 1 and 2.

## Separate ticket: writers name the chain id

Signs permanent entries and needs no view: the anchored id map is readable today. Scope:
`captureLifecycle.ts` (deletion), `exhibitBackfill.ts` (derivation and its dedup key at `:357`),
and `deletionReconciliation.ts:136-147`, all keyed on the chain id resolved through `'own'` or
`'id-map'` only. Writing an inferred id could sign a deletion for a live Exhibit and make both
verifiers excuse its absence permanently. On an unresolved row, the app refuses the operation (ruling 3).

No Manifest schema bump is needed: both verifiers accept a `deletion` naming an id the same
chain authored. Older app builds resolve the new entries only through the one-hop id map.
Failure 3 in PR #1672 (Case Archives carry no Derived Files) is not fixed here, so the
known-answer test must use a source Case with no thumbnails.

## Tests

- **New:** `tests/shared/verify/chainView.test.ts`, one case per invariant, each failing when
  that rule alone is removed; the per-file import ban; slice 0's fixtures and conformance.
- **Moves:** `tests/main/services/resolveChainNames.test.ts` into `chainView.test.ts` in slice 5.
- **Shrinks:** `signerSegments` cases in `exhibitModel.test.ts` (slice 3) and key-range cases in
  `certification.test.ts` (slice 4) drop to one wiring test each.
- **Unchanged floor:** `importedCasePackage.test.ts`, `sharedCaseExport.test.ts`,
  `verifyRunbookExecution.test.ts`, `exhibitNumbers.test.ts`, `exhibitNumbering.test.ts`.

## Risks

- **Verification cost.** Export does not check the chain today; the view does, once per export.
  Build it once per snapshot. Paths that add an Exhibit never build one.
- **#1199.** Two genuine newer-schema shapes still read as broken. Slice 1 must leave them
  exactly as they are.
- **Fact scope on a newer-schema entry.** If a slice wires `onTooOld: 'stop'` into export, a newer
  verifier FAILs a genuine package. Slice 0's newer-schema fixture guards it.

## Maintainer rulings (2026-10-02)

1. **The reader lives in verify-core** at `src/shared/verify/chainView.ts`, on the blocking tier.
2. **On a chain break, the report, index, and Certification stop at the break**, as Package
   Verification does, and state how many later lines they left out as unverified.
3. **When a writer cannot resolve a renamed Exhibit through its own id or the signed id map, the
   app refuses the operation** and explains why. It never signs an id it could not resolve.
4. **The Data screen prints the PEM-text key hash** that the Certification and `VERIFY.md` print.
5. **When the Manifest holds a newer-schema entry, export reads every written line and discloses
   it.** It never truncates there.

## Review disposition

1. Accepted. `caseArchive.ts:426-517` imports with `verifierTooOld`; added `onTooOld`, the
   behaviour row, the fixture, and question 5.
2. Accepted. `captureLifecycle.ts:1099-1113` refuses inference; `binds` takes own or id-map only
   and the writers moved to a ticket gated on question 3.
3. Accepted. `manifestChain.ts:326-334` pushes the unreadable entry's key; slice 1 extracts a
   parameterized `keyFor`.
4. Accepted. `export.ts:644`, `:1423` read unverified lines; the Certification moves in slice 4,
   with the break rule.
5. Accepted. `verifyRunbook.ts:192-196` uses `.index` and falls back to the enclosed key; all
   copies listed, `VERIFY.md` added to the conformance run.
6. Accepted. `export.ts:1091` reads `named?.path`; the view takes every row and returns
   `ChainName`.
7. Accepted. Inputs required, adapter added, write-side answers left outside the view.
8. Accepted. `local` and `shared` split; `shippedEntries` stays outside.
9. Accepted. `deletionReconciliation.ts:136-147` and `exhibitBackfill.ts:357` added to the ticket.
10. Accepted. Per-era frozen packages in slice 0; the "only slice 8" claim corrected.
11. Accepted. Per-file import ban added to slice 2.
12. Accepted. Whole packages, recorded differences, and Linux-only stated.
13. Accepted in part. Question 4 narrowed to the Data screen; question 5 settled as a new field and
    index schema 3. Question 3 narrowed rather than closed: the bindings are settled by #827's
    comments, but writer behaviour on an unresolved row is not.
14. Accepted. Numbering now cites PR #1672's body; failure 3 noted for the ticket's test.
15. Accepted. Placement cites the reviewer and ADR-0031; Working Copy effects stated.
