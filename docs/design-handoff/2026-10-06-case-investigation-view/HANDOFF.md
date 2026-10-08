# Birdbrain — session handoff

Live file: `Birdbrain.dc.html`. Design authority: `Case Reviewer.dc.html`.
Bound design system: BirdbrainUI (`_ds/birdbrain-ui-9632b0b0-…`).
Engineering: see `ENGINEERING_REVIEW.md` — ingestion order, feasibility
checklist (15 items), and the proposed next deliverable.

## Session 2026-09-19 — Shared Case members mock

New file `Shared Case.dc.html` (canvas, ids 1a–1h) answers the upstream brief
`docs/specs/2026-09-19-shared-case-members-ui-brief.md` (branch
`t3code/privacy-first-collaboration`). Standalone by design: the feature has no
code upstream and no Case-settings surface exists in `Birdbrain.dc.html`, so the
mock is the handoff artifact rather than a merge into the live prototype.
Designer calls (identity, sync pill placement, string-first invite, wizard-card
join) are stated in the mock header. Tweaks: `theme`, `showRevoked`. Member hues
`--m1..--m4` are proposed tokens; the local installation always uses
`--color-accent`. Deliberately not drawn: read-only role, per-Exhibit sharing,
owner transfer, at-rest encryption (brief "Not in scope").

## Session 2026-10-06 — Investigate: feasibility-assessment revisions

Applied in `Birdbrain.dc.html` only (reference drawings in `Case
Investigation.dc.html` unchanged). Every Modify in the 2026-10-04 assessment
is addressed except where noted.

- **S1.** "Find material for this claim" now lives in the Notes editor: select
  a passage → selection bar → pick one or two Subjects → "Record Joint and
  set up a run". It records a proposed Joint titled with the quoted claim,
  `proposed by you · from Note N-n`, then opens the setup card showing that
  Joint row. The old inquiry-prefill shortcuts route to Notes instead.
  Screening cap: "Pairs compared without screening" number field + Raise in
  the AI-layer setup row; the header count reads from it.
- **S2.** Header row 2 carries "Followed: 2 Joints out from each starting
  Subject".
