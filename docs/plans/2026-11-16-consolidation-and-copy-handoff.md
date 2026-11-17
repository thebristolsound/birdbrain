# Start here: the consolidation and the copy cut

**Status:** active

Two efforts change the same screens: the chrome, capture and export consolidation, and the cut
of the app's prose. This file is where an agent picking up a slice of either starts. It lists
the plans, what is ruled, what waits, what can start now, and which slices touch the same file.
It adds no decision of its own. Code references in the plans are to `origin/main` at `ae4b50a`.

## The plans

| Plan | Covers |
| --- | --- |
| `2026-11-15-chrome-capture-export-consolidation.md` | The parent plan: findings, six rulings, two open questions, the slices in brief |
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
after the parent merged. The parent plan is behind `main` in these places:

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

- **Consolidation.** Six decisions, in the parent plan under "Decisions taken".
- **Copy cut.** Six decisions, in the copy cut plan under "Decisions taken": no new bundle for
  copy alone; how-it-works text goes to `features.mdx`; "off in this build" for passive capture;
  a tip hangs only from a control or label already on screen; the two export descriptions; and
  the first tranche's 99 verdicts, accepted as written.

## What waits for the maintainer

| Waiting on | Holds up |
| --- | --- |
| Open question 1 of the parent plan: how a Capture Session starts when only the extension is connected | Slices 5.4 and 5.5 |
| Open question 2 of the parent plan: what the Data screen's two Verify buttons say | Slice 1.5 |
| The ruling on the design bundle from slice 0.1 | Slices 2.3, 4.2 to 4.4, 5.2 to 5.6 and 7.3 |
| A ruling on the next tranche's verdicts, once the copy cut plan has them | Copy slices for Settings, Sharing, Data and the extension's pages |

Nothing in the copy cut's first tranche waits for the maintainer.

## What can start now

Consolidation slices that wait for nothing:

| Slice | What | Note |
| --- | --- | --- |
| 1.1 | Faint text to 4.5:1 on dark surfaces | Styling |
| 1.2 | Export dialog: fixed footer, unfilled notices | `evidence-affecting` |
| 1.3 | A disabled Launch browser gives a reachable reason | `TopBar.tsx` |
| 1.4 | Recapture out of the add menu | Confirm `CaptureMenu.tsx`'s tier first |
| 1.6 | One browser shown as text in the launch dialog | |
| 2.1 | The recording mark drops its source where the panel shows | What is left after #2205 |
| 2.2 | One stop control on screen | |
| 2.4 | "Into this Case" in the panel | |
| 3.1 | Operator name field in the launch dialog | `evidence-affecting` |
| 3.2 | One VPN statement per launch | Amends ADR-0032 in the same pull request |
| 4.1 | Ruled nouns, file types, one icon | `evidence-affecting` |
| 5.1a | Shared menu component and three menus | |
| 5.1b | The Download menu on the shared component | `evidence-affecting` |
| 6.1 | Status tiers | Amends ADR-0032 in the same pull request |
| 7.1 | Capture details open on a summary | Outer section only |
| 7.2 | A count of Selector matches on each row | Read review pass 3 first if it has landed |
| 7.4 | Auto-capture switch to Settings | Low priority |

Copy cut slices:

| Slice | What | Note |
| --- | --- | --- |
| C0 | A tip that opens on focus | No string changes |
| C1 | Notes | |
| C2 | Signals | After C0, for one tip. With slice 7.4 if it has not landed |
| C3 | Dashboard, new Case and Overview | |
| C4 | The onboarding tour | Corrects two untrue statements. A good first slice |
| C5 | Launch dialog and VPN warning | With slices 3.1 and 3.2 |
| C6 | Captures and the delete dialog | |
| C7 | Capture Session panel | After C0. `evidence-affecting` |
| C8 | Export dialog | `evidence-affecting`. With slices 4.1 and 4.2 |

## Slices that share a file

Land these in the order given, or as one pull request where the plan says so.

| File | Slices, in order |
| --- | --- |
| `StartDialog.tsx` | 1.6, then 3.1, then 3.2 with C5. Slice 3.3 has nothing left to do: copy decision 4 removes the dialog's tips |
| `ExportDialog.tsx` | 1.2, then 4.1 with C8's wording, then 4.2 |
| `TopBar.tsx` | 1.3, then 2.1, then 5.2, 5.3 and 5.4 |
| `SessionControls.tsx` | 2.2, then 5.5 |
| `CaptureMenu.tsx` | 1.4, then 5.1a |
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
