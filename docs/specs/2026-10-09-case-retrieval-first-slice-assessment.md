# Case retrieval first slice: evaluation

**Status:** Baseline recorded, and the second field extractor version measured. Step 6 adds the
slice's own search.
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

Two of today's search paths answer each query:

- **Case search** is the search bar's Capture results (`searchCaptures`, over `captures_fts`).
- **Data search** is the Data screen's search over extracted values (`searchExtractedData`). It
  answers with values and the URLs they came from, in value order, so its rank is the order of
  first appearance.

For each query and path, the run records the rank of the first expected target among all the
path's results, whether it is in the top 5 and the top 20, whether every expected target came
back, how many results came back, and any error. It times 20 runs of each query that answered and
reports latency per query, so a query that starts answering after the slice does not change the
figures of the others. After a timed rebuild of `captures_fts`, the run records index bytes per
Capture from SQLite's `dbstat` table, the median time to re-index one Capture's text over 20
Captures spread across the Case, and how many committed Captures no live Note names and no
Persisted Match covers. The plan's locator checks and the unreviewed view's
groups have nothing to measure until steps 5 and 6. Since the second field extractor version
(#1890), the run also builds the Case search field records and measures them; the section on
that version says how.

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

## Field extractor `fields/2`, 2026-10-17

The second version of the field extractor (#1890, engine plan E11) adds To, Cc, Path and
References headers, image addresses, tracking codes and cryptocurrency addresses from the stored
page, and email and web addresses from the Extracted Text. To measure it, the runner now builds
the Case search field records after the timed `captures_fts` rebuild, through the pass the
Settings rebuild runs (`rebuildAllFields()`), and times that build. It then records the bytes of
every table and index whose name contains `exhibit_search`, the records per field, the build
outcomes, and the median time to build one Capture's records again over the same 20 Captures the
text re-index samples.

Each run built a fresh 1,000-Capture Case with `pnpm eval:retrieval --eval-captures=1000`: two
runs at commit `1d758124`, where the extractor was still `fields/1`, and two at `2833cfe1`, with
`fields/2`. Where the two runs of a version differ, both figures are given, first run first. The
`fields/2` runs predate commit `e3b3c3bc`, which reads each new kind in one pass that stops at the
row ceiling; the evaluation was not run again after it.

| Measure                                      | `fields/1`           | `fields/2`            |
| -------------------------------------------- | -------------------- | --------------------- |
| Field records                                | 17,762               | 18,739                |
| Full field build of 1,000 Captures           | 12.03 s and 17.47 s  | 19.96 s and 31.49 s   |
| Building one Capture's records again, median | 10.65 ms and 6.53 ms | 16.02 ms and 10.33 ms |
| Build outcomes                               | 1,000 built          | 1,000 built           |

Bytes per Capture for each table and index, as `dbstat` reports them:

| Table or index                             | `fields/1`      | `fields/2`      |
| ------------------------------------------ | --------------- | --------------- |
| `exhibit_search_builds`                    | 262             | 262             |
| `exhibit_search_fields`                    | 3,510           | 3,682           |
| `exhibit_search_fields_fts_config`         | 4               | 4               |
| `exhibit_search_fields_fts_data`           | 2,204           | 2,310           |
| `exhibit_search_fields_fts_docsize`        | 184             | 197             |
| `exhibit_search_fields_fts_idx`            | 12              | 12              |
| `idx_exhibit_search_builds_case_id`        | 53              | 53              |
| `idx_exhibit_search_fields_exhibit_id`     | 913 and 926     | 987 and 975     |
| `idx_exhibit_search_fields_lookup`         | 1,925           | 2,044           |
| `sqlite_autoindex_exhibit_search_builds_1` | 53 and 49       | 53              |
| All of them, from their summed bytes       | 9,122 and 9,130 | 9,605 and 9,593 |

Both versions recorded 14,763 `link.href` records, 2,993 `link.alt` records and one record each
for six headers. `fields/2` added 976 `text.address` records and one `header.to` record.

- **Size grew by about 5%.** The new records are addresses in page text. The Case's pages hold no
  web address in their text, no tracking code and no cryptocurrency address, and every image in
  them has a `data:` source, which `fields/2` does not record. So this Case measures what
  addresses in text cost, and leaves the size of the other new kinds unmeasured.
- **The build took longer in both pairs of runs.** The `fields/2` full build took 1.66 and 1.80
  times as long as the `fields/1` build of the same pair, and the one-Capture median 1.50 and 1.58
  times. `fields/2` reads each decoded part again with ioc-extractor and the tracking code
  patterns, and the text again with ioc-extractor and a web address pattern. The absolute times
  are rough: other work kept the machine's load average between 25 and 53 when it was sampled
  around the runs, and the `captures_fts` rebuild, which this version does not change, took
  between 53 ms and 328 ms across the four runs.

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
