# The evidence label serves two purposes

**Status:** Accepted

**Date:** 2026-09-01

Amends [ADR-0005](0005-unattended-agents-on-the-evidence-path.md) (the back gate and the draft
state after a verdict), [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md)
(the exit-bar clause), and [ADR-0011](0011-restate-the-autonomy-exit-bar.md) (clause 2, withdrawn).
Extends [ADR-0021](0021-a-verdict-survives-a-sha-that-changes-no-authored-content.md) with a second
carry-forward case. Nothing here weakens
[ADR-0004](0004-adopt-osint-assurance-baseline.md): the obligations an evidence-affecting change
carries are unchanged.

## Context

ADR-0014 wrote that the `evidence-affecting` label's merge gate was "already redundant" because
no agent PR auto-merged. That stopped being true the day it landed: since 2026-08-23, 34 agent
PRs have merged and 16 of them carried the label, so the label now decides who merges roughly
half of agent output. The question this ADR answers is what the label is for, so that each
mechanism hanging off it can be kept or removed on that basis rather than on habit.

The label carried five mechanisms, and the redesign wave of 2026-08-30 to 2026-09-01 exercised
every one of them on two evidence PRs, #1170 and #1181:

- **No auto-merge.** Both PRs waited for a human. On #1170 the round-2 pre-pass found two
  chain-forgery paths behind green CI, 100% diff coverage, and a clean CodeRabbit pass. That is
  the case the human back gate exists for.
- **Draft until a human acts.** The dispatch skill said an approved evidence PR "stays in draft
  for the human back gate". The maintainer marked both PRs ready before acting on them, and the
  reviewer reported the un-draft as a gate finding both times. A rule the maintainer overrides
  twice in a week is mis-specified.
- **Evidence impact section, known-answer test, backward verification.** Both PRs carried
  them, and the reviewer ran the named tests. On #1170 the round-3 blockers were an overclaiming
  code comment on `manifestChain.ts` and an Evidence impact section that presented a trade as
  forced. Neither changed behaviour; both changed what the change claimed to prove.
- **Adversarial pre-pass with reporter counting.** The verdict's first line reported "k of n
  reporters", counting CodeRabbit as the second reporter, and `.coderabbit.yaml` set
  `drafts: true` so CodeRabbit could report during the draft phase. CodeRabbit added nothing to
  either catch on #1170, and its auto-pause after four reviewed commits silenced it on a recent
  long loop before the PR was ever ready.
- **The exit-bar clause.** ADR-0014 keyed ADR-0011 clause 2 to the label's blocking tier. The
  #298 map closed on 2026-09-01 with the ledger never operated past 2026-08-16, so nothing reads
  the clause.

The two evidence PRs were also the two long ones: #1181 took five pre-pass rounds and #1170 four,
against one and two for the wave's non-evidence PRs. #1181's fifth round reviewed a docs-only
delta and then ran the full local verify loop over a tree CI had already passed.

## Decision

### Two purposes

The `evidence-affecting` label serves exactly two purposes:

1. **Merge routing.** A change that could alter an evidentiary result is merged by a human,
   never by the dispatcher.
2. **Claim discipline.** The author states what the change does to what verification proves,
   and a known-answer test pins it. Operator-facing strings, comments on the verify path, and the
   Evidence impact section are evidence surface in their own right: they are the statements that
   get quoted back when the tool's output is challenged.

Adversarial scrutiny is not a purpose of the label. Every agent PR gets the same pre-pass; the
label adds only the three gate checks that make purpose 2 checkable. The labelled merge history
is an audit trail as a byproduct of purpose 1 and needs no mechanism of its own.

Every mechanism below is kept or removed by whether it serves one of the two.

### Kept, unchanged

- **No auto-merge on evidence PRs.** Purpose 1. The one mechanism the label uniquely carries
  since ADR-0014, and the #1170 catches are the argument for it.
- **Gate verification as the label's only extra review work.** Purpose 2. Adding more would
  recreate the paperwork cost ADR-0014 measured at 42% noise.
- **Truth defects stay blocking.** Purpose 2. A comment that overstates what the chain proves is
  a defect in the evidence surface, whatever the code does.
- **The tiered path-list backstop.** Purpose 1, by catching a missed triage call. Measured on
  2026-08-23 and not revisited.
- **The triage-time label as primary trigger.** Purpose 2 needs the implementer to know before
  writing, so the known-answer test is written with the change rather than bolted on to satisfy
  a reviewer.

