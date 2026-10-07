# Investigation records are Case data outside the Manifest

**Status:** Accepted

**Date:** 2026-10-06

This record answers the first follow-up in the
[Case investigation engine spec](../specs/2026-10-02-case-investigation-engine-design.md). Where
it places the records, and what Case delete, Case Archive, and export do to them, it restates
that spec as merged and as ruled on 2026-10-04. The Case revision's mechanism, the change log,
the rule for the two exceptions, and the addition of Selectors to the run inputs are new here;
the maintainer accepted them on 2026-10-06. Nothing in it is implemented.

## Context

The engine spec stores what an investigation produces: Subjects, Joints, their spans, the
Operator's decisions, Source Class, copy marks, Withheld from analysis flags, the Operator's own
identifiers, and run records. None of it exists today; the database at schema version 37 has no
table for any of it.

The Manifest records custody events. Its entry types are `capture`, `exhibit`, `derivation`,
`deletion`, `timestamp`, `export`, `archive-export`, `import`, `renumber`, and the Shared Case
types (`src/shared/schemas.ts`). Writing a Note writes none, and
[ADR-0004](0004-adopt-osint-assurance-baseline.md) keeps investigative assertions apart from the
originals they cite.

A run must know whether the Case it read has changed. The Manifest head cannot say, because most
run inputs live outside the Manifest, and several writers change those inputs without going
through a repository:

- **Settings -> Database** creates, updates, and deletes rows directly in the tables
  `ALLOWED_TABLES` lists in `src/main/services/db/dbAdmin.ts`, `notes` among them.
- **Reprocessing a Capture** deletes and rebuilds its Extracted Data rows without a Manifest
  Entry.
- **Restoring a snapshot** replaces the whole database file (`restoreSnapshotFile` in
  `src/main/services/db/dbSnapshots.ts`), so any counter in it can move backwards.
- **A Case Archive import** writes a Case's rows under remapped ids, and **Shared Case sync**
  writes rows received from other members.
- **The read-only MCP server** reads the database from a separate process, opening it for each
  tool call ([ADR-0038](0038-a-read-only-mcp-server-reads-a-case-from-a-separate-process.md)).

