# Case retrieval first slice: evaluation

**Status:** Finished. The baseline and the second run, which adds the slice's own search, are
recorded.
**Date:** 2026-10-09
**Audience:** Maintainer and implementers of the retrieval first slice.

This assessment records how the
[Case retrieval first slice plan](../plans/2026-10-09-case-retrieval-first-slice.md) measures its
work (D10, step 1), and the results of each run. The baseline measures today's search before any
step of the slice lands. Step 6 repeats the run on the same Case and adds the slice's own search.

## Method

### Pages and filler

`pnpm eval:retrieval` builds a synthetic Case through the product's own pipeline and measures it.
A Chromium window renders each page, saves it as MHTML, and `ingestMhtmlCapture` ingests it, so
each Capture has a signed Manifest Entry, a stored page, and an Extracted Text file, as in the
app. The extraction the app runs after an ingest runs too. `--eval-captures=<n>` sets the size,
and `--eval-phase=measure` measures a Case a previous run built.

Every page is fictional and says so on the page. Hosts are subdomains of example.com,
example.net, and example.org, which RFC 2606 reserves. The demo fixture's `.invalid` hosts would
not do here: the extractor rejects reserved top-level domains, so no `.invalid` address reaches
the extracted-data search, and the baseline would understate it.

Five target pages carry the facts the queries look for:

| Target            | What it tests                                                               |
| ----------------- | --------------------------------------------------------------------------- |
| `image-link`      | A host and a phrase present only in an image link's target and alt text     |
| `mail-header`     | An unannotated mail header whose `Reply-To` address and host no query names |
| `rare-address`    | An address that appears in one Capture only                                 |
| `address-variant` | The queried address in other capitalization and punctuation                 |
| `annotated-shop`  | The seller's own page, which a Note already names                           |

Generated filler pages make up the rest of the Case. Page `i` is the same on every run. The
filler carries the queries' decoy words at fixed rates, shared addresses, and 5 to 25 outbound
links, one in five of them an image link. A Note names 30% of the filler pages, and a Selector
matches the pages on one topic. One file goes to the Staging Pool and never to the Case.

### What is measured

Two of today's search paths answer each query in the baseline, and the second run adds a third:

- **Case search** is the search bar's Capture results (`searchCaptures`, over `captures_fts`).
- **Data search** is the Data screen's search over extracted values (`searchExtractedData`). It
  answers with values and the URLs they came from, in value order, so its rank is the order of
  first appearance.
- **Field search** is the slice's search over link and header records (`searchCaseFields`). It
  answers newest Capture first, not by relevance, and stops at 200 results, so its rank is the
  target's place in capture order.

For each query and path, the run records the rank of the first expected target among all the
path's results, whether it is in the top 5 and the top 20, whether every expected target came
back, how many results came back, and any error. It times 20 runs of each query that answered and
reports latency per query, so a query that starts answering after the slice does not change the
figures of the others. After a timed rebuild of `captures_fts`, the run records index bytes per
Capture from SQLite's `dbstat` table, the median time to re-index one Capture's text over 20
Captures spread across the Case, and how many committed Captures no live Note names and no
Persisted Match covers.

The second run also builds each Capture's link and header records after its extraction, as the
app does after an ingest. It times a full rebuild of those records and their index, and the median
time to build one Capture's records over the same 20 Captures. It runs the exact check of step 5 on
every Field search result of every query, and counts as false locators the results the check finds
absent or cannot check. It counts the unreviewed Captures through the read the unreviewed view
calls, at the view's opening limit of 2, and records each group's rows and Captures and whether the
planted pages sit where the plan's table expects. A second measure pass over the same built Case
repeats the timings.

The queries differ from the indexed wording:

