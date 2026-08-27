# Standalone mock corrections brief

Sixteen items need a design decision. Twenty-nine are recorded deviations that want no response.

This is the round-trip register for the 2026-08-21 standalone mock
(`docs/design-handoff/2026-08-21-birdbrain-standalone/Birdbrain-standalone.html`), the single design
source for the redesign program (spec #382). It is the snapshot handed to the design side. The
content cutoff is the wave-3 phase-2 intake of 2026-08-24; the filename carries the date that ruling
R11 assigns to this document in `docs/plans/2026-08-24-wave3-phase2-intake-rulings.md`.

Answer the first section. The second is a notification list: those calls are made and most are
already shipped, and they are written down so the same ground is not re-covered in a later handoff.

Line references point into the **unpacked** template, never the packed HTML. Unpack it with the
recipe in the bundle README. The copy every citation below was checked against is
`md5 45cc353308009126ede962d1a6cb0067`, 16161 lines, and every citation in this document was re-read
with `sed` against that copy before it was written. Citations in three of the source comments did
not survive that check, so nothing here is quoted from a ticket without a second read.

Where a decision is already recorded, the ruling identifier (`R4`, `R17`, and so on) points at
`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md`.

## Needs a design decision (16)

### 1) The extension options page specifies a mono token the extension does not ship

The server-URL pill (template 12234) and the token readout (template 12240) both set
`font-family:var(--font-mono)`. The Chrome extension bundles exactly one font, Inter Variable. The
app's `--font-mono` is JetBrains Mono Variable, which the extension does not carry. Shipped: the
Tailwind `ui-monospace` system stack, adding no token and no second webfont to the packaged zip.
**Decide whether the extension gets a mono token at all**, given that adding one costs a webfont in
every install.

### 2) The extension options page draws no disconnected, loading or no-token state

Template 12221-12257 draws only the connected, token-issued, screenshots-on case. The mock's own
state model disables Birdbrain interactions on that tab rather than rendering a degraded page, so
the three states the page exists to explain are not drawn at all. All three were built, with copy
derived from the popup's already-shipped offline vocabulary rather than invented: `Checking` while
loading, `Not connected` plus a line saying the page reconnects on its own, and `Not issued yet`
plus a line saying the app issues a token on first contact. **That copy is a derivation, not a
specification, and needs confirming or replacing.**

### 3) There is no broken-Mention chip treatment

`mentionStyleFor` (template 13961-13974) and `mentionColor` (template 13975-13981) have no broken
branch, and every fixture in the mock resolves. A Mention whose target is deleted is a state the
notes work has to draw. Shipped as an invention derived from existing tokens: the
`--color-danger-fg` token, a dashed ring in place of the solid one, strike-through, no click, and
geometry identical to a live chip so that deleting a target cannot reflow the paragraph. **Rule on
the treatment**, or confirm the invented one.

### 4) The Overview backlink map has no empty state, and its note lattice breaks past three notes

Two problems in the same card, both reachable in a real Case.

`noteAngle` (template 14169) divides by `notes.length`, so a Case with no notes yields `NaN`
coordinates, and the card renders the lattice unconditionally. There is no empty state for either
no-notes or no-Mentions.

The lattice snap places notes at `row = Math.max(0, Math.min(ROWS - 1, 1 + noteN * 3))` (template
14228) against `ROWS = 8` (template 14218), so notes four onward all clamp to row 7; and the note
branch returns at template 14232 before the collision search at 14236-14247 can run, so they stack
in one cell rather than finding a free one. Cases carry more than three notes routinely.

Shipped: two empty states, and a deterministic layout whose row count grows with the note and entity
counts and which matches the mock exactly at three notes or fewer. **Specify the empty-state copy
and treatment, and rule on note placement at a realistic note count.**

### 5) The consolidated Overview drops the Evidence-integrity card

`ovConsolidated` (template 9859-9862) is empty; `ovClassic` (template 9863 onward) holds both the
selector-coverage card and the Evidence-integrity card. The string `Evidence integrity` occurs
exactly once in all 16161 lines, at template 9896, inside the classic branch. Only the coverage card
was ruled on. The card is kept, because `VerifyBar` is the app's only Case-level verified or
tampered display and deleting it would remove the one place an operator sees that state for a whole
Case. **Say where evidence integrity belongs in the consolidated arrangement.**

### 6) The map's first-visit entrance animation has no trigger this app can express

The mock's node stagger fires on first visit only, keyed on a per-screen `_seen` map that the app
has no equivalent of. Building it unconditionally would be different behaviour from the design;
building the first-visit variant needs session state outside the owning ticket. Nothing animates on
mount today. **Define what "first visit" means in an app whose routes remount**, or drop the
animation.

### 7) The `showBanner` conditional encloses the Quick notes card

Template 9694 opens `<sc-if value="{{ showBanner }}">` and it does not close until 9744. Inside it
sit both the Quick notes card (heading at 9698, input at 9705) and the Since-your-last-visit card
(9721 onward). Read literally, a Case with nothing since the last visit renders no Quick notes card
either, which contradicts Quick notes being a permanent fixture of the screen. Treated as an
artifact of a flattened fragment and built with Quick notes unconditional and only the Since card
gated. **Confirm that was not intentional.**

### 8) The Signals detail rail's count label cannot be built as drawn

Template 14793 composes `N matches · in M of K captures`. That needs a per-selector count of match
*occurrences*. The database stores one `selector_matches` row per matched Capture, not per
occurrence, so `N` and `M` would be the same number printed twice. Shipped:
`Matches 12 of 48 captures` for a selector and `Applied to 3 of 48 captures` for a tag. **Either
drop the redundant half of the label, or specify where an occurrence count comes from.**

### 9) The Signals rows carry no density metric

The app's density system pins single-line list rows to `--d-row` at three steps, and an end-to-end
test asserted that metric exactly. The mock's Signals rows are two-line, name over pattern, with a
fixed `padding:8px 10px` (template 10915 and 10963), so they neither equal nor can equal a
single-line metric, and the design supplies no row metric for this screen. No metric was fabricated:
the density promise for Signals rows is now "legible at all three steps" through padding, gap, and
card tokens only, and the retired pin is tracked at #706. **Supply a row metric for the two-line
Signals row, or confirm the padding is the specification.**

### 10) Two defects in the Signals footer copy

One pair of lines, two separate defects.

Template 13565-13566 reads `the global ignore list (12 entries, Settings → Privacy)`. There is no
Privacy section in Settings; the global list lives under Capture Preferences. The `12 entries` is
mock seed data, not a real count.

Template 13566 continues `Matching pages are never captured, even by selectors.` The ruled
enforcement scope is that the per-Case list blocks **every** source, manual capture included, so the
mock's copy understates it. Shipped copy names Capture Preferences, reports the live entry count,
and reads `Matching pages are never captured for this case, by any route, including manual capture`.
The section label follows: `Never capture in this case` rather than the mock's `Never auto-capture`,
which carries the same defect. **Correct both strings in the mock.**

### 11) The bulk-import drawer's static footnote drops the live counts

Template 10876 puts a static line in the drawer footer:
`Duplicates are skipped · matching runs immediately after import`. The screen it replaces showed
live new, duplicate and blank counts, an end-to-end test pins them by test id, and "no capability is
lost with the screens" is an acceptance criterion. Shipped as a deliberate superset in the same
footnote slot, at no pixel cost. **If the static line is the specification, that acceptance
criterion has to be revisited explicitly.**

### 12) The capture rows carry no multi-select checkbox

In both row variants the mock offers selection through modifier-clicks only, with a 2px left rail as
the sole visual. The app keeps a checkbox: an end-to-end spec clicks `capture-select-checkbox` and a
component test pins its role, both aria-labels and its sticky class, and the design's checkbox-free
row would mean deleting shipped affordances that those tests protect. Two facts settled on #663
belong with this item, so it is not raised a third time: the amendment requested against the
superseded V2 bundle was refused because that bundle is no longer the source, and the metrics taken
from the selection bar's own select-all checkbox (14px box, 2px radius, accent fill when checked,
opacity fade on row hover, sticky once anything is checked) are the record of what the affordance
looks like. **Draw the row checkbox in the mock so the two agree.**

