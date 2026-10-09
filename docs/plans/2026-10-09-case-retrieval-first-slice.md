# Case retrieval, first slice: link and header search, exact checks, and an unreviewed view

Plan only. Nothing here is built. It plans the "Smallest first slice" of
[the Case retrieval pipeline spec](../specs/2026-10-02-case-retrieval-pipeline-design.md), under
[ADR-0044](../adr/0044-case-search-indexes-are-rebuildable-caches-outside-the-manifest.md), which
places the new search records in the app's database as a rebuildable cache outside the Manifest.

## Goal

Three things the Operator cannot do today:

1. **Search the fields Extracted Text leaves out.** A link target, an image link's alt text, and
   an identity-bearing mail header are searchable within one Case, beside the existing Extracted
   Text search. Each hit names its Exhibit Number and Content Hash, and opens the Capture at the
   span it came from.
2. **Check a hit against the stored bytes.** One action re-reads the stored Exhibit and reports
   `present`, `absent`, or `cannot-check`, with the reason.
3. **See what nobody has looked at.** A review view lists committed Captures with no Note and no
   Persisted Match, grouped by `From`, `Reply-To`, link host, and identifiers that appear in few
   Captures.

The slice uses no model, vector extension, remote call, generated prose, or new public API. It
measures itself on a synthetic Case, so the spec's later decisions (embeddings, more
representations) rest on numbers.

Out of scope: PDF page text, `mbox` messages, headers-only Exhibits, uploaded files, Staging Pool
search, `exhibit.search` over the MCP server, and locators for Extracted Text hits (D6). The
Withheld from analysis mark waits for ADR-0042's storage (D9).

## What exists today

- **Extracted Text search.** Each Capture has a `capture_texts` row holding its title, URL, and
  Extracted Text, and triggers keep the external-content FTS5 table `captures_fts` in step
  (migration 25). `searchCaptures()` in `captureRepo.ts` passes the query to `MATCH` and returns
  ranked Capture rows with no span. The search bar (`SearchBar.tsx`, through `useSearch`) lists
  those rows and the Notes search results.
