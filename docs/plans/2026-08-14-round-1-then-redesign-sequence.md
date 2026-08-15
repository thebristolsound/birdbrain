# Round 1 first, then redesign — sequence

Date: 2026-08-14
Maps: [#284](https://github.com/thebristolsound/birdbrain/issues/284) (round-1 tester readiness),
[#298](https://github.com/thebristolsound/birdbrain/issues/298) (autonomy pipeline).
Program: spec [#382](https://github.com/thebristolsound/birdbrain/issues/382) (design handoff).

## Decision

Ship round 1 before the redesign program, because tester feedback is an **input** to the
redesign rather than a reaction to it. The redesign's model — Mentions, backlink map,
selection→Selector flow, two export classes — was validated by the prototype and the
maintainer, never by an outside investigator. #389+#390 alone are XL+L. A workflow
correction arriving before those are built is worth months; the same correction after is
sunk cost.

Pixel and layout feedback is not worth collecting: those decisions are closed (feasibility
review passed with nothing rejected, ADR-0009/0010 ratified, 20 tickets written).

## Acceptable state to hand a tester

Not a new judgement — already decided on the map.

- **Floor (#284):** no silent loss, corruption, or mis-attestation of evidence. UI roughness,
  missing features, and known architectural debt ship as-is, deliberately.
- **Gate (#291):** CI green; CI-built artifacts only; smoke checklist passing on Windows NSIS
  and Ubuntu AppImage; verifier against `tests/fixtures/timestamp/` plus a live
  capture→verify→export→re-verify; upgrade-path test confirming the pre-migration snapshot.
  Human-run, ~45 minutes.

#413 (pre-migration snapshot) closed COMPLETED 2026-08-14, so the durability contract from
#286 is implemented and the gate's upgrade test has something to assert.

Shipping build is `1.0.1-beta.17`, tagged 2026-07-24. #291 requires CI artifacts, so round 1
needs a fresh tag.

## Remaining before round 1

| # | Work | State |
|---|---|---|
| #415 | Write the pre-ship validation gate checklist | `ready-for-agent`, docs |
| #416 | Refresh the tester rollout brief | `ready-for-agent`, docs |
| #414 | Warn when the signing key cannot be protected at rest | `ready-for-human`, evidence-affecting |
| #412 | Audit every evidence claim across four surfaces | `wayfinder:research` |

## The feedback ask changes

#285 left the 3 Jul brief's "loose all-purpose feedback" as the default. That default collects
the wrong thing given a redesign is queued. #416 is where the wording is finalized. It should
tell the tester:

- The UI is changing substantially in the coming months. Do not report layout, spacing,
  wording, or visual nits.
- Do report: evidence lost, mangled, or mis-described; sites that fail to capture; workflow
  dead-ends ("I wanted to do X and there was no path").
- Do report whether the Certification and verify output read as true to someone who would have
  to defend them. #412 audits those claims internally; a working investigator reading them is
  the external check no internal audit produces.

Separately, and cheaply: show the tester the prototype
(`prototype/design-handoff-2026-08`, `Birdbrain.dc.html` runs standalone) beside the shipped
app and ask which matches their work. One session, de-risks 20 tickets, needs no build.

## Sequence

1. #415 + #416 (batched — both docs, both `ready-for-agent`)
2. #414
3. #412
4. Tag a build; run the #291 gate against CI artifacts
5. Tester in; prototype walkthrough in the same session
6. #388 spike (interactive, maintainer-run, zero agent-slot cost — can run in parallel from step 1)
7. Redesign program, per the ordering below

## Redesign ordering (after round 1)

Stage 0 already landed: #384 tokens, #385 density, #386 capture-UI suppression.

| Order | Work | Blocked by |
|-------|------|------------|
| 1 | #388 spike (interactive) | — |
| 2 | **Batch A: #425 + #421** — post-#419 debt | — (#421 design call answered 2026-08-14) |
| 3 | #394 batch-ops backend | — |
| 4 | #395 selector origin | — |
| 5 | **Batch B: #387 + #406** — extension popup select + options page | — |
| 6 | #389 references index | #388 |
| 7 | **Batch C: #396 + #397** — Captures screen | #394 |
| 8 | #400 per-case exclusions | — |
| 9 | **Batch D: #390 + #391** — Notes editor + selection flow | #389, #395 |
| 10 | **Batch E: #402 + #403** — Overview + dashboard feed | #389 |
| 11 | #398 selection-scoped export | #396 |
| 12 | #399 export dialog | #398 |
| 13 | #392 server write endpoints | #389 |
| 14 | #393 in-page selection bar | #392 |
| 15 | #401 Wayback panel | #398 |
| 16 | #404 coach-mark engine | #387 |
| 17 | #405 case tour + demo Case | everything above |

Batching rationale: A shares the `SelectorTableRow.tsx`/token surface; B is two S-sized
extension items over the same `/api/status` surface; C is one layout rewrite of
CaptureList/CaptureViewer rather than two conflicting ones; D and E each match a single
feasibility-assessment line item ("Notes editor L", "Consolidated Overview and Dashboard
activity feed M").

Deliberately **not** batched: #398 and #399 are both evidence-affecting under ADR-0009/0010 and
get separate human review; #389 stays solo because it is load-bearing and bumps the Case
Archive schema version.

22 PRs become 15, which matters under ADR-0005's strict-serial WIP.

## Open items for the maintainer

- **#421 — answered 2026-08-14.** Rows must track `--d-row` at all three density steps; content
  is not permitted to win at the tighter steps. That makes it a code fix. The `ready-for-agent`
  label is still withheld, now for sequencing rather than design: the dispatch routine takes the
  oldest eligible issue, so labelling it would pull redesign work ahead of #414 and #412. Label
  it when the redesign program starts. Recorded on the issue.
- **Tester cohort — answered 2026-08-14.** The early tester is inside the 2–3 invited cohort, so
  #290's support commitment applies in full and #416 needs no one-off framing. Recorded on #416.
- **#310** (pilot verdict and cron enablement) is still open. The redesign is the largest
  agent-dispatchable queue in the repo; pushing 15 batched PRs through the routine before the
  verdict would contaminate the pilot measurement.

## Interaction to watch

#412 audits every evidence claim across the threat model, in-app verify language, the
standalone verifier, and export/certification output. The redesign changes claims on that last
surface (#398/#399 Working Copy and extended Certification, #401 Wayback non-evidence
labelling). Either #412 lands first and its scope explicitly covers shipped surfaces only, or
the audit is stale on delivery.
