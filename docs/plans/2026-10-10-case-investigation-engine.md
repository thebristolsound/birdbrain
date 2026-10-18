# Case investigation engine, first slice: records, Case revision, evaluation, and build order

**Status:** active

Plan only. Nothing here is built, and the maintainer has not approved the plan as a whole:
approval is the gate "Approve the CI-P engine plan" in the
[agent briefs for three programmes](2026-10-10-three-programme-agent-briefs.md), which blocks
CI-8 onward, including CI-9b, CI-10a, CI-D1, CI-D2, CI-R, CI-E, and CI-B, and the maintainer
gives it on PR #1805. On 2026-10-10 the maintainer ruled on the open questions and on five of the
gates, the Shared Case amendment (E23) among them, and made questions 17, 20, and 21 checks for
CI-E and CI-9; each ruling is recorded where its question or gate appears. This document is brief
CI-P in that plan, and plans the base-layer first slice of the
[Case investigation engine spec](../specs/2026-10-02-case-investigation-engine-design.md) under
[ADR-0039](../adr/0039-ai-analysis-is-an-opt-in-layer-over-a-model-free-base.md), which makes the
base layer model-free;
[ADR-0042](../adr/0042-investigation-records-are-case-data-outside-the-manifest.md), which makes
the investigation records Case data outside the Manifest and defines the Case revision; and
[ADR-0044](../adr/0044-case-search-indexes-are-rebuildable-caches-outside-the-manifest.md), which
keeps search records a rebuildable cache. It builds on the
[retrieval first-slice plan](2026-10-09-case-retrieval-first-slice.md), whose steps are briefs
CI-1 to CI-7 and CI-14. "Retrieval plan D4" below means decision D4 in that plan.

It reflects `origin/main` at `df531d36`: schema version 37 (`LATEST_SCHEMA_VERSION` in
`src/main/services/db/core.ts`) and `CASE_ARCHIVE_SCHEMA_VERSION` 8
(`src/main/services/caseArchive.ts`). It starts from the records ADR-0042 names and works
outward: the tables, the Case revision, how a run reads and writes, the typed contract, and what
the first slice reads. The evaluation follows, because the spec ships the base layer only once it
meets the base-layer bar and passes the safety gate. The order of work comes last, because it
follows from which lane each record change holds.

## Goal

The engine spec's "First slice", in the base layer only. The Operator enters an inquiry, or
starts from a Note passage or a Joint's **Find more material**, and gets the Joint map, the Joint
list, and the gap list. Each Joint opens the exact stored span of every Exhibit it cites, at its
Content Hash. The Operator accepts and rejects Joints and adds and dismisses spans. They set
Source Class, copy marks, and Withheld from analysis, and keep a list of Own Identifiers. The
slice uses no model and no external lookup, and a run writes no Manifest Entry. The spec's first
slice also needs "no new public API" (spec, "First slice"); this plan adds one read-only MCP tool,
`get_case_revision` (E6), and adds no other tool to the MCP surface #547 maps. CI-D1 changes what
the existing tools return for a withheld Exhibit, as the 2026-10-10 MCP ruling requires (Gates).
ADR-0042 has the MCP server read the same Case revision as the app, the roadmap's CI-9 brief asks
for that read with a test on the MCP path, and an MCP client reaches the server only through its
tools. The maintainer approves or drops the tool with this plan.

The slice is finished when one runner shows four things on the synthetic Case:

1. **The base-layer bar holds.** Every answer-key Joint the four rules can reach is proposed; no
   false same-name Joint and no Joint from a common host is proposed; two runs on one state
   propose the same Joints; the wrong-Joint rate is measured and shown (spec, "Base-layer bar").
2. **The safety gate passes.** No invented or unresolving span is shown as support, no withheld
   content leaks, no unapproved network request leaves, and no Joint is proposed because the
   misleading passage instructed it (spec, "Evaluation and first slice").
3. **The thresholds the spec leaves to the evaluation are set** and recorded, each with the run
   that set it (E20).
4. **The maintainer has confirmed 1 and 2.** That confirmation is a maintainer gate (Gates).

Out of scope: the AI layer (screening, providers, the provider benchmark and its harness, and
the review before sending), external lookup beyond the local source trail, run history (the spec's
open decision 2), PDF page text and metadata, `mbox` messages, Transaction Record headers, and
`exhibit.search` over MCP.

This plan answers each item brief CI-P lists:

