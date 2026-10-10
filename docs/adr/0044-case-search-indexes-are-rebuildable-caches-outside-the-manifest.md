# Case search indexes are rebuildable caches outside the Manifest

**Status:** Accepted

**Date:** 2026-10-07

This record answers two follow-ups. The
[Case retrieval pipeline spec](../specs/2026-10-02-case-retrieval-pipeline-design.md) asks for an
ADR on the boundary of the search records it adds. The
[Case investigation engine spec](../specs/2026-10-02-case-investigation-engine-design.md) asks
whether the Operator's own Case search hides an Exhibit Withheld from analysis, which
[ADR-0042](0042-investigation-records-are-case-data-outside-the-manifest.md) left open. On
2026-10-07 the maintainer decided the second: Case search does not hide it. The maintainer
accepted this record on 2026-10-09. Nothing in it is implemented.

## Context

Case search runs over one index today. Each Capture has a `capture_texts` row holding its title,
URL, and Extracted Text, and triggers keep the FTS5 table `captures_fts` in step with that row
(`src/main/services/db/migrations.ts`). `searchCaptures()` in `captureRepo.ts` returns ranked
Capture rows. The `.txt` sidecar on disk is the authoritative copy of Extracted Text:
`rebuildFts()` in `dbAdmin.ts` heals `capture_texts` from it and rebuilds `captures_fts`. A Case
Archive carries the Capture rows and the sidecars but not the index. Import writes a
`capture_texts` row for each Capture, and the triggers rebuild the index. The Note references
index follows the same pattern: it never travels and is re-extracted on import, as the comment on
`CASE_ARCHIVE_SCHEMA_VERSION` in `caseArchive.ts` records. No Manifest Entry names either index.

The retrieval spec adds search records for fields Extracted Text omits: a link target, image alt
text, a mail or document header, PDF page text and metadata, and an `mbox` message boundary, each
with a locator into the stored Exhibit. The workflow brief it draws on calls such an index a
Derived File with a Derivation. [ADR-0023](0023-exhibits-are-the-unit-of-evidence.md) defines a
Derived File as computed from one parent Exhibit and recorded by a `derivation` Manifest Entry,
and a Case-wide index has many parents.

ADR-0042 makes Withheld from analysis the per-Exhibit control for analysis: no analysis reads a
withheld Exhibit, and analysis caches drop it before the next query. It leaves open whether the
Operator's own search hides one, and whether the retrieval spec's class-based search exclusion
becomes that flag or a fourth meaning of "exclusion."

## Decision

### Search records are a cache

- **Search records are rows in the app's SQLite database**, keyed to the Case and the Exhibit,
  beside `captures_fts`. Each records the Content Hash of the Exhibit it was built from, and the
  extractor or parser version and parameters that built it.
- **They are not Derived Files.** None writes a Manifest Entry, and this record adds no entry
  type. A hit is a pointer: before the view shows a span as found, it compares the Exhibit's
  current Content Hash with the one the record holds, and the exact check reopens the stored
  Exhibit. A hit whose hash no longer matches is unavailable until its records are rebuilt. A
  preview or snippet is never citable.
- **They are rebuildable** from the stored Exhibits alone. The rebuild in Settings -> Database
  rebuilds them with `captures_fts`, and a new extractor version rebuilds the records the old one
  built.

### Case delete, Case Archive, and export

- **Case delete** removes them with the Case's other rows and writes no per-row deletion entries,
  as [ADR-0001](0001-case-delete-skips-manifest.md) rules for Captures.
- **A Case Archive** does not carry them. Import rebuilds them from the imported Exhibits, as it
  already rebuilds `captures_fts` and the Note references index, so adding them does not raise
  `CASE_ARCHIVE_SCHEMA_VERSION`.
- **No export** carries them: neither an Evidence Package nor a Working Copy
  ([ADR-0010](0010-evidence-package-vs-working-copy.md)).

### Case search shows withheld Exhibits

- **The Operator's own Case search covers every committed Exhibit in the Case**, including one
  Withheld from analysis. A result from a withheld Exhibit carries a Withheld from analysis mark
  and still opens in the source inspector, so the Operator can read it and clear the flag.
- **Analysis searches apply ADR-0042's eligibility rule in the query.** A withheld Exhibit leaves
  every analysis query once the flag is set and returns when it is cleared, with no rebuild.
  A cache built only for analysis, such as the count of Exhibits that hold an identifier, drops it
  as ADR-0042 requires.
- **The retrieval spec's class-based search exclusion is withdrawn**, so "exclusion" keeps its
  three meanings. Withheld from analysis keeps an Exhibit from analysis and from every provider,
  Source Class marks AI-origin material (ADR-0042), a Shared Case `exclude` entry keeps an Exhibit
  out of exports, and disclosure labels in exports stay with
  [#543](https://github.com/thebristolsound/birdbrain/issues/543).
- **Staging Pool text stays out of Case search**, searchable in the pool view only
  ([ADR-0024](0024-a-staging-pool-outside-the-chain.md)).
- **Not decided here:** whether the read-only MCP server
  ([ADR-0038](0038-a-read-only-mcp-server-reads-a-case-from-a-separate-process.md)) and a future
  `exhibit.search` return withheld Exhibits. An MCP client is often a model whose provider sits
  outside the in-app consent, so that decision goes with the MCP and local API surface work
  ([#547](https://github.com/thebristolsound/birdbrain/issues/547)). A vector index for the AI
  layer is a model output under
  [ADR-0039](0039-ai-analysis-is-an-opt-in-layer-over-a-model-free-base.md) and needs its own
  record; this one covers lexical records only.

## Considered options

- **Manifest the Case-wide index as a multi-parent Derivation.** The chain would attest what was
  indexed, but ADR-0023 would need a Case-level Derivation with many parents, and every rebuild
  would write a Manifest Entry. The index attests nothing a reader cites, because every hit
  resolves to the stored Exhibit.
- **A Derived File per Exhibit for its field records.** It keeps ADR-0023's single parent, but
  every Capture would gain a Manifest Entry for each extractor version, and every reprocess would
  write more.
- **A separate search database file per Case.** It isolates the index, but Case delete, Case
  Archive, and restore would each need a path for it, and the records join to Captures and Notes
  in the main database. The retrieval spec keeps this shape for a later vector index only.
- **Hide withheld Exhibits from Case search.** The flag would mean the same thing everywhere, but
  the Operator would lose sight of material they hold, and every existing `captures_fts` query
  would need a filter. The maintainer rejected it.

## Consequences

- The retrieval first slice adds tables for the field records in a schema migration and leaves
  the Case Archive format unchanged.
- `searchCaptures()` needs no filter. Its results gain the withheld mark once the tables from
  ADR-0042 exist.
- The withheld mark on a search result is a design item for the Case search screen.
- The retrieval spec drops the step that declares search exclusions from its first slice, and its
  evaluation tests a withheld Exhibit where it tested an excluded one.
