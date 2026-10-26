# Capture engine programme: run log

**Status:** active

The handoff file for the interactive run that works programme 2 of
[the delivery roadmap](2026-10-23-delivery-roadmap.md), started 2026-10-26. The goal is the done-when
of programme 2 in the roadmap: the manifest schema release that carries first-slice steps 1
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

- **ADR-0040 (#1736).** Accept or amend. Schema 5 shipped, so the fields take 6.
- **#586's schema step.** Whether it joins schema 6, and which slice of the chain head anchoring
  design is the schema step.
- **The release tag** that carries step 1's verifier. Steps 6, 9, and 10 merge only after it.
- **Merges.** Every step is `evidence-affecting`, so each needs the maintainer's approval at head.

## Slices

| Slice | Issue | Pull request | State |
| --- | --- | --- | --- |
| Step 1, verifier and schema | #1904 | - | in flight, 2026-10-26 |
| Step 8, WARC writer | #1906 | - | in flight, 2026-10-26 |

## Next

When step 1's pull request is open, stack step 2 (#1907) on it, then steps 3 to 5.
