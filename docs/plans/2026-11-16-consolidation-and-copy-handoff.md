# Start here: the consolidation and the copy cut

**Status:** active

Two efforts change the same screens: the chrome, capture and export consolidation, and the cut
of the app's prose. This file is where an agent picking up a slice of either starts. It lists
the plans, what is ruled, what waits, what can start now, and which slices touch the same file.
It adds no decision of its own. Code references in the plans are to `origin/main` at `ae4b50a`.

## The plans

| Plan | Covers |
| --- | --- |
| `2026-11-15-chrome-capture-export-consolidation.md` | The parent plan: findings, seven rulings, one open question left, the slices in brief |
| `2026-11-15-consolidation-phase-0-design-bundle.md` | Slice 0.1: frames to draw and ten questions the bundle answers |
| `2026-11-15-consolidation-phase-1-fixes.md` | Slices 1.1 to 1.6 |
| `2026-11-15-consolidation-phase-2-capture-session.md` | Slices 2.1 to 2.4 |
| `2026-11-15-consolidation-phase-3-launch-dialog.md` | Slices 3.1 to 3.3 |
| `2026-11-15-consolidation-phase-4-export.md` | Slices 4.1 to 4.4 |
| `2026-11-15-consolidation-phase-5-one-row-chrome.md` | Slices 5.1 to 5.6 |
| `2026-11-15-consolidation-phase-6-status-tiers.md` | Slice 6.1 |
| `2026-11-15-consolidation-phase-7-summary-first.md` | Slices 7.1 to 7.4 |
| `2026-11-16-ui-copy-cut.md` | The copy cut: rules, six rulings, accepted verdicts for ten screens, slices C0 to C8 |
| `2026-11-15-investigate-entry-point.md` | Left out of the consolidation: the Investigate entry |
| `2026-11-15-loose-file-export.md` | Left out of the consolidation: loose files, with #830 |
| `2026-11-15-unreviewed-surfaces-review-passes.md` | Three review passes the critique did not make |

## Where the plans disagree, follow these

The code, the ADRs and `CONTEXT.md` outrank every plan. Between plans, a detail plan outranks
the parent plan where the two differ, because the detail plans were reconciled with the code
after the parent merged. One exception holds: a ruling under "Decisions taken" in the parent
plan outranks any detail plan sentence written before it. Decision 7 and the ring ruling in
decision 2, both of 2026-11-17, are later than the detail plans' first text. The parent plan is
behind `main` in these places:

- **#2205 moved Share, Export and Launch browser into `TopBar.tsx`.** The parent plan names
  `CaseActionBar.tsx` for slices 1.3, 2.1 and 5.3 to 5.5.
- **#2205 did part of slice 2.1.** The label after the Capture Session switch now shows only
  the Active Case when it is another Case, and both sources when two are connected. The
  maintainer chose that rule. No slice removes the label.
- **The parent plan's open question 2 says `node-verify` never covers the whole Case.** On the
  four top-level nodes it does. Slice 1.5's detail plan states both cases.
- **Six components build a menu by hand, not three, and `dashboard/CaseMenu.tsx` already
  exists.** Slice 5.1's detail plan lists them.
- **Five slices edit `blocking` files, not four.** Slice 5.1b edits `CaptureDownloadMenu.tsx`.

## What is ruled

- **Consolidation.** Seven decisions, in the parent plan under "Decisions taken". The seventh,
  of 2026-11-17, accepts the design bundle's answers to its ten questions and answers open
  question 1.
- **Copy cut.** Six decisions, in the copy cut plan under "Decisions taken": no new bundle for
  copy alone; how-it-works text goes to `features.mdx`; "off in this build" for passive capture;
  a tip hangs only from a control or label already on screen; the two export descriptions; and
  the first tranche's 99 verdicts, accepted as written.

## What waits for the maintainer

