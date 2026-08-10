# Claim the dispatch slot at dispatch time

**Status:** Accepted

**Date:** 2026-08-10

Amends the flow-control clause of
[ADR-0005](0005-unattended-agents-on-the-evidence-path.md). The strict-serial rule — at most
one agent cycle in flight — stands unchanged; this ADR changes *when* and *how* the slot is
claimed, because the pilot showed the existing marker does not actually enforce the rule.

## Context

Under ADR-0005 the slot marker is an open PR labelled `agent-pr`. But a cycle starts at
dispatch, not at PR-open, and the implementer works for up to an hour in between. During that
window the slot reads as free to every other session. The part-two ledger
(`docs/plans/2026-08-10-pilot-part-two-ledger.md`, finding 1) recorded three collisions in
fourteen cycles, each a different face of the same hole:

- **#339 / #341** — two cycles dispatched into the window; duplicate PRs.
- **#354 / #355** — issue #267 implemented twice in parallel; both sessions checked the slot
  correctly, and both were right that it was free.
- **#357** — two agents committing to one branch *while the slot was correctly held by one
  PR*. A PR-based marker cannot see this case at all; only an agent noticing the collision and
  rebasing prevented a silent loss of a commit and four posted review replies.

All three happened while a human was watching. Scheduled operation (#310) removes the watcher,
so this hole is a precondition for the cron decision, not a tolerable annoyance.

## Decision

**The slot is claimed at dispatch time, before any implementer is spawned.** Two markers now
define it, checked together:

1. An open PR labelled `agent-pr` (unchanged), and
2. An open issue labelled `agent-wip` — the claim for a cycle whose PR does not exist yet.

The slot is busy if either set is non-empty. The claim protocol, in order:

1. **Comment first.** Post a claim comment on the chosen issue. Its GitHub `created_at` is the
   claim's timestamp — server-assigned, totally ordered, not forgeable by a racing session.
2. **Then label.** Apply `agent-wip` to the issue.
3. **Then re-read and settle.** List open `agent-pr` PRs and open `agent-wip` issues again.
   An open PR always wins over any claim. Between competing claims, the earliest claim
   comment wins; ties (same second) break to the lower issue number. A loser removes its
   label, posts a withdrawal comment, and exits the cycle.

**Release points.** The claim converts or dies, never lingers: remove `agent-wip` when the
draft PR opens (the `agent-pr` label takes over), or when the give-up path relabels the issue.
A claim older than **4 hours** with no open agent PR is stale; any later cycle may clear it
with a comment and proceed.

**One writer per branch.** The #357 case is inside a single cycle, where no label helps, so it
gets a discipline rule instead: during a cycle only the implementer pushes to the working
branch — the dispatcher never does. Before pushing, the implementer fetches and confirms the
push fast-forwards the remote head it last saw; force-push is never used. A remote head that
moved unexpectedly is a collision: stop and report, do not merge or overwrite it.

This is advisory locking — GitHub offers no compare-and-swap, so two sessions can still race
steps 1–2. The protocol makes the race *converge* (step 3 settles every interleaving to one
winner, using timestamps neither party controls) rather than pretending to prevent it.

## Consequences

- The dispatch window is no longer invisible. The two ledger collision modes that lived in it
  (#339/#341, #354/#355) are closed by construction; the third (#357) is reduced to a
  detectable stop condition rather than silent data loss.
- Every claim leaves a timeline record on the issue — dispatch attempts become auditable, and
  a crashed cycle is diagnosable from the stale claim it leaves behind.
- A crashed cycle blocks dispatch for up to 4 hours. Accepted: the pilot's cadence is manual
  triggers and, later, an hourly-at-most cron; a 4-hour worst-case stall is cheaper than a
  duplicate implementation reaching review.
- The routine gains steps, and the label vocabulary gains an entry
  (`docs/agents/triage-labels.md`). The protocol lives in
  `.claude/skills/dispatch/SKILL.md`, which is its implementation.

## Alternatives rejected

**Do nothing; rely on the human noticing.** That is the measured status quo: three collisions
in fourteen cycles with a human watching. The cron removes the human.

**Use the issue's assignee as the claim.** Assignment already means "a human owns this" in
this tracker, and the dispatch frontier explicitly filters to unassigned issues — overloading
it would make every eligible issue look claimed and would still not order competing claimants.

**A lock branch or repository dispatch lock.** Heavier machinery with the same fundamental
limit (no CAS over the API), worse visibility (nothing on the issue timeline), and a second
place for state to go stale.
