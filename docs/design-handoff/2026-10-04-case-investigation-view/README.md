# Handoff: Case investigation view (Joint map)

Repo: `thebristolsound/birdbrain@main`. Brief:
`docs/specs/2026-10-03-case-investigation-view-ui-brief.md` plus the
2026-10-04 feedback note (decided gaps G8, G9, G11, G12; G10 out of slice;
G3, G7 still open). Engine contract: `docs/specs/2026-10-02-case-retrieval-pipeline-design.md`.

## Overview

A sixth Case section, **Investigate**, between Signals and Data. The Operator
asks the Case a question, a run reads the stored Exhibits (base layer: shared
identifiers and identical text; optional AI layer), and the result is a Joint
map and list of proposed relations between Subjects, each with its supporting,
conflicting and unreviewed spans. The Operator accepts or rejects Joints; the
software never decides for them. The design is complete for the first slice
and the AI layer, and partially for "later" items (lookup).

## About the design files

The files here are **design references created in HTML**, not production
code. Recreate them in the renderer (`src/renderer/components/*`, React,
Tailwind v4 tokens from `globals.css`) with the existing primitives
(`Button`, `Badge`, `Card`, `Dialog`, `Input`, `Textarea`, `Tabs`). Open
`Birdbrain.dc.html` in a browser (keep `support.js` beside it), open the
Nightjar case, click **Investigate** in the sidebar. `Case Investigation.dc.html`
is the canvas of directions (turn 1) and reference drawings of every state
(turn 2); the live screen is the authority where they differ.

## Fidelity

**High-fidelity.** Final colors, type, spacing, copy and interactions. All
styles are inline in `Birdbrain.dc.html`; the file is the canonical source
for any measurement not listed. Tokens: see `design_handoff_birdbrain_prototype/style_sync_patch/`
(2 / 4 / 6px radii, 28px control metric, recessed inputs, 10/11/12/14/18 type scale).

## Reaching every state in the prototype

Tweaks (host panel): `aiLayer` seeds Settings → AI analysis; `narrowWindow`
forces the <1150px tab layout; `sharedCase` makes Nightjar a Shared Case with
member MB; `manySubjects` adds six Subjects so the map folds.

| State | How to reach |
|---|---|
| Empty Case | New Case wizard → create → open the new case → Investigate |
| No Joints found | New run → remove starts → add Rowan Pike → Run |
| Accept unavailable (one side only) | Select "Proposed · Jun Sato and The Ferryman are one writer" |
| Lost side on an accepted Joint | On Calloway–Sato, "Return to unreviewed" on E-17 |
| Path beside a direct Joint | ⇄ on The Ferryman, then ⇄ on Harrow Point Gazette |
| Contested | `sharedCase` on; Calloway–Sato shows NK accepted · MB rejected |
| cannot-check / missing | Sato–Ferryman unreviewed E-44; Calloway–Gazette "No longer counted" E-27 |
| Same-name choosing | Click a Rowan Pike node → "About this Rowan Pike" / "About neither" |
| Hosted provider | Settings → AI analysis → enable → Anthropic → confirm; Run → review dialog |
| Lookup → candidate → capture | Source inspector (E-38) → "Find the original…" |
| Stale run basis | Capture the lookup candidate (new Exhibit) |

## Screens / surfaces

### Surface 1 · Run setup ("Ask the Case")
Centered column, max 640px. Card (`--color-card`, 1px `--color-border`, 6px):
inquiry textarea (13px, recessed), **Starting Subjects** as chips (name 12/600
+ kind 10px faint + remove) and dotted "+ name" chips for the rest; a
150px/1fr grid of facts: Withheld from analysis (per Exhibit, holder text
"your flag" / "withheld by you and MB", Clear my flag), Sources, AI analysis
(off copy; or per-provider lines with model + version; hosted line in
`--bb-warn`; note that provider proposals appear in the header as its wording;
link to Settings → AI analysis), What the run records, Text a hosted provider
will receive. Footer: Cancel (if a previous run exists) + accent **Run**. Run
with a hosted provider on opens **Review before sending** first.

