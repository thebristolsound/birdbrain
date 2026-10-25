# Test reliability reviewer

**Status:** active

A reviewer that asks whether the tests a pull request adds or changes would fail if the behaviour
they claim to cover broke. Diff coverage (`scripts/diff-coverage.mjs`) already shows that changed
lines ran under a test. It does not show that any assertion depends on them: a line can execute
under a test that asserts nothing about its result. Issue #1217 is the recorded case: a fail-closed
test passed with and without the fix it was written for.

## Two layers

1. **A deterministic probe, run in CI on every pull request.** `scripts/test-reliability/cli.mjs`
   (`pnpm test:reliability`) runs two experiments against the unit tests and reports what survives.
   It costs runner minutes and no model calls.
2. **A reviewer agent for the claims a script cannot read.**
   `.claude/agents/test-reliability-reviewer.md` reads each added or changed unit test and
   end-to-end spec, states what its title claims, and checks the assertions against that claim.
   It reads the probe's results as evidence and runs targeted probes of its own.

## The probe

Both experiments edit tracked files in the working tree and restore them afterwards, so the probe
refuses a dirty tree and keeps a journal under `.cache/test-reliability/` while files are edited.

- **Revert probe.** The probe restores every source file the branch changed to its merge-base
  content, keeps the branch's tests, and reruns the test files the branch added or changed. A test
  the branch added or edited that still passes did not need the change. That is expected for a
  refactor and a finding for a fix or a feature.
- **Mutation probe.** On the source lines the branch added, the probe makes one small change at a
  time: it flips a comparison or a logical operator, swaps a boolean literal, drops a negation,
  negates an `if` condition, replaces a returned value with `undefined`, or deletes a call
  statement. It reruns the unit tests that import the file (`vitest related`). A mutant that
  leaves every test green is a changed line no assertion depends on.

The probe is capped by mutant count and wall-clock budget, picks mutants evenly across the changed
lines when there are more than the cap, and says how many it skipped. End-to-end specs are not
probed: each mutant would need a fresh `pnpm build`. The agent covers them.

## Decisions taken

- **Advisory, not required.** The CI job reports in its job summary and as line annotations, and
  exits 0 when it finds survivors. It fails only when the probe cannot run. Equivalent mutants
  (a change that cannot alter behaviour) and intended refactors make false positives certain, so
  the job is measured before anyone proposes gating on it. The Jev lens took the same
  shadow-first route (ADR-0031).
- **No new dependency.** Mutation sites come from the TypeScript compiler API, already a
  development dependency, rather than from a mutation framework such as Stryker.
- **No paid runs.** The agent is for interactive use. Adding it to the scheduled PR review or the
  dispatch pre-pass would add model spend to unattended runs, which ADR-0029 reserves for the
  maintainer to authorize. `birdbrain-reviewer` reads the CI job's result instead.
- **Static test smells stay with the slop audit.** Skipped tests, assertion-free tests and mocked
  subjects are the slop audit's phase 5 checks (`docs/specs/2026-09-03-slop-audit-design.md`).
  This work does not duplicate them.

## Slices

- [ ] Probe library and command line, with unit tests (`tests/testReliability/`).
- [ ] `pnpm test:reliability` script and coverage include for `scripts/test-reliability/`.
- [ ] `.github/workflows/test-reliability.yml`, advisory.
- [ ] Reviewer agent, and a paragraph in `birdbrain-reviewer` on reading the job.
- [ ] Testing guide section and the `CLAUDE.md` command line.
