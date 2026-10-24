# Stale agent issues spare high-impact work and warn first

**Status:** Accepted

**Date:** 2026-10-23

Amends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md) rule 4. The maintainer chose this
change on 2026-10-23 after an audit of what the stale-agent-issues workflow had closed.
ADR-0028's filing gate, hand-picked queue and `process` freeze are unchanged.

## Context

ADR-0028 rule 4 closes, as not planned, any open issue the machine account filed that has had
no activity for 14 days and carries neither `queued` nor `agent-wip`. The rule was meant to
retire the backlog the old file-every-defect rule had built up, and most of its closures did
that: 167 of the 176 issues it closed by 2026-10-19 went in the three runs of September.

The audit read every closure from the run logs. The workflow had closed 176 issues, and none had
been reopened. Among them:

- 36 carried `evidence-affecting`, one of them also `security`. That one, #992, lets page
  script trigger a selection-bar capture with no Operator gesture, and the defect is still in
  `extension/src/selectionBar.ts`.
- 10 carried `ready-for-human`, so they were waiting on the maintainer, not on an agent.
- 42 carried `needs-triage`, so nobody had decided whether they were worth keeping.
- Of the 9 the machine account filed after ADR-0028's filing gate took effect, so each had
  already passed the "user-visible or evidence-affecting" test, 7 were evidence or
  court-admissibility defects.

None got a warning. An issue closed on a Monday with one comment, and the 14 quiet days that
triggered it measured how much of the maintainer's attention was free, not whether the defect
was still real.

## Decision

1. **High-impact and waiting issues are exempt.** An issue carrying `evidence-affecting`,
   `security`, `court-admissibility`, `blocker`, `severity:blocking`, `ready-for-human` or
   `needs-triage` is never warned or closed, alongside the existing `queued` and `agent-wip`.
2. **A warning comes first.** An agent-filed issue with no activity for 7 days gets the `stale`
   label and a comment saying it closes at the next weekly run. An issue still untouched at that
   run closes as not planned. The time from last activity to closing stays about 14 days.
3. **Activity clears the warning.** A comment, an edit or a label change after the warning takes
   `stale` off, and the 7 days start again. So does adding an exempt label.

`.github/scripts/stale/run.sh` holds the logic and the exempt list, and
`tests/staleAgentIssues.test.ts` pins each case.

## Consequences

- An evidence defect an agent filed stays open until a human closes it. The backlog of such
  issues can grow, but ADR-0028's filing gate bounds how fast: the old rule closed 9 issues filed
  in the six weeks after the gate.
- Every closure is announced a week ahead, so a closure the maintainer would not have chosen can
  be stopped by touching the issue.
- The issues already closed are not reopened by this decision. Each is to be checked against the
  current code, and the maintainer chooses which to reopen.

## Alternatives rejected

- **Disable the workflow.** Agent-filed issues outside the exempt labels would then stay open
  until the maintainer closed each by hand, which is the backlog ADR-0028 removed.
- **Exempt the labels without a warning.** It protects the issues that carry a label, but an
  unlabelled issue that matters still closes with no notice.
