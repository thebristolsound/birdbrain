# Capture engine stage 2: orchestration handoff

**Status:** active

An orchestrating session walks the rest of the stage 2 programme
(`docs/plans/2026-10-31-capture-engine-stage-2.md`, "the stage 2 plan") through build, review,
preflight and merge. This file records what shipped, what is in flight, the next command and the
open questions, and it is updated after every completed slice. The maintainer's rulings of
2026-11-05 are in the stage 2 plan's "Rulings, 2026-11-05" section.

## Authority

The maintainer granted the orchestrating session the following on 2026-11-05, in the message that
started it and apart from the fifteen rulings:

- **Merges.** The session merges a PR that is not evidence-affecting with
  `.claude/skills/merge-pr/scripts/merge.sh <n>` after CI is green and the reviewer approves. An
  evidence-affecting PR stops at ready for review, and the `merge` label goes on only after the
  maintainer's approving review or `approved` label is on it at head.
- **Release.** The session cuts the next beta carrying the schema 7 verifier with the `release`
  skill, with ungated fixes merged before the version bump.
- **Concurrency.** At most two implementation PRs are in flight, with no shared hot files. One
  migration PR is open at a time. `captureLifecycle.ts` goes to #1832, then to #600. One
  `pnpm preflight` runs at a time on the Linux host.
- **Still the maintainer's.** Approving #543, a new dependency, destructive or irreversible
  actions, product or UX calls the rulings do not cover, #1628, and evidence-affecting merges.

## Slices

| Order | Slice | State |
| --- | --- | --- |
| 1 | Rulings docs PR, rulings posted on their issues, ruling 9 labels | done: #2066 |
| 2 | Schema 7 beta release | done: v1.0.1-beta.26 (#2067) |
| 3 | #1832, taken over from its build thread | #2068, fix round 1 |
| 4 | #1831 follow-up part A: five Change verdicts outside #2068's files | building |
| 4b | #1831 follow-up part B: the start dialog and panel verdicts, the empty Egress label | waits on #2068 merging |
| 4c | #1831 hand checks (ruling 13), then the CI job PR (ruling 14) | Windows half running; P17 waits on #2068 |
| 5 | Duplicate rows (ruling 4 and the browser fields #2068 found) and received Persona rows (ruling 5) | after #1832 on `captureLifecycle.ts`, before #600 |
| 6 | #1833 (rulings 6 and 7) | waits on the release and slice 5 |
| 7 | #1499 (ruling 8), then #1501 | waits on the release and slice 5 |
| 8 | #1824 remainder (ruling 10) | not started |
| 9 | #600 with #599 | waits on #1832 merging |
| 10 | #543 draft, #546, tester guide issue, close #1498 | not started |
| 11 | #1828 (ruling 15) | Windows rows running with 4c |
| 12 | Close-out under roadmap rules 2 and 4 | last |

## Log

### 2026-11-05

- **Shipped.** PR #2065 (the designer's review of the launcher build) merged as 875474a4 after
  the reviewer approved it with five non-blocking findings. The two that matter for slice 4: the
  review's answer 1 says the details panel folds at 1440, but by its own rule it docks at 1440
  and folds below about 1,422; and the new 480-pixel viewer rule moves the narrow end of the
  docked rail from about 1,020 to about 1,135 by the 2026-11-01 handoff's minimums.
- **In flight.** #1832 is building in another thread's child on branch
  `feat/capture-clicked-launched-browser`; no PR yet. This branch,
  `docs/stage-2-rulings-2026-11-05`, carries the rulings.
- **Not done.** The orchestrating session found no Claude Design thread on the Windows machine's
  Birdbrain project, so the 1440 correction has not been sent. The designer's branch
  `drafts/2026-11-04-launcher-build-design-review` is on GitHub only; the teardown and merge
  skills delete local branches, and a hook blocks deleting a remote branch by hand, so it is
  still there.
- **Rulings posted.** Each ruling is on its issues (#1828, #1832, #1831, #1498, #1833, #1499,
  #1501, #600, #599, #1500, #1824, #543), and #1500 came off ready-for-agent. #600 and #599 get
  ready-for-agent when #1832 merges.
- **Rulings PR.** #2066 holds this branch. Its first review asked for the step text and the
  Persona plan's line references to match the rulings; the second round fixes both.
- **Release.** The bump to `1.0.1-beta.26` is committed on `chore/release-1.0.1-beta.26` in a
  scratch tree. Its first preflight failed on one timing test in the launcher suite under load
  (`launcher.test.ts:851`, a 1 ms tab refresh); the file passed alone three times, and the
  preflight is running again.
- **Shipped, later the same day.** #2066 (the rulings in both plans) merged as a28b83a8 after
  three review rounds, and #1498 closed. The bump #2067 merged as f08fe66b and release run
  42010872538 published `v1.0.1-beta.26` as a prerelease with the Windows, Linux and macOS files,
  so the schema 7 gate on #1832, #1833 and #1499 is met.
- **#2068 (#1832).** The orchestrating session took it over at ca50e6e8, added the macOS launch
  gate (95e984f5) and its docs wording (05f20d7e), and ran a green preflight at 05f20d7e. The
  reviewer asked for changes: the launcher timing test is red in CI, the signed address goes
  stale on pages that change address without reloading, signed target counts overstate, the
  report misdescribes pinning and omitted text bodies, private-window tabs are recorded in
  memory, and no test catches an empty stored archive. The test-reliability review added four
  unpinned claims. A delegated fix round is working in the builder's worktree.
- **Windows thread.** One thread on the Windows machine runs the branded Chrome, Edge and Brave
  launches for #1831 and the #1828 Windows rows, and pushes `docs/1828-windows-probe-rows`.
- **Next command.** Read the fix round's result, then rerun both reviewers at its head.

## Open questions

- Where does Claude Design run, so the session can send it the 1440 correction?
- May the session delete the remote branch `drafts/2026-11-04-launcher-build-design-review`
  through the GitHub API, given that the skills cannot and a hook blocks `git push --delete`?