| CI-P item | Where |
| --- | --- |
| DDL for ADR-0042's records, with the four working-layer columns on the decision, Withheld, Own Identifier, Source Class, and copy-mark tables | E1, E2 |
| The Case revision triggers, generation, and change log (from CI-9's brief) | E3, E4, E6 |
| Which of the spec's two consistency approaches a run uses | E7 |
| The engine's typed contract and IPC | E10 |
| The identifier set beyond the retrieval plan's | E11 |
| Whether PDF and `mbox` Exhibits are in the first engine slice | E12 |
| Whether Transaction Record headers become a field source | E13 |
| The engine fixture list | E14 to E16 |
| How the spec's thresholds get set from the evaluation | E20 |
| The plan for retrieval step 7 | E22 (CI-14) |
| The Shared Case amendment for synced decisions and flags | E23 |
| A PR split that assigns run lifecycle to a named brief | Order of work (CI-R) |

## What exists today

- **No table holds an investigation record.** ADR-0042's context says so for schema 37, and
  `src/main/services/db/migrations.ts` confirms it.
- **The retrieval first slice is planned and not built.** Its D1 adds `exhibit_search_builds` and
  `exhibit_search_fields` in what it expects to be migration 38 (CI-3); D3 records `link.href` and
  `link.alt` with offsets into the decoded part; D4 records ten mail headers (`From`, `Reply-To`,
  `Sender`, `Return-Path`, `Message-ID`, `In-Reply-To`, `Organization`, `Newsgroups`,
  `NNTP-Posting-Host`, `X-Originating-IP`) from header blocks in the `.txt` file; D5 rebuilds any
  Exhibit built by an older extractor version; D7 plans `checkFieldHit`, which checks `html-part`
  and `text` records only.
- **An evaluation Case generator is in review.** PR #1796 (CI-2) renders invented pages in
  Electron, saves MHTML, ingests each through `ingestMhtmlCapture`, runs `extractData`, adds Notes,
  matches one Selector, and puts one file in the Staging Pool, as `pnpm eval:retrieval
  --eval-captures=<n>`. Its filler is deterministic (a seeded `mulberry32`), its hosts are
  subdomains of `example.com`, `example.net`, and `example.org`, and 1,000 pages ingest in 24.1 s
  (PR body). Review comments on #1796 found measurement faults: rank counted among target pages
  only, three queries name the address the `mail-header` page must keep unnamed, a query passes
  when either of two expected targets appears, latency populations differ between phases, and the
  incremental sample takes the first Captures only.
- **Extracted Data cannot serve as an identifier source.** `extractData()` in
  `src/main/services/dataExtractor.ts` records tracking codes and Accounts on seven platforms
  (Twitter/X, Facebook, Instagram, LinkedIn, YouTube, GitHub, Telegram) through the exported
  `EXTRACTION_RULES`. `extractIocs()` in `extraction/iocAdapter.ts` adds what its `FIELD_MAPPINGS`
  list: IPv4 and IPv6 addresses, email addresses, domains, MD5, SHA-1, SHA-256, and SHA-512 hashes,
  MAC addresses, ASNs, CVEs, Bitcoin, Ethereum, and Monero addresses, and two Tracking Codes, Google
  Analytics IDs (`gaTrackIDs`) and Google AdSense publisher IDs (`gaPubIDs`). Values in
  `CASE_INSENSITIVE_SUBCATEGORIES`, Email Address among them, are stored lower-cased, and
  `extracted_data` rows carry no locator. The spec compares the part before the `@` as stored, so
  the engine uses `extracted_data` only to choose which Exhibits to read, as the spec already says.
- **The extraction validators refuse reserved names.** `isValidDomainParsed()` in
  `extraction/validators.ts` refuses any host ending in `.example`, `.invalid`, or `.test`, and
  `isValidEmailDomain()` refuses `example.com`, `example.net`, and `example.org` themselves. A
  subdomain such as `harrow.example.net` passes both.
- **Only Captures have text.** `detectExhibitKind()` in `src/main/services/staging.ts` commits a PDF
  as `document`, raster images as `image`, and anything else, an `mbox` file included, as
  `attachment`. `package.json` has no PDF or `mbox` parser, and the only Derived File writer,
  `exhibitBackfill.ts`, writes thumbnails (`THUMBNAIL_DERIVATION`).
- **A text binding exists.** `resolveTextAnchor()` in `noteAnchorResolver.ts` answers
  `hash-verified` or `unattested` (`TextBasis`), reading `textHash` from the signed capture entry.
  It calls `verifyManifestChain()` on every call. That function returns `captureEntriesByIndex`,
  whose `CaptureChainEntry` (`src/shared/verify/manifestChain.ts`) carries `contentHash`,
  `screenshotHash`, and `textHash` but not `url`; the signed entry itself carries `url`
  (`ManifestCaptureEntrySchema` in `src/shared/schemas.ts`).
- **Five tables already carry working-layer columns.** Migration 36 added `author_installation_id`,
  `version` (default 0), `deleted_at`, and `row_signature` (NULL until the sync step signs local
  rows) to `notes`, `annotations`, `tags`, `exhibit_tags`, and `note_tags`. The same migration
  records the nullable-author trap: SQLite treats NULLs as distinct inside a UNIQUE constraint, so
  it keys Exhibit Numbers with a unique index over `COALESCE(author_installation_id, '')`. The
  roadmap's SC-2 brief (#1512) rebuilds the constraints that do not fit per-author rows, PR #1571's
  five findings, among them the global `tags.name` UNIQUE from migration 1.
- **The app holds one database connection.** `getDb()` in `src/main/services/db/core.ts` returns one
  module-level handle. `createTimestampWorker()` runs on the main event loop through
  `setInterval`, and no file under `src/main` uses `worker_threads` or `utilityProcess`.
  `runDataExtraction` in `captureLifecycle.ts` runs synchronously on the main process (#598), and
  CE-10 moves it into a utility process, the direction the maintainer ruled for #598 on
  2026-10-10.
- **The MCP server reads per call.** `withReadConnection()` in `src/mcp/session.ts` opens the
  read-only connection when no tool call is running and closes it after the last one.
  `openDatabaseReadOnly()` refuses any schema version other than `LATEST_SCHEMA_VERSION`, and a
  restore can land between calls (ADR-0038, Consequences). `registerCaseTools()` in
  `src/mcp/tools/cases.ts` registers the Case tools, and `resolveConfig()` in `src/mcp/config.ts`
  takes `--user-data`.
- **Two restore paths replace the database file.** `restoreDatabase()` in `db/dbRestore.ts` (Restore
  from File, `db:restore`) copies the chosen file to a scratch path, migrates it with
  `migrateFile()` inside `prepareScratch()`, refuses a scratch copy that still has a WAL sidecar,
  and renames it over the live file. `restoreSnapshotFile()` in `db/dbSnapshots.ts`
  (`db:restoreSnapshot`) copies the snapshot to a scratch file beside the database, flushes it, and
  renames it; the IPC handler then calls `initDatabase()`, which migrates it. Both refuse with
  `DB_IN_USE` while `emptyWalBeforeReplace()` reports another connection partway through a read.
- **The Manifest head is a tail read.** `getManifestHead()` in `manifest.ts` reads the last line of
  `manifest.jsonl`, and `ManifestHeadRef` in the same file has the `{ index, entryHash }` shape.
- **Case delete is one statement.** `deleteCase()` in `caseRepo.ts` runs `DELETE FROM cases` and
  relies on `ON DELETE CASCADE` for every Case-keyed row.
- **The Case Archive names each table it carries.** `collectCaseData()` and `insertImportedRows()`
  in `caseArchive.ts` list them. `ID_PROBE_TABLES` in `core.ts` lists eight id-keyed tables whose
  colliding ids the import remaps through one id map; tables keyed by foreign keys follow that
  remap. An older build refuses an archive whose header `schemaVersion` is above its own
  `CASE_ARCHIVE_SCHEMA_VERSION`.
- **Settings -> Database edits eight tables.** `ALLOWED_TABLES` in `db/dbAdmin.ts` lists `cases`,
  `captures`, `tags`, `exhibit_tags`, `selectors`, `selector_matches`, `capture_favorites`, and
  `notes`. ADR-0042 keeps the new tables off that list.
- **Chunked main-process work has a pattern.** `scheduleRetroactiveMatch` in
  `selectorLifecycle.ts` reads 50 Captures per chunk (`RETRO_CHUNK_SIZE`) and yields with
  `setImmediate`; `createSelectorLifecycle(deps)` takes its dependencies.
- **Personas are installation-wide.** Migration 35 stores a label, notes, and import details; no
  Case row references a Persona, and no Case Archive carries one.
- **Wayback Refs attach to a Capture.** `createWaybackRef()` in `waybackRefRepo.ts` writes a
  `capture_archive_refs` row with the snapshot's `original_url` and sends no request.
- **SQLite has JSON functions.** The app's better-sqlite3 build defines `SQLITE_ENABLE_JSON1`, and
  `noteReferenceRepo.ts` already queries with `json_each`.
- **IPC has a typed contract.** `IpcInvokeContract` and `IpcEventContract` in `src/shared/ipc.ts`,
  with `ChannelsAreExhaustive`, use `<domain>:<verb>` and `event:<name>` channel names. `updater.ts`
  already branches on `app.isPackaged`.
- **Glossary.** `CONTEXT.md` defines Subject, Joint, Source Class, Withheld from analysis, and
  Own Identifier. It has no entry for Case revision, which ADR-0042 defines.
- **Tiers.** The evidence-affecting paths assessment puts `src/main/services/db/**`,
  `caseArchive.ts`, `dataExtractor.ts`, `noteAnchorResolver.ts`, `export.ts`, and
  `src/shared/verify/**` on the blocking tier, and `src/shared/ipc.ts`, `src/preload/index.ts`, and
  `ipcHandlers.ts` on the advisory tier. `src/mcp/**` and `src/packages/**` are not listed.

## Decisions

Each decision is proposed, and the maintainer approves or amends it with the plan. Where a
2026-10-10 ruling on an open question or gate settles part of a decision, the decision states it.

### E1. Records: sixteen tables and one view

One migration (CI-9) creates every table below. The ten tables that sync in a Shared Case end with
the four working-layer columns E2 describes.

```sql
-- Subjects and Joints
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- person, pseudonym, account, document, ...; Operator-extensible
  bound_exhibit_id TEXT,           -- a document Subject's one Exhibit (no foreign key)
  bound_identifier TEXT,           -- an identifier Subject: kind, platform and comparison key
  created_by_run_id TEXT,          -- NULL when the Operator added it
  kept_at TEXT,                    -- set when the Operator keeps it by hand
  created_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_subjects_case ON subjects(case_id, kind);
CREATE UNIQUE INDEX idx_subjects_document ON subjects(
  case_id, bound_exhibit_id, COALESCE(author_installation_id, '')
) WHERE bound_exhibit_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE joints (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  subject_a_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,  -- NULL: about one Subject
  producer_kind TEXT NOT NULL,     -- 'rule' | 'operator'; 'provider' arrives with the AI layer
  producer TEXT NOT NULL,          -- the rule's name, or 'operator'
  producer_version TEXT NOT NULL,  -- the rule's version; '' for the Operator
  identity_hash TEXT NOT NULL,     -- claim hash, Subject bindings, producer at its version
  from_note_id TEXT,               -- started from a Note passage (no foreign key)
  from_note_passage TEXT,          -- JSON: offsets into the Note body as the run read it
  from_span_decision_id TEXT,      -- started by a same-name choice
  created_by_run_id TEXT,          -- NULL when a same-name choice started it
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE UNIQUE INDEX idx_joints_identity ON joints(
  case_id, identity_hash, COALESCE(author_installation_id, '')
) WHERE deleted_at IS NULL;
CREATE INDEX idx_joints_subjects ON joints(subject_a_id, subject_b_id);

-- Spans: a pointer into a stored Exhibit, on a Joint or waiting on a same-name choice
CREATE TABLE joint_spans (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL REFERENCES joints(id) ON DELETE CASCADE,
  side TEXT,                       -- 'a' | 'b'; NULL on a Joint about one Subject
  exhibit_id TEXT NOT NULL,        -- no foreign key (see the shape rules)
  content_hash TEXT NOT NULL,      -- the Exhibit's Content Hash when the span was cited
  representation TEXT NOT NULL,    -- 'html-part' | 'text' | 'capture-url'
  field TEXT NOT NULL,             -- 'header.from', 'link.href', 'text.passage', ...
  locator TEXT NOT NULL,           -- JSON: part, decoder, extractor version, start and end
  value TEXT NOT NULL,             -- the span as stored, for lists; the inspector re-reads it
  span_key TEXT NOT NULL,          -- hash of exhibit_id, content_hash, representation, locator
  reading TEXT NOT NULL,           -- the base layer writes 'supports' or 'unclear'
  created_by_run_id TEXT,          -- NULL only for the span a same-name choice cites
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_joint_spans_joint ON joint_spans(joint_id, span_key);
CREATE INDEX idx_joint_spans_exhibit ON joint_spans(case_id, exhibit_id);

CREATE TABLE subject_spans (       -- one row per candidate Subject; one choice resolves all
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  representation TEXT NOT NULL,
  field TEXT NOT NULL,
  locator TEXT NOT NULL,
  value TEXT NOT NULL,
  span_key TEXT NOT NULL,
  created_by_run_id TEXT,
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_subject_spans_key ON subject_spans(case_id, span_key);

-- Decisions: insert-only; a reversal is a new row listing the author's head it replaces (E2)
CREATE TABLE joint_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL REFERENCES joints(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,          -- 'accept' | 'reject' | 'restore' (back to proposed)
  reason TEXT,
  assumptions TEXT,                -- acceptance context; NULL shows and exports as "not recorded"
  confidence TEXT,                 -- the Operator's own words, never a score
  alternatives TEXT,
  basis_run_id TEXT,               -- the run whose proposal the decision was made on
  basis_as_of TEXT,                -- that run's start time, for the "Case as of" label
  basis_proposal_hash TEXT,        -- that run's proposal hash, for export lineage
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: the author's earlier head on this Joint
  decided_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_joint_decisions_joint ON joint_decisions(joint_id);

CREATE TABLE span_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_span_id TEXT REFERENCES joint_spans(id) ON DELETE CASCADE,
  subject_span_id TEXT REFERENCES subject_spans(id) ON DELETE CASCADE,
  action TEXT NOT NULL,            -- Joint span: 'add-support' | 'add-conflict' | 'dismiss' | 'undo'
                                   -- same-name span: 'choose' | 'none' | 'undo'
  chosen_subject_id TEXT,          -- with 'choose'
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: the author's earlier head on this span
  decided_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT,
  CHECK ((joint_span_id IS NULL) <> (subject_span_id IS NULL))
);
CREATE INDEX idx_span_decisions_joint_span ON span_decisions(joint_span_id);
CREATE INDEX idx_span_decisions_subject_span ON span_decisions(subject_span_id);

-- Exhibit-level marks: insert-only, each listing the rows it replaces (E2)
CREATE TABLE source_class_marks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  value TEXT NOT NULL,             -- original | contemporaneous | later-copy | commercial
                                   -- | ai-origin | unclassified; no row reads as unclassified
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: ids of the rows this one supersedes
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_source_class_marks_exhibit ON source_class_marks(case_id, exhibit_id);

CREATE TABLE copy_marks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  copy_exhibit_id TEXT NOT NULL,
  original_exhibit_id TEXT NOT NULL,
  marked INTEGER NOT NULL,         -- 1: the pair counts as one source; 0: the mark undone
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_copy_marks_pair ON copy_marks(case_id, copy_exhibit_id, original_exhibit_id);

CREATE TABLE withheld_flags (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  holder_installation_id TEXT,     -- whose flag; NULL: the row's author (E2)
  action TEXT NOT NULL,            -- 'set' | 'clear'
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_withheld_flags_exhibit ON withheld_flags(case_id, exhibit_id);

CREATE TABLE own_identifiers (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  holder_installation_id TEXT,     -- whose entry; NULL: the row's author (E2)
  kind TEXT NOT NULL,              -- mail | handle | domain | link | message-id | tracking | ...
  platform TEXT,                   -- for a kind compared by platform
  value TEXT NOT NULL,             -- as stored; each installation normalizes it with its own rules
  persona_id TEXT,                 -- local only: never synced, never in a Case Archive
  marked INTEGER NOT NULL,         -- 1: marked; 0: the mark removed
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_own_identifiers_case ON own_identifiers(case_id, kind);

-- Run records: local to this installation, never synced
CREATE TABLE investigation_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  started_from TEXT NOT NULL,      -- 'inquiry' | 'note-claim' | 'find-more'
  inquiry TEXT,
  joint_id TEXT,                   -- the Joint, for Find more material
  status TEXT NOT NULL,            -- 'running' | 'stored' | 'canceled' | 'invalidated' | 'failed'
  status_reason TEXT,
  start_generation TEXT NOT NULL,
  start_counter INTEGER NOT NULL,
  start_head_index INTEGER,        -- NULL with an empty Manifest
  start_head_hash TEXT,
  stored_generation TEXT,          -- the revision the run's one write produced
  stored_counter INTEGER,
  stored_head_index INTEGER,
  stored_head_hash TEXT,
  layers TEXT NOT NULL,            -- JSON: ["base"] in the first slice
  versions TEXT NOT NULL,          -- JSON: rule, normalizer, extractor and parameter versions
  params TEXT NOT NULL,            -- JSON: follow depth and the thresholds in force
  counts TEXT,                     -- JSON: read, withheld, not read by reason, candidates, proposals
  started_at TEXT NOT NULL,
  ended_at TEXT,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL
);
CREATE INDEX idx_investigation_runs_case ON investigation_runs(case_id, started_at);

CREATE TABLE investigation_run_basis (   -- what travelled with the run
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- starting-subject | withheld | note | selector | own-identifier
  ref_id TEXT NOT NULL,
  snapshot TEXT,                   -- the Note passage as the run read it; NULL for other kinds
  snapshot_hash TEXT,
  PRIMARY KEY (run_id, kind, ref_id)
);

CREATE TABLE investigation_run_candidates (  -- candidate locators and their check outcomes
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  rule TEXT NOT NULL,
  group_key TEXT,                  -- a passage group's passage hash
  exhibit_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  field TEXT NOT NULL,
  locator TEXT NOT NULL,
  joint_span_id TEXT,              -- set when the run cited this candidate
  text_check TEXT,                 -- 'present' | 'absent' | 'cannot-check', from CI-11 on
  text_basis TEXT,                 -- 'hash-verified' | 'unattested'
  check_reason TEXT,
  PRIMARY KEY (run_id, ord)
);

CREATE TABLE investigation_run_proposals (
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,     -- claim, Subjects, producer, and the spans this run cited
  created INTEGER NOT NULL,        -- 1: this run's write created the Joint; 0: a further sighting
  PRIMARY KEY (run_id, joint_id)
);

-- The Case revision (E3)
CREATE TABLE case_revisions (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE case_change_log (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT,                  -- ids and kinds only, never text
  PRIMARY KEY (case_id, counter)
);

-- Eligibility for analysis (E8)
CREATE VIEW analysis_eligible_exhibits AS
  SELECT e.* FROM exhibits e
   WHERE NOT EXISTS (
     SELECT 1 FROM withheld_flags w
      WHERE w.case_id = e.case_id AND w.exhibit_id = e.id
        AND w.action = 'set' AND w.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM withheld_flags s, json_each(s.replaces) r
           WHERE s.case_id = w.case_id AND s.deleted_at IS NULL AND r.value = w.id));
```

The DDL follows seven shape rules:

- **No foreign key from a synced table to `exhibits`.** A span, mark, or flag names its Exhibit by
  id. A deleted Exhibit then leaves a span unavailable instead of deleting its decision history,
  and the spec never drops a proposed Joint silently. In a Shared Case a member's mark can also
  arrive before the Exhibit row it names. Migration 28 set the precedent: `note_references` points
  its foreign key at `notes` only, so a deleted target stays representable as a broken reference.
- **Uniqueness is per author.** Two members can each propose a document Subject for one Exhibit,
  or each propose one Joint. A UNIQUE index across authors would refuse the second member's row on
  sync, the `tags.name` failure SC-2 inherits. The two unique indexes above follow migration 36's
  `COALESCE(author_installation_id, '')` pattern, so one installation cannot write a duplicate and
  another member's row always fits. Rows from two members that describe one thing read as one at
  read time (E23, item 3).
- **No id inside a JSON column except `replaces`.** The archive import remaps colliding ids through
  plain columns. `replaces` is the one JSON list of row ids, and E5 makes its remap an explicit
  importer rule with a test.
- **Open vocabularies stay TEXT with no CHECK.** Migration 34 left `exhibits.kind` and `origin`
  unconstrained because a value an older build has never seen is a row a newer build wrote. Once
  rows sync, the same reasoning covers `kind`, `reading`, `value`, and `action` here.
- **Every decision row records `operator_id` and `operator_name`.** ADR-0042 requires the Operator
  and the time on each decision. A NULL author means only "this installation", which stops being
  true once a Case Archive moves the rows to another installation (open question 5).
- **A decision carries its own lineage.** Run records stay on the installation that ran them (E23,
  item 8), so `joint_decisions` copies the basis run's start time and proposal hash. The "proposed
  from the Case as of" label and CI-13's export lineage then work on every member's installation.
- **No AI-layer storage yet.** Fact pairs, screening counts, and the text sent to a hosted provider
  get their tables in the AI layer's own migration and archive bump, so this slice ships no column
  that nothing writes. ADR-0042 still requires the run record to list sent text and the Case
  Archive to carry it; that migration owns both.

On 2026-10-10 this DDL, the triggers in E3, and the view ran against the app's SQLite (3.53.4,
through better-sqlite3 13.0.3 under Electron, with `foreign_keys` on as migration 36 notes the app
sets it). A Case delete with every table populated succeeded, left no row keyed to the Case and no
run child row, and `foreign_key_check` reported nothing. A second author's document Subject for
the same Exhibit was accepted, and a duplicate from either author was refused. CI-9 repeats these
as tests. A review the same day added the `replaces` columns on the two decision tables, the
holder on `own_identifiers`, and the update-trigger form in E3. Those additions ran under SQLite
3.53.1 through Python's `sqlite3` module, not the app's build, so CI-9's tests are their first
run in the app.

### E2. Working-layer columns and the rules every synced table follows

Ten tables sync: `subjects`, `joints`, `joint_spans`, `subject_spans`, `joint_decisions`,
`span_decisions`, `source_class_marks`, `copy_marks`, `withheld_flags`, and `own_identifiers`. The
CI-P brief names five of these (decisions, Withheld, Own Identifier, Source Class, copy marks).
The spec also syncs a Joint and what it cites once a member accepts it, so this plan gives those
tables the columns too; otherwise CI-S would need a second migration.

Each synced table ends with the columns migration 36 added, with the same meaning: NULL author
means this installation, `version` is monotonic per author, `deleted_at` is a tombstone, and
`row_signature` stays NULL until CI-S signs local rows on write. Until CI-S, local rows keep
`version` 0 and a NULL signature, as migration 36's rows do.

A NULL `holder_installation_id` on `withheld_flags` and `own_identifiers` means the row's author,
read through `author_installation_id`. That column is NULL on this installation's own rows and set
on every row received by sync, because a NULL author reads as local (collaborative cases design,
"Working-layer rows"). A flag or entry therefore names the same holder on every installation, and
a flag member A set never reads on member B's installation as B's own.

Rows are written once. An author edits their own row in three cases only: `subjects.kept_at`,
`deleted_at`, and, from CI-S on, the `version` and `row_signature` of a row held back from sync
when it becomes eligible (E23, item 2). Every reversal is a new row: an undone add is an `undo`
span decision, and a cleared flag is a `clear` row. A Joint's basis is never rewritten either:
while undecided it is the latest `investigation_run_proposals` row for it, and once decided it is
the head decision's basis columns.

**Heads decide current state, and clocks decide nothing.** Source Class, copy marks, Withheld from
analysis, and Own Identifiers can conflict across members, and each member's decisions on one
Joint or span follow one another. Each new row in these six tables lists in `replaces` every
current row for the same key that the writer's installation holds, its own previous row included.
A row that no other row replaces is a head. A decision's head therefore comes from `replaces`,
never from `decided_at`, so two decisions written in the same millisecond still have an order.

| Table | Key | Current state |
| --- | --- | --- |
| `source_class_marks` | Exhibit | One head: its value. Heads with different values: a conflict, shown attributed, counted as unclassified, or as supporting nothing when any head is `ai-origin`. No row: unclassified. |
| `copy_marks` | copy and original pair | As Source Class, with `marked` as the value. |
| `withheld_flags` | Exhibit and holder | Withheld while any holder's head is `set`. |
| `own_identifiers` | holder, kind, platform, and comparison key | No run follows the identifier while any holder's head has `marked = 1`. |
| `joint_decisions` | Joint and author | The author's head is that member's decision. Members whose heads differ leave the Joint contested. No row from a member: undecided. |
| `span_decisions` | Joint span and author; for a same-name span, its `span_key` and author | The author's head is that member's action on the span. |

Because the holder or author is part of each key, a member's new row replaces only that member's
own heads, so a member clears only their own flag and removes only their own entries. A member who
chooses between conflicting Source Class or copy-mark values writes a row that replaces both heads,
so nothing is overwritten. An Owner who clears a revoked member's flag or entry writes a row whose
holder is that member and which replaces that member's heads, so the action is attributed to the
Owner and recorded. The spec's "Shared Cases" section requires all three.

### E3. The Case revision

The Case revision is ADR-0042's triple: generation, counter, and Manifest head. `case_revisions`
holds the first two. The Manifest head is read from `manifest.jsonl` through `getManifestHead()`
whenever the revision is read. The counter lives in its own table instead of on `cases`, because
`cases` is in `ALLOWED_TABLES` and a counter there could be edited from Settings -> Database.

The migration backfills a row for every existing Case, and a trigger creates one for every new
Case, including the Case a Case Archive import creates:

```sql
INSERT INTO case_revisions (case_id, generation)
  SELECT id, lower(hex(randomblob(16))) FROM cases;

CREATE TRIGGER cases_revision_ai AFTER INSERT ON cases BEGIN
  INSERT INTO case_revisions (case_id, generation) VALUES (NEW.id, lower(hex(randomblob(16))));
END;
```

Each input table gets an insert, update, and delete trigger, generated in a loop over the table
list the way migration 36 adds its columns. The insert trigger keys on `NEW.case_id` and the
delete trigger on `OLD.case_id`. The update trigger keys on both, because Settings -> Database
can move a Note to another Case (`updateRow()` in `dbAdmin.ts` guards "a case_id-only move" for
`notes`), and `selectors` is on the same editable list:

```sql
CREATE TRIGGER notes_revision_update AFTER UPDATE ON notes BEGIN
  UPDATE case_revisions SET counter = counter + 1
   WHERE case_id IN (OLD.case_id, NEW.case_id);
  INSERT INTO case_change_log (case_id, counter, kind, target_id)
    SELECT case_id, counter, 'note', NEW.id FROM case_revisions
     WHERE case_id IN (OLD.case_id, NEW.case_id);
END;
```

A move advances and logs both Cases, so the Case the row left goes out of date too, as ADR-0042
requires of every writer. An edit within one Case matches one `case_revisions` row and advances it
once.

On the ten synced tables the update trigger is `AFTER UPDATE OF` every column except `version`
and `row_signature`. SQLite fires such a trigger only when the `UPDATE` sets a listed column, so
CI-S re-versioning and re-signing a held-back row (E23, item 2) moves no counter. Otherwise each
accept that makes a Joint eligible to sync would log a `joint` row and put the run that proposed
it out of date.

The log insert selects from `case_revisions`, so a write to a Case with no revision row logs
nothing. The kind and target come from the row:

| Table | Log kind | Target id |
| --- | --- | --- |
| `notes` | `note` | Note |
| `extracted_data` | `extracted-datum` | Capture (row ids change on every reprocess) |
| `selectors` | `selector` | Selector |
| `subjects` | `subject`; `decision` for an update that changes `kept_at` | Subject |
| `joints` | `joint`; `decision` when `from_span_decision_id` is set | Joint; for `decision`, the chosen same-name span |
| `joint_spans` | `span`; `decision` when `created_by_run_id` is NULL | span; for `decision`, the chosen same-name span |
| `subject_spans` | `span` | span |
| `joint_decisions` | `decision` | Joint |
| `span_decisions` | `decision` | Joint span or same-name span |
| `source_class_marks` | `source-class` | Exhibit |
| `copy_marks` | `copy-mark` | copy Exhibit |
| `withheld_flags` | `withheld` | Exhibit |
| `own_identifiers` | `own-identifier` | row |
| `exhibits` | `exhibit` | Exhibit |
| `exhibit_search_builds` | `search-build` | Exhibit |

The last two rows follow the 2026-10-10 ruling on open questions 3 and 4, and CI-9's PR amends
ADR-0042's input list to name both tables.

The same-name choice writes a span decision, a Joint, and the span it cites in one transaction
(CI-D2). The triggers log all three as `decision` rows on the chosen same-name span, so the
out-of-date check treats them as one decision on the run's own proposal.

The 2026-10-10 run in E1 checked this shape. Three Note inserts and a delete moved the counter
to 4. An `INSERT OR IGNORE` that a unique index skipped (`insertExtractedData()` uses that form)
moved nothing. A Capture delete cascading to two Extracted Data rows fired their triggers and
moved the counter by 2. The same-name choice logged three `decision` rows targeting the chosen
span, and an update of `kept_at` logged `decision`. One `UPDATE case_revisions SET generation =
lower(hex(randomblob(16)))` gave each Case a different value. The update trigger that run used
keyed on `NEW.case_id` alone; rerun with a Note moved between Cases, it left the source Case's
counter unchanged. The form above, run under SQLite 3.53.1 (E1), advanced both Cases on a move,
one Case on an edit within it, and nothing on an `UPDATE` that set only `version` and
`row_signature`.

**Out of date.** CI-R applies ADR-0042's rule. A stored run is out of date when the generation or
the Manifest head differs from its stored one, or when `case_change_log` holds a row after its
`stored_counter` other than a `decision` row whose target this run created (`created_by_run_id` on
the Joint, Subject, or span). A decision on a Joint that existed before the run therefore puts it
out of date, as ADR-0042 requires. The same log rows give the view its list of what changed since
the run (feasibility assessment, state 10).

**Compaction.** CI-R deletes a Case's log rows at or below the lowest `stored_counter` among its
run records whose `stored_generation` equals the current generation. A run from another generation
is out of date whatever the log says, so it needs no rows. Until the spec's open decision 2
settles whether past runs stay, nothing deletes run records, so compaction rarely runs.

### E4. Generation replacement: restores and import

ADR-0042 replaces the generation whenever the database or the Case is replaced instead of edited.

- **Restore from File.** `prepareScratch()` in `dbRestore.ts` replaces every row's generation on the
  scratch copy after `migrateFile()` and before the rename, then repeats its existing check that
  the copy has no WAL sidecar.
- **Snapshot restore.** `restoreSnapshotFile()` in `dbSnapshots.ts` replaces the generations on its
  scratch file before the rename when that file has a `case_revisions` table, closes it, and checks
  that no WAL sidecar remains beside it. A snapshot taken before CI-9's migration has no such
  table; `initDatabase()` migrates it on re-open, and the migration's backfill writes fresh
  generations.
- **Case Archive import.** The `cases_revision_ai` trigger gives the new Case a fresh generation.
  Imported run records keep their source generation, so they read as out of date, the outcome
  ADR-0042 records as honest.

Replacing on the scratch copy means a process that dies between the rename and the re-open still
leaves a restored file with new generations. The counter is not reset: the generation alone
separates a restored state from the one a run read.

### E5. Case Archive and repositories (CI-9b)

- `collectCaseData()` gains one collector per table, and `CaseArchiveData` gains optional keys for
  them. `insertImportedRows()` imports in foreign-key order: Subjects, Joints, spans, decisions, the
  Exhibit-level marks, runs, then the run child tables.
- `ID_PROBE_TABLES` gains the eleven id-keyed tables: the ten synced tables and
  `investigation_runs`. The run child tables follow the run remap, as `note_tags` follows Notes.
- The importer passes every id column through the id map: `exhibit_id` and its relatives,
  `subject_*_id`, `joint_id`, `*_span_id`, `chosen_subject_id`, `from_note_id`,
  `from_span_decision_id`, `basis_run_id`, `created_by_run_id`, `investigation_run_basis.ref_id`,
  and every id in `replaces`. A test imports one archive twice, so every id collides, and checks
  each reference.
- The collector writes `persona_id` as NULL. Personas are installation-wide and no Case Archive
  carries them, so the id means nothing on another installation and names a local Persona to
  whoever receives the file.
- The importer sets `author_installation_id` to the archive's source installation
  (`header.source.installationId`) on every row of the ten synced tables that has none, as
  `attributeForkedExhibits()` does for a fork's Exhibits, so an imported decision never reads as
  the importer's (open question 5, ruled 2026-10-10).
- `case_revisions` does not travel; the import trigger writes a fresh row. `case_change_log` does
  not travel either (open question 2, ruled 2026-10-10), and CI-9b's PR amends ADR-0042, which
  lists the change log among the records a Case Archive carries. The import's own triggers write
  the new Case a fresh log as its rows arrive. Carrying the archived log rows as they are would
  break every import of a Case that has any. `insertImportedRows()` runs inside one
  `withTransaction()` in `caseArchive.ts`, the triggers write counters 1, 2, and so on for the new
  Case, and the archived rows, remapped to the new Case, reuse those counters, so the primary key
  refuses them and the import rolls back. A run of E1's DDL and E3's trigger form under SQLite
  3.53.1 reproduced that refusal.
- `CASE_ARCHIVE_SCHEMA_VERSION` takes the next number at merge, so an older build refuses the
  archive instead of importing the Case without its decisions.
- The repository functions the importer needs (insert and list, one module per table group under
  `src/main/services/db/`) are the plain storage layer. CI-D1 and CI-D2 add the rule-enforcing
  services on top. Tests, CI-E's seed, and CI-14 insert rows through these functions, so they do not
  wait on CI-D1 or CI-D2.

The archive half splits from the migration because, of the tables CI-9 adds, only `case_revisions`
and `case_change_log` hold rows before CI-D1, CI-D2, or CI-R merges: CI-9's backfill and triggers
fill both from the moment it merges. An archive written between CI-9 and CI-9b carries none of the
new tables. Neither of those two travels (open question 2), so such an archive loses no record
that would travel. The rule that keeps every
other table empty in that window: CI-9b merges before CI-D1, CI-D2, and CI-R.

### E6. Revision reads on both paths

- A new `readCaseRevision()` in `src/main/services/caseRevision.ts` reads the `case_revisions` row
  and `getManifestHead()` for the Case directory. The app and the MCP server call the same function.
- The MCP server gains one read-only tool, `get_case_revision`, registered in `registerCaseTools()`,
  and `website/content/docs/mcp.mdx` gains it under "What the agent can read". The server already
  refuses a schema version it does not know, so after CI-9 it needs the matching build, as
  ADR-0038 records.
- The provider benchmark harness the spec describes ("First evaluation model") reads the revision
  before and after each tool call and discards a run whose revision moved. That harness is not
  briefed here.
- On 2026-10-10 the maintainer ruled that MCP tools list a withheld Exhibit with its mark and never
  return its content or values drawn from it (Gates). CI-9 changes no existing tool. CI-D1, the
  first brief that lets an Operator set the flag, implements the ruling and audits every
  registered tool.

### E7. Consistency: revision checks around synchronous batches

The spec offers two approaches ("Investigation flow", step 1): read one stable snapshot of the
Case database and its files, or check the Case revision before and after each read. This plan
recommends the second, on both paths.

- **A batch is one synchronous block on the app's connection.** It reads the revision, compares it
  with the run's start revision, then reads rows and files with synchronous calls. Between batches
  the run yields with `setImmediate`, as `scheduleRetroactiveMatch` does, so progress events and
  cancel get through and the window keeps responding.
- **Each batch's opening check is the closing check of the batch before it,** and the stored write
  checks once more inside its transaction (E9). A write that lands anywhere during the run moves
  the revision before one of those checks, whichever process makes it. CE-10 moves extraction into
  a utility process (#598, ruled 2026-10-10), and that second writer is caught the same way.
- **A moved revision stops the run as invalidated,** and the run discards everything it read.
- **A batch that awaits a file read re-reads the revision after the read returns.**
- **A time budget bounds each batch,** because a long synchronous block freezes the app, the problem
  #598 records for extraction. CI-10 reports the longest batch in the run cost measure (E17). If
  the maintainer finds it too long, the engine moves into a utility process, the direction ruled
  for #598.

What a run reads within those batches:

- **One chain read per run.** The run takes each Capture's `textHash` and URL from one
  `verifyManifestChain()` result, which the Manifest head in the revision covers. Calling
  `resolveTextAnchor()` per Exhibit would verify the whole chain once per Exhibit. Reading `url`
  this way means adding it to `CaptureChainEntry`, a `src/shared/verify/**` change on the blocking
  tier, which CI-10 makes and states in its Evidence impact.
- **One text read per Capture.** The run reads each eligible Capture's `.txt` file once, compares
  it with `textHash`, and runs the shared-passage rule and name matching on that text, so it does
  not depend on `captures_fts`.
- **Field records only from a current build.** The run reads link and header records from
  `exhibit_search_fields` only for a Capture whose build row matches the current extractor version
  and Content Hash. Any other Capture counts as not read, with its reason (E11). A field rebuild
  during a run writes `exhibit_search_builds`, whose triggers move the revision, so the run's next
  check catches it (open question 4, ruled 2026-10-10).

The snapshot approach was rejected for three reasons. A SQLite read transaction on a second
connection covers the database but not the files on disk, which a Capture delete removes. A read
transaction held for a whole run keeps `emptyWalBeforeReplace()` from emptying the WAL, so both
restores refuse with `DB_IN_USE` until the run ends. And the MCP path opens its connection per tool
call (ADR-0038), so it cannot hold a snapshot across calls; only revision checks work on both
paths.

### E8. Eligibility in one view

`analysis_eligible_exhibits` holds ADR-0042's rule in one place: an Exhibit is eligible when it has
an `exhibits` row (committed; Staging Pool files live in `staging_files`) and no live withheld head
is `set`. The 2026-10-10 run in E1 checked it with a set flag, a set flag a later `clear` row
replaced, and an Exhibit with no flag; it returned the second and third.

- Every analysis query joins this view, so a flag set or cleared takes effect at the next query
  with no rebuild (ADR-0044).
- The base layer keeps no analysis cache. It computes "in 3 of 994 Exhibits" in the query over the
  view, so nothing has to drop a newly withheld Exhibit.
- Case search does not join the view. ADR-0044 keeps withheld Exhibits in the Operator's own search,
  with a mark (E22).

### E9. What a run stores, and what the view derives

A run stores its output in one write that checks the revision first, inside one transaction: read
the revision, compare it with the start revision, insert the new Subjects, Joints, and spans, write
`investigation_run_proposals`, `investigation_run_basis`, and `investigation_run_candidates`, read
the revision again, and record it as the stored revision with status `stored`. A proposal matches an
existing Joint when its `identity_hash` matches any author's live row; the write creates a row only
when none matches. A matched Joint gets a further sighting (`created = 0`), and spans it does not
already hold arrive as unreviewed material.

The view derives the following at read time and stores none of it: a Joint's status per member and
whether it is contested; its reviewed support, reviewed conflicts, and unreviewed material; the "no
longer counted" list; the strength summary and weak mark; paths; the gap list; the local source
trail; counts of Exhibits holding a value; and whether the run is out of date. These must follow
decisions made after the run, which by ADR-0042's exception leave the run current, so stored copies
would have to be rewritten on every decision.

Passage groups are run output: `investigation_run_candidates` rows with rule `shared-passage` and a
`group_key`.

### E10. Engine contract and IPC

CI-8 adds the contract in a new `src/shared/investigation.ts`. The contract sorts every array by a
canonical key, so two runs on one state serialize identically once ids and times are removed. The
core types:

```ts
export interface CaseRevision {
  generation: string
  counter: number
  manifestHead: { index: number; entryHash: string } | null // ManifestHeadRef's shape
}

export type TextCheck = 'present' | 'absent' | 'cannot-check'
export type Reading = 'supports' | 'conflicts' | 'unclear'
export type RuleId = 'same-field' | 'shared-identifier' | 'shared-passage' | 'reply-or-citation'

export type Producer =
  | { kind: 'rule'; rule: RuleId; version: string }
  | { kind: 'operator'; noteId: string | null } // a Note claim, or a same-name choice

export interface SpanLocator {
  representation: 'html-part' | 'text' | 'capture-url'
  field: string // 'header.from', 'link.href', 'text.passage', ...
  part: number | null // html-part only
  start: number
  end: number
  extractor: string // 'fields/2', ...
}

export interface ClaimCheck {
  text: TextCheck
  basis: 'hash-verified' | 'unattested' | 'decoded' | null // null when the check could not run
  reason: string | null
}

export interface SpanView {
  id: string
  exhibitId: string
  exhibitNumber: number
  memberCode: string | null
  contentHash: string
  locator: SpanLocator
  value: string
  side: 'a' | 'b' | null
  reading: Reading
  review: 'unreviewed' | 'support' | 'conflict' | 'dismissed'
  availability: 'available' | 'withheld' | 'unavailable' | 'no-longer-counted'
  check: ClaimCheck | null // null until CI-11
  holders: { count: number; of: number } | null // "in 3 of 994 Exhibits"
}

export type RunRequest =
  | { caseId: string; from: 'inquiry'; inquiry: string; startingSubjectIds: string[] }
  | {
      caseId: string
      from: 'note-claim'
      noteId: string
      passage: { start: number; end: number }
      subjectIds: string[]
    }
  | { caseId: string; from: 'find-more'; jointId: string }

export interface RunParameters {
  version: string // the parameter set's own version, recorded in every run
  followDepth: number
  sharedPassageMinWords: number
  passageGroupCeiling: number
  commonHostShare: number
  sharedHostListVersion: string
}

export type RunStatus = 'running' | 'stored' | 'canceled' | 'invalidated' | 'failed'

export interface RunProgressEvent {
  caseId: string
  runId: string
  phase: 'inventory' | 'search' | 'check' | 'store'
  exhibitsRead: number
  exhibitsWithheld: number
  exhibitsTotal: number
}

export interface InvestigationView {
  revision: CaseRevision
  run: RunSummary | null // the latest stored run only: no run history (spec open decision 2)
  outOfDate: OutOfDate | null
  subjects: SubjectView[]
  joints: JointView[]
  passageGroups: PassageGroupView[]
  paths: PathView[]
  gaps: GapGroup[]
}
```

`RunSummary` carries the run's basis revision, parameters and versions, and counts: read,
withheld, and not read by Exhibit kind and reason (E12). `JointView` carries the claim, its one or
two Subjects, the producer, the basis ("proposed from the Case as of" its run's start), each
member's decision, the proposal hash, and its spans in four lists: reviewed support, reviewed
conflicts, unreviewed, and no longer counted. CI-12 fills the strength summary, the weak mark,
paths, and gaps.

CI-8 defines the remaining view types from these sources, so neither CI-8 nor CI-E waits on CI-12
for their shape:

| Type | Source |
| --- | --- |
| `RunSummary` | The paragraph above, and the view header (feasibility assessment, S2), including the follow-depth line |
| `SubjectView`, `PathView` | The Joint map and list (feasibility assessment, S3), and the spec's step 5 for paths |
| `PassageGroupView` | Joint detail (feasibility assessment, S4): the Exhibits holding the passage and the ceiling shown with the group |
| `GapGroup`, `GapKind` | The gap list (feasibility assessment, S6), the spec's gap-list groups (spec, "What a run produces"), and its same-name gap entry (spec, "Visual design", the "Same-name Subjects" state); `GapKind` below |
| `OutOfDate` | State 10 of the feasibility assessment and E3's rule: the stored revision, the current one, and the change kinds and targets since the run |

```ts
export type GapKind =
  | 'claim-without-support'
  | 'accepted-with-unreviewed'
  | 'accepted-lost-support' // all available support, or the support on one side
  | 'contested'
  | 'weak'
  | 'reached-only-through-another'
  | 'path-on-unaccepted-joint'
  | 'missing-date'
  | 'missing-original'
  | 'search-not-run'
  | 'same-name-unjoined' // two Subjects share a name and no Exhibit joins them yet
```

The main process holds the engine behind one interface:

```ts
export interface InvestigationEngine {
  run(
    request: RunRequest,
    options: {
      onProgress: (progress: RunProgressEvent) => void
      signal: AbortSignal
      parameters?: Partial<RunParameters> // the evaluation runner only; IPC never passes it
    }
  ): Promise<{ status: RunStatus; runId: string; reason: string | null }>
}
```

Channels join `IpcInvokeContract` and `IpcEventContract`, so `ChannelsAreExhaustive` fails the
build if one is missing, and the renderer calls them through a new
`src/renderer/lib/api/investigation.ts`. Every write returns the new `CaseRevision`.

| Channel | Arguments | Result | Real implementation |
| --- | --- | --- | --- |
| `investigation:getRevision` | Case id | `CaseRevision` | CI-9 |
| `investigation:getView` | Case id | `InvestigationView` | CI-10, CI-12, CI-R |
| `investigation:getSpan` | span id | the span for the source inspector, with its withheld state and Source Class heads | CI-10 |
| `investigation:checkSpan` | span id | `ClaimCheck` | CI-11 |
| `investigation:startRun` | `RunRequest` | run id | CI-R |
| `investigation:cancelRun` | run id | nothing | CI-R |
| `investigation:getChanges` | run id | the change kinds and targets since the run | CI-R |
| `investigation:decideJoint` | Joint id, decision, reason, acceptance context | `CaseRevision` | CI-D2 |
| `investigation:decideSpan` | Joint span id, action, reason | `CaseRevision` | CI-D2 |
| `investigation:chooseSubject` | same-name span id; Subject id or none | `CaseRevision` | CI-D2 |
| `investigation:addSubject`, `investigation:keepSubject` | name and kind; Subject id | `CaseRevision` | CI-D2 |
| `investigation:setSourceClass` | Exhibit id, value, reason | `CaseRevision` | CI-D1 |
| `investigation:setCopyMark` | copy and original Exhibit ids, marked | `CaseRevision` | CI-D1 |
| `investigation:setWithheld` | Exhibit id, withheld | `CaseRevision` | CI-D1 |
| `investigation:listOwnIdentifiers`, `investigation:markOwnIdentifier`, `investigation:unmarkOwnIdentifier` | Case id; entry | entries; `CaseRevision` | CI-D1 |
| `event:investigationProgress` | `RunProgressEvent` | event | CI-R |

**The fake engine** lives in `src/main/services/investigation/fakeEngine.ts` and serves every
channel from one invented fixture module that the renderer tests also import, so CI-V1 to CI-V4
exercise the real preload and IPC path. It keeps its state in memory and writes nothing to the
database, so its `setWithheld` sets no real flag. `ipcHandlers.ts` registers it only when
`app.isPackaged` is false, as `updater.ts` already branches on that flag. Each real brief replaces
its channels as it merges, and CI-V5 removes the fake. CI-E scores a separate key-backed fake of
its own (E18), and its faulty wrappers alter whatever result an engine returns, so this fake
carries no faulty modes.

**The base layer is a deep-module package,** `src/packages/investigation-base-layer/`, with one
entry point, `proposeJoints(input)`. The input is a plain snapshot of everything a run read; the
output is sorted proposals, Subjects, surfaced spans, same-name spans, and passage groups. It
touches no database and no file, so its determinism tests need no Electron, and
`pnpm lint:boundaries` enforces the boundary (`src/packages/README.md`). The main-process engine
under `src/main/services/investigation/` takes its dependencies as `createSelectorLifecycle(deps)`
does (repositories, the clock, the shared-host list, the profile-URL rules), gathers the input
through revision-checked batches (E7), runs the claim checks once CI-11 lands, and hands the result
to the run lifecycle (CI-R). The evaluation runner uses those dependencies as its seams.

The engine module also exports `runUnstored(request, deps)`, which gathers the input through the
same batches, calls `proposeJoints()`, runs the claim checks from CI-11 on, and returns the result
without the stored write. CI-E's runner scores CI-10 and CI-11 through it, because CI-R owns the
stored write that makes a run readable through `investigation:getView`, and CI-10 and CI-11 may
merge before CI-R. Once CI-R merges, the runner scores stored runs through the view as well.

### E11. Identifiers beyond the retrieval plan

The retrieval plan records `link.href`, `link.alt`, and ten header fields (retrieval plan D3, D4).
The spec's identifier table ("Identifiers the base layer extracts") needs more. CI-10a raises the
field extractor to `fields/2`; retrieval plan D5 rebuilds the records an older version built, and
the change needs no migration because `field` is free text in `exhibit_search_fields`. The new
records stay search records under ADR-0044.

| Spec identifier | Retrieval plan records | `fields/2` adds | Engine comparison key (`idnorm/1`) |
| --- | --- | --- | --- |
| Mail address | `From`, `Reply-To`, `Sender`, `Return-Path`; `mailto:` targets in `link.href` | `header.to`, `header.cc`; `text.address` for addresses in Extracted Text, with offsets | The part before `@` as stored; the domain in lower case and ASCII form |
| Username or handle | Profile URLs in `link.href` | none: the engine derives a platform and handle from `link.href` records at run time, with the profile-URL rules it takes as a dependency (E10, rule 2) | Platform plus handle; a handle on one platform never matches another |
| Domain and host | `link.href` hosts; `Message-ID`; `NNTP-Posting-Host` | `image.src`; `header.path`. The Capture's URL is not a field record: the engine reads it at run time from the signed capture entry (rule 3) | Lower case; internationalized names through `url.domainToASCII()`, which Node 20.20.2 provides |
| Link target | `link.href` | `image.src` for `img[src]`; `text.url` for URLs in Extracted Text | Scheme and host in lower case, default port removed, fragment kept |
| Message identity | `Message-ID`, `In-Reply-To` | `header.references` | Exact |
| Tracking and payment identifiers | none; `extracted_data` has no locator | `id.tracking` (the Tracking Code patterns in `EXTRACTION_RULES`, and the `gaTrackIDs` and `gaPubIDs` values `extractIocs()` returns) and `id.crypto` (the Bitcoin, Ethereum, and Monero values `extractIocs()` returns), each located in the decoded part with offsets | Exact |
| Document metadata | `Organization` | none (PDF is out, E12) | Exact after whitespace folding |
| Name | none | none: the base layer finds a Subject's name as an exact phrase in the `.txt` text it already reads (E7) | Exact phrase |

Three rules from the evidence above shape this:

- **The engine keeps its own comparison key.** The retrieval plan's search form lower-cases a whole
  address (retrieval plan D4), and `extractData()` stores addresses lower-cased. The spec keeps the
  part before the `@` as stored and surfaces near-matches as unreviewed material, so `idnorm/1`
  computes its key from `value` at run time and keeps the stored value beside it. If CI-10's run
  cost is too high, a later migration adds an indexed key column.
- **CI-10a reuses the existing patterns without editing `dataExtractor.ts`.** `EXTRACTION_RULES` is
  exported, so the field extractor imports its Tracking Code patterns and resets each pattern's
  `lastIndex` as `runRules()` does. `extractIocs()` returns values without positions
  (`ExtractedDatum` has none), so CI-10a locates each returned value by exact search in the same
  part. `dataExtractor.ts`, a blocking-tier file, stays unchanged, and a test shows `extractData()`
  output unchanged on its fixtures. Handles are run-time derivations, not field records: CI-10
  passes the Accounts patterns to the engine as its default profile-URL rules and records their
  version with the run's other versions. The evaluation's invented-platform rule (open question 14)
  reaches the engine through the same dependency, and no field record has to be rebuilt for it.
- **The Capture's URL comes from the signed capture entry.** `captures` is editable from Settings ->
  Database and its edits do not move the revision. The run reads the URL from the signed entry
  (E7), as step 4 reads `textHash` from the signed entry and never from the database mirror. A
  legacy Capture with no entry contributes its database URL, marked `unattested`. CI-11 checks a
  `capture-url` span against that entry.

Only Capture Exhibits that have a `.txt` file and a current build row are read. A Capture whose
build row is missing, `failed`, `partial`, or from an older extractor counts in the run's "not
read" figure with its reason, so the header's count of Exhibits read stays honest (view brief,
decision 19). Selectors are read and recorded in `investigation_run_basis`, and the first slice
uses none as a search key (open question 6).

### E12. PDF and `mbox` Exhibits are not in the first engine slice

The first slice reads only representations a claim check can check, because the safety gate fails
on any span shown as support that does not resolve. `checkFieldHit` (retrieval plan D7) checks
`html-part` and `text` records; the engine adds the Capture's URL (E11).

- **PDF stays out.** A PDF is a `document` Exhibit with no text today. Reading one needs a runtime
  PDF parser, which is a new dependency for the maintainer to approve, a page-and-span locator, and
  a check that reruns the extractor (retrieval spec, "Representations and locators"). The roadmap's
  PDF parser gate covers a test-only reader for CE-8, not this.
- **`mbox` stays out.** An `mbox` file commits as `attachment`, so the engine would have to
  recognize one by its content, and a message locator and its check are new. The spec moves
  per-message document Subjects to a later phase (decided 2026-10-04; the view brief's G10).
  Fixture 1 keeps the spec's Usenet header in reach as a Capture of a page showing the header,
  which is how the retrieval spec describes the original miss.
- **Unread Exhibits are counted.** A run reports how many eligible Exhibits it did not read, by
  kind and reason, and the gap list's "searches not yet run" group names them (fixture A5, open
  question 15), so a PDF holding a starting Subject's address never reads as "no connection".

Proposed later briefs, outside the waves: CI-15, PDF page text and metadata field records; CI-16,
`mbox` message and header field records. Each adds its fixtures to the answer key before its code.

### E13. Transaction Record headers are not in the first engine slice

The Transaction Record is _Planned_ in `CONTEXT.md`. CE-7 writes it in wave 4 and merges only after
a release carrying CE-5's verifier, and CE-9 is the brief that carries the WARC in a Case Archive.
The retrieval spec allows observed HTTP headers only when that record exists and forbids
reconstructing absent ones, and no fixture or measure in the engine spec needs an HTTP header.

Proposed later brief CI-17, filed after CE-7 and CE-9 merge: a field-extractor version that adds
`txn.header.*` records from the WARC and writes a build-row outcome for a Capture without one, so
its absence is recorded and never read as "no header".

## The evaluation

### E14. The synthetic engine Case

CI-E builds the Case with #1796's generator, so every Capture has a signed Manifest Entry, a stored
page, and an Extracted Text file, as in the app. Case data that has no Operator write path yet
(Subjects, Withheld from analysis, Source Class, Own Identifiers) is declared in a seed file and
applied through CI-9b's repositories (E5); until they exist, the runner's key-backed fake (E18)
reads the seed directly.

Every person, site and document is invented, and nothing comes from the live investigation the
spec draws on. Names are the spec's own invented ones. Hosts are subdomains of `example.com`,
`example.net` and `example.org`, as #1796 uses: the spec's examples end in `.example` (such as
`calloway@harrow.example`), which the extraction validators refuse, so the fixture writes
`calloway@harrow.example.net`. No page ties a pseudonym to a handle on a real platform (open
question 14).

The spec's list (fixtures 1 to 14) and this plan's additions (A1 to A6):

| # | The Case holds | The first slice must | Measure | Passes in |
| --- | --- | --- | --- | --- |
| 1 | A Capture of an unannotated newsreader page showing `From: Jun Sato <...>`, `Path` and `NNTP-Posting-Host`, whose address no inquiry names, and a second Capture tying M. Calloway to the same address | Propose the same-field Joints and the shared-identifier Joint between Calloway and Jun Sato, reached within two Joints of a starting Subject; its span opens at its locator | Recall | CI-10a, CI-10 |
| 2 | A fact only in an image link: `<a href>` around an `<img>` whose target is another Capture's URL | Propose the citation Joint between the two document Subjects, found through `link.alt` and `image.src` | Recall, span resolution | CI-10a, CI-10 |
| 3 | A Note anchored to a Capture that lacks the Note's claim | From **Find material for this claim**: a Joint that stays proposed, and a gap entry "claim with no supporting Exhibit" | Gap entries | CI-R, CI-12 |
| 4 | Two Subjects named Rowan Pike with no Exhibit joining them, and a header naming Rowan Pike | Propose no Joint; surface the header span on each; a gap entry saying no Exhibit joins them | False same-name Joints | CI-10, CI-12 |
| 5 | One article with conflicting publication dates, and a later copy on another site | Propose the shared-passage Joint, claiming only that both contain the passage; the dates appear in the gap list; which copied is Operator work (key: `operator-only`) | Recall | CI-10, CI-12 |
| 6 | Addresses on one webmail host across many Captures | Propose nothing from the host alone, once above the common-host share and once on the shared-host list | Common-host Joints | CI-10 |
| 7 | A footer on more Exhibits than the passage-group ceiling | One passage group and no pairwise Joints | Threshold sweep | CI-10 |
| 8 | A document whose Source Class is AI-origin, falsely tying The Ferryman to Calloway's address | No Joint whose support rests on it; its spans move to "no longer counted" once classed | Wrong-Joint rate | CI-10, CI-D1, CI-12 |
| 9 | A dead original URL captured as an error page with a pinned Wayback Ref; a Staging Pool file; a withheld Exhibit, withheld before one run and after another, with a Note anchored to it and an unanchored Note quoting it | Match the Wayback Ref locally by URL and date with no network request; never read the Staging Pool file or the withheld Exhibit; put the earlier run out of date when the flag is set | Safety gate, gap entries | CI-10, CI-12, CI-R |
| 10 | A captured page whose header shows the Operator's Persona account, recorded as an Own Identifier | Never follow it | Absence | CI-10, CI-D1 |
| 11 | A press release and two articles that each quote it | Shared-passage Joints that claim only that both contain the passage | Recall | CI-10 |
| 12 | Two link targets on a hash-routed site that differ only in the fragment | No Joint; surfaced as unreviewed material | Absence | CI-10a, CI-10 |
| 13 | The wrong-Joint fixture: a forwarded message quoting another writer's header, and a public contact page listing `ihale@lantern.example.org` | In run I4, which starts from Imogen Hale (E15): the key marks "Imogen Hale used ihale@lantern.example.org" unsupported; if proposed, it counts in the wrong-Joint rate | Wrong-Joint rate | CI-10 |
| 14 | The AI-layer pages: two paraphrased retellings signed The Ferryman, a third sharing no rare word, a decoy story, and the misleading passage, which names M. Calloway and The Ferryman | In run I1, which starts from both: no base-layer Joint between the retellings (key: `ai-only`), and none because of the misleading passage; the provider benchmark reuses these pages later | Safety gate | CI-10 |
| A1 | An identifier chain three Joints from every starting Subject | Not proposed; the header reports two Joints followed | Expansion bound | CI-10 |
| A2 | A canary address held only by the withheld Exhibit and one eligible Exhibit | No shared-identifier Joint; the holder count reads 1 | Safety gate | CI-10 |
| A3 | A copy of the built profile with one stored page byte and one `.txt` byte changed | Spans from both read as unavailable, never as support | Span resolution, positive control | CI-11 |
| A4 | Inside the misleading page, a header-shaped block that names M. Calloway and The Ferryman | In run I1: keyed unsupported, so a Joint proposed from it counts as a wrong Joint (open question 13) | Wrong-Joint rate | CI-10 |
| A5 | A committed PDF (`document`) and an `mbox` file (`attachment`) that both hold a starting Subject's address | Counted and listed as not read (E12) | Not-read counts | CI-10, CI-12 |
| A6 | For run I3: pages naming the _Marlow Star_ and two invented companies, one of which states only in prose that a company owned the vessel between 2019 and 2022; no header, link, or shared passage ties them | No base-layer Joint for the ownership (key: `ai-only`) | Absence | CI-10 |

The filler carries what real pages repeat (site footers, navigation, cookie notices, syndicated
blocks) at rates CI-E states, so the threshold sweeps in E20 meet repeated text. A unit test, as in
#1796's `tests/retrievalEval.test.ts`, asserts that no fixture-only string appears in the filler and
that every host is a subdomain of a reserved example domain.

### E15. Inquiries

The runner asks the spec's three product-promise questions, one question this plan adds so a run
reaches the wrong-Joint fixture, and starts two runs from Notes. Expansion stops two Joints from
each starting Subject (spec, "How two Exhibits come to support one Joint"), so every fixture needs
a run whose starting Subjects reach it, and the answer key lists that run for each row (E16):

| Key | Run | What it exercises |
| --- | --- | --- |
| I1 | "Are M. Calloway, Jun Sato, and The Ferryman the same writer?", from those three Subjects | The spec's end-to-end case: identifier Joints, the Rowan Pikes kept apart, paths |
| I2 | "Which sites republished the 12 March article?", from the article's document Subject | Shared passages, the passage group, the press release, the local source trail |
| I3 | "Who owned the _Marlow Star_ between 2019 and 2022?", from the vessel and two companies | A relation stated only in prose (fixture A6): no Joint, passages surfaced, the line saying what the base layer cannot find |
| I4 | "Which addresses did Imogen Hale use?", from the Imogen Hale Subject | The wrong-Joint fixture (13): the same-field rule meets a quoted header and a contact page |
| N1 | **Find material for this claim** on the Note in fixture 3 | An Operator-started Joint with no support, and its gap entry |
| N2 | **Find material for this claim** on the unanchored Note quoting the withheld Exhibit | No span from the withheld Exhibit surfaces |

### E16. The answer key

CI-E writes the key in `scripts/engine-eval/` and merges it before CI-10 starts, so the key is
fixed before the engine it scores exists. A later change to the key is a commit of its own with its
reason, and CI-B lists every such commit.

```ts
type RunKey = 'I1' | 'I2' | 'I3' | 'I4' | 'N1' | 'N2' // E15

// A Subject the seed names, or a document Subject by the fixture page it is bound to
type KeyedSubject = { name: string } | { page: string }

type Reach =
  | 'same-field'
  | 'shared-identifier'
  | 'shared-passage'
  | 'reply-or-citation'
  | 'ai-only'
  | 'operator-only'

interface KeyedJoint {
  key: string
  runs: RunKey[]
  reach: Reach
  subjects: [KeyedSubject] | [KeyedSubject, KeyedSubject]
  pages: string[] // fixture pages whose spans the Joint cites
  supported: boolean // false: the spans resolve and do not support the claim
}

interface KeyedAbsence {
  key: string
  runs: RunKey[]
  why:
    | 'same-name'
    | 'common-host'
    | 'fragment-only'
    | 'own-identifier'
    | 'beyond-follow-depth'
    | 'passage-group'
    | 'withheld'
    | 'ai-origin-support'
}

interface KeyedGap {
  key: string
  runs: RunKey[]
  kind: GapKind
  about: string[]
}
```

A proposal matches a keyed Joint when its rule equals `reach`, its Subjects equal `subjects` (as a
set, or in order for a directional rule), and the Exhibits it cites, mapped back to pages by
Content Hash, include every page in `pages`. A Subject the seed defines matches by its seed name
only. A document Subject matches by the page its bound Exhibit was built from, mapped by Content
Hash: the base layer names a document Subject it proposes from the Exhibit's title and Exhibit
Number (spec, "How two Exhibits come to support one Joint"), so the seed defines no such Subject,
and the match ignores Exhibit Numbers. A same-field Joint is about one Subject (open question 12,
ruled 2026-10-10), so `KeyedSubject` needs no identifier form. The match ignores database ids
too, so the key also serves the provider benchmark harness, which reads the same Case through a
separate data folder (spec, "First evaluation model"). With open questions 12 and 13 ruled, CI-E
can write the key.

### E17. Measures

Each measure is recorded per run (E15), per variant (E21), and per engine (`key` for the
key-backed fake, a faulty wrapper over it, or `real`).

| Measure | How the runner computes it | Source | First recorded |
| --- | --- | --- | --- |
| Joint recall | Keyed Joints with a base-layer `reach` that a run proposed, over all such keyed Joints; each counted on its own, never "any of" | Spec measure list | CI-10 |
| Wrong-Joint rate | Proposals matching a keyed Joint with `supported: false`, over all proposals, unkeyed proposals included in the denominator | Spec measure list | CI-10 |
| Unkeyed proposals | Proposals matching no key row, listed by claim | This plan | CI-10 |
| False same-name and common-host Joints | Proposals matching a `KeyedAbsence` of either kind | Spec measure list | CI-10 |
| Span resolution | Every displayed span re-resolved by the runner's own resolver: the stored file hashes to the Content Hash in the signed entry, a `text` span's file hashes to `textHash`, and a decoded span re-decodes to the same slice | Spec measure list | CI-10; CI-11 adds engine-against-runner agreement |
| Determinism | Two runs in separate processes, each on its own fresh copy of the built profile, so neither reads the other's stored output (the spec's step 2 reads existing Subjects and Joints as input). The runner compares the two proposal sets by identity hash and by the spans each proposal cites, keyed by Content Hash and locator. It also compares the whole results, with ids and times removed, byte for byte, and reports that as a diagnostic (open question 22) | Spec measure list | CI-10 |
| Gap entries | Keyed gaps found and missing | Spec end-to-end paragraph | CI-12 |
| Expansion bound | Fixture A1 absent; the follow depth the result reports | Spec, "How two Exhibits come to support one Joint" | CI-10 |
| Not-read Exhibits | Counts by kind against the seed | E12 | CI-10 |
| Review load | Proposals, unreviewed spans, passage groups, and gap entries per run | A proxy for time to review | CI-10 |
| Time to review | One person reviewing I1's result on the synthetic Case, timed | Spec measure list | CI-B |
| Run cost | Wall time, revision checks per run, and the longest batch the main process runs without yielding, at the chosen size | E7 | CI-10 |
| Screening loss | AI layer only | Spec measure list | Not planned here |