| Waiting on | Holds up |
| --- | --- |
| Open question 2 of the parent plan: what the Data screen's two Verify buttons say | Slice 1.5 |
| A ruling on the next tranche's verdicts, once the copy cut plan has them | Copy slices for Settings, Sharing, Data and the extension's pages |
| The two open points under "Raised in review" in the copy cut plan: the scrolling line and the tour's Selector sentence | One row each of C7 and C4 |
| Whether the launch dialog asks about the VPN warning again when Launch is pressed (slice 3.2 in the phase 3 plan) | That one point of slice 3.2 |
| Whether the Investigate view keeps its panes at the default 1,200 pixel window: beside the 72 pixel rail it has 1,128 pixels, under the 1,140 of `TABS_BELOW_WIDTH`, so it shows tabs | Nothing. The review of #2231 raised it |

Apart from those two rows, nothing in the copy cut's first tranche waits for the maintainer.

## What can start now

Consolidation slices that wait for nothing:

| Slice | What | Note |
| --- | --- | --- |
| 1.1 | Faint text to 4.5:1 on dark surfaces | Styling |
| 1.2 | Export dialog: fixed footer, unfilled notices | `evidence-affecting` |
| 1.4 | Recapture out of the add menu | Confirm `CaptureMenu.tsx`'s tier first |
| 1.6 | One browser shown as text in the launch dialog | |
| 2.4 | "Into this Case" in the panel | |
| 3.1 | Operator name field in the launch dialog | `evidence-affecting` |
| 3.2 | One VPN statement per launch | Amends ADR-0032 in the same pull request. One point of it is open, in the table above |
| 4.1 | Ruled nouns, file types, one icon | `evidence-affecting` |
| 5.1b | The Download menu on the shared component | `evidence-affecting` |
| 7.1 | Capture details open on a summary | Outer section only |
| 7.4 | Auto-capture switch to Settings | Low priority |

Slices 5.1a, 2.1, 2.2 and 6.1 are not in the table because they have merged, and slice 1.3 is
not because the stack leaves it out: "Progress on the chrome slices" has both. Slice 7.2 waits
for review pass 3 of `2026-11-15-unreviewed-surfaces-review-passes.md`, whose assessment says
whether the slice goes ahead as written.

Since decision 7, slices 2.3, 4.2 to 4.4 and 7.3 can start too. Slices 5.2 to 5.6 are built,
as #2231 to #2235, and merge in the order written.

Copy cut slices:

| Slice | What | Note |
| --- | --- | --- |
| C0 | A tip that opens on focus | No string changes |
| C1 | Notes | |
| C2 | Signals | After C0, for one tip. With slice 7.4 if it has not landed |
| C3 | Dashboard, new Case and Overview | |
| C4 | The onboarding tour | Corrects two untrue statements. A good first slice |
| C5 | Launch dialog and VPN warning | With slices 3.1 and 3.2 |
| C6 | Captures and the delete dialog | `evidence-affecting`: `WaybackPanel.tsx` and `LinksTab.tsx` are `blocking` |
| C7 | Capture Session panel | After C0. `evidence-affecting` |
| C8 | Export dialog | `evidence-affecting`. With slices 4.1 and 4.2 |

## Progress on the chrome slices

The maintainer made the chrome the first priority on 2026-11-17 and chose stacked delivery: one
slice per pull request, each branch cut from the one before, the first opened for review and
the later ones kept as drafts until their base merges. The order is 5.1a, 2.1, 2.2, 6.1, 5.2,
5.3, 5.4, 5.5, then 5.6. Slice 1.3 is left out of the stack, because slice 5.4 replaces the
button it changes.

