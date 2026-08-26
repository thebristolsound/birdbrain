# A verdict survives a sha that changes no authored content

**Status:** Accepted

**Date:** 2026-08-25

## Context

PR #961 was reviewed at `f8984823` and the pre-pass approved it. `main` was then merged into the
branch, producing head `c507d66f`. Three things followed mechanically:

- `pre-pass-gate.yml` re-seeded `agent/pre-pass=pending` on the new sha, because it seeds on any
  new head.
- The body's `## Verification` block drifted, because `main` had brought in `fa857710`, which adds
  tests, so the recorded total no longer matched a fresh run.
- Under ADR-0018 as written, "any push invalidates the block," the PR now owed a regenerated block
  and, by the dispatch skill's pin-the-sha rule, a fresh verdict.

The re-review would have re-derived the same findings over the same lines. The PR's authored
contribution did not change: `git diff origin/main...f8984823` and `git diff origin/main...c507d66f`
hash identically. Both describe 11 changed files and 1589 insertions. The cost of honouring the rule was roughly
twenty minutes of reviewer model time plus a local suite run, spent to reconfirm a diff that no
one had touched.

The rule was written for authored pushes, which is the case it describes correctly. A merge
commit that resolves cleanly is a different event wearing the same clothes: the head sha moves,
and nothing the reviewer read has changed.

Two facts bound the problem rather than eliminate it. GitHub reports whether a branch actually
needs updating, through `mergeable` and `mergeable_state`, so a back-merge is a response to a
signal rather than routine hygiene. And this repository's ruleset sets
`strict_required_status_checks_policy` to false, so being behind `main` is not by itself a reason
to merge anything into a branch.

## Decision

### The test is authored content, not the sha

A verdict attaches to what the pull request contributes, which is
`git diff <base>...<head>`. When a new head produces a byte-identical diff against the base, the
previous verdict still describes the work, and the reviewer does not run again.

```shell
git diff origin/main...<reviewed-sha> | sha256sum
git diff origin/main...<new-head>    | sha256sum
```

Equal hashes mean carry forward. Unequal hashes mean review, and this covers every case where a
merge was not clean: a conflict someone resolved by hand is authored work, and it changes the
diff, so it reviews like any other edit. The review is scoped to what changed rather than
reopening the whole diff.

### Carrying a verdict forward

Carrying forward is a set of writes, not a silence. The dispatcher:

1. Confirms every required check is green at the new head, read with the pinned-sha protocol. An
   unreadable or non-green check ends the carry-forward and the PR waits.
2. Posts the `agent/pre-pass` status on the new sha with the original verdict, whose description
   names the sha the review was performed at.
3. Comments the carry-forward on the PR, stating both shas, the equal diff hashes, and what
   produced the new head.
4. Annotates the `## Verification` block rather than regenerating it, recording the sha the block
   was measured at and that the delta to head is a clean merge of `main`.

### Narrowing the invalidation clause

ADR-0018's "any push invalidates the block" is narrowed to any push that changes authored
content. Its purpose is untouched: a body must never claim a green run over a tree nobody ran.
Under a carried-forward block that claim is still true, and the annotation is what keeps it
honest about which tree produced the figures.

### Back-merging is a response to a signal

A branch is updated from `main` when GitHub says it needs to be, which is `mergeable: false` or a
`mergeable_state` of `dirty`, or when a required check genuinely needs the merged tree. Being
behind is not a reason on its own while the ruleset is non-strict. This keeps the carry-forward
path from being load-bearing for churn nobody needed.

## Consequences

- A clean back-merge costs a status write and a comment instead of a reviewer run and a full
  verify loop. On the #961 shape that is minutes rather than tens of minutes.
- The dispatcher must compute two hashes before deciding, which is cheap and mechanical, and it
  records them in the carry-forward comment so the claim is checkable rather than asserted.
- A carried-forward verdict is weaker in one specific way, and the annotation must not hide it: a
  semantic conflict between `main` and the branch would not change the diff hash. The required
  checks at the new head are what covers that case, which is why green CI at head is a
  precondition rather than a nicety.
- ADR-0020's seeded `pending` still appears on the new sha. Carrying forward resolves it, so the
  expiry path is not reached.

## Alternatives rejected

**Re-review every new head.** The rule ADR-0018 already implied. Rejected on measured cost: an
identical diff produces an identical verdict, and the reviewer is the most expensive instrument
the pipeline has.

**Suppress the seeded status for merge commits.** Attacks the symptom in CI rather than the
decision in the protocol, and it would make a genuinely conflicted merge look reviewed when it is
not. The seeding stays honest; the dispatcher decides.

**Forbid back-merges entirely.** Tempting while the ruleset is non-strict, and wrong: GitHub does
report branches that genuinely need updating, and a conflicted branch has to be reconciled
somewhere. The signal decides, not a blanket ban.

## Related

- ADR-0018 - the invalidation clause this narrows.
- ADR-0020 - the seeded `pending` a carry-forward resolves.
- ADR-0014 - branches are cut from `main`; this governs what happens when one rejoins it.
- #961 - the PR whose clean back-merge produced the case.