| Query              | Text                                         | Expected          |
| ------------------ | -------------------------------------------- | ----------------- |
| `image-link-host`  | `northgate-ledger.example.com`               | `image-link`      |
| `image-link-alt`   | `payments desk Quillmere`                    | `image-link`      |
| `address-host`     | `tessellate-mail.example.net`                | `address-variant` |
| `whole-address`    | `c.hale.payouts@tessellate-mail.example.net` | `address-variant` |
| `address-capitals` | `C.HALE.PAYOUTS`                             | `address-variant` |
| `rare-address`     | `ada.penrose@larchfield.example.org`         | `rare-address`    |
| `plain-word`       | `Quillmere`                                  | `annotated-shop`  |
| `pooled-only`      | `reconciliation 7781`                        | no result         |

## Baseline, 2026-10-12

The baseline ran on `main` at commit `6724907d` with 1,000 Captures, the evaluation size the
maintainer set on 2026-10-12. It includes step 0: #1807 fixed #1590, so Case search reads a term
with punctuation as an exact phrase. Step 6 repeats this run at the same size.

- **Case search** answered all eight queries without an error. For the four queries that name an
  address or its host in page text (`address-host`, `whole-address`, `address-capitals`, and
  `rare-address`), the target was its only result. It returned nothing for `image-link-host`,
  whose host appears only in a link target, which Extracted Text does not hold. On
  `image-link-alt` it returned 5 pages, none of them the target. For the plain word it ranked
  `annotated-shop` first of 78, and it returned nothing for the pooled file's words.
- **Data search** gave the smoke runs' answers. For all five host and address queries it ranked
  the target first and returned 1 or 2 values. For the plain word, `annotated-shop` came at
  position 613. It missed the alt text and returned nothing for the pooled file's words.
- **Unreviewed Captures** were 631 of 1,000, and all four unannotated targets were among them.

| Measure                                                    | Value           |
| ---------------------------------------------------------- | --------------- |
| Build: render and ingest 1,000 pages                       | 24.2 s          |
| Case search latency, median, for each of the 8 queries     | 0.09 to 0.37 ms |
| Case search latency, ninety-fifth percentile, for each one | 0.11 to 0.59 ms |
| Data search latency, median, for each of the 8 queries     | 0.07 to 2.06 ms |
| Data search latency, ninety-fifth percentile, for each one | 0.12 to 2.40 ms |
| `captures_fts` tables, bytes per Capture                   | 631             |
| `extracted_data` and its FTS5 tables, bytes per Capture    | 4,952           |
| Full rebuild of `captures_fts`                             | 12.59 ms        |
| Re-indexing one Capture's text, median                     | 0.07 ms         |

Times from a single run are rough. The smoke run at the same size took 57.8 s to build, and its
search latencies were two to three times these, so step 6 should repeat its run before reading a
latency change as the slice's.

### What the baseline means for the plan

- **Identifiers in page text are findable today.** With step 0 merged, Case search returns the
  page that holds an address or host in its text, and Data search finds the same identifier as an
  extracted value. For those, the slice adds a position in the page, the check, and a field label
  in the search bar, not discovery.
- **A host only in a link target is findable on the Data screen alone.** Case search returns
  nothing for it, and Data search returns the value with no position. The slice's `link.href`
  records put it in the search bar with a position.
- **Alt text is findable nowhere today.** Neither path found `image-link-alt`, so the slice's
  `link.alt` records are new coverage.
- **The unreviewed set is large.** 631 of 1,000 Captures have no Note and no Persisted Match. The
  unreviewed view's groups have to shrink that list to something an Operator can read; step 6
  measures how far they do.

## Second run, 2026-10-17

The second run used the code at commit `32b86aeb`, which adds step 5's exact check and step 6's
unreviewed view to steps 2 to 4, on a Case of 1,000 Captures. A second measure pass then ran on the
same built Case. Both passes gave the same search answers, check outcomes and view counts; only
their times differ. Both ran under the shared lock that keeps the other sessions' pre-merge checks
and timing runs from overlapping them, and `uptime` gave load averages of 18.8, 18.7 and 25.8 over 1, 5 and 15 minutes on 18
cores as the first pass started, and 6.6, 14.9 and 23.9 as the second ended. Rendering and
ingesting the pages took 27.8 s with the field build included, where the baseline took 24.2 s
without it.

