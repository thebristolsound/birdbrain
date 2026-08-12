# Birdbrain — implementation guide

Audience: Claude Code (or any engineer) building these designs into
`thebristolsound/birdbrain@main`. This is the sequencing document — what to
build, in what order, and where the risk sits. Feature-level detail lives in
`README.md`; feasibility notes and open questions in `ENGINEERING_REVIEW.md`;
pixel truth in `Birdbrain.dc.html` (inline styles are canonical).

## Ground rules

- Recreate in the codebase's own stack (Electron + React renderer,
  `src/renderer/components/*`; MV3 extension in `extension/src/*`). The
  prototype is a reference, not code to port.
- Land the style patch before any screen work — everything downstream
  assumes its tokens (radius 2/4/6, 28px controls, type 10/11/12/14/18,
  recessed inputs).
- Two decisions are settled design, not open questions: case binding is
  **one global active case** (per-tab was withdrawn — do not build it), and
  export manifests record `scope: 'case' | 'selection'` + `captureIds`.

## Rollout order

Six stages; each ships independently and is testable on its own.
Dependencies flow strictly downward.

### Stage 0 — style sync (mechanical, ~a PR)
Apply `style_sync_patch/` to `globals.css` + `components/ui/*`: token set,
radius scale, control metrics, `SectionLabel`, `CardPanel`, density
custom properties (`--d-*`, three steps). Pure CSS/primitives; review as a
normal PR. Unblocks everything visual.

### Stage 1 — extension correctness pass (small, high value)
Self-contained in `extension/src/*`:
1. **Hide extension UI during capture** — toast, selection bar, popover,
   highlights out of the DOM before frames are taken, restored after
   (`content.ts` capture paths + `toast.ts`). Correctness-critical: no
   Birdbrain chrome in evidence images.
2. **Popup case select** — "Logging to" dropdown (connected) and the
   "No case selected" single-row select both read/write the one global
   active case; footnote copy says switching here switches the app.
3. **Popup ignore-list pre-filter** — client-side pre-check matching the
   context-menu path.
Defer the options page to stage 5 — it's read-only and cuttable.

### Stage 2 — references index (the load-bearing data structure)
Extract mention tokens (`@[capture|…]`, `@[note|…]`, `#[tag|…]`) from note
bodies into a queryable index: note↔note backlinks, note→capture /
selector / tag references. Prove it on real case data before any UI.
Gates stages 3 and 4. Add `origin: 'note'` to the selector schema while
touching the model.

### Stage 3 — notes editor + mentions
Editor with inline chip decorations (TipTap in the prototype; use whatever
the codebase's editor supports — the grammar, not the framework, is the
spec), caret-following autocomplete (flips above near the bottom, Escape
suppresses without mutating, index clamps), snippet masking in list rows,
selection→selector/tag flow with typed confirm. Mentions must be scoped to
the current case — no cross-case leakage in the popup.

### Stage 4 — case workspace screens
Now mostly view-layer, in this order:
1. **Captures** — 3-column resizable layout, Screenshot/Page/Text/Wayback
   tabs (no Source tab), multiselect with the floating bottom-center action
   bar (select-all checkbox, "N selected", Export / Tag / Pin / Recapture /
   Delete, Esc clears). Confirm batch endpoints exist.
2. **Overview consolidated variant** — Quick Notes, Tags/Selectors stack,
   backlink map over the stage-2 index (3×8 lattice, 20-node ceiling, type
   filter chips, hover preview). Deterministic layout — no physics.
3. **Signals** — auto-capture card with per-case "Never auto-capture"
   exclusions (domain or `/regex/`, stack-on vs override-global). Needs the
   capture-server filter change; sequence the server bit first if separate.
4. **Export dialog** — three presets over an 8-item checklist, scope row
   (case vs selection, manifest note), chain-of-custody cover sheet always
   included.
5. **Wayback panel** — CDX querying, side-by-side compare (no diffing —
   copy says so), snapshot pinning surfacing in export.

### Stage 5 — dashboard, onboarding, polish
1. **Dashboard** — hero + case grid + recent-activity feed (needs a cheap
   cross-case activity query).
2. **Onboarding walkthrough** — build last: it spotlights real elements via
   `data-tour` anchors, so screens must exist first. Two phases (intro on
   first launch, case tour on first case open), seeded demo case with
   Delete-demo-case ending, replay via ⌘K palette + Settings → About,
   extension chapter replayable from old Setup Guide entry points. The
   standalone Setup guide screen is removed — its install steps live in the
   tour's expandable. Persist one "tour done" flag per user.
3. **Extension options page** (read-only) and remaining Settings/Data
   polish.

## Risk register

- **Stage 2 is the schedule risk.** If token extraction on real data is
  slow or the model fights it, flag before starting stage 3 — the backlink
  map and notes rail both die without it.
- **Editor framework** (stage 3): if the current notes editor can't do
  inline decorations, that's a rewrite decision — surface it, don't absorb
  it silently.
- **Batch endpoints** (stage 4.1) and **notes/tag write APIs from the
  extension** (deferred selection-bar actions): confirm existence early;
  they're the likeliest hidden server scope.
- Anything infeasible as designed: send back the constraint, not a
  redesign — the prototype gets revised to match (per
  `ENGINEERING_REVIEW.md`).

## Definition of done, per screen

Match the prototype pixel-for-pixel at `density: compact` (the default),
then verify: hover/empty/keyboard states from README § Interactions;
tokens only (no ad-hoc hex, radii, or type sizes); and the screen still
reads correctly at the other two density steps.