### E18. The safety gate and its positive controls

A detector that never fires proves nothing, so each one has a control: a wrapper in
`scripts/engine-eval/` that takes any engine and breaks one rule in what the runner scores. Each
wrapper alters the engine's result, or for the network clause acts around its run; none reaches
inside an engine, so each works the same on every engine.

In CI-E the gate runs on a key-backed fake, a module in `scripts/engine-eval/` that builds its
result from the seed and the answer key and cites the spans the page generator planted, at their
locators in the synthetic Case's stored pages. CI-8's fake cannot serve here: it serves the
renderer's invented fixture, which names none of the synthetic Case's Exhibits, so no span it
shows would resolve. CI-E is done only when every control fails the gate and the unwrapped
key-backed fake passes it.

| Gate clause | Detector | Positive control |
| --- | --- | --- |
| Invented or unresolving span shown as support | The runner's resolver re-reads every span in every support and conflict list. It shares only the decoder, which defines the representation, with the engine's check | A wrapper that shifts one span's offsets; fixture A3 |
| Withheld-content leak | No withheld Exhibit in any proposal, surfaced span, passage group, holder count, or gap entry, except the withheld-support entries the spec keeps on earlier Joints; fixture A2's count stays at 1 | A wrapper that adds a span from the withheld Exhibit to one Joint's support and raises fixture A2's holder count to 2 |
| Unapproved network request | A guard the runner installs for the run records every outbound connection attempt and name lookup in the main process; the first slice approves none | A wrapper that tries to connect to a closed local port |
| Joint proposed because the misleading passage instructed it | No proposal cites a span inside the instruction part of the misleading page; a Joint proposed from the header-shaped part (A4) counts in the wrong-Joint rate instead (open question 13) | A wrapper that adds the instructed Joint |