### 13) Six controls do not fit the capture-list header at the drawn column width

Measured in the running app at the mock's 316px column default, the header row offered 305px, and
the six controls needed 327, so the sort button wrapped and its label collided with the view toggle.
Rather than reinstate the second header row the redesign removed, the capture menu's trigger became
the icon-only accent button the mock itself specifies, recovering 76px. The app's labelled
`+ Capture` split button is gone as a consequence. **Confirm that an icon-only new-capture control
is wanted at that width, or supply a different arrangement for the header.**

### 14) The demo-Case flag is a surface the mock never drew

The mock's only demo affordance is a tour button, `tourDeleteDemo` (template 13427-13430, label at
12657), which sets a flag that filters the card out of the dashboard list (template 13491 and
13502). Nothing in the mock's export dialog or certification surface distinguishes a demo Case from
real evidence. The app now carries a demo flag on the Case, surfaced in the export dialog, and
stated in the Certification, so that an operator who exports fixture data cannot hand it over as
though it were collected. That surface was invented to close that gap, and its **copy and treatment
are undesigned and need specifying**.

### 15) The Data screen's `network.har` rows have no backing data

The artifact table lists a HAR log the app cannot produce:
`F('CAP-0007', 'network.har', 'raw', 'HAR log', '896 KB', 16)` at template 15170, a second row
flagged `In manifest, missing on disk` at 15276, a ledger event `verify.missing` targeting
`CAP-0019/network.har` at 15330, and an icon rule keying on `.har` at 15147. Birdbrain captures no
HAR today. Whether it ever should is an open spike (#804), because it is a new acquisition path with
a credential-disclosure problem. The screen is specified to carry no HAR row, and no placeholder row
for any artifact a Case does not have. **Remove the rows and the ledger event from the mock, or hold
them until the spike answers.**

### 16) Which prose documents in the handoff are current?

The 2026-08-21 bundle contains only `Birdbrain-standalone.html` and a README. The repository's
handoff index points readers at a round-trip protocol in each bundle's `ENGINEERING_REVIEW.md`, and
for this bundle that pointer resolves to nothing. Under its 'What this file does not carry' heading,
the 2026-08-21 bundle README routes readers to six V2 prose documents: `HANDOFF.md`, `MOTION.md`,
`IMPLEMENTATION_GUIDE.md`, `ENGINEERING_REVIEW.md`, `style_sync_patch/SCREEN_NOTES.md` and
`github.md`. All six are current only on the unmerged `prototype/design-handoff-2026-08` branch, and
three of them (`ENGINEERING_REVIEW.md`, `github.md`, `style_sync_patch/SCREEN_NOTES.md`) also sit on
`main` inside the superseded 2026-08-10 bundle with different content, so a reader who searches the
repository finds the older text with no signal that it is stale. The repository-side half is
tracked at #818. **Confirm which prose documents are current for the standalone bundle, and where
the round trip is meant to land.**

## Recorded deviations, no response wanted (29)

Every item here is a decision already taken. Some have shipped and some are ruled and still waiting
on the ticket that builds them, so read this section as the decision record rather than as a
description of the current build. It is written down so the mock's version is not re-proposed as a
defect later.

### From the app shell and navigation

1. **The Recording indicator binds the session, not auto-capture.** The mock derives it from
   auto-capture alone: `const sessionOn = s.autoCapture` (template 13468), consumed at
   `recActive: sessionOn` (13538) and at `recDotColor` and `recLabel` (13569). The app has a
   separate session model, and auto-capture stays a Signals concern.
2. **The Connected chip never hides.** The mock hides it while recording:
   `showConnected: extConnected && !sessionOn` (template 13537). During recording is exactly when
   the operator needs to know the extension is connected, because it is the only signal that
   captures can still arrive.
3. **Birdbrain gets no in-app browsing surface, ever.** The mock's top bar carries a Browser button
   (template 9307-9309) whose handler (`goBrowser`, template 13523; route flag `vBrowser`, 13521)
   opens a simulated Chrome window (template 12176, `data-screen-label="Chrome Extension"`). This is
   a permanent rejection, not a deferral: capture happens in the operator's real browser through the
   extension, and a second acquisition path was never asked for. #707 closed on that basis. Please
   stop drawing it.
4. **Four of the mock's thirteen context-menu kinds are built.** The mock binds 23
   `sc-camel-on-context-menu` handlers across 13 entity kinds, all routed through one `openCtx`
   helper (for example template 13929). Capture, note, selector and tag are built. File, folder,
   part and ledger wait on the Data screen they live on. The remaining five duplicate inline
   controls and add no capability.

### From the capture viewer and the Data screen

5. **The archived-copy banner carries the capture time only.** The mock's banner (template
   10367-10374) carries three things: the pill (10368-10371), a caption reading
   `scripts and network disabled · rendered from page.mhtml · 2026-08-02 14:02 UTC` (10372), and a
   truncated `sha256 e3b1c4…b855` (10373). The scripts-and-network claim is not true of this app:
   the `mhtml-sandbox` partition is unconfigured and navigation blocking does not cover
   subresources. The hash duplicates the provenance badge, and two displays of the same verification
   state can drift. Ruling R19.
