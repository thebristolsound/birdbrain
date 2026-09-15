# Reduce agent overhead in small steps

Status: Approved scope implemented. Verification evidence is recorded separately.

Audience: Birdbrain maintainers.

This plan replaces the four-phase implementation commitment in
`2026-09-13-agent-workflow-cost-reduction.md`, supplied from the `t3code-12f44f1f`
worktree. The supplied file remains unchanged. The maintainer approved this narrower
scope on September 13, 2026, after questioning whether the original work was premature
optimization. [ADR-0029](../adr/0029-measure-before-expanding-agent-automation.md)
records the maintenance tradeoff and automation restart conditions.

## Implement the small improvements

- [x] Remove the standalone full unit-suite run from preflight. Keep the coverage
  run, OpenSSL and `jq` requirements, the 90% diff-coverage floor, and revision checks.
- [x] Remove the duplicate full-suite requirement from reviewer instructions.
  Preserve independent source review, targeted reproductions, and live CI checks.
- [x] Update verification examples and test execution, failure reporting, and stale
  result rejection.
- [x] Move the architecture, website, and testing sections out of the root
  instructions with explicit reading triggers. Preserve their rules and the existing
  synchronized `CLAUDE.md` and `AGENTS.md` convention.
- [x] Pause hosted Dispatch and Doc curator. Both were active when checked;
  GitHub confirmed `disabled_manually` for both after the authorized pause.
- [x] Run the focused regression and posting checks on Node 20: 20 preflight tests
  pass, posting fixtures report zero failures, and all six typecheck projects pass.
- [x] Verify the moved sections preserve their original text, root copies match,
  and relative links resolve. New plan and ADR prose have zero Vale errors; copied
  instruction prose retains existing Vale findings.

Run `pnpm preflight` after committing. Its uncommitted `.preflight/verification.md`
records the full check results at the tested revision; keep that output out of commits.

## Measure before expanding scope

Each root instruction file fell from 39,646 bytes to 18,887 bytes. The detailed
reference text remains available when relevant. This is a context-size measurement,
not a measured reduction in token usage or billing. Preflight and reviewer instructions
each prescribe one coverage execution instead of a normal execution plus coverage.
CI reuse remains deferred, so this change does not establish the original five-to-two
execution target.

For subsequent comparable work, record available verification duration and agent usage
per merged, maintainer-selected task, including failed attempts and maintainer
intervention. Missing historical usage blocks savings claims, not these improvements.
Use existing outputs; do not add a reporting service or launch paid measurement runs.

Defer shared change classification, automated CI evidence reuse, import-based instruction
loading, and elaborate budget accounting. Keep automation paused until basic limits are
verified and restart is explicitly authorized. Resolve exhaustion suppression and any
provisional allocations as part of that future restart work.