How the guard hooks the main process is CI-E's to choose and state; this plan names no Node or
Electron interface for it, and CI-E's done-when checks the choice (open question 17).

### E19. The base-layer bar

| Condition (spec, "Base-layer bar") | Measure | Pass |
| --- | --- | --- |
| Proposes every answer-key Joint the four rules can reach | Joint recall | 1.0 on every run in E15 |
| Zero false same-name Joints and zero Joints from a common host | Absences | 0 and 0 |
| Two runs on one state propose the same Joints | Determinism | The same identity hashes, each citing the same spans; whole-result byte-equality is reported, not required (open question 22) |
| The wrong-Joint rate is measured and shown | Wrong-Joint rate, and the view | Reported; no threshold |
| The safety gate, beside the bar | E18 | No detector fires |

Unkeyed proposals do not fail the bar as decided. They leave the wrong-Joint rate incomplete, so
CI-B classifies each one into the key, in its own reviewed commit, before it reports the rate.

### E20. How the thresholds get set

The spec leaves three base-layer numbers to the evaluation and names a fourth control:

| Parameter | Spec | Sweep on variant A |
| --- | --- | --- |
| Shared-passage minimum length | "Shared passage": set by the evaluation | Whole words after folding, from the shortest run any filler pair shares up to the shortest keyed passage |
| Passage-group ceiling | "Shared passage": set by the evaluation and shown with the group | From 2 Exhibits up to the footer's count |
| Common-host share | "Distinctiveness and noise": a set share of the Case | Share of eligible Exhibits read |
| Shared-host list | "Distinctiveness and noise" | Not swept: a versioned list in code, reviewed in CI-10's PR. The runner adds fixture 6's invented host for the evaluation only, since a real webmail domain cannot appear in a fixture |

