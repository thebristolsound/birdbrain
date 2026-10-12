# Case retrieval first slice: evaluation

**Status:** Started. The baseline waits for the evaluation size.
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
groups have nothing to measure until steps 5 and 6.

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

## Baseline

Not yet run. It waits for the evaluation size, the plan's open question.

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

## What the smoke runs mean for the plan

- **Identifiers are findable today, on the Data screen.** Hosts in link targets and addresses in
  page text already reach Data search as extracted values. For those, the slice adds a position
  in the page, the check, and an answer in the search bar, not discovery.
- **Alt text is findable nowhere today.** Neither path found `image-link-alt`, so the slice's
  `link.alt` records are new coverage.
- **The unreviewed set is large.** 631 of 1,000 Captures have no Note and no Persisted Match. The
  unreviewed view's groups have to shrink that list to something an Operator can read; step 6
  measures how far they do.
