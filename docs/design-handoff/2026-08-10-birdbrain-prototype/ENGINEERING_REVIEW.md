# Birdbrain prototype — engineering review brief

Audience: engineers reviewing the interactive prototype for technical
feasibility. Goal: an Accept / Modify / Reject verdict per feature area below,
with sizing, so design iteration can continue against real constraints.

## How to ingest

1. **Run the prototype.** Open `Birdbrain.dc.html` in a browser — it is fully
   interactive. Walk it in this order: Dashboard → case Overview (backlink
   map) → Captures (multiselect, Wayback panel, export dialog) → Notes
   (mention grammar, selection→selector) → Signals (auto-capture exclusions) →
   Browser sim (popup, right-click menus, capture toast, per-tab tabs, options
   tab). Tweaks panel toggles variants (`firstRun`, `density`, `mentionStyle`,
   `overviewVariant`).
2. **Read `HANDOFF.md`.** Session-by-session record of what was built and why,
   including what was corrected against upstream and what is invented.
3. **Read `github.md`.** Screen map ties every prototype surface to the repo
   files it was grounded in (`thebristolsound/birdbrain@main`), plus sync
   history. Anything marked "prototype improvement" is a deliberate delta,
   not a misreading.
4. **Styling is already packaged.** `design_handoff_style_sync/` is an
   apply-ready patch for `globals.css` and `components/ui/*` (radius scale
   2/4/6, 28px controls, recessed inputs, type scale 10/11/12/14/18,
   `SectionLabel` + `CardPanel`). Review it as a normal PR — it is mechanical
   and independent of everything below.

## Feasibility review checklist

Ordered roughly by expected refactoring cost. For each: confirm the data-model
impact, name the constraint if infeasible as designed, and size it.

### Extension (self-contained; `extension/src/*`)

1. **Per-tab case binding.** Upstream binds ONE global active case
   (`background.ts`); the prototype binds case per tab. Needs a
   `tabId → caseId` map in the service worker (survives worker suspension —
   `chrome.storage.session`), per-tab badge/context-menu enablement, and
   per-capture `caseId` (the upload API already accepts optional `caseId` in
   `sendMhtmlCapture`, so the server side may be free). Open question: does the
   app's single "active case" concept stay, and what do popup/app show when
   they disagree?
2. **Hide extension UI during capture.** Full-page/scrolling captures scroll
   the page while framing; toast, selection bar, confirm popover and selector
   highlights must hide for the shot and restore after (`content.ts` capture
   paths + `toast.ts`). Small but correctness-critical: no Birdbrain chrome in
   evidence images.
3. **Options page.** Net-new (`options_ui` doesn't exist upstream). Prototype
   keeps it read-only: server URL, masked auto-provisioned token, screenshot
   setting mirrored from `/api/status`. Low risk; also fine to cut — say so.
4. **In-page selection bar: Selector / Tag / Quote.** Upstream only has
   context-menu Create Selector. Tag-this-page and Quote-to-note need server
   endpoints that don't exist yet (notes write API, tag apply API). Flag if
   that's a capture-server scope change you'd rather sequence separately.
5. **Popup ignore-list pre-filter.** Popup capture currently relies on the
   server 403; prototype expects a client-side pre-check like the context-menu
   path. Small.

### App — data model first

6. **Mentions + backlinks.** Notes use `@[capture|…]` / `#[tag|…]` tokens; the
   Overview backlink map and the notes rail both assume an extracted,
   queryable references index (note↔note, note→capture/selector/tag). This is
   the load-bearing new data structure — verdict here gates features 7–8.
7. **Backlink map (Overview).** Graph layout is deterministic in the prototype
   (3×8 lattice, edge routing, type filters, hover preview). Feasible as pure
   render over the references index? Any node-count ceiling to enforce?
8. **Notes editor.** Autocomplete popup (flip-above-caret, escape squelch),
   chip rendering of tokens, snippet masking. Editor-framework question:
   does the current notes editor support inline decorations, or is this a
   rewrite?
9. **Selectors `origin: 'note'`.** Selection→selector from notes tags
   provenance on the selector record. Schema addition.
10. **Per-case auto-capture exclusions.** Case-level domain-or-regex list with
    stack-on / override-global modes. Settings schema + capture-server filter
    logic change.

### App — larger UI reworks

11. **Captures screen.** Multiselect (⌘/shift, select-all, batch bar),
    footer selection bar, resizable/collapsible columns, Source tab removed,
    relative-time dates. Mostly view-layer; confirm batch export/tag/delete
    endpoints exist.
12. **Wayback slide-out + side-by-side compare + pinning.** Needs CDX API
    querying, snapshot pinning persistence, and pinned snapshots surfacing in
    export as archive.org references. Note: the panel explicitly does NOT
    diff — copy says so; keep it that way.
13. **Export dialog.** Presets over an 8-item custom list, scope (case vs
    selection), chain-of-custody cover sheet (nine fields + purpose +
    signature rules) always included. Export pipeline change.
14. **Overview consolidated variant + Dashboard activity feed.** View-layer;
    the feed needs a cheap "recent activity across cases" query.
15. **Density system.** Three steps via CSS custom properties on the root
    (`--d-*` set is enumerated in HANDOFF.md). Cheap if the style-sync patch
    lands first.

## Suggested next deliverable

One review pass, then two parallel slices:

- **Deliverable A — feasibility memo** (the checklist above with
  Accept / Modify / Reject + t-shirt size + data-model notes per item,
  ~1 page). This is the thing design iteration is blocked on, especially
  items 1, 4, 6.
- **Deliverable B — first implementation slice**, chosen for low coupling:
  (1) apply the `design_handoff_style_sync/` patch, (2) extension pass —
  hide-UI-during-capture + per-tab binding spike behind a flag, (3) a
  references-index spike proving mentions→backlinks extraction on real case
  data. Each lands independently; together they unblock most of the
  checklist.

Anything Modified/Rejected: send back the constraint, not a redesign — the
prototype will be revised here to match.