The spec fixes the two-Joint follow depth, so it is not swept. The AI layer's numbers (the
withheld-quotation length, the screening cap, and each provider's recall and wrong-Joint bounds)
are out of scope.

CI-10 ships each number as a named constant marked provisional, then runs each sweep with CI-E's
runner over a grid its PR states. For each value it records the three bar conditions and the
wrong-Joint rate. The values that meet all three conditions form the feasible range. CI-10 picks
the conservative end of that range: the longer passage, the lower ceiling, and the lower share,
because a false Joint costs the Operator review time and risks a wrong acceptance, while a missed
shared passage stays findable through Case search. If no value meets the bar, CI-10 does not merge,
and the assessment says which condition failed. CI-10 records each curve, the range, and the chosen
value in the engine assessment, and the assessment states that synthetic text cannot establish what
real Cases repeat.

Each value is a run parameter, recorded in every run record under the parameter set's version and
shown where the spec shows it ("in 3 of 994 Exhibits", the ceiling beside a passage group). A
threshold change leaves the rule version as it is, so decisions carry across it; the rule version
changes only when a rule's matching logic changes (open question 16, ruled 2026-10-10).

### E21. Size, variants, and where results go

- **Size.** The engine runs at 1,000 Captures, the size the maintainer ruled on 2026-10-10 for
  CI-2's baseline and the engine runs (Gates). The spec sizes its design for "a Case of about 1,000
  Exhibits", and #1796's smoke run already ingested 1,000 pages in 24.1 s.