6. **The banner also appears on legacy `format: 'html'` captures**, with format-accurate copy that
   does not say MHTML. The mock draws no such variant. The provenance claim, an archived copy taken
   at a stated time, is equally true of pre-v11 captures. Ruling R18.
7. **The Data screen adds an indicators view the mock does not draw.** A divergence by addition: the
   extracted-data table, its search, and the pivot from an indicator to a new Selector survive
   inside the new screen, so the extraction pipeline stays readable and the pivot stays alive.
   Ruling R21.
8. **The MHTML Parts hash column is labelled `SHA-256 (computed now)` and the mock's caption is
   replaced.** Template 11833 reads
   `Every part is hashed at capture time. Re-hashing on open compares against the manifest...`.
   Nothing hashes a MIME part in this app, at capture time or since; only the whole MHTML file is
   anchored in the manifest. The column is computed over the raw encoded bytes at display time and
   says so, with no shield and no use of the word verified. Ruling R6.
9. **The part context menu's `Verify against manifest` item is dropped** (template 15710). There is
   nothing per-part in the manifest to verify against. Ruling R6.
10. **The Headers and TLS Request panel is reduced to what the app actually captures**, which is the
    host and the user agent. No request headers and no HTTP verb exist anywhere in the schema, so
    the rest of the drawn panel has no source. Ruling R21.