- **S3.** Map layout is now computed (ring model, see below). `role="group"`
  replaces `role="application"`; keyboard handling unchanged, the list stays
  the screen-reader equivalent. Shared Case: member cards appear in the
  detail pane for any decided Joint; an undecided member shows "Not decided ·
  As MB sees it: 'Accepted by NK · you have not decided'". List rows keep
  the status word only (user's call).
- **S4.** Passage group: "Footer repeated in 9 of 62 Exhibits · ceiling 5".
- **S5.** Inspector adds "Body not acquired · headers only" (E-40),
  "unattested" chip when the Manifest never hashed the stored text (E-31),
  an identifier-frequency chip ("3 Exhibits", total in tooltip) on link
  targets and mail headers, Dismiss beside Take suggestion, and in a Shared
  Case two stacked Source Class rows (NK / MB) with "Use this" and the
  unclassified / AI-origin rule (E-38).
- **S6.** New Gap group "No longer supported": accepted Joints that lost
  their last available support or one side (derived; withhold E-23 to see
  it).
- **S7.** Breakpoint measured on the view (ResizeObserver on the Investigate
  root), tabs below 1140px.
- **S8 / 14 / 17.** Disclosure copy uses decision 21's limit (no "never
  withheld material"). Review-before-sending adds the hash-check line and,
  in a Shared Case, "1 member not connected (MB, last synced 2 Oct)". A local
  model now has its own shorter disclosure before it turns on.
- **States 6 / 10.** Per ADR-0042 (2026-10-06): withholding, clearing a flag,
  Source Class, copy marks, own identifiers (Add, Remove, Mark as my own),
  span placement, and any decision on a Joint the shown run did not create
  mark it out of date. Exempt: decisions on the shown run's own proposals.
  Joints carry `run` (the run that created them; seeded j1–j4 = run 1, j5 and
  Note/placement Joints = none), so Restore on the N-3 Joint, or any decision
  after run 2, shows the banner. The earlier G12 reading
  ("withholding no longer stales the run") is withdrawn.
- **State 13.** "Ollama · llama3.1" → "Local model (placeholder)" everywhere.
- **States 15 / 16.** Reachable from the setup card via prototype-only
  "Simulate: Case changed" / "Simulate: AI stopped" buttons. Banners carry
  the Shared Case sync trigger and the hosted-provider line.
- **Tokens.** `--bb-*` replaced by `--color-success-fg` / `--color-warning-fg`
  / `--color-danger-fg` (shimmed in the helmet with the repo's light values
  `#047857 / #92400e / #b91c1c`; dark unchanged) and `--color-accent-subtle`.
  Investigate type snapped to 10 / 11 / 12 / 14 / 18; chips 4px, overlays 6px.

### Joint map layout rules (for the pure model module)

1. Starting Subjects share the centre: one sits at it; two or more sit on a
   small inner ring, clockwise from the top in the order given.
2. Each hop out by accepted or proposed Joints is one ring further out. A
   Subject sits at the mean angle of the Subjects it hangs from (all
   neighbours one ring in); siblings that would collide spread
   clockwise by a fixed separation. A second-hop Subject sits one step
   clockwise of its parents.
3. Subjects with no Joint to the starting set sit on the outermost ring,
   evenly spaced and offset from the ring inside.
4. A single-Subject Joint's tab hangs under its Subject; several stack in
   Joint-list order.
5. Deterministic: same Case state, same map. Adding a Subject adds one
   position; existing Subjects move only within their ring.

6. If a wanted position would overlap a placed Subject or tab, or an edge
   from it would cross one, the Subject steps along its ring (±20°, ±40°…)
   to the first clear spot. Edge labels start at the midpoint and slide
   along the edge to the first spot clear of every box.

Map is 360px tall; rings in the 500-wide design space: inner 110×62,
hop 1 185×152, outer 200×160. Edge labels sit at the midpoint, to the right
of a steep edge and above a flat one. Fold threshold stays 8.

### Still open

G3 run history, G7 once-per-run lookup approval. Reference drawings not
redrawn for the new states.

## Session 2026-10-04 — Investigate (Joint map), turn 3

Carried the turn-2 states from `Case Investigation.dc.html` into the live
Investigate screen, plus map behaviour. Reached by real interaction where the
Case allows it; otherwise by tweak.

- *Map*: fits the pane width (x-scaled from the 500px design space, measured
  by ResizeObserver); hovering a Subject dims everything not adjacent; the map
  is focusable (arrows step through Joints in list order, Enter opens the first
  Exhibit span, Escape clears the path); above 8 Subjects, those with no Joint
  fold into an "N more Subjects" chip (tweak `manySubjects` adds six);
  clicking an edge label opens its first span.
- *Reach*: a run now shows only Joints connected to its starting Subjects, so
  starting from Rowan Pike alone reaches "The run proposed no Joints". A case
  created in New Case has 0 captures → Investigate shows "Nothing to read yet".
- *Contested* (tweak `sharedCase`): j1 carries MB's rejection; your own
  accept/reject against it derives Contested (double rule, both member cards,
  Gaps → Contested Joints, "withheld by you and MB").
- *cannot-check / missing*: E-44 poster alt text (unreviewed on the proposed
  Joint, no reading, cannot be added as support); E-27 PDF missing (No longer
  counted, inspector explains).
- *AI*: Settings → AI analysis (installation switch, providers, per-Case
  toggles; turning on Anthropic asks first). Running with Anthropic on opens
  the review-before-sending dialog; cancel copy says text cannot be recalled.
  `aiLayer` tweak only seeds the switch.
- *Own identifiers*: Settings tab beside Personas; "Mark as my own" in the
  source inspector adds there.
- *Lookup*: "Find the original…" in the source trail → Direct-connection
  warning (once per Exhibit, or stopped) → consent prompt → candidate row →
  "Capture as a new Exhibit" (E-61…, marks the run basis stale).

### Brief feedback applied (2026-10-04, same session)

Decided gaps: G9 two-sided Accept needs a reviewed available span on each
side (spans carry `about: a|b|both`; the proposed Sato–Ferryman Joint shows
Accept unavailable with the side named; returning E-17 on the accepted
Calloway–Sato Joint demonstrates the lost-side state: stays accepted, dotted
notice, out of paths, weak mark only via the one-source rule). G11 a pair
with a rejected or proposed direct Joint shows that Joint beside the path
through other Subjects. G12 (superseded 2026-10-06: withholding does put the
run out of date; see the session above). G8 shared + hosted: run proceeds, names
MB's last sync. Confirmed items kept. New surface: same-name choosing lives
in Subject detail (reachable from a Subject with no Joints): "About this
Rowan Pike" starts a proposed single-Subject Joint citing the span, the other
candidate shows where it went, "About neither" parks it, all undoable; the
Gaps entry tracks the choice. Small things: the Joint list is always
complete (map rows marked "not on this run's map", fold chip points to the
list); history and `by` carry rule/model versions; Reject takes an optional
reason; Source Class has an optional reason shown beside the class
everywhere; with the AI layer on, the results header carries the provider's
candidate claims and search terms, labelled as its wording, with "Draft as
inquiry". Matched-fact Reject/Restore now work and write history.

## Where things stand

### Done this session

**Motion & polish pass (2026-08-11).** App-wide: 150ms fade+rise screen
transitions; first-visit-only list stagger; press/hover/focus micro-states;
drawer-expand panels and scaleY popovers; toast overshoot entrance with a 6s
progress bar; overview metric count-up and one-time link-map stagger; theme
crossfade; slim scrollbars. Three kill switches: prefers-reduced-motion, the
Settings "Reduce motion" toggle (now functional), and a `motion` tweak.
Spec: `design_handoff_birdbrain_prototype/MOTION.md`. Also repaired a
drag-displaced Case Overview block (restored into its route wrapper).

**File consolidation.** `Birdbrain.dc.html` was already a strict superset of the
Fable and Opus variants. Both moved to `archive/` with a README recording the
diff; the byte-identical `Opus copy` was deleted. The one decision not carried
forward is documented there: Opus framed the archive.org panel as performing an
automated diff, which Fable corrected to "Birdbrain doesn't diff the two". The
live file uses Fable's honest framing.

**Notes screen.** Sort + filter toolbar matching the Capture viewer (Newest /
Oldest / Title A–Z; filter by tag and date). Empty states for both
filtered-to-nothing and first-run, with a Clear filters action. Wired the search
field. Footer count is now dynamic.

**Mention rendering.** Fixed a misfire where a completed `#[tag|phishing]` token
at the end of a note body was read as an in-progress mention query, leaving the
autocomplete popup stuck open. Completed tokens are now masked before the
trailing-query scan. Note-list snippets route through `noteSnippet()` so they
honour the `mentionStyle` tweak instead of leaking raw storage syntax.

**Data screen context menus.** Added `folder`, `part`, and `ledger` kinds to the
existing `ctxRootItems` system and wired `onContextMenu` onto tree nodes, MHTML
part rows, and ledger entries.

**Captures screen.** Removed the Source tab entirely (Page is the MHTML file) —
tabs are now Screenshot / Page / Text / Wayback. The capture list column is
hidden when Wayback is active, so the two stacked list columns no longer compete.

**Density.** Three steps (compact / default / comfortable) driven from the root
element, scaling padding, row heights, and gaps: `--d-pad`, `--d-gap`, `--d-card`,
`--d-cardsm`, `--d-metric`, `--d-row`, `--d-rowpad`, `--d-head`, `--d-itemy`,
`--d-itemx`, `--d-tree`, `--d-listgap`. `--d-r` is pinned at 6px — radius is not
a density concern.

**Multiselect.** Checkbox fades in on row hover and stays once anything is
checked. Row click selects and the detail pane follows; ⌘-click toggles;
shift-click extends a range from the anchor, from either the row body or the
checkbox. Select-all checkbox in the batch bar, ⌘A for everything in the current
filter, Escape clears. Selection survives filter changes and navigation. The
sort/filter toolbar transforms in place into the batch bar (Export / Tag /
Delete / Clear). Helpers: `multiIds`, `setMultiIds`, `clearMulti`,
`allSelected`, `toggleSelectAll`, `rowSelect`.

**Export.** Three presets — Full evidence bundle, Working copy, Court exhibit
(everything except analyst notes) — over an eight-item custom list that
auto-detects which preset is active and expands when the selection is custom.
Scope row reflects whether you are exporting the case or the current selection.
Chain-of-custody cover sheet carries all nine agreed fields plus a free-text
purpose input and signature/date rules.

**Standardization pass — all seven screens** (Overview, Signals, Selectors,
Tags, Settings, Extension, New Case). Four rules applied:

- *Section headers.* Panel labels are now one treatment everywhere: 10px / 600 /
  uppercase / .06em / `--color-text-faint`, matching `.section-label` in the
  handoff patch and Case Reviewer. Overview's icon+12px/700 card titles, and the
  `h2`/`h3` titles on Selectors, Tags and Settings, all converted; header icons
  dropped to 13px faint. The one exception is a header that is itself a control
  with a description under it (Selectors' "Create New Selector" disclosure) —
  that stays a 12px/600 title, since a label role and an action role are
  different things.
- *Controls.* One button metric: 28px tall, 4px radius, `0 11px` padding,
  12px/500. Killed the 30px and 32px variants and every 6px-radius button. One
  input: recessed — `--color-canvas` fill, `--color-border-strong` border, 4px
  radius, `6px 10px`. Replaces the elevated/surface/canvas mix.
- *Radii.* Progress and coverage bars moved from pill to 2px. 9999px is now only
  status pills and dots.
- *Density.* `--d-pad` / `--d-gap` / `--d-card` now drive Signals, Extension and
  New Case, which were hardcoded.

Monospace was cleaned on these seven at the same time (partial delivery of the
open mono item): hostnames, counts, timestamps and labels lost mono and took
`tabular-nums` where numeric. Mono survives on selector patterns, ignore-list
globs, file paths and names, chrome:// URLs, hashes, the TSA endpoint, the
installation ID and the diagnostics log.

## Session 2

All four open items closed, plus five rounds of user-directed work.

- *Monospace cleanup* finished on Dashboard, Captures, Notes, Data, dialogs and
  the extension mock. Mono survives on selector patterns, file paths, hashes and
  the diagnostics log; numerics took `tabular-nums`.
- *Context menus* wired onto Wayback snapshot rows, pinned snapshots, pipeline
  events, Notes suggestion/link rows and tag chips. New ctx kinds: snapshot,
  event, link, suggestion.
- *Empty states* added for the Captures list (with Clear filters when narrowed)
  and the Notes rail's "Links out".
- *Dashboard ultrawide* resolved: a "Recent activity" feed (flat chronological,
  last 10, case chip + provenance dot + relative time, rows jump to the capture)
  replaces Quick Start once a case has activity. `firstRun` prop drives it.
- *Notes list* rebuilt: uniform-height rows, 44×32 capture thumbnail from the
  note's `capId`, timestamp demoted to the byline, detailed/list toggle
  mirroring Captures, column widened to 308px.
- *Capture selection* moved to a footer bar that slides in above the count row
  (export / tag / pin / recapture / delete / clear). Old top bar removed;
  ⌘click and shift-click unchanged.
- *Wayback* is now a right-side slide-out panel (436px) holding the archive.org
  header, snapshot filter, date range, presets, calendar, snapshot list and
  pagination. The viewer splits into your capture vs. archive snapshot, each
  pane floored at 300px, with an Open-at-archive.org button.
- *Thumbnails* across Overview, Captures and Notes are now a masked silhouette
  of the Birdbrain logo on the tinted gradient.
- *Both viewer columns* are resizable (drag handles, 240–560 list / 320–680
  details) and collapsible to 40px rails.
- *Scale test*: the case seeds 156 captures. The Signals coverage strip caps at
  the 24 most recent — it blew the row out at full length.

## Session 3

- *Overview rework (consolidated variant, now the default).* "Since your last
  visit" strip moved into the right column; Quick Notes sits top-left with Tags
  and Selectors stacked beside it.
- *Backlink map* below Quick Notes: Maltego-style, notes down the centre lane,
  connected captures/selectors/tags in flanking columns; dashed edges =
  references, solid = note-to-note backlinks. Layout hardened: 3×8 lattice, no
  node overlaps, edges avoid unrelated nodes, reciprocal backlinks deduped,
  reference-edge contrast raised 1.28:1 → 3.25:1, duplicate node names
  middle-truncated. `mapClear` clears focus; nodes open their note/capture.
- *Comment fixes.* Capture rows: selection rail removed for single selection
  (redundant with accent border + tint; still shows for multi-select). Capture
  detail panel: Source/Captured lost their hanging icons — labels and values
  now share the 20px left edge with Tags/Notes.
- *Tweak defaults* saved by the user: `overviewVariant: consolidated`,
  `density: comfortable`, `mentionStyle: chip`.

### Extension findings (questioned, not built)

The mock already covers the Browser sim (route `browser`, Chrome + extension
popup) and the Extension Setup guide (route `extension`). Not mocked: in-page
capture overlay, options page, per-tab case memory. User preferences collected:
cover all four surfaces eventually; default capture = full page; case binding =
per-tab; popup pipeline health = minimal dot. Later rounds (post-capture
moment, overlay tools, where it lives) were left unanswered.

## Session 4

**Sweep pass — done.** Code-first sweep of every remaining off-system value.
App chrome only; the Meridian phishing mock and the Chrome browser sim keep
their own styling (they are simulated content).

- *Dashboard + header* (never covered by the session-1 pass): hero CTAs from
  16px-radius glow buttons to 6px flat; case cards, Quick Start cards, icon
  tiles and extension banners from 8–16px radii to 6px; step tiles 9px → 6px;
  hero subtitle 16 → 14px; card titles 13 → 12px; Connected badge became a
  status pill; Setup/Install buttons to the 28px/4px metric; glow shadows
  removed. Header: search field to the recessed-input standard (canvas fill,
  border-strong, 4px), Export button 32px/14px → 28px/12px, menus 8 → 6px.
- *Captures viewer*: sort/filter/download menus 8 → 6px; annotation toolbar
  32px buttons → 28px; toolbar shell 16px and style panel 12px → 6px;
  screenshot frame 12 → 6px; tab group 8/6 → 6/4; selection bars 32 → 28px;
  row titles 13 → 12px; thumbnails 3 → 2px; tag chips → pills.
- *Notes*: mention popup and sel-confirm popover 10 → 6px; context rail 12 →
  6px; suggestion/link rows and boxes 7–8px → 4–6px.
- *Data*: search input to recessed standard; tree rows and tabs to 4px;
  detail panels 8 → 6px; badges 5 → 4px; checkboxes 3 → 2px.
- *Extension popup*: 7px radii → 6px; 32px action buttons → 28px/4px.
- *Dialogs/overlays*: delete + export dialogs 16 → 6px; palette 12 → 6px;
  context menu 10 → 6px; toasts 9 → 6px; footer buttons 32/8 → 28/4.
- Dialog titles 16px → 14px (scale compliance).

**Backlink-map interactions — done.** Hovering a node previews its
neighbourhood (same dimming as focus, accent-tinted border, no click needed);
focus still wins while set. The legend became four filter chips (note /
capture / selector / tag) — toggling one ghosts that type's nodes to 12%,
drops their edges to 5%, and disables their pointer events; focus clears
itself if its type is hidden. Selector nodes got a distinct sky dot
(`#0ea5e9`) in the map only — they were indistinguishable from notes, both
accent. State: `mapHover`, `mapTypesOff`.

**Notes editor rail / mention grammar polish — done.**

- *Rail:* collapsed Context pill 30 → 28px / 12px text; suggestion add/dismiss
  buttons and popup rows 6 → 4px radius; linked-mention cards 7 → 4px;
  off-scale 9.5/10.5/11.5px type normalized to 10/11/12. Rail footer copy fixed
  — it claimed `[[wiki links]]`, which was never the grammar; now describes the
  real `@` / `#` sigils. Editor footer's dead "type / for commands" replaced
  with the same @ / # legend.
- *Grammar logic:* Escape now suppresses the popup via `mSquelch` (previously
  appended a space to the note body to dismiss); selection index clamps to the
  real item count (Enter could hit undefined past the list); popup flips above
  the caret near the bottom edge (`syncMentionPos`, drives `mAbove`, which was
  never set). Unused `mHint` removed.

**Capture flow in the browser sim — done** (first of the four extension
surfaces; built to the collected preferences: full-page default, per-tab
binding). "Capture now" closes the popup and runs an in-page overlay — accent
viewport frame + top HUD with a three-step progress readout (serialize /
inline / hash, `capStep`). On completion a post-capture card slides in
bottom-right: case name, page title, provenance meta line, quick-add tag
chips (`extCapTags`), View in Birdbrain / Recapture. Replaces the old
top-center toast. Popup header now reads "Logging to · this tab".

**Capture list dates.** Compact list rows: clock icon + short relative time
(`fmtAgoShort`), hover = full timestamp (`fmtFull`); detailed rows got the
same hover. (From Matt's inline comment.)

**Popup minimalized + native context menus — done** (user: popup too busy /
too much color; driving happens via right-click). Grounded in
`extension/src/background.ts` + `popup.tsx`:

- *Popup*: Recording pill → bare status dot (title tooltip); "Matched on this
  page" colored-dot box and tag chips → one quiet summary line (`matchSummary`);
  page-status icon neutral; added a faint right-click hint line. Header reads
  "Logging to · this tab".
- *Context menus (mocked native Chrome)*: right-click on the sim page opens a
  light-native menu — page context: Back/Forward/Reload, Save as…, Print…,
  **Birdbrain ▸ Capture Full Page / Capture Full Page (Scrolling)**, Inspect;
  selection context: Copy, Search Google, Birdbrain ▸, **Create Selector from
  Selection** (top-level, as in background.ts). Extension items gray out unless
  connected + active case, mirroring `chrome.contextMenus.update(enabled)`.
  Scrolling capture runs the HUD with a stitching step; card meta reflects mode.
  State: `bctx`, `capMode`. Create Selector routes into the existing
  sel-confirm popover.
- *Improvement candidates surfaced to user*: real menu lacks "Save selection as
  note/quote" and "Tag this page"; popup Capture button skips the ignore-list
  pre-filter that the context-menu path enforces (server 403 is sole guard).

**Auto-capture exclusions (Signals) — done** (Matt's inline comment). The
Auto-capture card grew a collapsible "Never auto-capture" section: case-level
exclusion chips (domain or /regex/, mono, removable, Enter-to-add inline
input) plus a Stack on global / Override global segmented toggle
(`acExclMode`); collapsed header shows "3 exclusions · + global" summary.
Footer line explains each mode and points at the global list (Settings →
Privacy, 12 entries — fictional but consistent with the options-page ignore
list in background.ts).

**Per-tab case memory demo — done.** Browser sim now has two Chrome tabs
(cracked-forum → Nightjar Phishing Kit; a paste-site wallet dump → Lazuli
Ransom Wallets), each with a case-color dot on the tab. Switching tabs swaps
page content, popup binding, match summary, badge, and capture-card case.
The popup's "Logging to · this tab" case name is now a dropdown — rebinding
remembers per tab (`tabCases`), with a footnote ("other tabs keep their own
case"). Note: upstream has ONE global active case; this is the prototype's
proposed improvement.

**Selection → selector in Notes — done** (Matt's inline comment). The notes
editor now runs the same flow as captures/extension: select text →
Selector/Tag bar → typed confirm popover (kind detection, watch, backfill) →
toast. New `note` scope on the shared `startSel` machinery; selectors created
from notes carry `origin: 'note'`; tag toast says "applied to this note".
Quote action omitted in notes (already a note).

**In-page feedback grounded in upstream — done.** Replaced the invented
capture HUD (accent viewport frame + top progress bar) with the real
extension's toast, recreated 1:1 from toast.ts: dark #131316 bottom-right
toast, #6467f2 spinner, "Capturing page..." (scroll mode first shows
"Scrolling to load content..."). Success stays the corner card. Selector
match highlights now match content.ts exactly: amber rgba(251,191,36,.35)
mark + 2px #f59e0b bottom border, inherit text color — replacing the old
per-type color coding.

**Options page — done** (net-new; nothing upstream). Deliberately thin, since
upstream pulls all settings from the app via getStatus: third tab in the sim
(chrome-extension://…/options.html, opened from a gear in the popup footer) with
Connection (localhost:19845, Connected dot, 30s refresh note), a screenshot
toggle (captureScreenshotsEnabled), and a note that cases/selectors/ignore
list/dedupe live in the app. The tab demos DEFAULT_IGNORE: no case dot,
popup says "This page can't be captured / chrome-extension:// pages are always
ignored", no Capture button, Birdbrain context-menu items disabled.

### Design note — capture must hide the extension's own UI (user, session 4)

Full-page and scrolling captures scroll the page while framing the screenshot.
All extension-injected UI — capture toast, selection action bar, selector
confirm popover, selector highlights — must hide itself for the duration of the
screenshot and reappear after, so no Birdbrain chrome ends up baked into the
evidence image. Applies to `content.ts` (captureFullPage / scrolling capture
paths) and `toast.ts`; the toast should suppress or defer its progress state
until frames are taken. Noted for handoff; the sim does not yet demo it.

### Still open

- Demo/document the hide-UI-during-capture behavior above in the browser sim.
- Extension surfaces otherwise built; later preference rounds unanswered.
- (Session 5) Per-tab binding was later withdrawn — see Session 5; the session-4
  demo described above no longer reflects the prototype.

## Session 5 — engineering review response

Engineering returned the feasibility assessment (Deliverable A, in `uploads/`),
audited against `thebristolsound/birdbrain@main` tree `37dbf57`: 13 of 15 items
Accept or Accept-with-modifications; item 6 (references index) confirmed as the
gate for 7, 8 and the Overview map; the 2026-08-07 style patch rejected as stale.

**Decisions made (design, 2026-08-11):**

- *Per-tab case binding — withdrawn* (item 1, user call: "asking for trouble").
  The model is pure global: one active case, popup shows it, switching in the
  popup switches the app. Prototype updated — popup header reads "Logging to",
  the case dropdown sets `extCase` globally (menu: "Set active case", footnote
  says switching also switches the app), per-tab dots on the Chrome tab strip
  removed, capture card no longer says "this tab". `tabCases` state replaced by
  `extCase`. Item 1's disagreement-semantics question is moot. No wrong-case
  guard added beyond the prominent case name in the popup header.
- *Captures viewer tabs — prototype wins* (item 11): Screenshot / Page / Text /
  Wayback. This deliberately reverses upstream's Wayback demotion; the standing
  "confirm which side wins" sync note is settled.
- *Export manifest scope field* (item 13): the signed export manifest entry
  records `scope: 'case' | 'selection'` plus a `captureIds` list for selections.
  The export dialog now shows the manifest note under the Scope row
  (`expManifestNote`).
- *Backlink map node ceiling* (item 7): capped at 20 nodes — notes always
  survive, busiest entities (by edge degree) fill the rest; footer shows
  "showing N of M nodes" when capped. Same treatment as the Signals coverage
  strip cap.
- *Style patch regenerated as v2* — `design_handoff_style_sync/` rewritten
  against the final 2/4/6 system and the real files at tree `37dbf57`: radius
  collapse via token aliasing, one 28px control metric, recessed inputs
  (canvas fill + strong border), SectionLabel at .06em, no hero glow, density
  `--d-*` rides with it (item 15).
- *Sequencing accepted:* item 2 (hide extension UI during capture) files as a
  live evidence-integrity bug now; item 6 spike before any mentions UI; items
  5/9 are safe fillers; item 10 deferred until auto-capture returns.

## Session 6 — final audit sweep + handoff prep

Consistency audit of the whole shell against the session-5 decisions and the
2/4/6 system. Confirmed clean: global `extCase` binding ("Logging to" popup,
"Set active case" menu), export `scope`/`captureIds` manifest note, Captures
tabs, radii (all remaining off-system radii live in simulated content only).
Fixed:

- *Type scale*: 83 app-chrome lines carried half-pixel sizes (9.5/10.5/11.5/
  12.5) — normalized to 10/11/12. Sim content (Meridian mock, Chrome menus,
  options/forum/paste pages) untouched.
- *Dead markup*: the per-tab case-dot span on the Chrome tab strip (always
  transparent since the session-5 withdrawal) removed, with its `caseDot`/
  `caseTip` fields.
- *Off-metric buttons*: browser-sim "Return to Birdbrain" (32px/6px) and the
  delete-dialog footer pair (36px/14px) → the 28px / 4px / 12px standard.

**Handoff bundle refreshed** (`design_handoff_birdbrain_prototype/`): prototype
copies (`Birdbrain.dc.html`, `Case Reviewer.dc.html`, `support.js`), `github.md`
and `ENGINEERING_REVIEW.md` re-synced from the live files; `style_sync_patch/`
replaced with the v2 patch (the rejected v1 is gone); `SESSION_HISTORY.md`
regenerated through session 6; README updated for the session-5 decisions
(global `extCase` binding — per-tab withdrawn, export manifest
`scope`/`captureIds`, backlink-map 20-node ceiling); all 10 screenshots
recaptured from the post-sweep prototype. `design_handoff_style_sync/prototypes/`
re-synced too.

## Session 7 — onboarding walkthrough

Spec settled over an eight-round form, then built into the prototype:

- *Mechanic*: Style C spotlight coach marks — light dim (38%), accent ring +
  numbered badge on the real element, compact anchored tooltip with arrow
  (flips above near the bottom edge), "N of M · skip" + Next. Warm-brief copy,
  kbd hints on relevant steps.
- *Two phases.* Intro on first launch: centered welcome card → create-case
  mark (hero CTA, Ctrl N) → extension mark (Browser button) with an
  expandable "Install walkthrough" (3 compact steps absorbed from the Setup
  guide). Ends on the dashboard pointing at the demo case. Case tour fires on
  first case open (5 marks): capture viewer tabs → Signals selectors →
  notes @/# mentions → link map → Export button, ending with
  "Delete demo case / Keep exploring".
- *Navigation*: mixed — Next auto-navigates routes; user nav clicks jump the
  tour ahead to the matching step. Spotlighted elements stay live but never
  auto-advance.
- *Skip/replay*: skippable anytime, never auto-returns; replay via ⌘K palette
  ("Replay walkthrough") and Settings → About. `tourOnLaunch` tweak
  (default on) drives the first-launch trigger.
- *Extension guide absorbed*: the standalone Setup guide screen (route
  `extension`) is removed; its install steps live in the tour's expandable,
  and old entry points (`goExt` — dashboard banner Setup Guide) now replay
  just the extension chapter.
- *Demo case cleanup*: "Delete demo case" hides Nightjar from the dashboard
  grid and palette (`demoDeleted`, in-memory; reload restores).
- State: `tour {phase, step, installOpen}`, `tourRect` (measured off
  `data-tour` anchors), `_tourCaseDone`; targets carry `data-tour` attrs
  (newcase, browser, viewertabs, selectors, noteeditor, linkmap, export).
- Note: handoff bundle fully re-synced after this session — prototype copies,
  SESSION_HISTORY, github.md, ENGINEERING_REVIEW, and all 12 screenshots
  (incl. tour welcome + case-tour mark) recaptured from the final build.

**Extension popup case select** (follow-up comment): the "No case selected"
state's link-out button ("Choose case in Birdbrain") replaced with a
single-row select — "Select a case…" + chevron opening the case list in
place, Hunchly-style. Picking sets the one global active case (footnote in
menu). Connected state's "Logging to" dropdown unchanged.

**Session-7 review + cleanup**: tour walked end-to-end (intro 2 marks +
welcome, ext chapter expandable, case tour 5 marks, Delete/Keep ending) —
anchors, arrow flips, and jump-ahead nav all correct. Tour Style A/B/C
candidate files deleted. Bundle fully re-synced: prototype copies, README
(walkthrough section, floating action bar, popup select, Setup guide
removal), ENGINEERING_REVIEW (item 1 marked withdrawn, item 16 walkthrough
added), SESSION_HISTORY through session 7, screenshots 03/09 recaptured +
11/12 tour shots added, and a new `IMPLEMENTATION_GUIDE.md` — six-stage
rollout order (style sync → extension pass → references index → notes
editor → case screens → dashboard/onboarding) with risk register and
per-screen definition of done.

**Captures multiselect rework** (Matt's inline comment: old pattern "doesn't
work", wanted industry standard). The in-column footer batch bar (icon-only
24px buttons crammed into the 280px list column) is replaced by a floating
action bar: fixed, bottom-center of the viewport, elevated pill on
`--shadow-overlay` with a select-all checkbox + "N selected", labeled actions
(Export / Tag / Pin / Recapture / Delete) and an X (Esc) to clear. The
"⌘click to multi-select" footer hint is gone — the hover checkbox is the
affordance. Selection mechanics unchanged (checkbox / ⌘ / shift / ⌘A / Esc);
appears only when the multi-set is non-empty, never on plain row click.

## Session 8 — interaction polish + pin annotations

User-directed refinement pass, all shipped and synced to the handoff bundle:

- *Capture-row hover:* replaced the translateY "wobble" with a tint-overlay
  fade (`.liftrow::after`, 4.5% text-primary, 120ms). Rows never move.
- *Selection toolbar:* floating bottom-center bar collided with the
  annotator toolbar — replaced with an inline selection bar at the top of
  the list column (`bbselbar`). Same pattern added to Notes (⌘/shift-click,
  accent rails, Export / Tag / Delete; Export opens the export dialog with
  a notes-focused include set).
- *Screenshot pin annotations (net-new):* pin tool drops numbered teardrop
  markers (% coordinates, counter-scaled against zoom), note popover
  (flips above the marker below 55% height), and a top-right legend panel
  (scannable rows, inline expand, marker halo). ENGINEERING_REVIEW item 17.
- *Signals:* add-selector input grew a match-mode drawer on focus (Exact
  text / Regex radio cards, mousedown-pick); coverage-strip empty cells now
  use a 9% text-primary tint (legible in light mode).
- *Notes:* mention chips are clickable — captures/notes navigate, selector
  chips deep-link to Signals with the rule open for editing (fuzzy
  label/pattern resolver).
- *Light-mode legibility:* backlink-map surface is now a shaded inset
  (5% tint + dot grid).
- *Right-edge panels:* Wayback and details panels now fade (150ms) instead
  of width-animating — the two were fighting in opposite directions on tab
  switches. MOTION.md updated.
- *Handoff bundle synced:* fresh prototype + support.js, MOTION.md/README/
  ENGINEERING_REVIEW updated, all 14 screenshots recaptured at 6226×2330
  (full desktop viewport, 2×; two new shots: selection bar, match-mode
  drawer).

## Agreed design system

Compact 12px base. Sharp radii: 2 / 4 / 6px, with pills reserved for status.
Five-step type scale: 10 / 11 / 12 / 14 / 18. Surfaces separate using both
borders and backgrounds. Monospace only for machine output as above.

## Other files

`Birdbrain v2.dc.html` — standardized sample of Dashboard + Captures.
`Birdbrain v2 (github sync).dc.html` — snapshot of the reverted upstream sync
(thebristolsound/birdbrain 1.0.1-beta.17), kept only for parts salvage.
`archive/` — superseded Fable and Opus variants.
