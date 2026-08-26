# Convention-shaped plans proceed without waiting for approval

**Status:** Accepted

**Date:** 2026-08-25

## Context

The global instructions require a plan for any task larger than about three file changes, and
require waiting for approval before executing it. The recorded answer is almost always
"approved." The wait lands at the worst moment: the agent has just built full context on the
task, and the approval latency is dead time before execution starts.

Plan approval does carry information some of the time - when the plan commits to a new
dependency, an irreversible step, or a design without precedent. The decision below separates
those plans from the ones that are convention all the way down.

As with ADR-0015, no transcript measurement exists; the criteria are seeded from the
maintainer's report. The posted plan is the instrument here, because it survives for
after-the-fact review whether or not anyone waited on it.

## Decision

In interactive sessions, a plan is still produced and posted, and is then executed in the same
turn without waiting for approval, when all of these hold:

1. No new dependencies.
2. No file on the blocking tier of the evidence-path list
   (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`).
3. No schema migration and no data deletion.
4. Every step is reversible with git alone: no force-push, no history rewrite, no external
   publishing.
5. Every design choice in the plan is either an existing repo pattern or falls in an ADR-0015
   pre-approved class.
6. At most 10 files changed. The number is a parameter, seeded rather than measured; tune it
   against the record of vetoed and regretted auto-proceeds.

A plan failing any criterion waits for approval as before, and names which criterion tripped so
the maintainer reviews the right thing first.

## Consequences

- Approval moves from a gate to a review. The plan is still written, still posted, still
  open to veto; the veto arrives against work in progress instead of blocking the start.
- The revert cost of a wrong auto-proceed is bounded by criteria 3 and 4: nothing irreversible
  is in scope for an unapproved plan.
- Criterion 5 chains this ADR to ADR-0015. Loosening or tightening the class list moves this
  gate with it, deliberately, so there is one list to argue about rather than two.
- The file-count parameter will be wrong in one direction or the other; the record says which.

## Alternatives rejected

**Auto-approve on size alone.** A three-file diff can add a dependency or rewrite history. The
risk criteria carry the decision; size is only the backstop against plans too large to review
after the fact.

**Drop the plan artifact along with the approval.** The plan is what makes after-the-fact veto
possible. Removing the wait is cheap only because the artifact survives.

## Related

- ADR-0015 - pre-approved recommendation-grade decisions; the class list criterion 5 binds to.
- ADR-0017 - a green verify block at head replaces completion confirmation.