| Slice | Branch | Pull request | State |
| --- | --- | --- | --- |
| 5.1a | `feat/chrome-5.1a-shared-menu` | #2227 | Merged on 2026-11-17 as `4fb88fce`, under the maintainer's override label after three reviews with no blocking finding |
| 2.1 | `feat/chrome-2.1-recording-mark` | #2228 | Merged on 2026-11-17 as `396ce264`. The review passed at `86cdaf8e` with fifteen findings, none blocking, and a comment on the pull request answers them |
| 2.2 | `feat/chrome-2.2-one-stop-control` | #2229 | Merged on 2026-11-17 as `5c21ba25`. The review passed at `267b53a3` on its second round with six findings, none blocking, and a comment on the pull request answers them |
| 6.1 | `feat/chrome-6.1-status-tiers` | #2230 | Merged on 2026-11-18 as `1ef4456a`, under the maintainer's override label after two reviews with no blocking finding. Two comments on the pull request answer the findings |
| 5.2 | `feat/chrome-5.2-labelled-rail` | #2231 | Merged on 2026-11-18 as `8c7f99d6`. The review passed at `c08d4869` with fourteen findings, none blocking |
| 5.3 | `feat/chrome-5.3-case-menu` | #2232 | In review at `4ec8808e`, based on `main`, after two fix rounds. It holds the two fixes from the review of #2231 and six commits for its own reviews |
| 5.4 | `feat/chrome-5.4-launch-control` | #2233 | Draft, based on the 5.3 branch |
| 5.5 | `feat/chrome-5.5-one-row` | #2234 | Draft, based on the 5.4 branch |
| 5.6 | `feat/chrome-5.6-docs` | #2235 | Draft, based on the 5.5 branch |

Each draft's base is the branch below it in the stack, so its diff is its slice alone. A pushed
branch only gains commits: when a lower branch gains a fix, merge it up through each branch above
with a `chore(merge)` commit, then run preflight at each new head and replace the Verification
block in that pull request's description. When a pull request merges into `main`, merge its last
head and then `main` into the branch above it before marking that one ready.

What the slices found that the plans did not say:

- A menu trigger built on `Button` passes `whileTap={undefined}`. For Enter, Motion's tap gesture
  sends a `pointerdown` of its own, which shut the menu again and stopped its first item taking
  focus. Slices 5.3 and 5.4 build menus on `Button` triggers and need the same.
- The review fleet has no `node_modules`, so it cannot check a sentence about what `radix-ui`
  does. A description states what the diff holds and names the test that pins each behaviour.
- The details panel now folds below a 1,124 pixel window, not 1,100: slice 5.2 kept the screen
  room at 1,052 pixels beside the wider rail.
- The top bar keeps its Settings gear on the dashboard, where no rail shows. The new-Case wizard
  shows the rail, so it has no gear.
- Slice 5.3 deleted `ExportMenu.tsx`, `SharePill.tsx` and their tests. The 5.1a branch gained a
  commit after the stack was cut, which edits `tests/components/ExportMenu.test.tsx`. When it is
  merged up, the 5.3 branch conflicts on that file: keep the deletion.
- A new renderer file with `try` and `finally`, or a conditional inside `try`, fails
  `tests/reactCompiler.test.ts`. A deleted file that the baseline names fails it too. Prune with
  `REACT_COMPILER_BASELINE=update pnpm test tests/reactCompiler.test.ts`.
- "into ‹Case›" on the recording mark shows in practice for a launched browser's session.
  Opening a Case activates it, so the extension's session moves with the Operator; only a
  launched browser pins the Active Case. For the same reason no end-to-end spec holds that
  state: main's update replaces a stand-in session as the Case opens. The unit tests cover it.
- `e2e/readme-screenshots.spec.ts` had stopped at its annotation step when the pin popover's
  wording changed. Slice 5.6 repairs it. Under `xvfb-run` it needs a screen taller than the
  default, or the seeded page screenshots are cut short; `screenshots.mdx` gives the command.
- The labelled rail made `e2e/investigate-view.spec.ts` fail in CI: a 1,200-pixel window leaves
  the Investigate view 1,128 pixels, under its 1,140 threshold, so it shows tabs. The spec now
  opens a 1,224-pixel window. Run the whole end-to-end suite, or read CI on the draft, before
  calling a slice that changes a width done.
- `pnpm preflight --carry` compares the whole diff against `main`. When a pull request below
  merges, every branch above has a different diff against `main`, so nothing carries and each
  new head needs a full run. A draft's Verification block is refreshed when the draft becomes
  the bottom of the stack, not at every merge below it, so the blocks on #2231 to #2235 name
  the heads they were measured at.