- **Case search and Data search** gave the baseline's answers to all eight queries, with the same
  ranks and the same number of results.
- **Field search** ranked `image-link` first, its only result, for `image-link-host`, the host
  that appears only in an image link's target and that Case search does not find. It returned
  nothing for `image-link-alt`: the query holds the alt text's words in another order, and field
  search matches the query as one phrase. It returned nothing for the four address queries, whose
  addresses are in page text and in no link or mail header. For `plain-word` it stopped at its
  limit of 200 results, and `annotated-shop` was not among them: the target pages are the oldest
  Captures, and field search lists the newest first. A query on the run's database found those 200
  to be link targets on 113 filler pages. It returned nothing for the pooled file's words.
- **The exact check** found all 201 Field search results present at their recorded place, so the
  run had no false locators. These are unaltered stored files; the check's own tests cover the
  altered ones. Six of the seven queries that expect a target are Field search misses:
  `image-link-alt`, the four address queries and `plain-word`.
- **The unreviewed view** listed 631 of the 1,000 Captures, the count the baseline's own query
  gave, and every one of them was under at least one row. None lacked current link and header
  records, and none had a partial build. The `From` and `Reply-To` groups each held one row, the mail
  header page under its `From` and its `Reply-To` address. The rare identifiers at the limit of 2
  were 7 rows over 3 Captures: `rare-address`, `address-variant` and the mail header page. One of
  the mail header page's rows is its `Message-ID`, which the indicator extractor reads as an email
  address. The link host group held 12 rows over 628 Captures. Its first row, since rows run from
  the fewest Captures, is `northgate-ledger.example.com` with the `image-link` page alone. A query
  on the run's database gave the other 11 hosts between 433 and 461 Captures each.

| Measure                                                     | First pass      | Second pass     | Baseline        |
| ----------------------------------------------------------- | --------------- | --------------- | --------------- |
| Case search latency, median, for each of the 8 queries      | 0.21 to 0.53 ms | 0.15 to 0.50 ms | 0.09 to 0.37 ms |
| Case search latency, ninety-fifth percentile, for each one  | 0.24 to 0.59 ms | 0.18 to 0.62 ms | 0.11 to 0.59 ms |
| Data search latency, median, for each of the 8 queries      | 0.08 to 2.21 ms | 0.05 to 1.81 ms | 0.07 to 2.06 ms |
| Data search latency, ninety-fifth percentile, for each one  | 0.12 to 2.37 ms | 0.07 to 2.04 ms | 0.12 to 2.40 ms |
| Field search latency, median, for each of the 8 queries     | 0.41 to 6.71 ms | 0.30 to 5.38 ms | -               |
| Field search latency, ninety-fifth percentile, for each one | 0.43 to 7.04 ms | 0.31 to 5.85 ms | -               |
| New tables and their indexes, bytes per Capture             | 9,228           | 9,245           | -               |
| Of which the trigram index's tables                         | 2,429           | 2,429           | -               |
| Of which the B-tree indexes on the new tables               | 2,998           | 3,015           | -               |
| Full rebuild of the field records and their index           | 3,450 ms        | 3,329 ms        | -               |
| Building one Capture's field records, median                | 2.26 ms         | 2.08 ms         | -               |
| Full rebuild of `captures_fts`                              | 14.29 ms        | 25.54 ms        | 12.59 ms        |
| Re-indexing one Capture's text, median                      | 0.13 ms         | 0.06 ms         | 0.07 ms         |
| The unreviewed view's read, median of 20                    | 53.6 ms         | 58.2 ms         | -               |