- **Variant B.** CI-E adds a variant flag that rebuilds the planted pages with a second invented set
  of names, hosts, and wording. Thresholds are set on variant A and confirmed, frozen, on variant B
  (open question 11).
- **Results.** CI-E starts `docs/specs/<date>-case-investigation-engine-assessment.md` with the
  method and the key-backed fake's runs. CI-9 adds the trigger timing, CI-10 the sweeps and the
  first real runs, CI-12 the gap entries, and CI-B the confirmation run and the time to review.
- **Command.** CI-E adds `pnpm eval:engine`, beside #1796's `pnpm eval:retrieval`, with three
  flags: `--eval-captures=<n>`, run at 1,000 Captures, the size ruled on 2026-10-10;
  `--variant=a` or `--variant=b`; and `--engine=key` or `--engine=real`. With `--engine=real` the
  runner scores `runUnstored()` (E10) until CI-R merges, and stored runs read through the view from
  then on. The done-when list below names the command each brief runs.

## Search and sharing

### E22. Retrieval step 7: the Withheld from analysis mark (CI-14)

ADR-0044 keeps withheld Exhibits in the Operator's Case search with a mark. CI-14 adds it where the
retrieval slice returns Exhibits:

- `searchCaptures()` in `captureRepo.ts` adds a `withheld` flag to each row through a join on the
  current withheld heads, with the holders. ADR-0044 rules that it needs no filter.
- The `search:fields` repository (CI-5) and the unreviewed view's query (CI-7) add the same field to
  each hit and row.
- `SearchBar.tsx` and the Data screen's unreviewed tab render the mark once its design gate clears.
- `scripts/retrieval-eval/` gains a page withheld before its field records are built and one
  withheld after; a third run appends its results to the retrieval first-slice assessment. The
  withheld Exhibit appears in Case search with its mark, and in no analysis query. The engine runner
  imports the same withheld pages, so one definition serves both evaluations.
- CI-14 changes no MCP tool; CI-D1 implements the 2026-10-10 MCP ruling (Gates).

CI-14's tests seed the flag through CI-9b's repository, so CI-14 does not wait on CI-D1, though an
Operator can set the flag only once CI-D1 merges.

### E23. Shared Case amendment (approved 2026-10-10)

The maintainer approved this amendment as proposed on 2026-10-10, item 6 included, which rules
#543 for Own Identifiers in a Shared Case (Gates). CI-P's pull request adds it to the
"Working-layer rows" section of
[the collaborative cases design](../specs/2026-09-19-collaborative-cases-design.md).

1. **Rows.** The ten synced tables in E2 join the working layer, with the same four columns, the
   same signing over canonical JSON, and the same rule that remote rows are inserted only with a
   roster member's valid signature and a version above the stored one. Within one author's rows
   the `rows` step sends Subjects, then Joints, then spans, then decisions. That order holds
   nothing across authors, because the step pulls each author's rows by
   `(authorInstallationId, sinceVersion)` (design, "Sync session" step 5): member B's decision on
   member A's Joint can arrive before A's Joint row, and `joint_decisions.joint_id` would refuse
   it. CI-S therefore applies every row one session receives in one transaction with SQLite's
   `defer_foreign_keys` pragma on, so each foreign key is checked at commit, after the Joint has
   arrived. A peer that holds B's decision also holds A's Joint, because its own insert passed the
   same check, so one session can carry both; a session that ends without the referenced row rolls
   back, and the next session retries. Under SQLite 3.53.1 (E1) the pragma let a decision inserted
   before its Joint commit in one transaction, refused a decision whose Joint never arrived, and
   reset itself at commit. The alternative is to drop the foreign keys between synced tables, as
   E1 does for `exhibits`; that needs a migration, so CI-9 would make that choice, not CI-S.
2. **When a Joint syncs.** A Joint, the Subjects it names, and its spans sync once any member's head
   decision on it is `accept`. Until then they stay with the member whose run proposed them. A
   reject of a Joint that has not synced stays local, and syncs once another member accepts a Joint
   with the same `identity_hash`; the Joint then reads as contested. A same-name span syncs only
   with the Joint its choice started; a `none` choice stays local. A held-back row keeps the
   version it took at write time, and versions are monotonic per author, so once the author syncs
   any later row, each peer's cursor for that author passes the held-back one and no peer would
   pull it. CI-S therefore gives a held-back row a fresh per-author version, and signs it again,
   when it becomes eligible. E2 lists that update as an exception to "written once", and E3's
   update triggers on the synced tables ignore it.
3. **Subject identity across members.** A document Subject is bound to its Exhibit and an
   identifier Subject to its kind, platform, and comparison key. Subjects with the same binding read
   as one Subject, and `identity_hash` uses bindings in place of row ids, so two members' proposals
   of one Joint match. Person, pseudonym, and other unbound Subjects never combine.
4. **Decisions** sync attributed to their author, and so do adds and dismisses. Each member's
   current decision on a Joint or span is their own head row, found through `replaces` (E2);
   members who disagree leave the Joint
   contested, and a dismiss by another member shows beside a span this installation counts.
5. **Withheld from analysis** syncs per holder, and a NULL holder means the row's author (E2). An
   installation withholds an Exhibit while any holder's head is `set`. A member clears only their
   own flag, and an Owner clears a revoked member's flag with a row it authors (E2).
6. **Own Identifiers** sync per holder, as flags do: their kind, platform, stored value, holder,
   and the marking member's Member Code. `persona_id`, and with it the Persona's label and notes,
   never syncs. Each installation normalizes the stored value with its own rule version. A member
   removes only their own entries, and an Owner removes a revoked member's entries with a row it
   authors (E2).
7. **Source Class and copy marks** sync with their `replaces` lists. Heads with different values
   read as a conflict until a member writes a row replacing them.
8. **Never synced:** run records and their child tables (they list what this installation read
   and, later, what it sent to a provider), `case_revisions`, and `case_change_log`. Selectors are
   already local (decision 17). A synced decision carries its basis time and proposal hash (E1), so
   lineage survives without the run record.
9. **The revision.** A received row fires the same triggers as a local one, so it advances the
   counter and invalidates a running run. Received Manifest entries land in
   `manifest.<installationId>.jsonl` and move this installation's head only when the session writes
   its `merge` entry (design, "Sync session" step 6). Before then, the `exhibits` triggers move the
   counter when SC-2b inserts a received Exhibit's row (open question 3).
10. **Decisions received on this installation's proposals.** ADR-0042's rule excepts any decision
    on a run's own proposals, so a decision another member makes on them, received by sync, leaves
    the run current. The spec says "the Operator's own decisions"; the maintainer ruled on
    2026-10-10 that this reading holds, and the amendment states it (open question 7).

Items 3, 4 (adds and dismisses), 8, and 10 came from this plan; the spec's "Shared Cases" section
states none of them, and the 2026-10-10 approval covers them.

## Order of work

Each brief is one pull request. Waves are the roadmap's; file counts are estimates.

| Brief | Wave | Change | Depends on | Lane | Blocking-tier paths | Files |
| --- | --- | --- | --- | --- | --- | --- |
| CI-8 | 2 | E10: `src/shared/investigation.ts`, the `investigation:` channels and preload, the renderer API module, the engine interface, and the fake engine and its invented fixture | CI-P approved | none | none (IPC files are advisory) | 7-9 |
| CI-9 | 4 | E1, E3, E4, E6, E8: the migration, triggers, and view; `caseRevision.ts`; generation replacement in both restores; `get_case_revision` and its `mcp.mdx` line; a Case revision entry in `CONTEXT.md`; trigger timings | CI-2, CI-3, CI-P approved | migration | `db/**` | 10-12 |
| CI-10a | 4 | E11: the `fields/2` extractor | CI-4, CI-5 | none | `db/**` (build service) | 4-6 |
| CI-E | 4 | E14 to E21: pages, seed, key, inquiries, scorer, the key-backed fake, network guard, faulty wrappers, variant B, assessment started | CI-P approved, CI-2, CI-8 | none | none | 8-10 |
| CI-9b | 5 | E5: repositories, collectors, importers, `ID_PROBE_TABLES`, the `replaces` remap, the archive version | CI-9 | Case Archive | `db/**`, `caseArchive.ts` | 8-10 |
| CI-10 | 6 | The base-layer package, the batch reader, the four rules, document Subjects, expansion, holder counts, the threshold sweeps | CI-9b, CI-10a, CI-E's key | none | `db/**` (reader), `src/shared/verify/**` (`url` on `CaptureChainEntry`), `src/main/services/investigation/**` (its row, open question 19) | 10-12 |
| CI-D1 | 6 | Withheld from analysis, Source Class, copy marks, and Own Identifier services and IPC; the 2026-10-10 MCP ruling in the MCP server: every registered tool audited, and a withheld Exhibit listed with its mark and none of its content or values drawn from it; the `mcp.mdx` update | CI-9b | none | `db/**` | 13-16 |
| CI-D2 | 6 | Joint and span decisions with acceptance context and undo; Subjects added and kept by hand; the same-name choice | CI-9b | none | `db/**` | 7-9 |
| CI-R | 6 | Run lifecycle, the stored write, out of date, changes since a run, compaction, runs left `running` by a quit; the Notes editor action | CI-8, CI-9b | none | `db/**`, `src/main/services/investigation/**` (open question 19) | 8-10 |
| CI-14 | 6 | E22 | CI-5, CI-7, CI-9b, the mark's design | none | `db/**`; `src/renderer/components/data/**` or `DataExplorer.tsx`, whichever holds CI-7's tab | 6-8 |
| CI-11 | 7 | Claim checks: `checkFieldHit`, the `textHash` comparison, the `capture-url` check | CI-6 (after its sign-off), CI-10 | none | `db/**`; the check module, under `src/main/services/investigation/**` (open question 19) | 5-7 |
| CI-12 | 7 | The derived view: paths, strength summary, weak mark, gap list, local source trail | CI-10's threshold run, CI-R | none | `db/**` (read queries) | 6-8 |
| CI-S | 7 | E23, implemented | SC-2, CI-9b, CI-D1, CI-D2, CI-R | none | `db/**`, `src/main/services/sharing/` | 8-12 |
| CI-13 | 8 | Exporting Joints with their lineage | CI-11, CI-12 | none | `export.ts` | 5-7 |
| CI-B | 8 | The bar confirmation run: every E17 measure on variants A and B with the real engine, unkeyed proposals classified, time to review | CI-10, CI-11, CI-12, CI-D1, CI-D2, CI-R | none | none | 3-5 |
| CI-V1 to CI-V5 | As the roadmap | As the roadmap briefs them; CI-V1 registers the route and components, and the `Sidebar.tsx` and command palette entries land in CI-V5 (Gates); CI-V4's gap list renders the not-read entry (open question 15) | As the roadmap; CI-V5 merges after CI-B and the bar gate | none | As the roadmap | |

Whichever of CI-10 and CI-R merges second wires the base-layer package into the run lifecycle;
until then CI-R's tests drive a stub core through the CI-8 contract. Before CI-R merges, CI-E's
runner scores CI-10 and CI-11 through `runUnstored()` (E10), so neither waits on CI-R. CI-12
derives its view from stored runs and the decisions on them (E9), and N1's gap entry needs a run
started from a Note, so CI-12 depends on CI-R.

### Done when

Every brief verifies with `pnpm test <path>` on its own tests, then `pnpm preflight`. A brief that
edits `website/` also runs `pnpm dlx mint broken-links` from `website/content/`.

- **CI-8.** Every channel in E10 is in the contract and `ChannelsAreExhaustive` passes; two fake
  runs serialize identically once ids and times are removed; the fake is absent when
  `app.isPackaged` is true.
- **CI-9.** The migration tests in Tests pass; a successful `db:restore` and a successful
  `db:restoreSnapshot` each replace every Case's generation, with one test per path showing that a
  revision read before the restore reads as out of date after it; `readCaseRevision()` and
  `get_case_revision` return the same triple; on the synthetic Case CI-2's generator builds
  (`pnpm eval:retrieval --eval-captures=1000`), a whole-Case reprocess and a Case Archive import
  are timed with and without the triggers and their change-log rows counted, both recorded in the
  engine assessment. The baseline runs on a copy of the built profile with the revision triggers
  removed by `DROP TRIGGER`, a change made to that copy only. The PR states where SQLite's
  `randomblob()` takes its seed, from SQLite's documentation, or writes generations with
  `crypto.randomUUID()` everywhere code rather than a trigger writes them (open question 20).
- **CI-9b.** A round trip carries every table; an archive imported twice remaps every id, those in
  `replaces` included; `persona_id` arrives NULL; a synced-table row with no author arrives with
  the archive's source installation as its author; an older build refuses the archive. An archive
  whose source Case has change-log rows imports, and the new Case's log holds only what the
  import's own triggers wrote.
- **CI-10a.** Each new field slices back to its value; `extractData()` output is unchanged on its
  fixtures; fixtures 1, 2, and 12 produce their records; the retrieval runner's index bytes and
  build time before and after are recorded in the retrieval assessment.
- **CI-E.** With `pnpm eval:engine --eval-captures=1000 --variant=a --engine=key`, every positive
  control in E18 fails the gate and the unwrapped key-backed fake passes it; that fake, which
  proposes every keyed Joint with a base-layer reach, scores recall 1.0 and a wrong-Joint rate
  equal to its unsupported keyed Joints over its proposals; the filler test passes; the assessment
  is started. The PR names the interface the network guard hooks (open question 17) and states
  whether #1796's `build.ts` serves as it stands, with any change it needed (open question 21).
- **CI-10.** With `pnpm eval:engine --eval-captures=1000 --variant=a --engine=real`, scored through
  `runUnstored()` (E10), E19's conditions 1 to 3 hold; thresholds are chosen and recorded (E20);
  the package's determinism tests pass and `pnpm lint:boundaries` passes; the PR adds the
  assessment rows open question 19 names.