- **Punctuation in a query.** FTS5 reads `.`, `@`, `:`, and `-` in a bare term as syntax, so a
  search for `example.com` or an email address fails (#1590, `ready-for-agent`, not queued). Its
  agent brief quotes such a term as a phrase in all three search paths.
- **Extracted data.** `extractData()` in `dataExtractor.ts` pulls emails, domains, account handles,
  and tracking codes from a Capture's HTML into `extracted_data`, which has its own FTS5 table. It
  runs after each ingest (`runDataExtraction` in `captureLifecycle.ts`) and on reprocess
  (`EXTRACTED_DATA_REPROCESS`). Rows carry no locator. Unlike the records this plan adds,
  `extracted_data` travels in a Case Archive (`importExtractedDataRows`). ADR-0044's context
  names `captures_fts` as the only index and does not mention this table; its decision does not
  depend on that.
- **Links.** `linksFromMhtml()` in `captureLinks.ts` parses a stored page's text/html parts with
  cheerio for the Links tab (#1708), under part and row budgets, and collapses repeats into one
  row. It computes on demand and stores nothing. A row carries the raw and resolved `href`, the
  anchor text or an image's alt, the frame, and the part's document URL, but no part number or
  offset.
- **Offsets.** cheerio 1.2.0, already a dependency, reports each element's and attribute's start
  and end offset in the parsed string when loaded with `sourceCodeLocationInfo: true`. Checked on
  2026-10-09 against the installed package.
- **Text anchors.** A Note can anchor to a passage of Extracted Text. `noteAnchorResolver.ts`
  resolves it against the `.txt` file and calls it `hash-verified` only when that file matches the
  text digest in the signed Manifest capture entry.
- **Extracted Text keeps line breaks.** The extension and the background renderer both take it
  from `document.body.innerText`.
- **Viewer.** The Capture viewer has Screenshot, Page, Text, Links, and Wayback tabs, and the
  active tab lives in the app store (`activeViewerTab`). The captures route takes only
  `captureId`. `CaptureTextPanel` lays the text out as paragraphs and highlights nothing.
- **Withheld from analysis has no storage.** The schema is at version 37, and no table holds the
  flag.
- **Demo fixture.** `scripts/build-demo-fixture.mjs` drives a real Electron window over invented
  pages in `scripts/demo-fixture/pages/` to produce genuine MHTML and a Case Archive.
- **Tiers.** `src/main/services/db/**`, `captureLifecycle.ts`, and `caseArchive.ts` are blocking
  tier on the evidence path list, so steps 0 and 2 to 6 trip the path backstop.

## Decisions

### D1. Records: a build table and a field table

Migration 38 adds two tables keyed to the Exhibit:

```sql
CREATE TABLE exhibit_search_builds (
  exhibit_id TEXT PRIMARY KEY REFERENCES exhibits(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  text_hash TEXT,
  extractor TEXT NOT NULL,
  built_at TEXT NOT NULL,
  outcome TEXT NOT NULL,   -- 'built' | 'partial' | 'no-source' | 'failed'
  skipped_json TEXT        -- parts the budgets refused, counted by reason
);

CREATE TABLE exhibit_search_fields (
  id INTEGER PRIMARY KEY,
  exhibit_id TEXT NOT NULL REFERENCES exhibit_search_builds(exhibit_id) ON DELETE CASCADE,
  case_id TEXT NOT NULL,
  field TEXT NOT NULL,     -- 'link.href' | 'link.alt' | 'header.from' | ...
  value TEXT NOT NULL,     -- exactly as stored
  norm TEXT NOT NULL,      -- the search form
  source TEXT NOT NULL,    -- 'html-part' | 'text'
  part INTEGER,            -- text/html part number in file order; NULL for 'text'
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);
CREATE INDEX idx_exhibit_search_fields_lookup ON exhibit_search_fields(case_id, field, norm);
```

The build row holds what ADR-0044 asks each record to carry: the Content Hash the records were
built from, and the extractor version, such as `fields/1`, whose parameters are fixed in code for
each version. Field rows inherit both through `exhibit_id`, which keeps the hash off every row.
Every Exhibit the builder processes gets a build row, including one with no fields, so "not built"
and "built, found nothing" stay distinct. A part the budgets refuse is counted in `skipped_json`,
not dropped, which is the Links tab's rule.

Deleting a Capture deletes its Exhibit row (`captureRepo.ts`), and the cascade takes both tables.
Case delete cascades the same way and writes no Manifest Entry (ADR-0001). No Case Archive
collector and no export reads either table.

### D2. Search form: a trigram index over `norm`

An identifier with punctuation must match as typed, including a domain inside a longer URL. An
FTS5 table declared with `tokenize='trigram'` over `norm` does that without the word splitting #1590
describes. The bundled SQLite is 3.53.4, and `trigram` has existed since 3.34. The table is
external-content over `exhibit_search_fields`, kept in step by triggers, the pattern migration 25
set for `captures_fts`. A query shorter than three characters falls back to `LIKE` on `norm`, as
`searchExtractedData` already does.

Trigram indexes are large. Step 1 measures bytes per Exhibit with SQLite's `dbstat` table, which
better-sqlite3 compiles in (`SQLITE_ENABLE_DBSTAT_VTAB` in its `defines.gypi`). If the size is
too high, the fallback is exact and prefix matching on the B-tree index in D1.

### D3. Link records come from the stored page, with offsets

A new pure module, `src/main/services/search/fieldExtractor.ts`, walks each text/html part that
`listHtmlPartsInMhtml()` returns, or a legacy `.html` Capture's one document, with cheerio and
`sourceCodeLocationInfo: true`. It writes:

- **`link.href`** for every `a[href]` and `area[href]`. `value` is the attribute as stored; `norm`
  is the URL resolved against `<base>` or the part's document URL. Its scheme and host are in
  lower case. The offsets cover the attribute value in the decoded part.
- **`link.alt`** for the `alt` of an `img` inside such a link, and of an `area`. This is the
  spec's "fact present only in an image link target" case.

`resolve`, `partDocumentUrl`, and the budgets move out of `captureLinks.ts` into a module both
files import. The Links tab keeps its collapsed rows, while the indexer keeps one record per
occurrence, because each occurrence has its own offset. Anchor text is not indexed, since
Extracted Text already holds it.

Offsets are UTF-16 code units into the string `decodePartBody` returns for that part. They are
not byte offsets into the MHTML file, and the locator says so: it names the part, the decoder,
the extractor version, and the span. That is the spec's "parser version and a reproducible field
path plus span."

### D4. Header records come from the `.txt` file

A mail header reaches a Capture as page text, for example on a webmail "show original" page,
and Extracted Text keeps its line breaks. The extractor scans the `.txt` file for a header block:
two or more consecutive `Name: value` lines, with folded continuation lines joined, including at
least one of `From`, `Reply-To`, `Sender`, `Message-ID`, `Path`, or `Received`. From each block it
records `From`, `Reply-To`, `Sender`, `Return-Path`, `Message-ID`, `In-Reply-To`, `Organization`,
`Newsgroups`, `NNTP-Posting-Host`, and `X-Originating-IP`. For an address, `norm` is the address
in lower case without its angle brackets or display name, and `value` keeps the text as stored.
The offsets index the `.txt` file, the coordinate a Note text anchor uses, and the build row
records that file's hash in `text_hash`.

Reading headers from the stored page instead was considered. It finds the same text, but its
offsets would land in markup, and the visible text would have to be recomputed the way Chromium
computes `innerText`. The `.txt` file is already bound to the Capture through the signed Manifest
entry, and the check in D7 reuses the binding `noteAnchorResolver.ts` already makes.

The header list comes from the spec (`From`, `Reply-To`, account identifiers) and lives in one
constant with a test.

### D5. When records are built

- **On ingest.** `runPostCaptureWork` in `captureLifecycle.ts` runs the field build after
  `runDataExtraction`, timed with `recordSlowOp` so Settings -> Diagnostics shows its cost. A
  failed build writes a `failed` build row and a log entry. It never fails the ingest.
- **Existing Captures.** `ensureCaseFields(caseId)` builds each Exhibit with no build row or an
  older `extractor`, yielding between Captures as `reprocessCase` does. It runs when the Case
  workspace opens (an IPC call from the renderer, so `session.ts` stays untouched), after a Case
  Archive import, and on reprocess.
- **Rebuild.** Settings -> Database (`DB_REBUILD_FTS`) clears both tables and rebuilds them with
  `captures_fts`, as ADR-0044 says. `rebuildFts()` is synchronous today, so the field rebuild
  runs after it returns, and the result reports both counts.

### D6. What search returns

A new IPC channel, `search:fields`, returns `FieldHit` rows: the Case and Exhibit ids, the Exhibit
Number, the Content Hash, the field, the value, a short preview, and the locator. Before it returns
a hit, the query compares the build row's `content_hash` with the Exhibit's current one, and a
mismatch comes back as unavailable, never as a hit (ADR-0044). The search bar adds a group beside
Captures and Notes, labelled by field, such as **Link target**, **Image alt text**, or **From header**. Each row
names the Exhibit Number and the first 12 characters of the Content Hash.

Extracted Text hits keep their shape and gain the Exhibit Number and Content Hash in the row. They
gain no locator in this slice: FTS5 reports no match offsets, and a query with `OR`, `NEAR`, or a
prefix has no single span. A later step can re-match the terms in the `.txt` file and build a
locator shaped like a Note text anchor.

### D7. Opening a hit, and the exact check

Opening a hit selects its Capture and tab through the app store. A header hit opens the Text tab
with the span highlighted and scrolled into view. A link hit opens the Links tab with the matching
row highlighted, and the row shows the part and offsets.

The check is a main-process function, `checkFieldHit(fieldId)`, behind an IPC channel:

1. The Exhibit row exists and its Content Hash equals the build row's. Otherwise the result is
   `cannot-check`, "the Exhibit changed after it was indexed."
2. The stored file hashes to that Content Hash, through the verification the Capture already has.
   Otherwise the result is `cannot-check`, with the verification status.
3. For an `html-part` record, decode the named part with the current decoder, slice the span, and
   compare it with `value`. For a `text` record, read the `.txt` file, require that it matches the
   signed Manifest's text digest as `noteAnchorResolver.ts` does, then slice and compare.
4. An equal slice is `present`. An unequal or out-of-range slice is `absent`, with the locator. A
   part that is missing or over budget is `cannot-check`, with the reason.

The result names what it compared, decoded page text or Extracted Text, and never says what the
source asserts. The view shows it beside the hit and does not store it.

### D8. The unreviewed view

A new view lists committed Captures in the Case that no live Note names and that have no
`selector_matches` row. A Note names a Capture through `notes.capture_id`, a Note anchor, or a
`capture` row in `note_references`; a Note with `deleted_at` set does not count. The view groups
the Captures four ways: by `header.from` value, by `header.reply-to` value, by link host from
`link.href`, and by identifiers in `extracted_data` (emails and accounts) found in at most N
Captures of the Case. A header or link row opens its span as in D7. An `extracted_data`
identifier has no locator, so its row opens the Capture only.

Where the view lives, and N, are questions for the maintainer (Q1, Q3).

### D9. Withheld from analysis

ADR-0044 rules that `searchCaptures()` needs no filter and that results gain the mark once
ADR-0042's tables exist. No such table exists at schema 37, and no issue tracks building one.
This slice ships without the mark, and step 7, which adds it, is blocked on that storage. The
evaluation's withheld cases wait with it.

### D10. The synthetic evaluation Case

`scripts/retrieval-eval/` follows the demo fixture: invented pages under
`scripts/retrieval-eval/pages/`, rendered by Electron into genuine MHTML and ingested through
`ingestMhtmlCapture`, plus generated filler pages up to a target size. Every person, site, and
document is invented. Nothing comes from the live investigation: no name, date, wording, or
structure.

The target pages cover the spec's evaluation list as far as this slice reaches:

| Page                                                                                   | Expected                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A fact present only in an image link's target and alt text                             | Found by field search, missed by Extracted Text search |
| An unannotated "show original" page whose `From` and `Reply-To` address no query names | Listed in the unreviewed view's header groups          |
| An address that appears in one Capture only                                            | Listed in the rare-identifier group                    |
| The same address written with other capitalization and surrounding punctuation         | Found through `norm`                                   |
| A pooled file holding the target address                                               | Absent from Case search                                |

Not covered by this slice: a PDF page, an `mbox` header, a headers-only Exhibit, an Exhibit
withheld before and after indexing, an AI-origin document, and a Note whose target Capture lacks
its phrase, which needs a claim check.

A runner ingests the Case into a fresh profile and records, for today's search and for the slice:

- whether the target Exhibit is in the top 5 and the top 20 for each query;
- index bytes per Exhibit, from `dbstat`, for `captures_fts` and for the new tables;
- full build time, and the incremental time for one new Capture;
- query latency at the median and at the ninety-fifth percentile over a fixed query set;
- how many Captures the unreviewed view lists;
- every hit's check result, counting `absent` and `cannot-check` as false locators, and expected
  targets not found as misses.

Query wording differs from the indexed wording, as the spec asks. The results go in a dated
assessment under `docs/specs/`.

## Order of work

Each step is one pull request.

| Step | Change                                                                                         | Blocking-tier paths                              | Files |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----- |
| 0    | #1590 as briefed: quote a term with punctuation in all three search paths                      | `db/**`                                          | 4-5   |
| 1    | Evaluation Case generator and runner; a baseline run on today's search; the assessment started | none                                             | 6-8   |
| 2    | Migration 38; `fieldExtractor.ts` and its tests; link helpers shared with `captureLinks.ts`    | `db/**`                                          | 7-9   |
| 3    | Field repository and build service; ingest hook, `ensureCaseFields`, rebuild, and import       | `db/**`, `captureLifecycle.ts`, `caseArchive.ts` | 8-10  |
| 4    | `search:fields`; the search bar group; opening a hit in the Text and Links tabs                | `db/**`                                          | 8-10  |
| 5    | `checkFieldHit` and its display                                                                | `db/**`                                          | 5-7   |
| 6    | The unreviewed view; the second evaluation run; the assessment finished                        | `db/**`                                          | 7-9   |
| 7    | The Withheld from analysis mark on hits and in the view. Blocked on ADR-0042's storage         | to be planned                                    |       |

Step 0 is independent and already briefed; it needs the `queued` label. Step 1 comes before the
schema so the baseline is measured on today's search alone.

## Evidence impact

Steps 2, 3, 4 and 6 add rows outside the Manifest and change no stored or anchored value: no
Manifest Entry, no Exhibit byte, and no Case Archive format. They touch blocking-tier paths, so the
path backstop fires, and each pull request says in its Evidence impact section why the change is
not evidence-affecting, as the #1590 brief does. Step 5 reports whether a span is present in
stored bytes, which is an interpretation of evidence, so this plan treats it as evidence-affecting
unless the maintainer rules otherwise (Q4).

## Tests

- **Link extraction.** A link in the main frame and in an embedded frame; `<base>`; an `area`; an image
  link's alt; a relative and an unparseable `href`; a quoted-printable part; offsets that slice
  back to the value in the decoded part; a part the budgets refuse, counted in the build row.
- **Header extraction.** A block with folded lines; a lone `From:` line in prose, which is not a
  block; CRLF and LF line endings; offsets that slice back to the value in the `.txt` file.
- **Migration 38.** The tables, the trigram table and its triggers; the cascade from Capture
  delete and Case delete; a Case Archive export without the tables, and an import that rebuilds
  them.
- **Search.** A Content Hash mismatch returns unavailable; capitalization and punctuation match
  through `norm`; a substring of a URL matches; a query under three characters falls back.
- **Check.** Each outcome, including a `.txt` file edited together with its database copy (the case
  `noteAnchorResolver.ts` guards against) and a missing part.
- **Unreviewed view.** A Note by each route (column, anchor, or reference) removes a Capture, a Note
  with `deleted_at` set does not, and a Persisted Match removes it.
- **End to end.** Search reaches a header hit and opens the Text tab at the span.

## Questions for the maintainer

1. **Where should the unreviewed view live?** Recommendation: a tab on the Data screen beside the
   extracted-data view, because it groups the same identifiers. The investigation view design
   has no such screen yet.
2. **Should a hit open as a highlighted span in the Text tab, or a highlighted row in the Links
   tab?** No screen does this today. Recommendation: yes for this slice, and the source inspector
   in the investigation view design can take it over later.
3. **How rare is a rare identifier?** Recommendation: found in at most 2 Captures of the Case,
   adjustable in the view.
4. **Is the exact check in step 5 evidence-affecting?** Recommendation: yes. It states whether a
   span is present in stored bytes. An Operator will read that as a statement about the evidence,
   so it should carry the maintainer's sign-off.
5. **What size should the synthetic Case be?** The spec asks for a "synthetic Case of comparable size." A round
   number of Captures is enough, and the plan records it as the evaluation size, not as a fact
   about any Case.