- The maintainer chose, in a Claude Code session on 2026-11-17, to merge #2228 as it stood and
  carry the two fixes for its review on the next slice. They are commits `d7bbd671` and
  `dbf9351d` on the 2.2 branch: the mark names the extension once a launched browser has
  closed, and the Launch browser test waits for the Case. Two more commits follow from them
  higher in the stack, and each draft's description has to name its own when the draft
  reaches the bottom: `5e00c293` on the 5.3 branch makes that test wait for the Case name,
  since Export leaves the bar there, and `89779e3e` on the 5.4 branch applies the mark's rule
  in `LaunchControl.tsx`. On the 5.5 branch an open browser with the extension connected
  reads "+ extension", so the test merged up from 5.4 expects that text there.
- Merging the 5.3 branch into 5.4 conflicts on `CaseActionBar.tsx` and its test whenever a
  lower slice touches the mark in that row: keep the 5.4 side, which has no mark there.
  Merging 5.4 into 5.5 conflicts on `SessionControls.tsx`: keep the deletion.
- The maintainer chose the same for #2229, in a Claude Code session on 2026-11-17: merge it as
  it stood and carry the fixes on the next slice. They are commits `8f60fef5` and `db3989a1`
  on the 6.1 branch: two tests for the label that shows with no switch, and four corrected
  comments. Merging them up conflicts on `CaseActionBar.tsx` from 5.3 into 5.4, where the 5.4
  side is kept, and on `SessionControls.tsx` and its launched browser test from 5.4 into 5.5,
  where the deletion is kept.
- The first review of #2229 blocked on two sentences of its description: one named the wrong
  end-to-end spec, and one said a merge made with `-X ours` had no conflicts. A description
  names the files the automatic merge conflicts in and says the merge commit's tree equals its
  first parent's.
- The merge script refuses while a cancelled `test` or `e2e` job sits at the head commit, even
  beside a passing one. Marking a pull request ready cancels the run its last push started.
  Re-run the cancelled jobs with `gh run rerun <run> --failed`, then run the script again.
- The first review of #2230, at `1831b862`, failed with fifteen findings and none blocking,
  because two passes named claims they could not check from the repository: a ruling the
  decision record cited from a plan that did not hold it, and the file a merge conflicts in.
  A ruling a slice relies on goes into the plan on `main` in that slice, and a description
  says only that a merge has a conflict. Commits `89c9f4ad`, `f6e9615d` and `36ef51f3` answer
  the findings. The layout spec now writes "Egress unknown" into the status control before
  it measures, and the upper branches' versions of that spec need the same lines by hand
  where a merge keeps their side. They merged up cleanly through 5.4. The 5.5 branch
  conflicted in the launched browser test of that spec, where both sides are kept: the rail
  check with its short timeout, then the 5.5 check of the mark's "+ extension".
- The second review of #2230, at `36ef51f3`, failed the same way on one source: the ruling
  that the advisory mark is a hollow ring has no record written by the maintainer, only the
  plan line the slice adds. A third review would fail on it too, so the maintainer chose the
  override label, in a Claude Code session on 2026-11-18. Commits `2afd5249`, `2266e023` and
  `501d4069` answer the other findings: the ring has a border under forced colours, the layout
  spec reads the ring's computed style, and its launched browser test no longer waits five
  seconds on a folded panel, which had failed about one local run in four.
- The maintainer chose, in a Claude Code session on 2026-11-18, to merge #2231 as it stood and
  to merge the plans pull request, #2236, under the override label. The fixes for the review
  of #2231 are commits `4b81b23e` and `8c3a4f60` on the 5.3 branch: the tests beside the
  Capture Session rail read the rail's width from the constant, a test covers the window inset
  on the last control of the top bar, and comments no longer give the 48 pixel rail. On the
  5.4 branch the capture control is the last control, so commit `b74d7908` moves that test to
  it. Merging these up conflicts on one line of `docs/agents/architecture.md` at each branch,
  where the branch's own line is kept with the wording fix, and on `TopBar.tsx` from 5.3 into
  5.4, where the 5.4 side is kept.
