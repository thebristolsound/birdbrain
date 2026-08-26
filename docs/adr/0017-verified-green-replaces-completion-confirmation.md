# A green verify block at head replaces completion confirmation

**Status:** Accepted

**Date:** 2026-08-25

## Context

The global instructions say a task is not complete until the maintainer confirms. In practice the
maintainer confirms when the verification evidence is green and withholds when it is not, which
re-derives a boolean the toolchain already computed. The background-jobs carve-out in CLAUDE.md
already made this trade for unattended work: verify, then finish, with no confirmation wait.
Interactive sessions still wait.

The failure the confirmation rule guards against is real and has a name in this repo: ADR-0011
clause 1, the false claim of success. PR #423 reported green while CI was red because the verify
loop was a strict subset of CI. The guard worth keeping is the evidence, not the wait.

## Decision

In interactive sessions, the agent reports a task complete without waiting for confirmation when
all of these hold:

1. The full verify block ran against the current tree state: `pnpm lint`, `pnpm typecheck`,
   `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, plus `pnpm build:extension` when
   `extension/` changed, plus `pnpm test:coverage` and `pnpm coverage:diff` when the work is
   headed for a PR.
2. Exit codes were captured directly at the command, not inferred from output, and any edit made
   after a verify run invalidates it: the block runs again at head before the claim.
3. The report shows actual output, not a summary of belief.
4. Nothing in the task's acceptance rests on a check the agent could not run, such as visual
   verification in the running app or an external system. If something does, the agent names
   exactly which check is outstanding, and completion waits on that check - run it, or hand it to
   the maintainer - rather than on a general confirmation.

"Complete" means the work is done and verified, not merged. Merging stays a human act, and
nothing here touches the PR gates (ADR-0005, ADR-0014).

## Consequences

- The confirmation that carried information - did the human check the thing only a human can
  check - survives as criterion 4, narrowed to naming the specific outstanding check.
- The confirmation that carried none, re-reading a green block, is gone.
- A false completion claim under this ADR is the same failure ADR-0011 clause 1 measures for
  unattended cycles, and it gets the same response: the maintainer names it, and this ADR gains a
  constraint or is revoked.
- This is the riskiest of the three standing-approval ADRs (0015, 0016, and this one), and it is
  deliberately its own ADR so it can be rejected or constrained without touching the other two.

## Alternatives rejected

**Confirmation only for evidence-affecting work.** The verify block does not vary by path; what
varies is the PR gate, which already handles the evidence tiers. Splitting confirmation by path
duplicates the tier list in a second place.

**Report "probably done" and let the maintainer upgrade it.** That is the current state with
softer words. Hedged completion claims are exactly what criterion 3 forbids.

## Related

- ADR-0011 - clause 1 defines the failure mode this ADR must not reintroduce.
- ADR-0015 and ADR-0016 - the other two standing-approval decisions, each open to veto on its own.
