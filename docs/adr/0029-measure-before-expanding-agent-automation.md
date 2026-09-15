# Measure before expanding agent automation

**Status:** Accepted

**Date:** 2026-09-13

Extends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md) with a restart condition
for scheduled Dispatch and Doc curator. Its queue, review, and issue-filing rules remain
in force.

## Context

ADR-0028 records unsustainable agent spend and maintainer review load. A subsequent
cost-reduction plan proposed verification reuse, shared change classification, instruction
reorganization, and budget accounting. Implementing all of them before measuring their
benefit would create more pipeline maintenance in response to a pipeline cost problem.

## Decision

Remove duplicate full-suite execution and move occasional instruction reference material
behind explicit pointers. Defer automated reuse of continuous integration (CI) results,
shared change classification, and elaborate budget accounting until measurements justify
their maintenance cost.

Keep scheduled Dispatch and Doc curator disabled until basic spending limits are verified
and the maintainer explicitly authorizes restart. Verify limits against the selected command
line interface (CLI) version, including any additional calls or subagents. If unattended
operation resumes, budget exhaustion must not automatically grant the same task a fresh
allocation on the next scheduled run. Implementing those controls is separate future work;
the current pause does not prove limits work.

Evaluate agent usage per merged, maintainer-selected task alongside maintainer intervention.
A reduction that requires more intervention is not success. Record unavailable historical
usage as unknown, and identify any provisional limits as maintainer-selected allocations.
Calibrate those allocations in a separately authorized supervised rollout.

## Consequences

Scheduled implementation and documentation curation remain unavailable during the pause;
the maintainer handles necessary work interactively. Local verification and CI still repeat
some checks. We accept that cost until measurements justify reducing it. The coverage floor,
source review, and human review of evidence-affecting changes remain required.
