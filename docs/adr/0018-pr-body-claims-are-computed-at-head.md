# Pull-request body claims are computed at the head sha they describe

**Status:** Accepted

**Date:** 2026-08-25

## Context

PR #857 took five pre-pass rounds. Classified from the round records on the PR:

- Round 1's blocking finding was a code defect (BB1, a cancelled draft overwriting its own saved
  note). The round system caught it and the fix held. This is the review working as intended.
- Rounds 2, 3, and 4 were each held open solely by body defects, and all of them sat in the
  `## Verification` block: BB4, a stale table whose file list omitted three changed source files;
  BB5, a stale block replaced wholesale; BB7, a coverage-gap justification that was false
  (`ipcHandlers.ts` does have a unit test, and one of the three new channels was exercised by
  nothing).
- Round 4 reviewed body accuracy only; the diff was not re-read. Round 5 approved.

Three of five rounds existed because the body's description of the work was wrong, not because
the work was. The round 2 fix note records that #856's e2e verification block failed the same way for
the same reason, so this is the wave's pattern, not one PR's. Each body defect cost a full
review round: the most expensive unit the pipeline has, spent on prose that a command could have
generated correctly.

The mechanism is already known and filed: `coverage:diff` and the verification figures describe
the working tree, so any edit after the block is written makes it stale (#508). What is missing
is the rule that makes staleness a protocol violation rather than a per-round discovery.

## Decision

### The Verification block is generated last, at head

The `## Verification` section of an agent PR body is written from a verify-loop run against the
head sha under review, with exit codes captured at the command. Any push invalidates the block;
it is regenerated before review is requested, every time. A block describing any other tree
state is a blocking body defect by definition, with no argument about how close it is.

### Derive, do not recall

Any figure in the body that a command can compute at head - changed-file lists and counts,
coverage rows, test totals, formatter counts - comes from running the command, not from memory
of an earlier run. BB7's false justification and the two stale tables were all recalled figures
that a one-line command would have contradicted.

### Body-only rounds resolve in place

When every blocking finding in a round is a body defect and the head sha is unchanged, the fix
and its re-verification happen inside the same round: the reviewer re-checks the corrected body
against the sha already reviewed, without a new code pass. The code review from that sha stands.
Rounds 3 through 5 of #857 were three round trips over an effectively settled diff; under this
rule they are one.

### The instrument

The dispatcher records, per PR, how many rounds were body-only. The number this ADR predicts is
zero once the generate-at-head rule is followed; a nonzero count names the PR and the block that
broke it, and the protocol gets amended with that evidence.

## Consequences

- The pre-pass keeps reviewing body accuracy - the gate stays. What changes is that body
  accuracy becomes cheap to achieve (run the commands, paste the output) and cheap to re-verify
  (same round, same sha).
- Regenerating the block after every push costs a full verify-loop run each time. That cost
  already exists as the #508 rule for coverage; this ADR extends it to the block that reports it.
- Enforcement lives in the implementer and dispatcher instructions and in the pre-pass checklist,
  tracked by the implementation issue filed with this ADR.

## Alternatives rejected

**A body template alone.** #857 had the right sections; the content was stale. Templates fix
shape, and shape was never the defect.

**Drop the Verification section and point at CI.** CI does not run `coverage:diff` semantics
against the working tree the agent claims to have verified, and ADR-0011 finding 6 is the case
where green CI plus an unexamined claim still lied. The block is the claim being checkable.

## Related

- ADR-0011 - finding 6, the false success claim; the failure class body accuracy guards.
- #508 - coverage figures describe the working tree; re-run after any edit.
- #857, #856 - the round records this ADR is measured from.