11. **The TLS heading is labelled by `refetchedAt`**, never the mock's `TLS chain at capture time`
    (template 11870). The chain is fetched when the certificate is fetched, which is not the moment
    of capture, and ADR-0002 requires the label to say which. Ruling R21.

### From export and certification

12. **The chain-of-custody card is not unconditional.** The mock renders it whatever preset is
    chosen (template 12761-12796, heading at 12764), with every item, manifest and custody included,
    as a plain toggleable checkbox. The two export classes are semantically distinct: an Evidence
    Package's invariants render always-on and cannot be deselected, and the custody card hides, or
    restyles as a non-evidentiary notice, under a Working Copy. Ruling R4.
13. **The signer is the Operator, not an Examiner, and not an analyst.** Template 12773 labels the
    signer `Examiner` and template 15057 describes notes as `analyst work product`. Birdbrain has
    one term for the person who holds the signing key, and it is Operator. The vestigial
    `Investigator (self-asserted)` string in the report generator went with it. Ruling R4.

### From selectors, tags, and notes

14. **The in-page Selector action is one click, without the typed confirm popover.** The mock draws
    a 296px two-step popover on three surfaces (template 10439, 11423 and 12323) carrying
    `Watch for new hits` (10451, 11435, 12335) and a Backfill toggle (`selBackfillLabel`, 15890).
    One click matches the existing context-menu path. The popover is deferred to its own ticket,
    blocked on the server capabilities its toggles need. Ruling R8.
15. **The Backfill checkbox renders checked and disabled.** The mock defaults it to unchecked
    (`selBackfill: false` at template 12965, 15849 and 16121; the checkbox itself at 10453-10457,
    11437-11441 and 12337-12341). The app backfills unconditionally on every Selector create
    (`selectorLifecycle.ts:96-100`), over the 500 most recent captures. Checked and disabled, with
    copy saying backfill always runs, is the treatment that matches the mock's pixels and also tells
    the truth. Ruling R17.
16. **A tag created from a note attaches to the Capture as well as the note.** The mock's `selAsTag`
    (template 15913-15918) applies it to the note alone: `applied to this note` at 15917. Attaching
    to the anchored Capture too is what keeps Capture-level filtering and Signals coverage able to
    see tags that were created from notes. Ruling R15.
17. **The `@[kind|label]` Mention form is prototype shorthand, not the shipped model.** Recorded so
    it is not re-litigated: all seven phase-1 readers reached that independently.
18. **Mention suggestions filter before capping.** `mentionCandidates` (template 14037-14049) slices
    the primary kind to eight rows at 14042 and 14045 and only then filters at 14048, so a query
    matching the ninth candidate returns nothing. Harmless against four-row fixtures, wrong against
    a real Case. Shipped as filter, then order, then cap at six, which preserves the mock's own
    final cap.
