# Delivery roadmap: finish one programme at a time

**Status:** active

Written 2026-10-23 after an audit of every plan in `docs/plans/` against `main` at ab27340b. The
audit found about 25 plans with unbuilt slices. Nothing unfinished is reachable in a packaged
build: the Investigate route has no navigation entry, the Transaction Record collector is not
wired into a capture, and no renderer code calls the sharing API. The cost is dormant code on
`main` and plans with no end. This roadmap gives every one of them an end.

## Rules

1. **One programme at a time.** Dispatch slot 1 works the current programme and slot 2 works the
   defect lane. A programme starts only when the one before it is done.
2. **A programme ends Done or Parked.** Done means an Operator can reach it in a packaged build,
   its docs are published, and its tracking issue is closed. Parked means the plan's Status line
   reads `parked` with a date, what was built and what picking it up again starts with, and its
   code stays unreachable. Nothing stays in between.
3. **Unreachable until finished.** Screens a programme adds stay unlinked until its last PR adds
   the entry points, the way the Investigate route is registered today.
4. **A plan closes with its programme.** When a programme is done, each plan it covers gets
   `**Status:** done` with the PR that finished it.

## Current programme: Capture engine first slice

Steps 1 to 6 and 8 to 10 of the capture engine first slice, in one manifest schema release
(schema 6) that also takes ADR-0040's link provenance fields; then MHTML viewer slices 2 and 3,
with slice 3's S2 rewritten around `src/shared/localAddress.ts`. It is done when the release is
tagged and the viewer plan's three slices are done. The spec and plan were approved on #1803 and
ADR-0040 was accepted at schema 6 on 2026-10-26; the gate the maintainer still owes is the
release tag. It started before Shared Cases reached Done by the maintainer's choice: Shared Cases
waits only on the maintainer's close-out sync, which no dispatch slot works.

## Shipped programmes

- **Shared Cases**, shipped in the `v1.0.1-beta.24` release. The members screens became
  reachable in [#1972](https://github.com/thebristolsound/birdbrain/pull/1972), after the two
  sync defects #1951 and #1955 merged
  ([#1966](https://github.com/thebristolsound/birdbrain/pull/1966),
  [#1967](https://github.com/thebristolsound/birdbrain/pull/1967)), and the docs were published
  in [#1973](https://github.com/thebristolsound/birdbrain/pull/1973).
  [#2007](https://github.com/thebristolsound/birdbrain/pull/2007) dropped the placeholder tabs
  from Case settings, and [#2009](https://github.com/thebristolsound/birdbrain/pull/2009) to
  [#2011](https://github.com/thebristolsound/birdbrain/pull/2011) gave every Case a Share pill
  in the top bar and a palette row, the dashboard a role line, a Shared badge and an Older Cases
  list, and the pill a one-time Share card.
  [#2014](https://github.com/thebristolsound/birdbrain/pull/2014) marked sharing as early
  access in the Share pill's hover text and with a badge on the Members panel. The close-out
  sync between two networks is still owed; the maintainer records it on #1508 and closes the
  issue, which makes the programme Done under rule 2. Nine Shared Cases plans read
  `**Status:** done` with the PR that finished each; the close-out handoff
  (`2026-10-26-shared-cases-closeout-handoff.md`) keeps the sync steps, the release notes and
  two open questions.

## Defect lane

Slot 2 works defects in this order, one at a time, beside whichever programme is current:

1. The verifier defects, because every package any programme ships depends on them: #1453,
   #1472 then #1278, #1674, #1725, #1517 and #1172.
2. The selection-bar security defect, #992.
3. The other evidence-affecting defects the stale-agent-issues workflow closed without a fix,
   reopened as the maintainer picks them (ADR-0053).
4. Small unfinished plans, between programmes: database restore slices 2 to 5, renderer query
   layer PRs 5 and 6 (after its call-site list is updated), the three open tasks of the UI bug
   audit, and the open design-gap tickets.

## Next programmes, in order

| Order | Programme | Done when | Gate the maintainer owes |
|---|---|---|---|
| 3 | Capture engine stage 2: the launched browser, passive capture (#600) and a profile per Persona (#1833), with Persona phases 2, 3, 5 and 6 rewritten around it; phase 4 moves to the stage 3 Companion pipe | Passive capture and Personas ship, and the Persona plan is done | Answer the schema question on #1498 |
| 4 | Case investigation engine | The Investigate section gets its navigation entry in a packaged build | An ADR choosing the local model and runtime; the evaluation bar (#1892, CI-B) |

**Ruling, 2026-10-26.** The maintainer accepted ADR-0040 at schema 6 and moved #586's schema
step out of the schema-6 release: chain head anchoring takes a later schema number once its
design is approved, so it does not hold back the capture engine's writer steps.

## Parked on 2026-10-23

Each carries a `parked` Status line: anchored notes phase 2, the Manifest chain reader, the
Hunchly import, the review-quality benchmark, the Doc curator, and slop audit phases 2 to 10.

## Done but still open

These issues describe work that is on `main` and can be closed: #1535, #803, #922, #481, #698,
#271, #268, #269 and #1449.