### Changed

**Un-draft at approve, whether or not the PR is evidence-affecting.** Draft has one job on an agent PR: it says no approve
verdict exists yet. The dispatcher opens every agent PR as draft and marks it ready on an
`approve for human review` verdict. An evidence PR then waits for the human back gate in the
ready state, which is the state the maintainer's review list shows. A non-evidence PR proceeds
to the auto-merge conditions, where marking ready was already the first step. The reviewer's
draft-status control is removed: a maintainer who un-drafts early is choosing to look early, and
a control that flags that has no failure scenario behind it. The `agent/pre-pass` status already
shows whether a verdict exists on the head sha.

**CodeRabbit reviews at ready.** `.coderabbit.yaml` sets `drafts: false`. The pre-pass is the
only draft-phase reporter, so the verdict's "k of n reporters" tally and the dispatch rule to say
what else is outstanding are retired. CodeRabbit fires when the PR is marked ready, which on an
evidence PR is the moment the human is reading, and that is where a second pair of eyes has
value. On a non-evidence PR it fires at un-draft-then-merge and is out of the auto-merge path;
ADR-0014's four conditions never counted it, so no policy relies on what this removes.

**A prose-only delta gets a delta pass.** When every blocker in a verdict is a truth defect and
the fix commit contains no executable change, the next pre-pass does not re-run the verify loop.
The reviewer re-derives every claim the delta makes against the source, reads the required
checks at the new sha, and states in the verdict that the verify loop was not re-run because the
diff since the last verdict sha contains no executable change. The code verdict carries forward
the way ADR-0021 carries one across a clean back-merge. The reviewer reads the diff regardless,
so "no executable change" is a judgement it already makes; stating it in the verdict keeps it
checkable.

**The exit-bar clause is withdrawn.** ADR-0011 clause 2, as re-keyed by ADR-0014, has no reader.
The #310 pilot verdict withdrew scheduled operation and adopted the dispatch routine as the
standing human-triggered engine. A clause nothing reads is a claim about the pipeline's rigour
that is not true, so it is recorded withdrawn here rather than left for a scheduled pipeline that
is not coming back on this evidence.

## Consequences

- An approved evidence PR is visible in the ready-for-review list, which is the list the
  maintainer reads. Nothing about its merge changes: it still needs a human.
- A new commit on a ready agent PR re-seeds `agent/pre-pass` as `pending` and CI runs the full
  matrix, so the ready state hides no unreviewed work.
- CodeRabbit's findings on an evidence PR arrive during human review and are handled there,
  by the maintainer, rather than relayed to the implementer during the draft loop. The dispatch
  skill's guidance on reply storms still applies at that point.
- A prose-only fix round costs a claims check and a status read instead of a reviewer run over
  the suite. On the #1181 round-5 shape that is minutes rather than tens of minutes.
- A delta pass is weaker in one specific way, and the verdict must say so: it trusts the
  required checks at the new sha for everything the local loop would have covered. Green CI at
  head is therefore a precondition of the delta pass, not a nicety.
- The believability streak no longer exists as an instrument. If scheduled operation is ever
  re-proposed, it needs a new exit bar written against whatever evidence exists then.

## Alternatives rejected

**Keep draft until the human merges, and stop overriding it.** Rejected on the observed
behaviour: the maintainer un-drafted both PRs before acting on them, which is what ready means.
The rule was asking for a state that carried no information the status did not already carry.

**Keep CodeRabbit on drafts and raise the pause threshold.** Keeps a reporter in the draft phase
that contributed nothing on the one PR where a second reporter could have mattered, and keeps a
verdict line whose number is about CodeRabbit's schedule rather than the PR's state.

**Un-draft non-evidence PRs at approve and wait one CodeRabbit cycle before merging.** Buys a
wait on every non-evidence merge for a reporter the auto-merge policy ignores.

**Make truth defects advisory.** Would end the long rounds and gut purpose 2 with them. The cost
was never the finding; it was the full re-verify loop the finding triggered, and the delta pass
removes that instead.

## Related

- ADR-0005 - the back gate this keeps and the draft clause this ends.
- ADR-0011, ADR-0014 - the exit-bar clause withdrawn here.
- ADR-0021 - the carry-forward the delta pass extends.
- #1170, #1181 - the two evidence PRs whose rounds are the evidence.
- #310 - the pilot verdict that left the exit-bar clause without a reader.