- The first review of #2232 passed, and its findings were behaviour an Operator would meet,
  so the maintainer chose, in a Claude Code session on 2026-11-18, to fix them before the
  merge. What the Case menu taught:
  - A dialog opened from the top bar renders through a portal. Inside the bar it comes before
    the search, which keeps a layer of its own, and the search sits over it.
  - The top bar drags the window, and its rule exempts buttons, inputs and links. Anything
    else that takes the pointer there needs `[app-region:no-drag]`.
  - State that has to outlive the Case menu does not live in it. The menu leaves the screen
    on the dashboard and in Settings, so a running archive export and its failure are kept in
    a store of their own in `useCaseExport.ts`, keyed by Case. A store's hook is named
    `use…`, or the React compiler does not treat it as a hook and the tests fail on a changed
    hook order.
  - The second review blocked on the description: it said a guard held on every route when
    it held on one, and that one test file covered every fix. A description says what the
    code does and names each test file, and says nothing about earlier review rounds, which
    the reviewers cannot read.
- This file is on `main` since #2236. Later updates ride on the 5.6 branch, the docs slice.
- The linked WSL machine stopped answering on 2026-11-18. Preflights then ran on Omarchy, in
  about ten minutes each, after the scratch tree's test image library was rebuilt.
- Marking a draft ready cancels the CI run its last push started. Let that run finish first,
  or the merge script later meets cancelled jobs at the head commit.
- The remote refuses one push that updates several branches. Push the stack one branch at a
  time.
- The Dependency audit check has failed on `main` and on every pull request since
  2026-11-17, on a new advisory for `picomatch` (GHSA-fc5q-39xc-vjpf). It is not a required
  check, and no slice here changes a dependency. An upgrade, or an entry in
  `audit-exceptions.json`, is the maintainer's decision.
- `Menu` swaps its trigger when a control changes state, as the capture control does between
  Launch browser and the recording mark. The button that held focus is unmounted, so the
  control moves focus to the button that replaced it.

The stack is complete through 5.6. What is left of phase 5:

- Slice 5.1b, the Download menu on the shared component. It edits a `blocking` file, so it is
  its own `evidence-affecting` pull request and is not in the stack.
- The design bundle and its row in `docs/design-handoff/README.md`. The maintainer approved
  the drafted wording in a Claude Code session on 2026-11-17, and commit `3a180c85` on the 5.6
  branch adds the bundle as `docs/design-handoff/2026-11-17-one-row-chrome/` with the row.
  The row links the phase 0 plan and cites decision 7 of the parent plan. Both reached `main`
  with #2236, which merged on 2026-11-18 as `ac5509be` under the maintainer's override label.
- The parent plan's check boxes for slices 5.1 to 5.6, 2.1, 2.2 and 6.1, ticked as each pull
  request merges.

## Slices that share a file

Land these in the order given, or as one pull request where the plan says so.

| File | Slices, in order |
| --- | --- |
| `StartDialog.tsx` | 1.6, then 3.1, then 3.2 with C5. Slice 3.3 has nothing left to do: copy decision 4 removes the dialog's tips |
| `ExportDialog.tsx` | 1.2, then 4.1 with C8's wording, then 4.2 |
| `TopBar.tsx` | 2.1, which has merged, then 5.2, 5.3 and 5.4. Slice 1.3 is left out |
| `SessionControls.tsx` | 2.2, which has merged, then 5.5, which deletes it |
| `CaptureMenu.tsx` | 5.1a, which has merged, then 1.4 |
| `AutoCaptureCard.tsx`, `SignalsOverview.tsx` | 7.4 with C2 |
| `tourSteps.ts` | C4, then 7.4 and 5.3 move their anchors |
| `CaptureSessionPanel.tsx`, `CaptureControl.tsx` | 2.4, then C7 after C0 |

## Rules for every pull request

They are in `CLAUDE.md` under "Posting surfaces" and in the parent plan under "Slices". In
short: one slice per pull request, before and after screenshots for anything that shows on
screen, the `evidence-affecting` label and an Evidence impact section for a `blocking` file, an
ADR amendment in the same pull request as the change that needs it, and a description that
matches the diff at its head.

## Not in the repository

- The design critique of 2026-11-15, which is a page in the design session. The parent plan
  restates its findings.
- The inventory behind the copy cut: every string of four words or more, with its file. The
  copy cut plan gives the method under "What was measured", so the list can be made again.
