# Design gap batch: `ultracode` session prep

Prepared 2026-09-21 against `origin/main` at `b89efc07` (CI green). Parent documents: `docs/plans/2026-09-20-design-gap-ticket-batch.md` (the grouping, on PR #1563), `docs/plans/2026-09-19-mock-reconciliation.md` and `docs/plans/2026-09-19-ui-ux-pass.md`. Tracking issue #1562. Design source: `docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html`, the last full design sync.

**The session's completion test** is a pull request for each of the 23 tickets (#1534 to #1555, and #1526), each with a green verification block at head and a reviewer pre-pass, handed to the maintainer. Merging stays with the maintainer. The 27 direction rows on #1562 are not in this set; a mock decision there becomes a new ticket for a later session.

## Program state

- **No agent PR holds the dispatch slot.** Open PRs are #1563 (the batch doc) and three Dependabot bumps. This session's PRs run off the slot: `agent-authored`, never `agent-pr`, as in the 2026-09-19 session.
- **The Dispatch workflow reports failure on main** at `b89efc07`. It is paused under the automation ADR and is not needed here, because this session dispatches its own fleet.
- **Every ticket is labelled `redesign` and `ready-for-agent`**, filed by the maintainer's account, and not `queued`. The session works them directly, so `queued` is not required.

## Batches

A batch holds tickets whose cited files do not overlap, so they run in parallel. Every branch is cut from `main`, never from another PR, so each batch waits for the previous one to merge. The order puts shared foundations first: design tokens, focus handling and theme before contrast, labels and the screen tickets that sit on them.

| Batch | Ticket | Title | Blocking-tier files cited | Starts when |
| --- | --- | --- | --- | --- |
| 1 | #1544 | feat(tokens): type scale, radii, shadows and button metrics drift from the mock | `VerifyBar.tsx` | now |
| 1 | #1536 | fix(a11y): dialogs, menus and the palette drop or hide keyboard focus | `ImportCaseDialog.tsx`, `ExportDialog.tsx` | now |
| 1 | #1545 | feat(shell): top-bar search, tooltips, tour step text and the wizard route | none | now |
| 1 | #1551 | feat(notes): mention inline-create, hover peek and honest dead mentions | none | now |
| 1 | #1552 | feat(data): Data explorer table, detail strip and ledger match the mock | `DataExplorer.tsx`, `ArtifactTable.tsx`, `ArtifactTabs.tsx`, `HeadersTlsTab.tsx`, `ManifestLedger.tsx`, `dataTableModel.ts`, `dataTreeModel.ts`, `ledgerModel.ts` | now |
| 2 | #1534 | feat(theme): open dark by default and cross-fade theme switches like the mock | none | batch 1 merged |
| 2 | #1543 | feat(feedback): the mock's toast, completion and banner patterns | `ExportDialog.tsx` | batch 1 merged |
| 2 | #1540 | feat(density): honour the density steps on Notes, Settings, the extension screen and the Overview strip | none | batch 1 merged |
| 2 | #1548 | feat(captures): list, viewer tabs, pins and Wayback compare match the mock | `PinCommentPopover.tsx` | batch 1 merged |
| 2 | #1549 | feat(signals): detail rail and tag list match the mock, and signal edits stop destroying data | none | batch 1 merged |
| 3 | #1541 | feat(motion): add the mock's press feedback, entrance staggers and count-ups | none | batch 2 merged |
| 3 | #1542 | feat(menus): add the missing context menus and the customise-menu footer | `ExportDialog.tsx` | batch 2 merged |
| 3 | #1550 | feat(notes): rebuild Notes as the mock's two-pane workspace | none | batch 2 merged |
| 3 | #1553 | feat(settings): database integrity check, Diagnostics header and Operator layout | `OperatorConfig.tsx` | batch 2 merged |
| 3 | #1554 | feat(extension): popup and in-page capture card match the mock | `background.ts`, `PopupApp.tsx`, `pageStatus.ts`, `toast.ts` | batch 2 merged |
| 4 | #1535 | fix(theme): light-theme text and controls fail contrast across every screen | `DataTree.tsx` | batch 3 merged; contrast needs the batch 1 tokens and batch 2 theme |
| 4 | #1538 | fix(copy): raw error strings and copy that promises things the app cannot do | `DataExplorer.tsx`, `ExportDialog.tsx`, `DbTables.tsx`, `DbUtilities.tsx` | batch 3 merged; contrast needs the batch 1 tokens and batch 2 theme |
| 4 | #1526 | New Case wizard, extended | none | batch 3 merged; contrast needs the batch 1 tokens and batch 2 theme |
| 5 | #1537 | fix(a11y): controls across the app have no accessible name, label or state | `ArtifactTable.tsx`, `DataTree.tsx`, `ExportDialog.tsx`, `OperatorConfig.tsx`, `DbTables.tsx` | batch 4 merged |
| 6 | #1539 | fix(layout): screens break or hide their primary actions at the minimum window size | `ImportCaseDialog.tsx`, `ExportDialog.tsx` | batch 5 merged |
| 6 | #1546 | feat(dashboard): Quick Start cards, case cards and footer match the mock | none | batch 5 merged |
| 6 | #1547 | feat(overview): heading, sources, capture strip and tag cards match the mock | `overviewModel.ts` | batch 5 merged |
| 7 | #1555 | feat(export): export menu wiring and dialog chrome match the mock | `ExportDialog.tsx` | batch 6 merged; last of the seven tickets on the export dialog |

File lists come only from the paths the sweep cited, so an implementer can touch more. A token or theme change in batch 1 or 2 reaches every screen; the batch 2 onward tickets rebase onto it rather than race it.

## Evidence tier

14 of the 23 tickets cite at least one blocking-tier path, mostly the export dialog, the Data screen and the extension popup. None is labelled `evidence-affecting` at triage. When the backstop fires at the blocking tier, the implementer applies the label, writes the Evidence impact section, and the PR goes to human review with no auto-merge. A visual change on a blocking file still owes that section. Two cases need particular care:

- **#1552, Data explorer.** Eight of its nine files are blocking. Several rows change how hashes, the ledger and column values read, which is interpretation surface.
- **#1554, extension.** The popup, the background worker and the in-page toast are acquisition paths. The toast's markup can land inside captured bytes, so the post-capture card must mount after capture completes.

## Rules that carry forward

From the 2026-09-19 prep, unchanged: `model: 'opus'` on every fleet `Agent` and `agent()` call. `Closes #N` on line 1 of every body. `pnpm preflight` at head, regenerated after any push. Labels in the create call, verified by a direct read of the labels endpoint. One `birdbrain-reviewer` at a time, a pre-pass on every PR before handoff. Nothing auto-merges. At most two defects filed per PR, user-visible or evidence-affecting only. Every PR linked to this thread through `link_pull_request`.

Added for this set:

- **The mock is the spec.** Each ticket's rows cite mock line numbers. An implementer reads those lines in the design export, not the sweep's summary of them, and matches both themes and all three density steps.
- **Direction is mock, except where a ticket says otherwise.** A row that turns out to contradict a recorded ruling is left undone and named in the PR body's findings, not implemented.
- **Screenshots live only in the sweep worktree.** The UI pass cites them by relative path under `e2e/.sweep/` in `/home/matt/.t3/worktrees/birdbrain/sweep-ui`. They are not tracked.
- **Local e2e runs** clash with a running Birdbrain on the capture port. Run them in a network namespace, or with the app closed.

## Open decisions

- **Launch approval.** The set touches blocking-tier files and far more than ten files, so the plan-approval carve-out does not cover it. The session starts on the maintainer's go.
- **Trash with undo.** Three direction rows turn on whether the app gets a trash. The recommendation is no for now; it does not block any ticket here.
- **Scale.** Seven batches with a merge between each means seven maintainer merge rounds. Batches 1 to 3 hold five tickets each, under the ten-agent guideline per wave once the reviewer is counted.

