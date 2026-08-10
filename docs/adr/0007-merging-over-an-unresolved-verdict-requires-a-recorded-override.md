# Merging over an unresolved verdict requires a recorded override

**Status:** Accepted

**Date:** 2026-08-10

## Context

Every agent PR gets an automated reviewer pre-pass whose verdict is `approve for human
review` or `request changes` (ADR-0005; `.claude/skills/dispatch/SKILL.md` §4). The part-two
ledger (`docs/plans/2026-08-10-pilot-part-two-ledger.md`) found that **six of fourteen agent
PRs merged while their final pre-pass still said `request changes`** — 43%. One of the six
(#357) was a deliberate, disclosed override: the blocker was argued in the thread and deferred
to filed issues #362 and #363. For the other five the record says nothing. "Merged" and "the
final automated pre-pass was `approve for human review`" are measurably different events in
this pipeline, and nothing currently requires the difference to be explained.

That gap has two costs. It makes the pilot's own success metric unreadable — a merge can mean
"findings resolved", "findings rejected", or "findings never looked at", and the ledger cannot
tell them apart. And it silently converts the automated reviewer from a gate into noise: a
verdict that can be ignored without a trace exerts no pressure on anything.

## Decision

**The human back gate may overrule the automated verdict — silently ignoring it is what's
prohibited.**

1. A human MAY merge an agent PR whose latest pre-pass verdict is `request changes`.
   The pre-pass is advisory to the human and binding on the pipeline — binding meaning the
   dispatch routine must answer a `request changes` with a fix round and may never merge at
   all, while the human may weigh the verdict and proceed. ADR-0005's trust ordering (human
   review is the back gate) is unchanged.
2. Doing so requires an **override record**: a PR comment whose first line contains
   `Override record`, posted after the final `request changes` pre-pass and at or before the
   merge, that names each outstanding pre-pass finding and dispositions it as one of:
   - **disputed** — the finding is wrong or does not apply, with the reason; or
   - **deferred** — the finding is real but out of scope, with a filed issue linked.
   #357's close-out (deferral to #362/#363) is the model in substance; the marker and the
   time window are what make future records mechanically findable and bind each one to the
   verdict it overrides rather than to some earlier round.

   The record is a human's statement — the merging human's, or another maintainer's. In this
   repo that is a trust assumption, not a checkable property: agents post under the
   maintainer's account (a ledger finding), so no mechanical check can distinguish authors.
   The compensating controls are that agents never merge (ADR-0005) and never post replies
   directly (`.claude/skills/dispatch/SKILL.md`); the hygiene check in rule 4 verifies the
   record's presence, marker, timing and per-finding dispositions — authorship is the one
   property it cannot establish.
3. **On an evidence-affecting PR, findings against the evidence gate itself** — the Evidence
   impact section, the known-answer test, backward verification of existing packages — **may
   not be deferred.** Fix them or dispute them on the merits. Deferring an evidence-gate
   finding would merge an admitted gap in the exact obligations ADR-0004 and ADR-0005 exist
   to enforce.
4. The dispatch routine checks override hygiene from the free-slot branch of its cycle. A
   merged PR drops out of the open-PR slot query, so the routine keys the check off the most
   recently closed `agent-pr` PR instead (`.claude/skills/dispatch/SKILL.md` §1). If that PR
   merged over a final `request changes` with no conforming override record, the gap is
   reported — and re-reported every free-slot cycle until the record is posted. Report-only —
   the merge stands; the record debt is surfaced, not litigated.
5. Nothing changes about who merges. Humans only, exactly as ADR-0005 requires.

## Consequences

- "Merged" becomes an interpretable signal again: every *compliant* merge either follows an
  approving verdict or carries a written account of why not. A merge missing its record is
  not prevented — it is surfaced by the routine each free-slot cycle until the record exists.
  Future ledgers can count overrides instead of guessing at them.
- The cost is one comment per override, borne by the human merging. Given the measured rate
  (6 in 14), that is real but small friction — and if it proves heavy, that pressure is
  itself information: it means the pre-pass produces findings not worth answering, which is a
  reviewer-quality problem to fix at the source rather than by ignoring verdicts.
- Rule 4 gives the routine a hygiene check it can perform mechanically (final verdict comment
  vs. a marked, correctly-timed override comment with per-finding dispositions) without
  granting it any authority over merges.

## Alternatives rejected

**Block merging until the pre-pass approves.** Inverts ADR-0005's trust ordering by making a
bot the authority over the human back gate, and creates a hostage problem when the pre-pass
is wrong — the observed pre-pass factual-error count is non-zero (two in a single round, per
the ledger), and a rate would need a denominator the ledger does not define.

**Leave verdicts advisory with no record requirement.** The status quo the ledger measured:
43% divergence with a written explanation in one case out of six. Advisory-with-no-trace is
indistinguishable from noise.

**Auto-file an issue for every unresolved finding at merge.** Mechanically attractive, but it
launders disputed findings into the backlog as if they were accepted debt, and it removes the
one moment a human states their reasoning — which is the thing the record is for.