Two earlier records leave questions this one must answer for analysis.
[ADR-0023](0023-exhibits-are-the-unit-of-evidence.md) defers sensitivity and access labels to
the disclosure work on [#543](https://github.com/thebristolsound/birdbrain/issues/543). The
[retrieval spec](../specs/2026-10-02-case-retrieval-pipeline-design.md) asks, in its open
question 1, what marks an Exhibit as excluded from search, who may change that after indexing,
and whether to exclude AI-origin material by default.

## Decision

### The records are Case data

Subjects, Joints, their spans, every accept, reject, add, and dismiss decision with its recorded
assumptions, confidence, and alternatives, each reversal of one, Source Class, copy marks,
Withheld from analysis flags, the Operator's own identifiers, run records, and the change log
below are **Case data**: rows in the app's SQLite database, keyed to the Case, like Notes.

- Each decision records the Operator and the time. Each Joint records what proposed it: the
  base-layer rule and its version, or the provider, model, and model version.
- None of them writes a Manifest Entry, and this record adds no entry type. A run reads,
  proposes, and stores Case data; it writes nothing to the chain.
- None of them is an Exhibit or a Derived File. A Joint cites Exhibit spans; it is never itself
  cited as evidence.
- The new tables do not join Settings -> Database's editable list. A decision edited by hand
  there would keep its attribution while changing its content.

### Case delete, Case Archive, and export

- **Case delete** removes them with the Case's other rows and writes no per-row deletion
  entries, as [ADR-0001](0001-case-delete-skips-manifest.md) already rules for Captures.
- **A Case Archive** carries them in `data.json` with the Case's other rows, under the same id
  remapping as Notes, and adding them raises `CASE_ARCHIVE_SCHEMA_VERSION`. An older build
  refuses an archive newer than itself, so it rejects one that carries these rows instead of
  importing the Case without them, which it would otherwise do because its importer reads only
  the tables it knows. Import checks every artifact against the digests the archive header
  declares and recomputes the package hash, so it catches a damaged file or an edit that left
  those digests alone. The header is unsigned, so a deliberate edit that also rewrites the
  digests passes that check, and the chain verification that runs on import cannot catch it,
  because no Manifest Entry names these rows. Run records travel too, including the list of
  text a run sent to a hosted provider, so the archive discloses what was sent.
- **Export** follows the engine spec: Joints and their decisions travel where an export preset
  includes Notes and stay out where it omits them (the Court exhibit preset), always as the
  Operator's working material, never as evidence
  ([ADR-0010](0010-evidence-package-vs-working-copy.md)). Each exported Joint carries the lineage
  of the proposal its decision was made on. An export scoped to selected Exhibits carries a Joint
  only when every Exhibit it cites is selected. Full run records are not exported in the first
  slice; whether a past run's record can be reopened, and so whether it exports, is the engine
  spec's open decision 2.

### The Case revision

The **Case revision** is a per-Case triple: a generation identifier, a counter, and the Manifest
head. Two revisions are equal only when all three parts are.

- **The counter advances in the same transaction as every write to a run input stored in the
  database**, enforced by database triggers on each input table rather than by repository code,
  so no writer can skip it: not Settings -> Database, a reprocess, a sync, or an import. Those
  inputs are the ones the engine spec names other than Manifest Entries: Withheld from analysis,
  Source Class, copy marks, the Operator's own identifiers, Subjects, Joints, decisions, Notes,
  and Extracted Data rows. Selectors join them, because the spec's inventory step reads them
  too: creating, editing, enabling, disabling, or deleting one moves the counter.
- **The Manifest head is the index and hash of the last entry in the Case's `manifest.jsonl`**,
  read from the file whenever the revision is read. Manifest Entries are the one run input kept
  outside the database: `appendManifestEntry` writes the file directly, and writers such as the
  timestamp worker and export append entries with no database write, so no trigger can see them.
  Comparing the head instead catches every append, and a rollback that truncates the file
  changes the head too. A run never writes a Manifest Entry, so neither exception below applies
  to this part: any change to the head puts every run out of date.
- **The generation identifier is a random value that changes whenever the database or the Case
  is replaced** rather than edited: a snapshot restore, any future restore from a backup, and a
  Case Archive import. A counter alone can repeat after a restore while the state behind it
  differs.
- **The MCP server reads the same revision** through its read-only connection, so a run on that
  path checks it the same way as a run in the app.

### The change log and the two exceptions

Every advance of the counter writes a **change log** row: the Case, the new counter value, the
kind of change, and, for a decision, the Joint, Subject, or surfaced span it acted on. The log
holds ids and kinds, never text. Manifest changes need no rows here: the entries after a run's
stored head are already the record of what changed in the chain.

- A run stores its proposals, the Subjects proposed with them, and the material it surfaced in
  one write that checks the revision first. Its run record keeps the revision that write
  produced, and the ids of the Joints, Subjects, and surfaced spans that write created. Those are
  the run's own proposals. A Joint, Subject, or span that existed before the write is not one,
  even when the run proposed it again: the run read it, and its decisions, as input.
- **A run is out of date** when the Case's generation or Manifest head differs from the one its
  record kept, or when the change log holds any row after its stored counter other than a
  decision on one of that run's own proposals. A decision on anything that existed before the
  run, such as reversing the acceptance of a Joint another run proposed, puts it out of date,
  because the run computed its paths and search keys from the earlier state. Its own output does not count because
  the stored revision already includes it; the Operator's own decisions on its proposals do not
  count because the rule excepts them. Both exceptions apply to that run only: to every other
  run, the stored proposals and the decisions on them are changes like any other.
- The log also lets the view say what changed since a run, which the
  [feasibility assessment](../specs/2026-10-04-case-investigation-view-feasibility-assessment.md)
  asks for in state 10.
- Rows older than the oldest retained run record's stored revision can be compacted, because no
  run can ask about them.

### Eligibility for analysis

- **An Exhibit is eligible for analysis** when it is committed, is not in the Staging Pool, and
  is not Withheld from analysis on this installation. In a Shared Case it is withheld while this
  installation holds any member's flag for it.
- **Withheld from analysis is the per-Exhibit answer to the retrieval spec's open question 1**,
  for analysis. The Operator sets it on one Exhibit, not on a class or a Tag, and may clear their
  own flag at any time. The next run reflects the change, and analysis caches drop a newly
  withheld Exhibit before the next query.
- **AI-origin is a Source Class, not a withholding.** An AI-origin Exhibit is eligible, may
  supply a claim to check, and never supports a Joint. It is not withheld by default.
- **For analysis, Withheld from analysis is the only access control.** This record adds no
  sensitivity or access label scheme. Labels that govern disclosure in an export stay with #543,
  as ADR-0023 leaves them, and this record reserves nothing for them.
- **Not decided here:** whether the Operator's own interactive Case search hides withheld
  Exhibits, and whether the retrieval spec's class-based search exclusion becomes this flag or a
  fourth meaning of "exclusion." Both are the engine spec's second follow-up.

## Considered options

- **A Manifest Entry for each decision.** It would make each judgement's time tamper-evident, but
  a decision is not a custody event, and putting the Operator's interpretation in the chain
  beside acquisition events would make it read as attested. It would also need a new entry type
  and schema version, and it would break the rule ADR-0001 records that Case delete leaves no
  per-row trail.
- **A separate investigation database file per Case.** It would isolate the new tables, but Case
  delete, Case Archive, snapshots, and restore already handle rows in the main database, and a
  second file needs its own path through each. Joints also join to Exhibits and Notes.
- **A revision computed as a hash of the run inputs.** It needs no triggers, but every check
  would rehash the Case's inputs, and a hash cannot say what changed.
- **A counter advanced by repository code.** It is simpler to write, but Settings -> Database,
  a reprocess, and a sync write rows without passing through it.
- **The exceptions recorded on the run record** as a list of revisions to ignore. It works, but
  it records less than the change log, which also answers what changed.

## Consequences

- Implementation needs a schema migration for the new tables, the triggers, the change log, and
  the generation identifier. The restore and import paths must replace the generation. The
  Case Archive collectors, importers, and `ID_PROBE_TABLES` gain the new tables, and
  `CASE_ARCHIVE_SCHEMA_VERSION` rises with them. Every revision read also reads the Manifest
  head from `manifest.jsonl`, the MCP server's included.
- The export change touches `src/main/services/export.ts`, a blocking-tier path, so that pull
  request is evidence-affecting and needs human review.
- These rows have the integrity of Notes, no more. Anyone with write access to the database,
  the Operator included, can change a decision or its acceptance context without a Manifest
  trace; the change log records that something changed, and its own rows are editable too.
  Package Verification treats exported Joints as package content covered by the package hash,
  not as Manifest-anchored evidence.
- Every write to an input table pays for one trigger and one log row. A Case of about 1,000
  Exhibits writes far fewer input rows than it reads, so the cost is small; the first slice
  measures it.
- A run record imported in a Case Archive always reads as out of date, because the import gives
  the Case a new generation. That is the honest reading: ids were remapped and the state may
  differ.
- The Shared Case design amendment still has to add these rows to the synced working layer.
  This record defines what a member's installation stores, not how it syncs.
- The engine spec's `CONTEXT.md` follow-ups remain, including a term for the Operator's own
  identifiers.