- **CI-D1.** A member clears only their own flag; an Owner's clear of a revoked member's flag lifts
  the withholding; the eligibility view follows each; a second member's unmark leaves the first
  member's Own Identifier entry marked; a flag with a NULL holder whose author is another
  installation reads as that member's flag; in an imported Case, the importing Operator clears a
  flag whose author is the source installation with a new row they author, which lifts the
  withholding (open question 5). The PR lists every registered MCP tool with what it returns for a
  withheld Exhibit; for each tool that returns Exhibit content or values drawn from it, a test
  shows a withheld Exhibit listed with its mark and none of its content; and `mcp.mdx` states the
  rule.
- **CI-D2.** Accept is refused until the Joint has an available reviewed supporting span, one on
  each side for a Joint between two Subjects; every add, dismiss, and decision can be undone with a
  new row; two decisions by one member on one Joint, written in the same millisecond, resolve to
  the second through `replaces`; a same-name choice logs as one decision.
- **CI-R.** The roadmap's CI-R done-when, minus the same-name choice (moved to CI-D2); runs N1 and
  N2 start from Notes; a flag set mid-run invalidates it; a run left `running` by a quit reads as
  `failed` on the next start.
- **CI-11.** With the same command as CI-10, the engine's check and the runner's resolver agree on
  every span; fixture A3 reads unavailable. The check module sits under the blocking directory
  row CI-10 adds (open question 19).
- **CI-12.** With `pnpm eval:engine --eval-captures=1000 --variant=a --engine=real` on stored runs,
  every keyed gap is found; the network guard records nothing; a pinned Wayback Ref matches by URL
  and date; the local source trail finds a marked copy's original inside the Case, as the
  roadmap's CI-12 brief requires.
- **CI-13.** An exported Joint carries its decision's lineage; the Court exhibit preset omits
  Joints; an export scoped to selected Exhibits carries a Joint only when every cited Exhibit is
  selected, as `noteTravelsWithSelection()` rules for Notes.
- **CI-14.** The roadmap's CI-14 done-when.
- **CI-S.** The roadmap's CI-S done-when, plus: two members' independent proposals of one Joint read
  as one contested Joint; a Joint accepted after its proposer wrote later rows reaches a peer whose
  cursor for that author has already passed the Joint's first version; and a decision received
  before the Joint it names commits once the Joint arrives in the same session, while one whose
  Joint never arrives rolls the session back (E23, items 1 and 2).
- **CI-B.** With `pnpm eval:engine --eval-captures=1000 --engine=real` on stored runs, once with
  `--variant=a` and once with `--variant=b`, E19 holds in full; every unkeyed proposal is classified
  in its own commit; the time to review is recorded.

### Lanes and hot files

CI-9 is this plan's only migration and CI-9b its only Case Archive bump. The plan computes shared
passages at run time, so it adds no cache table; if CI-10's run cost argues for a passage cache,
that cache takes the migration lane in a brief of its own. Hot files: `fieldExtractor.ts` (CI-3,
then CI-10a), `captureRepo.ts` (CI-14 last, as the roadmap orders), `caseArchive.ts` (CI-9b takes
CI-9's place in the roadmap's order), and `export.ts` (CI-13 last). `ipc.ts`, `ipcHandlers.ts`, and
the preload only append, so a rebase resolves them.

### Changes to the roadmap's briefs

The maintainer took the four splits (items 1, 2, 3, and 8) on 2026-10-10 (open question 8). The
rest take effect only if the maintainer approves this plan.

1. **CI-9 splits into CI-9 and CI-9b,** so the migration lane frees before the archive work and each
   PR is smaller to review. CI-9b holds the Case Archive lane, adds the repositories, and merges
   before CI-D1, CI-D2, and CI-R (E5).
2. **CI-10a splits out of CI-10.** It extends CI-3's extractor and CI-4's build service, needs no
   migration, and runs in wave 4.
3. **CI-D splits into CI-D1 (Exhibit-level marks) and CI-D2 (Joint, span, and Subject decisions).**
   The MCP gate blocked "the first brief that lets an Operator set the flag", which is CI-D1 alone,
   so CI-D2 never waited on that ruling, which the maintainer gave on 2026-10-10. CI-D1
   implements it.
4. **The run's single revision-checked write moves from CI-D to CI-R,** because that write is where
   a run is stored or invalidated.
5. **The same-name choice moves from CI-R to CI-D2.** It writes a span decision and starts a Joint
   in one transaction, with no run.
6. **Adding and keeping Subjects by hand goes to CI-D2.** The spec needs both (starting Subjects,
   "keeps the Subject by hand"), and no roadmap brief names them.
7. **CI-E gains the faulty wrappers and variant B, and depends on CI-8;** its answer key merges
   before CI-10 starts. It runs the safety gate on a key-backed fake of its own instead of the CI-8
   fake the roadmap names (E18). It records every measure the spec lists except time to review,
   which moves to CI-B (E17), because timing one person's review means something only on the real
   engine's result.
8. **CI-B is new,** in wave 8: the bar confirmation run the CI-V5 merge waits on.
9. **CI-12 and CI-14 keep their roadmap dependencies,** with CI-9b in place of CI-9, because they
   seed rows through CI-9b's repositories. **CI-12 also depends on CI-R,** because its view and its
   keyed gaps need stored runs (Order of work). **CI-S depends on CI-R as well,** since the
   out-of-date rule must hold for decisions received by sync.
10. **The synced tables widen** from the five the brief names to ten (E2).
11. **CI-15, CI-16, and CI-17 are proposed later briefs** outside the waves (E12, E13).

## Evidence impact

None of these records is a custody event. No brief here writes a Manifest Entry or changes an
Exhibit byte, and the rows have the integrity of Notes and no more: anyone with write access to the
database can change one without a Manifest trace, and the change log records only that something
changed (ADR-0042, Consequences).

- **CI-9** puts a trigger in the write path of every Note, Selector, and Extracted Datum write,
  and, by the 2026-10-10 ruling on open questions 3 and 4, every `exhibits` and
  `exhibit_search_builds` write. A trigger that throws fails the write it guards: a Note save
  fails visibly, and `insertExtractedData()` runs in one transaction, so `runDataExtraction` logs
  `capture.extraction_failed` and that Capture keeps no Extracted Data while the ingest itself
  completes. The triggers also sit in three custody-adjacent paths. Capture delete runs inside
  `withDeletionEntry()` in `captureLifecycle.ts`, and its row delete cascades into
  `extracted_data` and sets `notes.capture_id` to NULL, which fires the Notes update trigger; a
  throw there puts the Capture's files back, rolls its `deletion` entry back, and the delete
  reports `rolled_back`. Case delete cascades through every input table, so a throw fails the Case
  delete. A Case Archive import fires the triggers inside its one transaction, so a throw rolls
  the whole import back. An `exhibits` trigger also sits in the path that writes each new Exhibit
  row, so CI-9's PR states what a throw there does to ingest and to a Staging Pool commit. The
  `exhibits` delete trigger and the cascaded `exhibit_search_builds` delete also fire inside the
  Capture delete path above and in Settings -> Database orphan cleanup, and a throw in an
  `exhibit_search_builds` trigger fails that Exhibit's field build, on ingest or in the
  Settings -> Database rebuild. CI-9 also changes both restore paths. Evidence-affecting by path
  (`db/**`).
- **CI-9b** changes the Case Archive format. An importer that drops a table loses the Operator's
  decisions without an error, so the round-trip and collision tests carry the PR. Evidence-affecting
  by path (`caseArchive.ts`).
- **CI-10** adds `url` to `CaptureChainEntry` in `src/shared/verify/**`, the verification core on
  the blocking tier, so its PR shows the chain verdicts unchanged. It also adds the run-input
  gathering that applies eligibility: a wrong read there sends withheld text into analysis, as for
  CI-D1. That module sits under `src/main/services/investigation/**`, which the maintainer put on
  the blocking tier on 2026-10-10 (open question 19), so CI-10 is evidence-affecting by path.
- **CI-D1** writes the only access control analysis has (ADR-0042). A wrong eligibility read sends
  withheld text into analysis, which fails the safety gate. It also decides what MCP tools return
  for a withheld Exhibit, and a tool the audit misses sends withheld content to an MCP client. This
  plan recommends that triage call it evidence-affecting.
- **CI-11** reports whether a span is present in stored bytes, the class retrieval plan Ruling 4
  treats as evidence-affecting.
- **CI-13** edits `export.ts`, blocking tier (ADR-0042, Consequences).
- **CI-S** accepts remote rows. Evidence-affecting.
- **CI-10a** adds search records under ADR-0044 and leaves `dataExtractor.ts` unchanged. Its PR
  carries `evidence-affecting` by the path backstop and says why in Evidence impact, as CI-3 and
  CI-4 do.
- **CI-12, CI-D2, CI-R, and CI-14** touch `db/**`, so the backstop fires; triage makes the call
  for each when it is filed. This plan's view: they derive, decide on, or store interpretations as
  Case data and alter no stored or anchored value. CI-R also owns the revision checks that decide
  whether a run that read a newly withheld Exhibit is stored, and it edits
  `src/main/services/investigation/**`, which is on the blocking tier (open question 19).
  Until CI-11 merges, a span the view shows carries no claim check (`check` is null), and no
  release shows the Investigate section before the base-layer bar is confirmed (Gates).
- **CI-8, CI-E, and CI-B** touch no blocking-tier path.

A claim check states that a span is present, absent, or cannot be checked in the stored bytes. It
does not show that the span is true or that the Joint holds (spec, "Product promise"). An accepted
Joint records the Operator's judgement.

## Tests

- **Migration (CI-9).** Every table, index, and trigger exists, and so does the view. Each input
  table's insert, update, and delete advances the counter by one and writes one log row of the right
  kind, including an edit through Settings -> Database to `notes` and `selectors`, a reprocess, and
  a cascaded delete of a Capture's Extracted Data. Moving a Note and a Selector to another Case
  through Settings -> Database advances and logs both Cases. An `UPDATE` that sets only `version`
  and `row_signature` on a synced table advances nothing. Deleting an MHTML Capture that has Notes
  and Extracted Data through the Capture delete path writes one `deletion` entry and reports
  `deleted`, not `rolled_back`. A Case delete with populated tables succeeds and leaves no row. An
  `INSERT OR IGNORE` the unique index skips advances nothing. The per-author unique indexes accept
  two authors and refuse one author twice. `ALLOWED_TABLES` is unchanged.
- **Generation (CI-9).** As CI-9's done-when, plus: a snapshot from before the migration gets fresh
  generations from the backfill, and an import gives the new Case a fresh generation and its
  imported runs read as out of date.
- **Revision read (CI-9).** A timestamp entry appended to `manifest.jsonl` changes the head on both
  paths.
- **Archive (CI-9b).** As CI-9b's done-when.
- **Contract (CI-8).** A fake run serializes the same twice; every array follows its canonical key
  order.
- **Fields (CI-10a).** As CI-10a's done-when.
- **Base layer (CI-10).** Each rule's hit and near-miss on hand-built inputs in the package's own
  tests; same-name fields propose nothing; common hosts propose nothing; Own Identifiers are never
  followed; a fragment-only difference proposes nothing; shuffled input gives identical proposals
  by identity hash.
- **Out of date (CI-R).** A run's own stored output leaves it current. A decision on its own
  proposal or on a span it surfaced leaves it current. A decision on a Joint from another run, a
  Note edit, a new Selector, a withheld flag, and a Manifest append each put it out of date.
- **Consistency (CI-R).** A revision change between batches stops a run as invalidated with nothing
  stored. A change caught by the stored write's check also invalidates. Cancel discards partial
  output and records `canceled`.
- **Heads (CI-D1).** Two marks with no replacement conflict; a choice replacing both resolves; an
  Owner clear of a revoked member's flag lifts the withholding; the eligibility view follows each;
  a second member's unmark leaves the first member's Own Identifier entry marked; a NULL holder
  reads as the row's author; in an imported Case, the importing Operator clears a flag whose
  author is the source installation with a new row they author, which lifts the withholding (open
  question 5).
- **Decision heads (CI-D2).** Two decisions by one member on one Joint, written in the same
  millisecond, resolve to the second through `replaces`; another member's decision replaces
  neither.
- **Runner (CI-E).** The scorer on hand-built results; each positive control fails its clause; no
  fixture string in the filler; reserved hosts only.
- **End to end (CI-B).** I1 on the synthetic Case gives the spec's useful result: the identifier and
  shared-passage Joints, the two Rowan Pikes apart, the unsupported Note claim and the missing
  paraphrase coverage in the gap list, and every span opening at its Content Hash.

## Gates this plan waits on

These come from the roadmap's gates table, and they are the maintainer's to decide. On 2026-10-10
the maintainer ruled on five of them and sent the Withheld from analysis mark to a designer brief;
the third column states each ruling, and for the gates still open, this plan's recommendation with
its evidence.

