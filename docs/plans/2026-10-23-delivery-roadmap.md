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

## Current programme: Shared Cases

Steps 1 to 5b and 7 of #1508 are on `main`: sync, the Iroh transport, the invite, join, and
roster writers, Trusted Time on `merge` entries, `verify.sh` member chains and the two-instance e2e
(#1946). The Members UI (#1514) is being built from the designer's revised bundle, received
2026-10-23. Shared Cases is done when all of the following hold:

- **#1514, Members UI.** It changes the ledger (item 24), and `src/renderer/components/data/**`
  is blocking tier in the evidence path assessment, so the PR carries `evidence-affecting`.
- **#1951 and #1955.** Each stops a teammate's sync for good: a row written on an imported or
  legacy Capture, and a share with a teammate who earlier imported the Case's archive. Both land
  before the entry points of the Members UI, because the UI is what makes a Shared Case reachable.
- **#1883, docs.** The threat model section, the `features.mdx` limit line, the tester guide and
  the `CONTEXT.md` terms.
- **The close-out sync.** The maintainer runs one real sync between two networks over the relay.
- **Housekeeping.** #1697 closes (the spike merged as #1806), #1508's checklist is ticked and the
  issue closes, and the Shared Cases section of the three-programme briefs plan is marked done.
- **Release.** A beta tag carries it, with release notes telling members to upgrade together.

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
| 2 | Capture engine first slice, steps 1 to 6 and 8 to 10, in one manifest schema release (schema 6) that also takes ADR-0040's link provenance fields; then MHTML viewer slices 2 and 3, with slice 3's S2 rewritten around `src/shared/localAddress.ts` | The release is tagged, and the viewer plan's three slices are done | Approved on #1803; ADR-0040 accepted at schema 6 on 2026-10-26. Owed: the release tag |
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
