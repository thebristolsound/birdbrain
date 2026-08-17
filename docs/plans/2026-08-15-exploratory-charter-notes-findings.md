# Exploratory notes charter — findings

**Charter:** `e2e/charters/notes.md` — investigator recording and revising observations while
moving through a case. Exercise rich-text creation, formatting, save, search, edit, navigation,
data-loss boundaries, and deletion.

**Run:** 2026-08-15, harness `scripts/exploratory-harness.mjs` under `xvfb-run` (1440x900
window), commit `992eba1`, built app `1.0.1-beta.17`. Screenshots copied to
`/tmp/exploratory-charter-notes-2026-08-15/` (12 PNGs; not tracked). No issue was filed during
the run; the finding below was filed afterwards as #481.

**Reproducibility caveat.** Commit `992eba1` predates #414's signing-key acknowledgement gate,
and the harness at that commit seeded only `settings.json`. On the merged tree the same
command hangs until `firstWindow()` times out, so this session does not replay as recorded; it
boots again only with the keypair seeding added in this PR. The finding itself was
reconfirmed at filing time.

## Findings

| # | Sev | Title | Screenshot | Issue |
|---|-----|-------|------------|-------|
| 1 | med | Unsaved edits to an existing note silently disappear on tab navigation | 009, 010 | #481 |

### 1. Unsaved existing-note edits lost on navigation (med)

- Notes tab → edited saved note "Harbor observation — reviewed" → replaced its title with
  "UNSAVED replacement title" → clicked Overview in the sidebar → clicked Notes.
- Expected: prompt to keep or discard the edit, or preservation of the edit draft.
- Observed: edit mode closed without a prompt or toast and the previous saved title returned.
  This confirms that the draft-loss behavior from charter 1 also affects edits to existing
  notes, not only creation of new notes. Charter 1's create-path case is #464; this edit-path
  case is #481, filed separately because a fix scoped to creation would close #464 and leave
  this one live.

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
- Drained the console throughout the run and every drain came back empty. This is **not** a
  clean-console claim for the session: at this commit the harness attached its console
  listeners only after `firstWindow()` and the `[data-testid="app-ready"]` wait, so renderer
  output during startup was never observable. With the listener placement corrected in this
  PR, the first drain of a fresh run surfaces a CSP `font-src` violation that this run could
  not have seen. Treat the empty drains as covering post-readiness activity only.

## Harness notes

- `--skip-onboarding` landed directly on the dashboard, and `typetext` entered content into the
  ProseMirror editor without per-character `press` calls.
- The harness temp profile was isolated, all screenshots were copied out before `close`, and the
  temp profile was removed on shutdown.