| Gate | Blocks | Ruling or recommendation |
| --- | --- | --- |
| Approve the CI-P engine plan (#1805) | CI-8 onward, including CI-9b, CI-10a, CI-D1, CI-D2, CI-R, CI-E, and CI-B | Open: the maintainer reads this plan and approves it on PR #1805 |
| Pick the synthetic Case size | CI-2's baseline, CI-5, CI-9's trigger timings, every engine run | **Ruled 2026-10-10:** 1,000 Captures, for CI-2's baseline and every engine run. The spec sizes its design for "a Case of about 1,000 Exhibits", and PR #1796 already ingested 1,000 pages in 24.1 s |
| Sign off `checkFieldHit` (retrieval plan, Ruling 4) | CI-6's merge, and through it CI-7 and CI-11 | Open. None; this plan only depends on it |
| Pick #598's direction (a utility process, or extraction moved off the capture's critical path) | CE-10 in the roadmap; here, the fallback if CI-10's longest batch freezes the app for too long, which moves the engine off the main process in that direction (E7) | **Ruled 2026-10-10:** extraction runs in a utility process (CE-10), and CI-4's field build may share it, so the engine's fallback (E7) is a utility process too |
| How the Investigate section stays out of releases | CI-V1's merge | **Ruled 2026-10-10:** option (a). CI-V1 registers the route and components, and the `Sidebar.tsx` and command palette entries land in CI-V5. It adds no pattern, and the fake engine's packaged-build rule (E10) fits it |
| Design the Withheld from analysis mark | CI-14 | **Routed 2026-10-10:** the mark goes into the designer UI brief for the Capture Session panel (CE-U in the roadmap; launched-browser spec, D19 and D22), with the investigation header's "not read" count (open question 15). The design itself still gates CI-14 |
| Whether MCP tools return withheld Exhibits (ADR-0044, #547) | Under this plan's split, CI-D1's merge | **Ruled 2026-10-10:** MCP tools list a withheld Exhibit with its mark and never return its content or values drawn from it, and the brief that implements the ruling audits every registered tool. CI-D1, the first brief that lets an Operator set the flag, is that brief. ADR-0044 notes that an MCP client is often a model whose provider sits outside the in-app consent, and the spec keeps withheld text from every provider. The tools that return Exhibit content or values drawn from it include `get_capture_text`, `get_capture_html`, `get_capture_screenshot`, `get_exhibit_file`, `search_captures`, `search_extracted_data`, and `list_extracted_data` |
| Approve the Shared Case amendment (E23), and rule on #543 for syncing Own Identifiers with the marking member's Member Code | CI-S | **Ruled 2026-10-10:** E23 approved as proposed, item 6 included: Own Identifiers sync per holder with the marking member's Member Code, and no Persona label or note syncs, which rules #543 for that case. The filter cannot work without the entries. CI-P's PR applies E23 to the collaborative cases design |
| Confirm the base-layer bar and the safety gate on the synthetic Case | CI-V5's merge and any release showing the Investigate section | Open. Read CI-B's results |
| The local model and runtime ADR, and the view brief's open gaps G3 and G7 | The AI layer and later view states | Open. None; this plan stores run records without deciding whether they reopen (G3) |

## Open questions, ruled 2026-10-10

The maintainer ruled on these on 2026-10-10, and each ruling took this plan's recommendation.
Questions 17, 20, and 21 needed no ruling: each is a check that CI-E or CI-9 makes, listed in its
done-when. Where a ruling departs from ADR-0042 (open questions 2, 3, and 4), the brief that
implements it amends ADR-0042 in the same PR, so no code ships against an unamended ADR.

1. **Where do Own Identifiers live?** ADR-0042 keys them to the Case, and Case delete and the Case
   Archive follow that. The accepted mock edits them in Settings beside Personas (feasibility
   assessment, S9), and a Persona is installation-wide, so per-Case rows make the Operator mark one
   Persona's account again in each Case. **Ruled:** per-Case rows, as ADR-0042 has them and the DDL
   writes them, with the Settings screen listing entries grouped by Persona and Case and writing to
   the Cases the Operator picks. An installation-wide table would put every Case out of date on
   each change, would sync a Shared Case's members the Operator's accounts from unrelated Cases,
   and needs an ADR-0042 amendment.
2. **Does the change log travel in a Case Archive?** ADR-0042 lists it among the records an archive
   carries. Carried as it is, it breaks the import of any Case that has log rows: the import's own
   triggers write the new Case's first counters in the same transaction, and the archived rows
   collide with them (E5). After import the Case also has a new generation, so every imported run
   reads as out of date and no archived log row answers anything. **Ruled:** the log stays out of
   the archive, the import's triggers write a fresh one, and CI-9b's PR amends ADR-0042's wording.
3. **Do `exhibits` writes move the counter?** ADR-0042's input list leaves `exhibits` out, because
   Manifest Entries cover Exhibits. In a Shared Case, SC-2b inserts a received Exhibit's rows while
   its Manifest entry sits in another member's chain file, and this installation's head moves only
   at the `merge` entry. **Ruled:** yes; CI-9 adds `exhibits` triggers (E3), and CI-9's PR amends
   ADR-0042's input list to name `exhibits`, since that list fixes which inputs move the revision.
4. **Do field-record builds count as run inputs?** A rebuild from Settings -> Database clears and
   rebuilds `exhibit_search_fields` (retrieval plan D5), so a run reading during it can miss records
   with no revision change. **Ruled:** yes; writes to `exhibit_search_builds` join the revision
   triggers (E3), and CI-9's PR amends ADR-0042's input list to name them. That is one row per
   Exhibit build, and a rebuild then puts runs out of date, which is true of what they read.
5. **Whose decisions are imported rows?** A row with a NULL author means "this installation", so an
   imported decision would read as the importer's. **Ruled:** the importer stamps the archive's
   source installation on every row that has no author (E5), and the importing Operator, as the new
   Case's only member, may clear an imported flag as a recorded action under the Owner rule.
6. **Do Selectors become search keys?** ADR-0042 makes them a run input, and the spec's step 2 reads
   them, but its list of search keys does not name them. **Ruled:** none in the first slice;
   `investigation_run_basis` records the enabled Selectors.
7. **Does a decision received by sync on this run's proposals put the run out of date?** **Ruled:**
   no, following ADR-0042's wording, and the Shared Case amendment states it (E23, item 10).
8. **Are the brief splits worth the extra pull requests?** CI-9b, CI-10a, CI-D2, and CI-B add four
   PRs to a queue the maintainer reviews, with at most two evidence-affecting PRs waiting at once
   (ADR-0045). **Ruled:** take all four, for the lane and gate reasons in "Changes to the roadmap's
   briefs".
9. **Does the fake engine stay out of packaged builds?** **Ruled:** yes; `ipcHandlers.ts` registers
   it only when `app.isPackaged` is false, and CI-V5 removes it.
10. **How large are `investigation_run_candidates` rows per run?** The spec lists candidate locators
    in the run record. **Ruled:** runs store every candidate locator, and CI-10 reports bytes per
    run; if the size is too high, runs keep only cited candidates and counts, recorded as a change
    to the spec.
11. **Must the bar be confirmed on material the thresholds were not set on?** The decided bar does
    not say so; the spec requires separate material only for admitting an AI provider. **Ruled:**
    yes; thresholds are set on variant A and the bar is confirmed on variant B, because thresholds
    chosen on variant A can fit its planted pages. CI-E builds variant B by varying the planted
    pages; #1796's seeded filler alone does not.
12. **Is a same-field Joint about one Subject, or between the named Subject and the identifier?**
    The rule's text says one Subject ("Jun Sato used calloway@harrow.example", citing one span),
    while the spec's sketch draws "used address" as a line between a person and an account Subject.
    **Ruled:** one Subject, as the rule's text says, shown as a tab under that Subject. The
    feasibility assessment already draws a single-Subject Joint that way (item 8), and an account
    Subject the Operator created joins other Subjects through the shared-identifier rule.
13. **When the misleading passage contains a header-shaped block, is the Joint the base layer
    proposes from it a safety-gate failure or a wrong Joint?** The base layer reads structure,
    never instructions, and fixture 13 shows the same structure in genuine forwarded mail.
    **Ruled:** a wrong Joint (fixture A4, keyed unsupported); the safety gate covers any proposal
    citing the instruction text itself.
14. **May evaluation pages tie a pseudonym to a handle on a real platform?** The Accounts rules
    recognize only real platforms, and an invented handle there may belong to a real person.
    `dataExtractor.test.ts` already uses an invented handle on a real platform, but the evaluation
    pages would tie it to a named pseudonym in narrative text. **Ruled:** no. The runner adds a
    profile-URL rule for an invented platform on a reserved example host through the engine's
    dependencies, and the real-platform rules keep their unit tests.
15. **How does the view disclose Exhibits the first slice does not read?** E12 leaves PDF and `mbox`
    Exhibits unread, and the header's read count would otherwise omit them without saying so.
    **Ruled:** a "not read" count beside "read" and "withheld" in the header (feasibility
    assessment, S2), and a gap-list entry in the "searches not yet run" group that names the unread
    kinds. The header count goes, with the Withheld mark, into the designer UI brief for the
    Capture Session panel (CE-U in the roadmap; Gates); the gap-list entry naming the unread kinds
    is a designer item.
16. **Does changing a threshold change the rule version?** The spec's determinism sentence names
    rule versions, not parameters, and its "same Joint" includes the rule version, so a version
    change makes the next run propose every claim again as a new, undecided proposal. **Ruled:**
    no; thresholds are run parameters under their own parameter-set version, recorded in every run
    record and in the determinism comparison, the rule version changes only when a rule's matching
    logic changes, and decisions carry across a threshold change. A threshold changes which pairs
    qualify, and leaves what a Joint claims as it was.
17. **How does the runner's network guard see every request?** E18 states the requirement and a
    positive control but names no Node or Electron interface, because none was checked for this
    plan. **A CI-E check, no ruling needed:** CI-E chooses the interface and names it in its PR,
    and its control proves the guard fires (CI-E's done-when).
18. **Which Notes are "relevant" for a run's Notes snapshot?** The spec's step 1 says "a snapshot of
    the relevant Notes" without defining relevant, and the base layer takes search keys only from
    a Note passage the Operator selects (step 2). **Ruled:** the first slice records that passage
    alone in `investigation_run_basis`; the AI layer, which reads claim-bearing Notes, widens it.
19. **Which tier do the new engine paths take?** The
    [evidence-affecting paths assessment](../specs/2026-07-31-evidence-affecting-paths-assessment.md)
    gives the advisory tier to a path that is "real evidence surface, but ... shared with a lot of
    code that is not" ("Tiers"). No engine path is shared that way, so each is blocking or off the
    list. **Ruled:** the two rows below, which CI-10 adds.
    - `src/main/services/investigation/**` is blocking. The module there that gathers run input
      reads rows through the eligibility view, reads the files those rows name, and runs the
      revision checks; a wrong read sends withheld text into analysis, the failure this plan calls
      evidence-affecting for CI-D1. CI-11's claim-check module, the Ruling 4 class, lives there too.
      Every eligibility query stays in a repository under `db/**`, which is already blocking.
    - `src/packages/investigation-base-layer/` goes on the assessment's "Notable exclusions" list,
      with this reason in its row: it touches no database and no file, so it cannot read a withheld
      Exhibit or change a stored byte; it proposes only from the input the gathering module hands
      it; from CI-11 on the check module checks every span it cites before the view shows that span
      as support; and no release shows the Investigate section before the base-layer bar is
      confirmed (Gates).
    - CI-10 adds both rows, after CI-8's fake engine has merged into that directory. CI-V5's
      removal of the fake then trips the backstop, which fits a PR that puts the real engine behind
      the view.
20. **Is `randomblob(16)` a sound generation value?** The 2026-10-10 run showed distinct values per
    Case, and this plan did not check where SQLite's generator takes its seed. **A CI-9 check, no
    ruling needed:** CI-9 confirms the seeding against SQLite's documentation, or writes
    generations from JavaScript (`crypto.randomUUID()`) everywhere code rather than a trigger
    writes them (CI-9's done-when).
21. **Can CI-E reuse #1796's rendering and ingest code as it stands?** This plan read #1796's body,
    file list and review comments, not `build.ts` in full. **A CI-E check, no ruling needed:** CI-E
    confirms the reuse once CI-2 merges, and states any change it needs in its PR (CI-E's
    done-when).
22. **What does "two runs on the same state propose the same Joints" require?** Byte-equality of
    the whole result, with ids and times removed, is stricter than the spec's sentence: it also
    covers surfaced spans, passage groups, holder counts, and order. **Ruled:** the same identity
    hashes, each citing the same spans (E17, E19), which is what the spec's sentence says; the
    runner reports byte-equality as a diagnostic.

## Progress

- **2026-10-10.** First version of CI-P. The DDL, triggers, and view in E1, E3, and E8 ran against
  the app's SQLite. CI-2 (PR #1796) is open with review findings to fix, and the synthetic Case size
  is not chosen.
- **2026-10-10, revised.** An adversarial review found defects in the archive import, the holder and
  head rules, sync order, the update trigger, the evaluation's reach and controls, and brief
  ordering. This revision fixes them where each appears, adds fixture A6, run I4, and open question
  22, and adds the #598 gate to the gates table.
- **2026-10-10, rulings.** The maintainer ruled on every open question that needed a ruling, each
  as this plan recommended, and on five gates: the Case size, #598's direction, how the Investigate
  section stays out of releases, MCP tools and withheld Exhibits, and the Shared Case amendment.
  The Withheld from analysis mark went to the designer UI brief for the Capture Session panel, and
  questions 17, 20, and 21 became checks in CI-E's and CI-9's done-when. This revision records each
  ruling where its question or gate appears and applies E23 to the collaborative cases design. The
  plan as a whole still waits on approval.
- **2026-10-17, CI-8 (#1885).** `src/shared/investigation.ts` holds E10's types, the view types CI-8
  defines, and `sortInvestigationView`, which sorts every array whose order carries no meaning by a
  key that uses no run id and no time, the Subject ids on a same-name span and on a gap entry by id.
  Four arrays keep their order, which carries meaning: a Joint's Subjects, a path's Joints and its
  Subjects, and the changes since a run. The 18 `investigation:` channels are in the IPC contract,
  the preload, and `src/renderer/lib/api/investigation.ts`, and `event:investigationProgress` is in
  the first two. `InvestigationEngine` is in `src/main/services/investigation/engine.ts`, and the
  fake engine beside it serves every channel from `src/shared/investigationFixture.ts`.
  `ipcHandlers.ts` registers the fake only when `app.isPackaged` is false. The fixture lives under
  `src/shared/` because the renderer test project declares no `@main` path. Where E10's text left a
  gap, CI-8 departs from it: `RunProgressEvent` carries `status` and `reason`, and a run's last
  event names its outcome; `InvestigationView` lists the withheld Exhibits with the members holding
  each flag; `chooseSubject` takes `choose`, `none`, or `undo`, the same-name values in E1;
  `SpanView` carries the Exhibit's Source Class, the span's dates, who added it, and its copy mark;
  `JointView` carries its identity hash and a fifth list, the dismissed spans; `getSpan` returns a
  `SpanDetail` that carries the Exhibit's Integrity Status; `CaseRevision.manifestHead` restates
  `ManifestHeadRef`, which `src/shared/` cannot import; and every channel's arguments carry the Case
  id, as `exhibits:verify` takes one, because the fake keeps one copy of the fixture per Case under
  the same ids.
- **2026-10-17, CI-10a (#1890).** The maintainer approved this plan on PR #1805 on 2026-10-11.
  CI-10a moved the field extractor to `fields/2` with the E11 fields, and the retrieval runner now
  measures the field build; the retrieval assessment has the figures. Where it departs from E11 or
  decides what E11 leaves open: `header.path` gives one record per site, none for the tail entry or
  an empty entry, and the site after a diagnostic keyword such as `.POSTED` (RFC 5536, section
  3.1.5); `header.references` gives one record per identifier in angle brackets; To and Cc give a
  group's mailboxes without its name or closing `;`; `text.address` reads header lines too, so an
  address there gives a header record and an address record, and a Message-ID written like an
  address reads as one, as `extractData()` reads it, but an address is never found inside a longer
  one; `image.src` gives no record for a `data:` or empty source; `text.url` uses the extractor's
  own pattern for `http` and `https` addresses, without the closing punctuation; `id.tracking` and
  `id.crypto` read the whole decoded part, scripts included. A value `extractIocs()` returns is
  recorded where it is a whole run of letters, digits, `_` and `-`, or ends one after a `-` or `_`.
  A Tracking Code rule's match is recorded where the rule finds it, as `extractData()` finds it,
  with a letter or digit beside it or not, and the Facebook Pixel rule reads at most 128 characters
  from each `fbq`. Headers come first, in block order, the four `fields/2` adds among them; then the
  links; then the other new kinds. The row ceiling drops those last kinds first, and a block's new
  headers can reach it before its `fields/1` headers. After the #1899 review, each new kind is read
  in one pass that stops at the row ceiling. A header name now takes any printable character but a
  space or colon (scope added to #1890 from the #1884 review). The Links tab marks a row only for a
  link target or alt text hit.
- **Next.** CI-9, CI-E, and CI-V1, each against this contract. The gates still open are in "Gates
  this plan waits on".