19. **The popup's flip threshold is not reproducible.** The mock flips the popup over the caret when
    `(window.innerHeight - el.getBoundingClientRect().bottom) < 290` (template 14053). The editor
    library places the popup by measured height instead of a fixed constant. The intent, flipping
    near the bottom edge, is met exactly; the literal number is not portable.
20. **`@` opens the popup only after whitespace or at the start of a block.** The mock's looser
    trigger would open it inside every email address an analyst types.
21. **Backspace does not delete a whole Mention in one key press.** That behaviour is an artifact of
    the mock's plain-string document model. A real inline atom selects, then deletes.
22. **`@` covers captures and notes; `#` covers selectors and tags.** This follows the mock, which
    says so in four independent places (template 11498, 11587, 11592 and 14110) plus the code at
    14037-14049. The owning ticket's body said the opposite; the mock won.
23. **The `Create "<query>" as ...` popup row is not built.** The mock offers it whenever the query
    matches no candidate (`canCreate`, template 14066). No acceptance criterion covers it and it
    overlaps the selection-to-Selector flow.
24. **The `underline` and `bracket` Mention variants are not built.** `mentionStyleFor` (template
    13961-13968) carries both, and `chip` is the default. Per the bundle README the defaults are the
    design, so the other two read as exploration.

### From the capture list and the tour

25. **Hover timestamps are pinned to UTC with an explicit suffix.** The mock uses the machine's
    locale and zone. The string sits on an evidence row and must not read differently on different
    machines.
26. **Relative times read `5 minutes ago`, not the mock's `5 min ago`.** The app reuses one shared,
    already-tested formatter rather than forking a second wording.
27. **The tour writes the case-chapter completion flag from the wrong chapter** (a defect in the
    mock, not reproduced). `tourSkip` sets it unconditionally (template 13348), and `tourEnd` is
    called as `tourEnd(t.phase !== 'intro')` (template 13339), so finishing or skipping the
    extension chapter marks the case chapter done. A replay of the extension chapter then suppresses
    a case chapter that never ran.
28. **A missing tour anchor paints the tooltip at the viewport origin** (a defect in the mock, not
    reproduced). `syncTour` returns without a rect when the anchor is absent (template 13354) and
    the positioning falls back to zero (template 13411-13412), so the 296px tooltip (template 12630)
    renders at (0, 0).
29. **The extension options footnote button reads `Open Birdbrain settings` and opens the app's
    settings.** The mock labels it `Open Birdbrain` (template 12254) and routes to the dashboard.
    The deeper link is the condition under which the options gear was allowed to point somewhere
    new.

## What is not in this brief

Four classes of item were deliberately left out.

**Items the source tree has already closed.** A finding that was true when the mock landed and has
since been fixed does not belong in a list sent to a designer. Dropped on a direct read of `main`:
the per-signal CSV export that had no backing query (now scoped by an optional selector id in
`selectorRepo`); the empty search slot in the capture-list header (now built); the Mention chip
routes that pointed at the old Selectors and Tags screens (now both point at Signals); and the
constraints about the classic Selectors table and its `Test matches` affordance, whose screen the
Signals rebuild deleted.

**Merge-order artifacts.** Constraints that only described one branch waiting for another are
resolved by the merge itself and say nothing about the design.

**Constraints with no design audience.** Verification gaps in a pull request, choices about which
source file a piece of copy is read from, and questions only the maintainer can answer, such as
whether the auto-capture mode control returns and where the locked switch should then point.

**Items that arrived after this snapshot's cutoff.** #708 stays open as the standing intake queue.
Further divergences were queued on it after 2026-08-24, marked there for the next snapshot; they are
not in this one.

## Sources

- The #708 issue body of 2026-08-22 (14 items) and its comment of the same day (37 implementation
  constraints from the wave-2 pull requests).
- `docs/plans/2026-08-21-wave2-phase1-findings.md`, sections B1-B4, G1-G7 and C1-C12, where most of
  the body items originate.
- `docs/plans/2026-08-23-wave3-phase1-understand-notes.md`, the per-ticket reader notes.
- `docs/plans/2026-08-24-wave3-phase2-intake-rulings.md`, rulings R1-R23, and the ruling comments
  posted on the individual issues.
