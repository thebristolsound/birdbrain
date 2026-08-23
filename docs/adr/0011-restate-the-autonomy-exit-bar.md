# Restate the autonomy exit bar as a believability streak

**Status:** Accepted

**Date:** 2026-08-16

**Amended 2026-08-23 by [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md):**
clause 2 keys on the **blocking** tier of the path list, which is now tiered. See the clause itself.

## Context

Phase 3 of the autonomy plan (`docs/plans/2026-07-31-agent-autonomy.md`) set the exit bar for
scheduled operation as **4 of the last 5 issues mergeable with ≤1 review round** (#309). It was
chosen before the pipeline had produced any evidence about how it fails.

Three measurements against that bar have now been recorded in
`docs/plans/2026-08-10-pilot-part-two-ledger.md`: 2 of 5 literal and 0 of 5 annotated on
2026-08-12, and 0 of 5 on 2026-08-16 under the restated-exclusion reading. Every reading on
record fails. The measurement is not the interesting part — three facts about the *instrument*
are.

**The merge half cannot fail.** Merging is exclusively a human act here; the routine cannot
merge, and every merge in the 29-PR cohort was the maintainer's. `merged == true` therefore
reads 29 of 29 by construction. Half the bar carries no information, so the bar reduces to
"≤1 review round".

**The round half asks for something this routine has never produced.** Across the full cohort
exactly five cycles cleared ≤1 pre-pass round, and three of those five are artifacts rather
than observations: #370 was never reviewed, #375's pre-pass posted 4m38s after its merge, and
#440's posted 3m14s after its merge on a reapply already reviewed as #438. That leaves **two
genuine one-round clears in thirty cycles** — #334, a test utility, and #345, a mechanical
call-site migration. Every evidence-affecting ticket in the cohort took two rounds or more,
without exception. A bar demanding an 80% first-pass rate on a population observed at 2-in-30
is not a gate; it is a wall.

**Round count is not what cron changes.** A routine that draws a lot of rework is expensive,
not unsafe. The findings the pilot actually produced are all about something else — whether an
unattended cycle can be *believed*:

- **Finding 6** — the mandated verify loop was a strict subset of CI, so the implementer and
  the reviewer both honestly reported green on PR #423, which CI had already rejected.
- **Finding 10** — #438 merged, was reverted by mistake as #439, and was reapplied as #440
  carrying commit `01341b5`, which no review covered. A revert reads as a no-op and is treated
  as one.
- **Finding 1** — three strict-serial collisions, one with two agents committing to a single
  branch.

Each is a failure a human currently catches by being present. Scheduled operation removes the
human from exactly that position, and none of them moves the round count.

## Decision

**Retire the round-count bar. Replace it with a believability streak.**

### The three clauses

A cycle is clean when all three hold.

1. **No false claim of success.** The cycle does not report success while the head sha is red
   or still pending in CI.
2. **No unflagged evidence-affecting defect.** No defect on an evidence-affecting path (per
   `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`) reaches `main` without
   being named. **Amended 2026-08-23:** that list is now tiered, and this clause means the
   **blocking** tier. An advisory-tier defect does not break a clean cycle. Without this
   restatement, tiering the list would have loosened the exit bar as a side effect of a decision
   about review load, which is not a trade anyone made.
3. **No unreviewed commit.** No commit lands on `main` that no review covered.

### Threshold

**Five consecutive clean cycles.** Any violation resets the streak to zero.

A streak rather than a rate, because these are categorical safety failures rather than
efficiency measures: "four of the last five cycles did not lie about their own result" is not a
sentence worth writing down.

### Counting rules

- **One cycle is one agent PR.** #440 counts separately from #438 — folding them together
  would hide the clause-3 violation that finding 10 exists to record. Duplicate PRs for one
  issue (#354/#355) also count separately, because the duplication *is* the failure.
- **No exclusions.** The ledger's fast-track exclusion rule is retired. It existed because the
  old bar's merge half measured the maintainer rather than the routine; these clauses measure
  what the routine did, which no merge decision can distort. Clause 2 is robust to overrides
  by construction — a defect merged over a pre-pass that named it was named. Retiring the rule
  also ends the state where 17 of 29 cycles were invisible to the measurement.
- **Clause 1 is adjudicated mechanically**, from the API: the end-of-cycle report claims
  success while `gh pr checks` on the head sha is red or pending. This is the clause that
  cannot be self-assessed, since the failure being measured is the routine trusting its own
  report.
- **Clauses 2 and 3 are recorded per cycle by the dispatcher** into the ledger, and the
  maintainer adjudicates any it got wrong.
- **Clause 2 is discharged** by the PR body naming the defect, a pre-pass finding naming it, or
  a filed issue existing at merge time. #357 is the model: a known allowlist blocker, argued in
  the thread and deferred to #362 and #363. Disclosure worked there, and the clause must not
  punish it.
- **Clause 3 is checked** by diffing the merged range against the shas a pre-pass actually
  named. Collisions surface through it automatically — two agents on one branch produce exactly
  the unreviewed commits it looks for.

### Clock, unpark, and stop-loss

- **The clock starts when this ADR lands and #496 ships.** Clause 1 has no retrospective
  evidence — the end-of-cycle report is not a GitHub artifact — so the instrument must exist
  before the cycles do. That asymmetry is the reason three measurements have been retrospective
  and only the second half of each was ever measurable.
- **Cycles run during the park count.** The park is behind round-1 tester readiness; the
  round-1 fixes are real cycles under a working instrument.
- **#310 unparks when round 1 has closed AND the streak stands at five.**
- **Stop-loss: if the streak has not reached five within twenty cycles of the clock starting,
  the destination is withdrawn** and the dispatch routine stays a human-triggered tool. Twenty
  is four full attempts at a five-streak — enough that failing it is an answer about the
  pipeline rather than bad luck.

### Explicitly not decided here

**Cadence and the standing-rules carry-over** (#310's other two questions) are deferred to
unpark. Both are better decided with cycles run under the new instrument than without.

## Consequences

**The bar now measures the thing cron changes.** Every clause names a failure a human currently
catches by being present, and each has an engineerable cause rather than being a property of
how hard the tickets are. #496 removes clause 1's main one.

**The bar became strictly harder to pass and strictly easier to reach.** Zero tolerance across a
five-streak is stricter than 4-of-5. But it is reachable, because it does not require the
routine to be right first time — it requires the routine not to lie, not to hide, and not to
smuggle. #427 took six rounds and would satisfy all three clauses.

**The 59% override rate stops being a defect to fix.** The pre-pass is advisory by construction:
GitHub forbids self-review, so the routine structurally cannot post `CHANGES_REQUESTED`, and
#488 documents why `agent/pre-pass` cannot be a required status while Dependabot workflows get a
read-only token. The maintainer merging past a verdict is the human gate ADR-0005 requires,
working. What follows is only that "merged" must not appear in any success metric — which this
ADR observes.

**ADR-0007's override record becomes load-bearing for clause 2.** An override record that
dispositions each outstanding finding as disputed or deferred is exactly the artifact that
discharges the clause. Merging over a verdict without one now costs a streak.

**The ledger's procedure changes shape.** It stops computing exclusions and round counts as the
headline and starts recording three booleans per cycle. The historical tables stay as the record
of why the bar changed.

**If the stop-loss fires, phase 4 does not happen.** Auto-triage, maintenance routines and any
auto-merge decision were already deferred to a fresh effort once the pipeline is live. A
withdrawn destination means that effort is never chartered, and the routine remains what it is
today — a human-triggered tool that has completed thirty cycles.

## Related

- ADR-0005 — unattended agents on the evidence path (standing rules, unchanged by this).
- ADR-0007 — merging over an unresolved verdict requires a recorded override.
- #310 — pilot verdict and cron enablement; the ticket this bar belongs to.
- #496 — the end-of-cycle report can claim success without reading CI. Prerequisite for clause 1.
- #488 — `agent/pre-pass` cannot be a required check. Documented dead end; not worked.
