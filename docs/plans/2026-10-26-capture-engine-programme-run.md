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
- **The link writer step.** ADR-0040's writer (slice 2 plan, B4 step 3) adds a migration and
  touches more than ten files, so its plan needs approval under ADR-0016 before work starts.
- **The release tag** that carries step 1's verifier. Steps 6, 9, and 10 merge only after it.
- **Merges.** Every step is `evidence-affecting`, so each needs the maintainer's approval at head.

## Slices

| Slice | Issue | Pull request | State |
| --- | --- | --- | --- |
| Step 1, verifier and schema | #1904 | #1978 | draft, preflight green, under review |
| Step 2, mirror columns | #1907 | - | in flight, stacked on #1978 |
| Step 8, WARC writer | #1906 | #1979 | draft, preflight green, under review |
| ADR-0040 acceptance | #1736 | #1977 | draft, preflight green |
| ADR-0040 verifier, schema 6 | #1976 | - | filed, stacks on #1904 |

## Carried forward

- **The hash field list.** #1978 leaves `transactionRecordHash` and `pdfHash` out of
  `CAPTURE_ENTRY_HASH_FIELDS`, which D2 and D14 put in step 1, because the Shared Case blob
  mapping has no file type for either file until step 3. Step 3 (#1925) adds both, and step 3
  merges before the schema-6 release tag (ruling B), so the release carries them.
- **The lane ledger.** The step issues say to claim a lane in a ledger, and no ledger file exists.
  This table is the record for this run.

## Next

Stack #1976 on #1978 when a slot frees, then steps 3 to 5. Viewer slice 2 Part A (#1735) is
independent of the schema and takes the next free slot after that.
