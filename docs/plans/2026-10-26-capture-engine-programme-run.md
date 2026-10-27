# Capture engine programme: run log

**Status:** active

The handoff file for the interactive run that works programme 2 of
[the delivery roadmap](2026-10-23-delivery-roadmap.md), started 2026-10-26. The goal is the
done-when of programme 2 in the roadmap: the manifest schema release that carries first-slice steps 1
to 6 and 8 to 10, the ADR-0040 link fields and #586's schema step is tagged, and the three MHTML
viewer slices are done. Programme 3 (stage 2) is out of this run's scope unless the maintainer
extends it.

## State at start

Read from `origin/main` at `50966b79` and the issue tracker on 2026-10-26.

- **Shared Cases.** Its last pull requests are open (#1972, #1973, #1975). What remains is the
  maintainer's: merges, the close-out sync, and the release.
- **Plan approval.** #1803 merged with the `approved` label, and D17 merged as #1902.
- **Step 7.** Merged as #1911.
- **Schema 5.** `v1.0.1-beta.23` carries it, so the next number is 6, shared by step 1, ADR-0040's
  fields and #586's schema step.
- **Step issues.** Filed and `ready-for-agent`, not `queued`: step 1 #1904, step 2 #1907, step 3
  #1925, step 4 #1926, step 5 #1927, step 6 #1928, step 8 #1906, step 9 #1929, step 10 #1930.
- **Unfinished step 1 work.** The local branch `feat/1904-first-slice-verifier` holds a WIP save
  from 2026-10-18.

## Gates the maintainer owes

- **ADR-0040 (#1736).** Ruled 2026-10-26: accepted at schema 6. Recorded in #1977; its verifier
  step is #1976.
- **#586's schema step.** Ruled 2026-10-26: deferred to a later schema number once its design is
  approved, so it does not hold the schema-6 release.
- **The WARC protocol line.** Ruled 2026-10-26: the convention of the `browsertrix-crawler` project, HTTP/1.x lines and a
  `WARC-Protocol` header with the real protocol.
- **Re-encoded text bodies.** Ruled 2026-10-26: #1979 marks and states the limit, and spike #1983
  measures whether the browser can hand over the served bytes before step 9.
- **Exact text bytes.** Ruled 2026-10-26 on spike #1988: step 9 sends
  `Network.configureDurableMessages` on every session, keeps a text body only from a session where
  it answered, drops the re-encoded marker, accepts service-worker-answered page copies as body
  omitted, and applies the per-resource limit itself.
- **Private host names.** Ruled 2026-10-26 (slice 3 ruling 3): the shared rule refuses
  hosts with no dot and `.local`, `.internal` and `.home.arpa` names for the lookup and Capture link. #1990
  puts it in `localAddressKind`, so Recapture, Add URLs and redirects refuse the same names;
  the maintainer kept that scope on 2026-10-26.
- **Wayback answer wording.** Ruled 2026-10-26: count distinct content fingerprints and say "N
  different versions", or "at least N" at the row limit.
- **The link writer step.** Approved 2026-10-26 under ADR-0016, filed as #1995, built as a draft
  that merges after the tag.
- **The release tag** that carries step 1's verifier. Steps 6, 9, and 10 merge only after it.
  This run holds the tag for steps 3 and 4 as well, pending the maintainer's confirmation: the
  review of #1978 found that without them a Shared Case member never fetches the two new files
  and `verify.sh` checks neither.
- **Step 9 rulings, 2026-10-26.** A request reported finished with no response gets its own
  inventory count, `finishedWithoutResponse`, added to schema 6 in #1978. The extra
  `history.length` entry stays and is recorded as a known limitation. The 120 s limit and the 35 s
  reserve stay, and the recording phases shrink to the time left.
- **The stack after the new count.** Done 2026-10-26: #1980, #1981, #1982, #1984, #1985, #1996
  and #1997 merged #1978's new head with preflight green at each; no fixture or downstream digest
  needed changing, and #1985's report gained the finished-without-response row. #1999 merges #1996
  next, then #2000 and the #1843 branch.
- **Step 10 rulings, 2026-10-26.** The final-artifact reserve rises to 40 s for the print, leaving
  80 s for load and scroll. The dev-only packages pdf.js pulls in (`@napi-rs/canvas` 0.1.100, its
  platform packages, and a stream helper) are accepted.
- **Step 6 and #1843 in one release.** Ruled 2026-10-26: no release carries step 6 without
  #1843, because step 6 signs zero pinned-image counts that read the same as a pinning pass that
  ran and found nothing.
- **The link source id.** Ruled 2026-10-26: `linkedFromCaptureId` signs the source's signed entry
  id, as deletion does since #1815, not the row id.
- **The replaced-header ordering.** Open: whether schema 6 refuses an unsorted or repeated
  `replacedHeaders` list, which D2's self-contradiction rule does not cover.
- **Merges.** Every step is `evidence-affecting`, so each needs the maintainer's approval at head.

## Slices

| Slice | Issue | Pull request | State |
| --- | --- | --- | --- |
| Step 1, verifier and schema | #1904 | #1978 | `finishedWithoutResponse` added at `083dba1b`, preflight green |
| Step 2, mirror columns | #1907 | #1980 | scheduled review: request changes; fix round pushed at `b3a68d48` |
| Step 3, the Case carries the files | #1925 | #1982 | review: approve, fix round pushed at `7dc83929` |
| Step 5, the report states the fields | #1927 | #1985 | fix round pushed at `b4bd9b71`, preflight green |
| Step 4, packages carry the files | #1926 | #1984 | fix round pushed at `b7e5e2a8`, preflight green |
| Step 8, WARC writer | #1906 | #1979 | fix round pushed at `b4e11287`, preflight green |
| Character set spike | #1983 | #1988 | rulings recorded at `33ed5a01`; posted on #1929 |
| Step 6, scroll and screenshot record (writer) | #1928 | #1996 | fix round pushed at `7d309557`; merges after the tag, with #1843 |
| ADR-0040 link writer | #1995 | #1997 | fix round pushed at `5db2bc69`; merges after the tag |
| Viewer slice 2 Part A | #1735 | #1987 | fix round pushed at `3f015984`; a left click on a new-window link now does nothing |
| Viewer slice 3, one-link lookup | #1737 | #1990 | fix round pushed at `1a1dfa3d`, preflight green |
| Viewer slice 3, batch lookup | #1738 | #1998 | fix round pushed at `a45764ce`, preflight green |
| Step 9, record the Transaction Record (writer) | #1929 | #1999 | fix round and stack merge pushed at `11fcd9c2`; merges after the tag |
| Step 10, PDF (writer) | #1930 | #2000 | draft, under review; merges after the tag |
| Pin images offered as sets (writer) | #1843 | - | in flight, stacked on #2000; ships with step 6 |
| ADR-0040 acceptance | #1736 | #1977 | draft, preflight green |
| ADR-0040 verifier, schema 6 | #1976 | #1981 | review: approve, stacked on #1978 |

## Carried forward

- **The hash field list.** #1978 leaves `transactionRecordHash` and `pdfHash` out of
  `CAPTURE_ENTRY_HASH_FIELDS`, which D2 and D14 put in step 1, because the Shared Case blob
  mapping has no file type for either file until step 3. Step 3 (#1925) adds both, and step 3
  merges before the schema-6 release tag (ruling B), so the release carries them.
- **The mirror insert path.** #1980 adds the six columns but not the insert parameters; the
  first writer step (6 or 9) adds them.
- **For the link writer step.** From the review of #1981: the writer signs without a schema
  check, so a source entry with a non-hex Content Hash would be copied into
  `linkedFromContentHash` and break the Operator's own chain; the writer refuses such a source.
  The Shared Case receive path (`receivedEvidence.ts`) builds rows without the three fields, so it
  gains them. The writer also settles whether `linkHref` is the address before or after
  `canonicalizeUrl`.
- **Received rows.** The Shared Case receive path (`receivedEvidence.ts`) builds rows without
  the mirror columns step 6 fills (#1996) or the link fields (#1995 adds those). A writer step
  carries the mirror columns there.
- **#1667.** Closes by hand when #1996 merges, because a stacked base branch does not trigger
  GitHub's closing keywords.
- **Stacked PRs and CI.** `.github/scripts/dispatch/checks.sh` keeps only workflow runs whose
  base is `main`, so the scheduled PR review reads every stacked PR's CI as empty. CI itself runs
  on stacked PRs. A fix is put to the maintainer, because dispatch tooling is under the `process`
  freeze.
- **Defects filed.** #1986: an evidence package exported with screenshots off fails its own
  verification (found by the review of #1984, predates it).
- **The lane ledger.** The step issues say to claim a lane in a ledger, and no ledger file exists.
  This table is the record for this run.

## Next

Once every writer is up: the maintainer's merges, the schema-6 tag, then the writers. Open decision for the maintainer from #1979:
the status line takes its code from the response event, not the ExtraInfo event, because the
ExtraInfo event carries no reason phrase. Viewer slice 2 Part A (#1735) is
independent of the schema and takes the next free slot after that.
