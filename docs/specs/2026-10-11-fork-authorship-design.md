# Fork authorship: design

Date: 2026-10-11
Status: proposed, awaiting maintainer approval. Nothing below ships today.
Issue: #1812 (this note). The fix it proposes is #1638.
Read at `origin/main` `2598173f`: every `path:line` below is at that commit.

## Problem

Decision 18 of the [collaborative cases design](2026-09-19-collaborative-cases-design.md)
("Owner loss") lets any member make a new Case from its replica of a Shared Case: a fork. After a
fork, the app accepts the forking installation as the author of every Exhibit the source Owner
wrote (#1638). A row whose recorded author is changed from the Owner to the forking installation
still reads `verified` in the app, and the same row changed to an unknown installation reads
`chain-broken`. The maintainer ruled on 2026-09-28 that the app should use a stricter rule, and on
2026-10-10 that a design note proposes the rule before anyone changes code.

In this note the *forking installation* is the one that imports the archive and writes the fork's
`import` entry. In the tests it is also the member that exported the archive.

Evidence Packages and the standalone verifier neither state nor check a per-Exhibit author
(#1638), so the rule changes the app's verdict on a row and nothing a package verifier reports.

## Today's rule

- `heldBy` (`src/main/services/manifest.ts:334`) accepts an installation as the holder of an entry
  when it wrote the entry (`operatorId`), or when it wrote any `import` entry later in the same
  accepted chain (`manifest.ts:335-338`).
- `authorChainOf` (`manifest.ts:349`) answers a row that names an author from the first chain
  whose accepted entry at the row's `manifestIndex` is an `exhibit` or `capture` entry for the
  row's Content Hash, held by that author (`manifest.ts:379-393`). It tries the local chain first,
  then each member or lineage chain file named for the author (`manifest.ts:371-378`). A row no
  chain answers for gets a failed chain, which the app reports as `chain-broken`. When none of the
  chains it tried failed verification, the reason is
  `no verified chain of <id> holds entry <n> for these bytes` (`manifest.ts:394-405`).
- `planImportChains` (`src/main/services/caseArchive.ts:543`) forks when the archive's Shared Case
  walk names an Owner, knows which member exported the archive, and holds the Owner's chain
  (`caseArchive.ts:553-570`). The new Case's chain is then the source Owner's chain, the `import`
  names the Owner's installation and key, and every other chain, the exporter's included when it
  is not the Owner, moves under `lineage/<sourceCaseId>/` (`caseArchive.ts:579-590`).
- `importCaseArchive` appends the `import` entry with `operatorId` set to the importing
  installation (`caseArchive.ts:745-758`). `attributeForkedExhibits` (`caseArchive.ts:597`) stamps
  each row that has no author with the exporter's installation id (`caseArchive.ts:603`).

Every entry of the source Owner's chain therefore sits before an `import` the forking installation
wrote, and `heldBy` accepts the forking installation as the holder of all of them. A scratch run
of #1638's test at `2598173f` (a fork of a member's replica, the source Owner's Exhibit row
relabelled) returned `verified` for the forking installation and `chain-broken` for an unknown
installation.

## Question 1: what marks a fork's import

The `import` entry does not. A fork's `import` and an ordinary one carry the same fields
(`src/shared/schemas.ts:705-725`), and `planImportChains` records its choice only in the files
and rows it writes.

The entries the `import` follows do. A fork's `import` continues the source Owner's chain, and that
chain holds the Owner's own `member-add` after its last `import`: the walk builds the roster from
the entries from the last `import` on (`src/shared/verify/sharedCase.ts:477`) and names an Owner
only from a first `member-add` with role `owner` and the chain's own key
(`sharedCase.ts:284-303`). An ordinary import continues a chain with no `member-add` after its
last `import`, with one exception: an archive whose own chain holds `member-add` entries the walk
rejects, so that the walk names no Owner. `planImportChains` then takes the ordinary path, the
failed walk fails the archive's chain check (`caseArchive.ts:423-425`), and the import goes ahead
only under the operator's override (`caseArchive.ts:652-656`), which the `import` records in its
`verificationResult`.

The source Owner signed those `member-add` entries, the chain check verifies them under the key
the `import` names (`schemas.ts:701-704`), and the `import`'s `prevHash` binds them. So the signed
record already separates the two kinds, and nothing needs adding. A history that holds a
`member-add` is also what the Shared Case walk verifies as the source Shared Case
(`sharedCase.ts:513-529`).

This note calls such an entry a *fork import*: an `import` with a `member-add` among the entries
after the previous `import` (or the chain's start) and before it.

## Question 2: an ordinary import and a fork

An ordinary archive import legitimately makes the importing installation the holder of the source's
earlier entries. The importer continues a single-member Case's chain and is its only writer from
then on. The walk agrees: when no `member-add` comes before the last `import` and no lineage
chains are supplied, it walks the whole chain, history included, as the importer's
(`sharedCase.ts:513-518` and `:702-705`). Once the importer shares the Case, the source's Exhibits
therefore cite under the importer's Member Code (`sharedCase.ts:715-718`).

The `import` clause of `heldBy` exists for that case. On the importer's own installation the rows
have no author, and `authorChainOf` answers them from the local chain without calling `heldBy`
(`manifest.ts:354`). Once the importer shares the Case, a member's replica records those rows under
the importer's id (`tests/main/services/sharedCaseExport.test.ts:485-489`), and a fork the
importer makes of its own replica stamps them with the importer's id (`:858-883`). In both, the
importer's chain holds the entries only through an `import` the importer wrote.

A fork differs because its source had a roster. The walk verifies a fork's history as the source
Shared Case under the source Owner's key (`sharedCase.ts:519-529`) and keeps the source members'
citations under the source Case's id (`sharedCase.ts:563-565`), and the import stamps each row
with its source author (`caseArchive.ts:597-610`). Both already treat the source's entries as
the source members', and `heldBy` is the exception. The forking installation starts a new
single-member Case: it holds what it writes after its `import`, and nothing before it.

Custody therefore passes along a run of ordinary imports and stops at a fork import. An entry
before a fork import stays with the source Case, and a later ordinary import, such as an import of
the fork's own archive, does not make its writer the entry's holder. A scratch run at `2598173f`
shows why the stop matters. After an ordinary import of a fork's archive, the source Owner's row
relabelled to the importing installation returned `verified`, through that later `import`, both
with today's rule and with a variant that skips fork imports without stopping at them.

## Question 3: rows a fork stamped under the forking member

`attributeForkedExhibits` gives the exporter's own rows the exporter's installation id and Member
Code (`caseArchive.ts:601-608`). When a member forks its own replica, those rows name the forking
installation, and their entries are in its own chain, which the fork keeps as lineage
(`caseArchive.ts:582`). When another installation imports the archive, the rows name the exporter
instead, and the same reading applies.

Today the app finds that lineage chain by its key `<sourceCaseId>/<installationId>`
(`manifest.ts:371-378`). The forking installation signed the entry there, so `heldBy` accepts it
by `operatorId` without reading any `import`. The app shows the row as verified against its
lineage chain and cites it with its source Member Code: in `sharedCaseExport.test.ts:698-722` the
forking member's row cites as `RP-1`, prefixed because the fork holds coded rows
(`src/main/services/db/caseMemberRepo.ts:122-130`). Exhibit backfill does not renumber these rows
(`src/main/services/exhibitBackfill.ts:95`). No renderer code reads `authorInstallationId` or the
lineage chains, so the source Member Code in the citation is what marks the row as the source
Case's.

The recommended rule leaves these rows as they are: the forking installation wrote their entries,
and `heldBy` accepts a writer before it reads any `import`. The same holds for an Owner that forks
its own replica. Its rows name the Owner, whose chain is the fork's own history, and entries the
Owner held through an earlier ordinary import stay held (`sharedCaseExport.test.ts:858-883`).

## Recommended rule

An installation holds an entry of an accepted chain when it wrote the entry, or when it wrote an
ordinary `import` later in the chain with no fork import between the entry and that `import`. A
fork import is an `import` with a `member-add` among the entries after the previous `import` (or
the chain's start) and before it.

The rule adds no signed field. `heldBy` reads it from the entries it already receives:

```ts
// A sketch of the rule, not the fix's code.
function isForkImport(entries: ManifestEntry[], imp: ManifestEntry): boolean {
  const start = entries.reduce(
    (at, e) => (e.type === 'import' && e.index < imp.index ? e.index : at),
    -1
  )
  return entries.some((e) => e.type === 'member-add' && e.index > start && e.index < imp.index)
}

function heldBy(entries: ManifestEntry[], entry: ManifestEntry, author: string): boolean {
  if (entry.operatorId === author) return true
  const fork = entries.find(
    (e) => e.type === 'import' && e.index > entry.index && isForkImport(entries, e)
  )
  const bound = fork?.index ?? Infinity
  return entries.some(
    (e) =>
      e.type === 'import' && e.index > entry.index && e.index < bound && e.operatorId === author
  )
}
```

`authorChainOf` keeps its call (`manifest.ts:388`) and its order of chains. The fix changes
`heldBy` and its comment (`manifest.ts:330-339`). The Shared Case walk, the schemas, the package
verifier and `verify.sh` stay as they are.

With the sketch applied to `manifest.ts` at `2598173f` and reverted afterwards, the #1638 scratch
test returned `chain-broken` for both relabels, the relabel after an ordinary import of a fork
returned `chain-broken`, and the case in criterion 5 below returned `verified` under the Owner
and `chain-broken` relabelled to the forking installation (today it returns `verified` for both).
The full unit suite exited 0 under the sketch. "Scratch runs" below gives the commands and output.

When a row verifies under the rule, the installation the row names signed the entry, or continued
the chain that holds it through an ordinary import before any fork import. The rule does not
constrain an installation that mints its own source chain under a key it holds and imports it:
`SECURITY.md` already puts an Operator forging a consistent chain out of scope.

One case reads differently from `planImportChains`: the archive from Question 1 whose own chain
holds `member-add` entries the walk rejects, imported under the override. `planImportChains`
continues that chain as an ordinary import, and the rule reads its `import` as a fork import
because a `member-add` comes before it, so the importer holds none of the history. That reading
is the stricter one, and the `import`'s `verificationResult` already records the failed check.

## Forks made before the rule

The rule reads only entries every fork already carries, so a fork made before the fix reads the
same as one made after it, and no fork lacks anything the rule needs. A row the import attributed
keeps verifying. `attributeForkedExhibits` stamps only the exporter's own rows with the exporter's
id (`caseArchive.ts:603`), and the exporter's chain holds each of those entries because the
exporter wrote it or took custody of it through an ordinary import. A row that names an
installation holding the entry only through a fork import, such as the forking installation on
one of the source Owner's rows, changes from `verified` to `chain-broken` with the reason
`authorChainOf` already gives (`manifest.ts:401-405`).

For a Case already forked, the report therefore changes only for a row whose author was changed
after the import. It changes the next time the app verifies that row. A Capture's recorded last
result (`last_verified_status` on `captures`, `src/main/services/db/captureRepo.ts:152-154`)
keeps the earlier outcome until then. The fix rewrites no chain: the rule changes how the app
reads the entries, not the entries.

## Alternatives considered

- **Only the nearest `import` counts.** In a fork, the nearest `import` after any of the source
  Owner's entries is the fork's own, which the forking installation wrote, so this still accepts
  the forking installation (#1638). A scratch run of this variant at `2598173f` returned
  `verified`. It also drops a legitimate holder: after two ordinary imports, the second importer
  no longer holds the first source's entries.
- **A signed fork marker on the `import` entry.** The 2026-10-10 ruling named this as the likely
  answer. It would be an optional field on `import`, for example `importKind: 'fork'`, present on
  a fork's `import` and omitted on an ordinary one, the omit-when-absent pattern `exportClass`
  follows (`schemas.ts:656-660`). A strict reader at schema 5 that meets an unknown key reports a
  broken chain, not "verifier too old" (the reasoning at `schemas.ts:613-615` and
  `manifest.ts:764-767`). An `import` carrying the field would therefore be stamped above 5, at
  the number the manifest schema lane holds when it merges, with a refine like `memberCode`'s
  (`schemas.ts:778-781`), and `heldBy` would skip an `import` whose `importKind` is `fork`.

  Not chosen, for three reasons. The signed record already separates the two kinds (Question 1),
  so the field restates what the chain shows, and a marker that disagrees with the history would
  need its own finding in the walk. Forks made before the marker carry none, so the app would
  either keep accepting the forking installation on every existing fork or fall back to the
  history test for them. Every fork's chain written after the marker ships would read "verifier
  too old" in verifier copies already distributed, for a field no package check reads. The marker
  becomes worth that cost if a later kind of import has to read a Shared Case history differently
  from a fork: for example, if the `owner-transfer` the collaborative cases design leaves to
  phase 2 were built on the import path.
- **Only the writer holds an entry.** Dropping the `import` clause fails the two existing tests
  that rely on an ordinary import's holding (`sharedCaseExport.test.ts:485` and `:858`): a
  scratch run of this variant at `2598173f` failed both.
- **The walk's own fork test.** The walk treats its last `import` as a fork's when any entry before
  it is a `member-add` or when lineage chains were supplied (`sharedCase.ts:515-518`). That test
  reads the whole history, and whether lineage files are present, which no signature covers. An
  ordinary import of a fork's archive would then count as a fork import, and its importer, once it
  shared the Case, would not hold the entries the fork wrote after its own `import`. The
  recommended rule reads only the entries between one `import` and the one before it. The walk
  keeps its own test, so after the fix the two read such an import differently: the walk verifies
  the fork's entries as another Case's history and cites them under the fork's Case id
  (`sharedCase.ts:519-529`, `:563-565` and `:702-705`), while `heldBy` makes the later importer
  their holder.

## Schema lane and merge order

The recommended fix does not join the manifest schema lane: it adds no field, entry type or
schema version. `MANIFEST_SCHEMA_VERSION` stays 5 (`src/shared/constants.ts:81`), and the `import`
entry keeps its minimum reader version of 2 (`manifest.ts:746`). If the maintainer chooses the
marker instead, the fix joins the lane in `docs/plans/2026-10-10-three-programme-agent-briefs.md`
(line 50): its verifier step takes the lane's next number and ships in a release before the
writer step merges, as [ADR-0023](../adr/0023-exhibits-are-the-unit-of-evidence.md) requires
(lines 53-61).

In the `manifest.ts` hot-file order of the same plan (line 52), the fix goes after SC-1 and before
#1815: SC-1, #1638, #1815 (if it changes `withDeletionEntry`), SC-2, CE-P step 1, SC-6. SC-1 is
queued and starts in the read side of `manifest.ts` (plan line 184), where `heldBy` sits. #1815
and SC-2 work the write side (`withDeletionEntry` at plan lines 442-443, `appendManifestEntry` at
plan line 199). The order saves rebase work only: the fix depends on no other brief. Its tests go
in `tests/main/services/sharedCaseExport.test.ts`, which SC-V also edits (plan lines 371-372).
The fix stays evidence-affecting, on #1638.

## Acceptance criteria for the fix

1. #1638's scratch test: in a fork of a member's replica, the source Owner's Exhibit row
   relabelled to the forking installation returns a failed chain (`chain-broken`).
2. The same row relabelled to an unknown installation still returns `chain-broken`.
3. Every existing Shared Case export, import and fork test in
   `tests/main/services/sharedCaseExport.test.ts` passes unchanged, including the two that rely on
   an ordinary import's holding (`:485` and `:858`).
4. A new test: after an ordinary import of a fork's archive, the source Owner's row relabelled to
   the importing installation returns `chain-broken`.
5. A new test: in a member's fork of a Case whose Owner imported an archive before sharing it, the
   row for an entry from that earlier archive verifies under the Owner and returns `chain-broken`
   when relabelled to the forking installation.
6. The diff changes `manifest.ts` and tests only: `src/shared/schemas.ts`, `src/shared/verify/`,
   `src/verifier/` and `MANIFEST_SCHEMA_VERSION` stay unchanged.

In the existing fork fixtures the forking member's own row and the source Owner's row both carry
Exhibit Number 1, so relabelling the Owner's row to the forking installation trips the
`idx_exhibits_author_number` unique index (`src/main/services/db/migrations.ts:970-971`). The
scratch runs moved the forking member's row to another number first. Verifying an Exhibit does
not read the row's number, so the move leaves the result unchanged.

In criterion 4's Case, the forking member's own lineage row already reads `chain-broken` at
`2598173f`, before any relabel, for a reason outside this rule. The walk keys a lineage chain
carried through two imports as `<fork Case>/<source Case>/<installation>`
(`sharedCase.ts:557-559`), and `authorChainOf` looks it up as `<source Case>/<installation>`
(`manifest.ts:371-378`). The new test asserts on the relabelled Owner row only.

## Scratch runs

Every "scratch run" above is one of these, run at `2598173f` on Node 20.20.2. None of this code
is in the commit.

The three cases are `it` blocks added inside the `describe` of a copy of
`sharedCaseExport.test.ts`, at `tests/main/services/scratch1812.test.ts`, so they reuse its
fixtures. Each one exports the replica with `exportCaseArchive`, deletes the source Case with
`deleteCase` so the import keeps the row ids, imports with `importCaseArchive`, relabels a row with
the `UPDATE exhibits SET author_installation_id` statement of `sharedCaseExport.test.ts:879-881`,
and records the status and reason `verifyExhibit` returns. Cases A and B move the forking
member's own row to Exhibit Number 9 before they relabel the Owner's row to that installation. In
case C the two rows carry 2 and 1, and nothing moves. One installation runs every step, so in B
the importing installation is also the forking one: the `skip` column below, where B's relabel
still verifies, shows that the later ordinary import alone accepts it.

- **A (#1638):** `memberReplica()`, forked. The source Owner's row relabelled to the forking
  installation, then to `installation-unknown-0001`.
- **B (criterion 4):** a fork built as in A, exported, deleted and imported again, an ordinary
  import. The forking member's own row unedited, the source Owner's row unedited, then the source
  Owner's row relabelled to the importing installation.
- **C (criterion 5):** `memberReplicaAfterImport()`, forked. The earlier archive's row under the
  Owner, then relabelled to the forking installation.

For the runs, `heldBy` read an environment variable and applied one variant: `today` (the code at
`2598173f`), `rule` (the sketch above), `skip` (an `import` counts unless it is a fork import,
with no stop), `nearest` (only the first `import` after the entry counts) and `writer` (no
`import` clause).

```sh
HELD_BY_VARIANT=<variant> pnpm test tests/main/services/scratch1812.test.ts
```

All five runs exited 0 with `Tests  3 passed | 20 skipped (23)`: the 20 skipped are the copied
tests. The results:

| Case and row | `today` | `rule` | `skip` | `nearest` | `writer` |
|---|---|---|---|---|---|
| A, Owner's row as forking installation | verified | chain-broken | chain-broken | verified | chain-broken |
| A, Owner's row as unknown installation | chain-broken | chain-broken | chain-broken | chain-broken | chain-broken |
| B, forking member's own row, unedited | chain-broken | chain-broken | chain-broken | chain-broken | chain-broken |
| B, Owner's row, unedited | verified | verified | verified | verified | verified |
| B, Owner's row as importing installation | verified | chain-broken | verified | verified | chain-broken |
| C, earlier archive's row under the Owner | verified | verified | verified | verified | chain-broken |
| C, earlier archive's row as forking installation | verified | chain-broken | chain-broken | chain-broken | chain-broken |

Every `chain-broken` above carried the reason
`no verified chain of <id> holds entry <n> for these bytes`.

The existing tests and the full suite, with the scratch file present:

```sh
HELD_BY_VARIANT=rule pnpm test tests/main/services/sharedCaseExport.test.ts
# exit 0: Tests  20 passed (20)
HELD_BY_VARIANT=writer pnpm test tests/main/services/sharedCaseExport.test.ts
# exit 1: Tests  2 failed | 18 passed (20), the tests at :485 and :858
HELD_BY_VARIANT=rule pnpm test
# exit 0: Test Files  375 passed | 1 skipped (376)
#         Tests  6112 passed | 37 skipped (6149)
```

The full run's 37 skipped tests include the scratch file's 20 copies.

## Open question

1. This note reads a fork from the history the `import` follows, where the 2026-10-10 ruling
   named a signed marker on the `import` as the likely answer. Approve the history rule, which
   needs no schema change and covers forks already made, or choose the marker and its place in
   the manifest schema lane?
