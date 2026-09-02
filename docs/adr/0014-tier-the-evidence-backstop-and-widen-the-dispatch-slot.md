# Tier the evidence backstop and widen the dispatch slot

**Status:** Accepted

**Date:** 2026-08-23

**Amended 2026-09-01 by [ADR-0025](0025-the-evidence-label-serves-two-purposes.md):** the section
"The exit bar keys on the blocking tier" is withdrawn with ADR-0011 clause 2, which has had no
reader since the #310 pilot verdict. The tiers, the slot count and the auto-merge conditions stand.

Amends [ADR-0005](0005-unattended-agents-on-the-evidence-path.md) (flow control, back gate,
mechanical backstop) and [ADR-0006](0006-claim-the-dispatch-slot-at-dispatch-time.md) (the slot is
claimed at dispatch time). The claim protocol ADR-0006 defines stands unchanged; what changes is how
many slots there are. [ADR-0011](0011-restate-the-autonomy-exit-bar.md) clause 2 is restated here
because tiering the list silently changes what it means.

Nothing here weakens [ADR-0004](0004-adopt-osint-assurance-baseline.md). The obligations an
evidence-affecting change carries are unchanged; this ADR narrows which changes are held to be
evidence-affecting by machine, and changes who merges the ones that are not.

## Context

Three facts, measured rather than argued.

**The backstop fires on changes that cannot alter an evidentiary result.** Over every PR that has
carried the label, 41 in total and 38 merged, 16 of the 38 touched no path where the diff could have
reached evidence behaviour. That is 42%. Four of the sixteen are the misleading kind: they hit a
narrow-looking glob incidentally, such as #786 adding `data-tour="export"` to a `div` in
`ExportMenu.tsx`. The full measurement and its method are recorded in
[`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`](../specs/2026-07-31-evidence-affecting-paths-assessment.md),
section `Tiers`.

**The list predicted this before the pilot ran.** Judgment calls 1, 3 and 10 in that document name
`ipcHandlers.ts` and `ipc.ts` wholesale, `pnpm-lock.yaml` and the distribution block as the entries
expected to produce noise, and pre-authorise dropping them if it proved out. It proved out.

**The label's merge gate is already redundant.** ADR-0005 says every agent PR gets human review
through the pilot and no agent PR auto-merges. Against that baseline the `evidence-affecting` label
adds nothing at merge time. Its whole marginal cost is the ADR-0004 paperwork. What actually stalled
redesign wave 2 for days was the blanket no-auto-merge rule, the one-open-PR limit, and four PRs
stacked on each other's branches, one of which (#769) ran no CI at all before it was replaced.

## Decision

### The backstop list is tiered

Every include-list entry carries `blocking` or `advisory`.

A **blocking** hit is a blocking review finding, as before: the PR owes an Evidence impact section, a
known-answer test or a written justification, and preserved backward verification. It gets human
review and never auto-merges.

An **advisory** hit produces a one-line reviewer disposition naming which region of the file the diff
touched. It owes no Evidence impact section and does not by itself make the PR evidence-affecting. A
reviewer who finds the diff does reach evidence behaviour relabels it blocking, and the full
obligations apply.

The advisory tier is the cross-process contracts block, the software distribution block except
`scripts/build-verifier.mjs` and `sea-config.json`, and nothing else. Everything else stays blocking,
including `src/main/services/db/**`.

The `evidence-affecting` label applied at triage is unchanged and remains the primary trigger. The
tiers govern the mechanical backstop only. A labelled PR owes the full obligations whatever its diff
touches.

### The dispatch slot widens from one to three

At most **three** agent cycles in flight, not one. ADR-0006's two markers and its claim-comment
protocol are unchanged; the routine now counts them and dispatches while the count is below three.

The collision modes ADR-0006 was written for are addressed by worktree isolation, which
`birdbrain-implementer` already uses: each cycle gets its own worktree and its own branch. The
failure that motivates raising the number is the opposite one. Serialisation pushed wave 2 into
stacking branches to make progress, and stacked branches are how a PR runs no CI and cannot rebase.

