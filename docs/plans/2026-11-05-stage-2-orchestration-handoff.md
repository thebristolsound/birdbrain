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
| 1 | Rulings docs PR, rulings posted on their issues, ruling 9 labels | done: #2066 merged; #600 and #599 took ready-for-agent on 2026-11-06 |
| 2 | Schema 7 beta release | done: `v1.0.1-beta.26`, tagged 2026-11-05 |
| 3 | #1832, taken over from its build thread | merged as #2068, fixed in #2140; the issue stays open for two maintainer questions, 2 and 4 |
| 4 | #1831 follow-up: the designer's 12 Change verdicts and the empty Egress label | five verdicts merged in #2069; no PR has taken the rest |
| 4a | #1831 hand checks (ruling 13), then the CI job PR (ruling 14) | Windows launches reported on #1831; the Linux checks and the CI job PR are not done |
| 5 | Duplicate and received Persona rows (rulings 4 and 5) | done: #2091 |
| 6 | #1833 (rulings 6 and 7) | unblocked; no PR, not queued |
| 7 | #1499 (ruling 8), then #1501 | unblocked; no PR |
| 8 | #1824 remainder (ruling 10) | merged as #2093; #1824 is open for the maintainer to accept one hover text |
| 9 | #600 with #599 | ready-for-agent, not queued, no PR; the brief on #600 puts the three report files after #1833 |
| 10 | #543 draft, #546, tester guide issue, close #1498 | #1498 closed; the rest is not started |
| 11 | #1828 (ruling 15) | done: #2072 closed it, and #2071 takes the rows left |
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
- **Next command.** `gh pr list --search 1832 --state open` to pick up #1832's PR for takeover.

### 2026-11-23

No session updated this file between 2026-11-05 and this entry. A session that was not the
orchestrating session wrote this entry on 2026-11-23 from GitHub and `origin/main` at d962cd30,
to prepare #600 for the maintainer's queue. It built nothing.

- **Shipped since 2026-11-05.**
  - The rulings PR, #2066, merged as a28b83a8 on 2026-11-05.
  - The release PR, #2067, merged as f08fe66b, and `v1.0.1-beta.26` was tagged on 2026-11-05. The
    tag contains the schema 7 verifier (6c488f05) and predates every `launched` writer.
  - #2069 (c2d8b395, 2026-11-05) built five of the designer's twelve Change verdicts, the ones
    whose files #1832's PR did not touch. Its description leaves the start dialog and panel
    changes to a second PR.
  - #2072 (b6744d85, 2026-11-05) added the Windows probe rows for Chrome, Edge and Brave 156 and
    closed #1828. #2071 takes the rows left, among them macOS, Linux Edge, regular Brave, Snap
    and Flatpak, and the Windows checks the run could not make.
  - #1498 closed on 2026-11-05 under ruling 11.
  - #2068 (4ef1e05b, 2026-11-06) merged clicked `launched` Captures from branch
    `feat/1832-launched-clicked-capture`. #2140 (ac0bfc76, 2026-11-10) fixed the four defects a
    review of #2068 found (#2138 and #2139, both closed).
  - #2091 (e27138c3, 2026-11-07) merged the Duplicate and received-row Persona change, rulings 4
    and 5.
  - #2093 (39608b65, 2026-11-07) merged #1824's remainder, ruling 10.
  - #2209 (e4e4600b, 2026-11-17) moved the finish of `background` and `launched` Captures into
    `src/packages/capture-finish/`, which the evidence-affecting paths assessment lists at the
    blocking tier (the `src/packages/capture-finish/**` row). #600's brief predates that move.
- **Labels.** The maintainer moved #600 and #599 from ready-for-human to ready-for-agent on
  2026-11-06, as ruling 9 says. Neither carries `queued`. #1500 is ready-for-human.
- **In flight.** Nothing. No open PR names #1833, #1499, #1501, #600 or #599, and no local or
  remote branch for them was found.
- **Not done.**
  - #1832 is open and ready-for-human. #2068 left four questions for the maintainer, and on
    2026-11-23 nobody had answered them on the issue. The 2026-11-24 entry records two answers;
    questions 2 and 4 are under "Open questions" below.
  - #1831 is open. The designer's other seven Change verdicts and the empty Egress label have no
    PR that names #1831. The chrome consolidation (#2201, built in #2205, #2228, #2229, #2233
    and #2240) changed the top bar and the session controls after #2069, so the seven verdicts
    need reading against `main` before anyone builds them. The Wayland pop-out and the keyboard
    shortcut check on the Linux desktop are still owed, and no PR adds the CI job for the
    known-answer suite.
  - The Windows launches of 2026-11-05 found that Birdbrain refuses every Microsoft Edge launch.
    #2070 holds that defect and is open.
  - #1824 is open for one item: the maintainer accepts or replaces the import button's hover
    text, "Checking whether import needs your acknowledgement".
  - #543 is ready-for-human. The triage comment of 2026-11-15 asks whether an agent writes its
    acceptance criteria now or waits for the Persona capture work. #546 waits on #1499. No
    tester guide issue was found.
  - The remote branch `drafts/2026-11-04-launcher-build-design-review` is still on GitHub.
  - Whether the 1440 correction reached Claude Design is not recorded anywhere this session read.
- **Order for #600.** #600's four blockers are met: #1832's code merged, `v1.0.1-beta.26`
  carries #1830's verifier, #1829 and #598 are closed. #2052 already shared the Selector matcher
  and made the regex timeout reportable, so those parts of #600's brief are done. #2045 added a
  planned Capture Scope glossary entry, and `CONTEXT.md` still marks `launched-passive` as
  planned, so the brief's glossary changes are not done. The brief still orders `reportHtml.ts`,
  `certification.ts` and `verifyRunbook.ts` after #1833, and the Concurrency rule above keeps
  two PRs off shared hot files. So #1833 goes first, or the maintainer reverses that order.
- **Next command.** `gh issue list --label queued --state open`, to see whether the maintainer
  queued #1833 or #600. An unattended run picks up neither until one carries `queued`.

### 2026-11-24

- **Answered.** The maintainer answered two of #1832's four questions, recorded in comment
  7140881445 on #1832. A `launched` record keeps leaving out the bodies the browser returns as
  text and adds no marker, and the zero pinning counts are accepted with no change to the record
  format.
- **Still open.** Questions 2 and 4 on #1832, and the order of #1833 and #600.

## Open questions

- Where does Claude Design run, so the session can send it the 1440 correction?
- May the session delete the remote branch `drafts/2026-11-04-launcher-build-design-review`
  through the GitHub API, given that the skills cannot and a hook blocks `git push --delete`?
- #1832, question 2: should a Capture of a tab hidden behind another bring that tab to the front
  itself, instead of refusing with a message?
- #1832, question 4: does the maintainer confirm that the window for catching duplicate manual
  Captures does not apply to the launched browser?
- Does #1833 merge before #600, as #600's brief orders the three report files, or does the
  maintainer reverse that order?
- Which session owns this file now? The orchestrating session of 2026-11-05 has not updated it
  since that day.