The new tables' bytes count `exhibit_search_builds`, `exhibit_search_fields`, the four
`exhibit_search_fields_fts` tables, and the four B-tree indexes on the two tables. All 1,000
build rows read `built`. For comparison, the `captures_fts` tables took 631 bytes per Capture and
`extracted_data` with its FTS5 tables took 4,952, as in the baseline; neither figure includes its
table's B-tree indexes. The slowest Field search query in both passes was `plain-word`, the one
that reached the 200-result limit.

### What the second run means for the plan

- **Field search finds the link-only host, with a position.** It is the one query where the slice
  adds discovery to the search bar: Case search misses the host, and Data search finds it without
  a position.
- **No path finds the alt text with this query's wording.** The slice records the alt text, but a query
  whose words come in another order does not match it, so the baseline's finding that no path
  finds `image-link-alt` still holds.
- **Field search's order is not a ranking.** Newest-first order put the seller's own page outside
  the first 200 results for a common word. Its first rank is not comparable with Case search's.
- **The check confirmed every result on an unaltered Case.** The 201 records it read slice back to
  the stored bytes. That shows nothing about a changed file or record.
- **The header and rare-identifier groups shrink the list; the link host group does not.** They
  point at 3 of the 631 unreviewed Captures, and those are the three unannotated planted pages
  that hold an address. The link host group lists 628 Captures, because every filler page links
  out, and sorts the one rare host first, where the fourth unannotated page, `image-link`, sits.
- **The new records cost about 9.2 KB per Capture.** That is close to twice what `extracted_data`
  and its FTS5 tables take. The trigram index is about a quarter of it; the field and build rows
  and their B-tree indexes take the rest. A Capture's records take about 2 ms to build, and the view reads
  1,000 Captures in under 60 ms at the median.
- **Search times sit near the baseline's.** The median ranges of Case search and Data search,
  whose code did not change, differ from the baseline's by at most 0.25 ms at either end. The
  baseline already called the times of one run rough.

## Smoke runs, 2026-10-10

Two runs proved the harness, at 60 and 1,000 Captures. They are not the baseline. They replace
the runs of 2026-10-09, which counted a target's rank among target pages only. Both runs gave the
same answer to every query; where their counts differ, both are given:

- **Case search** failed with an FTS5 syntax error on the five queries that contain `.` or `@`,
  the defect #1590 describes. On `image-link-alt` it returned 1 page at 60 Captures and 5 at
  1,000, none of them the target, because Extracted Text holds no alt text. For the plain word it
  ranked `annotated-shop` first of 8 results and first of 78. It returned nothing for the pooled
  file's words.
- **Data search** ranked the target first for all five host and address queries with 1 or 2
  values each. For the plain word it returned 3 values, and `annotated-shop` came at position 34
  of the pages those values came from at 60 Captures and at position 613 at 1,000, because Data
  search lists values, not pages by relevance. It missed the alt text, and returned nothing for the pooled file's
  words. Its results carry no position in the page.
- **Unreviewed Captures** were 39 of 60 and 631 of 1,000, and in both runs they included all four
  unannotated targets.

At 1,000 Captures:

| Measure                                                                 | Value           |
| ----------------------------------------------------------------------- | --------------- |
| Build: render and ingest 1,000 pages                                    | 57.8 s          |
| Case search latency, median, for each of the 3 queries that answered    | 0.26 to 1.12 ms |
| Case search latency, ninety-fifth percentile, for each of those queries | 0.31 to 1.20 ms |
| Data search latency, median, for each of the 8 queries                  | 0.22 to 6.56 ms |
| Data search latency, ninety-fifth percentile, for each of the 8 queries | 0.30 to 6.91 ms |
| `captures_fts` tables, bytes per Capture                                | 631             |
| `extracted_data` and its FTS5 tables, bytes per Capture                 | 4,952           |
| Full rebuild of `captures_fts`                                          | 32.49 ms        |
| Re-indexing one Capture's text, median                                  | 0.20 ms         |
