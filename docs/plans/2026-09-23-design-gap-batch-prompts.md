# Design gap batches: session prompts, 2026-09-23

One prompt per batch from `docs/plans/2026-09-21-design-gap-ultracode-prep.md`. Paste a batch's prompt into a fresh session and it works that batch's tickets. Batches run in order: every branch is cut from `main`, so a batch waits for the previous one to merge.

The direction-list rows the maintainer decided on 2026-09-23 are appended to #1549, #1551, #1552 and #1555, so those four tickets are larger than the prep doc records.

## Batch 1

Starts when: now, nothing blocks it.

```
Work batch 1 of the design gap program in this repository: #1544, #1536, #1545, #1551, #1552.

- #1544 feat(tokens): type scale, radii, shadows and button metrics drift from the mock
- #1536 fix(a11y): dialogs, menus and the palette drop or hide keyboard focus
- #1545 feat(shell): top-bar search, tooltips, tour step text and the wizard route
- #1551 feat(notes): mention inline-create, hover peek and honest dead mentions
- #1552 feat(data): Data explorer table, detail strip and ledger match the mock

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.

Particular care: #1552 cites eight blocking-tier files and its appended row changes how the Captured column reads.
```

## Batch 2

Starts when: batch 1 has merged.

```
Work batch 2 of the design gap program in this repository: #1534, #1543, #1540, #1548, #1549.

- #1534 feat(theme): open dark by default and cross-fade theme switches like the mock
- #1543 feat(feedback): the mock's toast, completion and banner patterns
- #1540 feat(density): honour the density steps on Notes, Settings, the extension screen and the Overview strip
- #1548 feat(captures): list, viewer tabs, pins and Wayback compare match the mock
- #1549 feat(signals): detail rail and tag list match the mock, and signal edits stop destroying data

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.
```

## Batch 3

Starts when: batch 2 has merged.

```
Work batch 3 of the design gap program in this repository: #1541, #1542, #1550, #1553, #1554.

- #1541 feat(motion): add the mock's press feedback, entrance staggers and count-ups
- #1542 feat(menus): add the missing context menus and the customise-menu footer
- #1550 feat(notes): rebuild Notes as the mock's two-pane workspace
- #1553 feat(settings): database integrity check, Diagnostics header and Operator layout
- #1554 feat(extension): popup and in-page capture card match the mock

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.

Particular care: #1554 touches acquisition paths; the in-page toast markup can land inside captured bytes, so the post-capture card must mount after capture completes.
```

## Batch 4

Starts when: batch 3 has merged; contrast needs the batch 1 tokens and the batch 2 theme.

```
Work batch 4 of the design gap program in this repository: #1535, #1538, #1526.

- #1535 fix(theme): light-theme text and controls fail contrast across every screen
- #1538 fix(copy): raw error strings and copy that promises things the app cannot do
- #1526 New Case wizard, extended with the wizard drift rows

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.
```

## Batch 5

Starts when: batch 4 has merged.

```
Work batch 5 of the design gap program in this repository: #1537.

- #1537 fix(a11y): controls across the app have no accessible name, label or state

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.
```

## Batch 6

Starts when: batch 5 has merged.

```
Work batch 6 of the design gap program in this repository: #1539, #1546, #1547.

- #1539 fix(layout): screens break or hide their primary actions at the minimum window size
- #1546 feat(dashboard): Quick Start cards, case cards and footer match the mock
- #1547 feat(overview): heading, sources, capture strip and tag cards match the mock

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.
```

## Batch 7

Starts when: batch 6 has merged, it is the last of the seven tickets on the export dialog.

```
Work batch 7 of the design gap program in this repository: #1555.

- #1555 feat(export): export menu wiring and dialog chrome match the mock

Read each issue with `gh issue view <n>` first; the body holds the design rows, the UI findings and the mock and app line references. The design source is docs/design-handoff/2026-09-14-design-project-export/Birdbrain.dc.html. Direction is mock on every design row: the app moves to the design.

One ticket per worktree, each branch cut from main and named agent/<issue>-<slug>. Work the tickets in parallel where their cited files do not overlap, and serially where they do. Follow CLAUDE.md and docs/agents/architecture.md.

Finish each ticket with `pnpm preflight` green at head, then open a draft PR with the post-pr-body skill's shape. Label each PR agent-authored, never agent-pr: these run off the dispatch slot. When the evidence backstop fires at the blocking tier, add evidence-affecting, write the Evidence impact section, and leave the PR for human review with no auto-merge. Merging stays with the maintainer.

Particular care: #1555 carries the appended chain-of-custody preview row, which is evidence-adjacent.
```
