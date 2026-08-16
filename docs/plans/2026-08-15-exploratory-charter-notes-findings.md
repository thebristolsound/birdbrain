# Exploratory notes charter — findings

**Charter:** `e2e/charters/notes.md` — investigator recording and revising observations while
moving through a case. Exercise rich-text creation, formatting, save, search, edit, navigation,
data-loss boundaries, and deletion.

**Run:** 2026-08-15, harness `scripts/exploratory-harness.mjs` under `xvfb-run` (1440x900
window), commit `992eba1`, built app `1.0.1-beta.17`. Screenshots copied to
`/tmp/exploratory-charter-notes-2026-08-15/` (12 PNGs; not tracked). No issues filed — findings
are recorded here for human review.

## Findings

| # | Sev | Title | Screenshot |
|---|-----|-------|------------|
| 1 | med | Unsaved edits to an existing note silently disappear on tab navigation | 009, 010 |

### 1. Unsaved existing-note edits lost on navigation (med)

- Notes tab → edited saved note "Harbor observation — reviewed" → replaced its title with
  "UNSAVED replacement title" → clicked Overview in the sidebar → clicked Notes.
- Expected: prompt to keep or discard the edit, or preservation of the edit draft.
- Observed: edit mode closed without a prompt or toast and the previous saved title returned.
  This confirms that the draft-loss behavior from charter 1 also affects edits to existing
  notes, not only creation of new notes.

## Explored and fine

- Created a case from a fresh isolated profile and opened its empty Notes tab.
- Created and saved a note containing plain text, bold text, and a two-item bullet list using
  `typetext`; the saved card preserved the rich-text structure.
- Searched by a term in the note body and got the expected note; searched for a missing phrase
  and got the expected explicit no-results state.
- Edited the title and body, saved, navigated to Overview and back, and confirmed both saved
  changes persisted.
- Exercised delete confirmation: Cancel preserved the note, then Confirm removed it and restored
  the empty state.
- Read all 12 PNGs for layout and visual defects. No additional defect was found at 1440x900.
- Drained the console throughout the run; it contained no console messages or page errors.

## Harness notes

- `--skip-onboarding` landed directly on the dashboard, and `typetext` entered content into the
  ProseMirror editor without per-character `press` calls.
- The harness temp profile was isolated, all screenshots were copied out before `close`, and the
  temp profile was removed on shutdown.