**No cycle may branch from another cycle's branch.** Every agent branch is cut from `main`. This is
the rule the wider slot buys and it is not optional; without it three slots produce the wave-2
failure three times over.

### Non-evidence agent PRs may auto-merge

An agent PR merges without a human when all of these hold:

1. Every required check on `main` is green.
2. `agent/pre-pass` reports `success`.
3. The PR carries neither `evidence-affecting` nor a blocking-tier backstop hit.
4. It is not a draft.

A pre-pass verdict of `failure` blocks the merge exactly as it does now.

ADR-0005 deferred this decision until post-pilot review-burden data existed. 349 merged PRs are that
data.

The pre-pass stays in the condition rather than green alone because ADR-0011 finding 6 is the case
where CI was green and the reviewer caught the false success claim anyway. Removing the reviewer from
this condition would remove the check that has already earned its place once.

**Evidence-affecting PRs never auto-merge.** Unchanged from ADR-0005, and not revisited here.

### The exit bar keys on the blocking tier

Clause 2 of the believability streak reads "no defect on an evidence-affecting path reaches `main`
without being named," defined against this list. It now means the **blocking** tier. An advisory-tier
defect does not break a clean cycle.

Stated explicitly rather than left inferable, because a tiered list quietly redefines the exit bar
otherwise, and the exit bar is what governs whether this pipeline ever runs on a schedule.

## Consequences

- Throughput rises on three axes at once: fewer PRs owe evidence paperwork, three cycles run instead
  of one, and the non-evidence ones stop waiting on a human. Whether that is too much at once is a
  real question, and the answer is the streak in ADR-0011: a violation resets it to zero and this
  decision gets re-argued with new evidence.
- Auto-merge needs required status checks on `main`, and they already exist. Ruleset `14967088` is
  named `master` for historical reasons but its condition is `~DEFAULT_BRANCH`, and it requires
  `lint`, `typecheck`, `test`, `build` and `e2e`. No ruleset change is needed for this decision.
- `agent/pre-pass` is **not** one of those required checks and is not made one here. #488 shows why:
  Dependabot workflows get a read-only `GITHUB_TOKEN` under both `pull_request` and
  `pull_request_target`, so the seed cannot write the status on a Dependabot PR, and a required
  context that never reports would block all 17 of them permanently. Condition 2 above is therefore
  enforced by the dispatcher reading the context, not by the merge box. That is weaker in one
  specific way and it is worth naming: a human clicking merge is not stopped by a missing or failed
  pre-pass. Humans are the back gate and may overrule it; the dispatcher may not.
- The advisory tier has a known exposure. `src/main/services/settings.ts` is advisory and persists
  the operator identity that `certification.ts` embeds verbatim in an export. The judgment is that
  the certification path is blocking and is where such a change becomes visible. If an advisory-tier
  defect reaches `main` by that route, promote the entry rather than argue with the evidence.
- Three concurrent cycles produce more review-feedback rounds arriving at once. That is a load
  problem, not a safety one, and ADR-0011 already declined to treat round count as a safety measure.

## Alternatives rejected

**Drop the broad entries instead of tiering them.** A dropped entry stops being visible, and the
reason it was listed stops being reviewable. `pnpm-lock.yaml` really does determine shipped code; the
problem was never that the fact is false, it was that it fires on every dependency bump. Advisory
keeps the fact and drops the tax.

**Let the evidence label carry the whole gate and delete the backstop.** ADR-0005's reasoning holds:
"looks harmless is exactly the judgment that fails under review pressure," and a list is checkable
when attention is not. The measurement in the context section argues for tiering, not for deleting.

**Keep strict-serial and only fix stacking.** Tempting, since stacking is the proximate cause. But
serialisation is what made stacking the only way to make progress in a wave, so removing the symptom
leaves the pressure that produced it.

**Auto-merge on green alone, no pre-pass.** Rejected on ADR-0011 finding 6, cited in the decision.