### State 2 · Run in progress
420px card: spinner + "Reading the Case", 4px progress bar, counts line
(+ hosted line, + "MB last synced … the run proceeds without MB's later
changes" when shared + hosted), **Cancel run**, footnote "A canceled run
reports nothing; partial results are discarded." (+ "Text already sent to
Anthropic cannot be recalled."). Cancel returns to the previous results with a
dismissible banner.

### Surface 2 · Results header
`--color-surface`, bottom border. Row 1: label JOINT MAP (10/600/upper/.06em
faint), inquiry (13/700, ellipsis), Shared Case chip, "Run N · Case as of
‹basis›", **New run** (24px). Row 2 (10px muted, wraps): Starting from chips,
"N Exhibits read · M withheld", "Sources: stored Case only", AI line(s) with
model + version and pair counts, sync note. Row 3 (AI layer on): link
"Show Ollama · llama3.1 (2026-03) proposals · 3 candidate claims · 4 search
terms" → dotted box: disclaimer ("Its wording, not yours; nothing here is a
Joint or a claim you made"), claim chips each with **Draft as inquiry** (copies
into the setup textarea and toasts "edit before running"), mono search-term
chips. Banners below: stale ("The Case changed after this run started … Run
again"), canceled.

### Surface 3 · Joint map + list (left pane, 500px; 100% under 1150px)
Map: 290px tall, `--color-canvas`, focusable (`tabIndex=0`,
`role=application`, inset 1px accent ring on focus). Subjects are 132px cards
(name 11.5/600, kind · detail · "N Joints" 9.5 faint) at fixed design-space
coordinates x-scaled to the pane width (ResizeObserver; `kx = width/500`).
Subjects with no Joint: dotted border. Selected: accent border + accent-subtle
fill. Each card has a 14px ⇄ "Pick for path" button.
Edges (SVG): accepted 2px `--color-text-primary`; proposed 2px
`--color-text-muted` round-dotted (`stroke-dasharray 0.1 5`, never dashed —
dashed is the Overview Link Map's reference edge); rejected 1px faint with
label struck and ✕; contested 4px with a 2px canvas line over it (double
rule). Selected or on-path edges get a 12px 22% halo (accent / border-strong).
Labels sit mid-edge on canvas-colored text backgrounds: "Status · claim",
"● unreviewed" in `--bb-warn`, "▵ weak". Clicking a label opens the first
Exhibit span; clicking the line selects. Single-Subject Joints hang as a
150px tab under their Subject (card background, top border in the status
line style). Hovering a Subject dims non-adjacent nodes, edges and labels to
18% (120ms). Keyboard: ↑↓←→ step through the list order, Home/End, Enter
opens the first span, Escape clears the path. Above 8 Subjects, those with
no Joint (not starts, not path ends, not selected) fold into a dotted chip
bottom-right "N more Subjects, none with a Joint to these · all in the list"
→ popover list. Top-right: "N Subjects · M Joints · showing all" or "K of M
Joints on the map · the list holds all". Legend bottom-left. "No Joints"
state: card over the map ("The run proposed no Joints … an empty result
never means there is no connection. The list below still holds every Joint
in the Case." + Gaps · N + Start a Joint from a Note claim); only starting
Subjects drawn.
Path row (min 30px): PATH chip + sentence. Direct accepted Joint → "A and B
have a direct accepted Joint: …". Otherwise "Direct Joint: ‹status› · ‹title›
(one side no longer counted). Through other Subjects: …" or "No path through
other Subjects by accepted or proposed Joints." Paths never use rejected
Joints or accepted Joints with a lost side. Steps listed as numbered rows.
Tabs **Joints N** / **Gaps N** (26px, top radius 4). Joint rows: 18px status
line swatch (double = 3px `double`), "Status · title" 12px, second line 10px
muted: strength sentence (always the same order: per-class counts, rare
matches, conflicts, independent sources), "▵ reason" bordered chip, "● N
unreviewed" warn, contested "NK accepted · MB rejected", "‹side› side no
longer counted" dotted chip, "not on this run's map" faint, "◆ read as
conflicting by …" alert; right: proposer. The list is always complete; only
the map truncates. Then **Subjects without a Joint**. Gaps: grouped list
(Claims with no supporting Exhibit, Accepted Joints with unreviewed material,
Contested Joints, Weak Joints, Subjects reached only through another Subject,
Same-name Subjects, Missing dates, Missing originals, Searches not yet run
with "no action yet").

### Surface 4 · Joint detail (center pane)
Title 15/700 with status swatch; "Proposed by ‹rule · version› / ‹provider ·
model · version›" (+ Member Codes note in a Shared Case). Contested: two
member cards (dot, code, name, decision, timestamp + whose clock, your
acceptance context; note that decisions are grouped by member, never
interleaved). Actions: **Accept** (accent; disabled at 45% with the reason
beside it: "Needs at least one reviewed supporting span…" or "Needs a
reviewed supporting span on the ‹Subject› side; support so far is on the
‹other› side only."), **Reject** (opens a dialog with optional reason),
**Restore to proposed**, **Find more material** (→ setup pre-filled).
Reviewed support row: counts sentence, ▵ chip, right-aligned "A side n · B
side m" for two-Subject Joints. Lost-side notice (dotted). Sections, each
10/600 upper label: Supporting Exhibits (rows: Exhibit chip button, Source
Class with its reason in quotes, "⧉ copy of", `present|absent|cannot-check`
mono chip, italic "reads as …", location · dates, mono quote, rare match,
"added by …", **Return to unreviewed** on hover), Conflicting Exhibits,
Passage group (shown once, "Start a Joint from this passage"), No longer
counted (dotted; reasons: withheld, reclassified AI-origin, changed since
capture, stored file missing), Matched facts (AI layer; `rare|common` chip,
Reject pair / Restore, each written to history), ● Unreviewed material
(warn left rule; cannot-check shows "no reading" and hides Add as support;
AI-origin shows "never supports a Joint"; actions Add as support / Add as
conflict / Dismiss…; dismissed collapsible with Restore), Acceptance context
(Assumptions / Confidence / Alternatives, "not recorded" when blank), History
(timestamp · who · what; every reversal recorded).
Dialogs (460/400px, 8px, `--shadow-overlay`): Accept this Joint (three
textareas, nothing scored), Reject this Joint (optional reason), Dismiss
‹Exhibit› (optional reason), This text will leave this machine (inquiry,
Note passages, shortlisted passage count, withheld-text caveat, Cancel/Send).

### Subject detail (center pane when a Subject is selected)
Name 15/700, kind · detail; twin notice for same-name Subjects ("they stay
two Subjects, and placing material with one never merges them"); Joints list;
"Start a Joint from a claim". **Unreviewed material · N waiting for you to
choose**: per span — Exhibit chip, location, Open span, mono quote, why,
rule line "Birdbrain never picks the Subject; placing the span with one never
merges the two", buttons **About this ‹name›** (creates a proposed
single-Subject Joint citing the span, `by: you · from E-40 …`, appears on
the map as a tab and in the list) and **About neither** / **Not about this
Subject**. Afterwards the row goes dotted/muted: here → "Placed with this
Subject · a proposed Joint about it cites this span · Undo"; the other
candidate → "Placed with Rowan Pike (byline) · no longer waiting here ·
Change"; neither → "You said this span is about neither … · Restore". The
Gaps entry mirrors the choice.

### Surface 5 · Source inspector (right pane, 340px)
Exhibit id chip + kind + integrity flag (`Changed since capture` / `Missing`
in `--bb-alert`), title, truncated sha256 (click to expand). Stored span:
mono quote with `--bb-sel` highlight; integrity explanation; cannot-check
chip + "no reading" + explanation; "Mark as my own" on mail headers. Grid:
Source Class radio chips (22px, accent when selected) + **Reason (optional)
· shows beside the class** input + AI suggestion line; Analysis: Withheld
from analysis checkbox (does not stale the run); Copy of: mark / remove.
Dates: Source states / Captured / Stamped at (missing values in warn).
Source trail (dotted top rule, "not the stored Exhibit"): URL, Wayback Ref
card; **Find the original…** → first-contact warning (Continue / Set up a
proxy / Stop warning on this network) → consent card (Destination, mono
Request, Egress; Cancel / Send) → spinner → CANDIDATE row (observed time,
"Not compared with E-38 until captured", **Capture as a new Exhibit** →
"Captured as E-61 · sha256 … beside E-38 · sha256 …", toast, run basis stale).

### Surface 7 · Narrow layout (<1150px)
Tabs Joints · Joint detail / Subject · Source (28px, 2px accent underline);
selection carries across.

### Surface 8 · Settings → AI analysis
Enable switch (installation); Providers grid (model + version, local/hosted
wording, region, egress); Case · per provider checkboxes; turning on
Anthropic opens an inline confirm card (Provider / Model / Region / Receives
/ Egress; "Turning on sends nothing"; **Turn on for this Case**).

### Surface 9 · Settings → Own identifiers
Beside Personas. Rows: mono value, meta, Remove; dotted "theirs" rows in a
Shared Case; Add input + button. "Mark as my own" in the inspector adds here.

## State model (prototype `inv` object)

`phase` setup|running|results · `inquiry` · `starts[]` · `runNo` · `basis` ·
`selJoint` · `selSubject` · `selExhibit` · `pane` map|detail|source ·
`pathA/pathB` · `joints{}` (id, a, b|null, claim, status, by, rare, mb?,
own?, support[], conflicts[], unreviewed[], dismissed[{id,reason}], lost[],
ctx, history[]) · `ex{}` per Exhibit (cls, clsWhy, withheld, copyOf) ·
`placed{}` span→Subject|neither · `candidates{}` · `extraEx{}` · `aiEnabled`
· `aiCase{ollama,anthropic}` · `ownIds[]` · dialogs (`acceptDlg`,
`rejectDlg`, `dismissDlg`, `review`) · `hover` · `foldOpen` · `lookup`.
Spans carry `present`, `reading`, `aiReading`, `about` (a|b|both), `cands`,
`claimFor`. Derived: effective status (contested when a member's decision
differs from yours), sides, lost side, reach set from starts (map subset),
strength sentence, weak reason, gaps.

## Rules the implementation must keep

- Status is always a word as well as a line style; colour never carries it.
- Proposed lines are dotted, not dashed. A path is never drawn as a line.
- Accept needs a reviewed, available span on each side of a two-Subject Joint
  (one span for a single-Subject Joint). AI-origin and cannot-check spans
  never support. A lost side keeps the Joint accepted but out of paths.
- Only a new Exhibit or a changed Note stales a run; Operator decisions and
  withholding do not.
- The list holds every Joint; only the map may truncate and must say so.
- Birdbrain never picks between same-name Subjects and never merges them.
- A lookup candidate supports nothing until captured as its own Exhibit.
- Hosted providers receive text only after the Operator reviews it; cancel
  copy says sent text cannot be recalled. Shared + hosted: proceed, name the
  unsynced members and their last sync.
- Every reversal (undo, restore, reject pair) is written to history; history
  names the rule or model with its version.

## Design tokens

From `globals.css`: `--color-canvas`, `--color-surface`, `--color-card`,
`--color-elevated`, `--color-border`, `--color-border-strong`,
`--color-text-primary|secondary|muted|faint`, `--color-accent`,
`--color-accent-subtle`, `--shadow-card`, `--shadow-overlay`. Prototype-only
status vars to add: `--bb-ok` #047857 / dark #34d399, `--bb-warn` #b45309 /
#fbbf24, `--bb-alert` #dc2626 / #f87171, `--bb-sel` (selection highlight).
Type: 9.5–10 (map meta), 10.5–11.5 (body in panes), 12 (rows), 13–15
(titles). Radii 3 (chips), 4 (controls, rows), 6 (cards), 8 (dialogs).

## Files

- `Birdbrain.dc.html` + `support.js` — live prototype (Investigate section:
  template at `data-screen-label="Investigate"`, logic in `invData`,
  `invDefault`, `invStrength`, `invPath`, `invRunStart`, `investigateVals`;
  Settings tabs `ai`, `identifiers` in `settingsVals`).
- `Case Investigation.dc.html` — directions and state drawings (canvas).
- `HANDOFF.md` — session log incl. the feedback-application record.
- `github.md` — repo association and screen map.

Not drawn: G3 run history, G7 per-run lookup approvals, G10 mail-message
Subjects. Open: real Subject layout algorithm (the prototype uses fixed
design-space coordinates scaled to width).
