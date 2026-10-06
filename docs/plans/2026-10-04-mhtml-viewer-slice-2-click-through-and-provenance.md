# MHTML viewer interactivity, slice 2: click through the Case, and record where a link Capture came from

Plan only. Nothing here is built. Slice 1 is
[the slice 1 plan](2026-10-02-mhtml-viewer-interactivity.md), merged as PR #1709. That plan names
both parts of this slice: "Click-through inside the Case is slice 2" (its D3), and "Provenance is
slice 2 and needs an ADR" (its D8).

## Goal

Two things the stored-page viewer cannot do after slice 1:

1. **Click through the Case.** A left click on a link in the Page tab opens the Case's Capture of
   that link's destination, when the Case holds one, and a Back control returns to the page the
   Operator came from. The guest still never follows the link: the main-process guard keeps
   refusing every cross-document navigation, and the click moves the viewer's selection instead.
2. **Record where a link Capture came from.** A Capture made with Capture link records, in its
   signed Manifest Entry, the Capture whose stored page held the link and the address the link
   named. Today such a Capture records what any background Capture of that URL records (slice 1,
   D8).

The two parts ship separately. Part A changes no stored or anchored value. Part B is a Manifest
schema change and follows the ADR-0023 sequencing: an ADR, then a verifier release that learns
the fields, then the build that writes them.

Out of scope: a Wayback check for each link (slice 3, planned in
[the slice 3 plan](2026-10-04-mhtml-viewer-slice-3-wayback-link-check.md)), bulk harvest,
revealing hidden content, selection-to-Note, the legacy HTML viewer, keyboard activation of a link
inside the guest, and scrolling to a `#fragment` in the main frame (slice 1, D2 As built).

## Part A: click through the Case

### A1. How does the app learn that a link was clicked?

From the guest's mouse events, read in the main process, paired with the hover destination the
viewer already holds. Not from the refused navigation.

The refused navigation was considered first and rejected for three reasons:

- Chromium serves the loads of an MHTML iframe from the archive without raising
  `will-frame-navigate` (slice 1, D2 As built). A click on a link in an embedded frame never
  reaches the guard, so a design built on the guard's refusals would work in the main frame only.
- The guard also refuses navigations that no click caused: a `<meta http-equiv="refresh">` and a
  form submission. `WebContentsWillFrameNavigateEventParams` in Electron's typings carries `url`,
  `isSameDocument`, `isMainFrame`, `frame` and `initiator`, and no user-gesture field, so the
  guard cannot tell a click from a refresh.
- Moving the selection from inside the guard would make its decision function,
  `decideFrameNavigation` in `src/main/webviewPolicy.ts`, or its call site in `src/main/index.ts`,
  which is blocking tier, carry user-interface behaviour.

The design that works in every frame:

- `src/main/guestMouseDown.ts` already reads `before-mouse-event` on the guest and forwards each
  press. It grows into a forwarder of presses and releases: `event:guestMouseDown` gains the
  button, and a new `event:guestMouseUp` carries the button, `clickCount` and the modifier keys.
  The event is still read and never prevented. The file is renamed only if the maintainer wants
  it; the name is a naming call in the ADR-0015 class, and keeping it avoids churn.
- `MhtmlViewer.tsx` already holds the hover destination from `update-target-url`, which Chromium
  raises for links in every frame. On a left press it records that destination. On the next left
  release it calls a new pure function, `classifyGuestClick`, with the press destination, the
  release destination, the button and the modifiers.
- `classifyGuestClick` returns a link click only when both destinations are the same non-empty
  URL, the button is left, and no modifier is held. A press on one link and a release on another,
  a drag off the link, a middle click, and a modified click are not link clicks. This matches the
  slice 1 E2E harness, which already sends each of those inputs.

A keyboard activation (Enter on a focused link) is not detected, because the focused element is
not visible without page script. The Operator uses the link menu instead.

### A2. What does a link click do?

`resolveCaptureForUrl` (`src/shared/urlCanonicalize.ts`) over the Case's captures, the same lookup
"Open captured copy" uses (slice 1, D10):

| Destination                                                        | Result                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A web address the Case holds a Capture of, other than this Capture | The viewer selects that Capture and pushes this one onto the trail (A3)   |
| This Capture's own address, or a `#fragment` of it                 | Nothing                                                                   |
| A web address the Case does not hold                               | The status bubble says "Not in this Case" with a Capture link button (A4) |
| Any other scheme (`mailto:`, `tel:`, `javascript:` and the rest)   | Nothing. Never executed                                                   |

When the Case holds several Captures of the destination, the newest is opened, as "Open captured
copy" does today.

In an embedded frame, the click also swaps the stored iframe for another archived document, as it
does on `main` today, and the frame-changed notice appears. When the click moves the selection,
the guest is replaced and the swap no longer matters. When it does not, the notice and its Reload
button behave as they do now.

### A3. How does the Operator get back?

A trail of Capture ids in `appStore`, beside `selectedCaptureId`:

- A link click pushes the viewed Capture's id before it selects the destination.
- The viewer header shows "Back to <title of the top Capture>" while the trail is not empty. It
  sits beside the existing duplicate and recapture links in the header of `CaptureViewer.tsx`
  and uses the same style.
- Back pops the trail and selects the popped Capture.
- Selecting a Capture any other way (the list, search, a Note) clears the trail, so the trail
  only ever describes a run of link clicks. Changing Case clears it too.
- The trail is not persisted, like `activeViewerTab`.
- A Capture on the trail that has since been deleted is skipped when popped.

No forward stack. Following the same link again is the forward action.

### A4. What happens on a link the Case does not hold?

The status bubble at the bottom left of the Page pane changes from the hover
destination to a "Not in this Case" notice with a Capture link button that runs the same action
as the menu item. The button is turned off with the same reason text when `captureLinkBlockReason`
refuses the address. The bubble clears on the next press in the guest.

The alternative was to do nothing and leave the menu as the only route. The maintainer chose the
button on 2026-10-04 (ruling 1).

### A5. Does the Links tab click through too?

Yes, with A2's table applied to the row's destination. A left click, or Enter on the focused
link, on a row marked "In Case" opens the captured copy and pushes the trail, the same as a click
in the Page tab. `LinksTab.tsx` marks a same-page link "In Case" on purpose, because the viewed
Capture holds it, and `resolveCaptureForUrl` drops the fragment, so such a row resolves to the
viewed Capture itself; A2's second row applies and it does nothing. A row that is not in the Case
does nothing on a left click; its menu still offers Capture link. The link text in each row
becomes a focusable button, rather than the whole row, so another cell can hold a control of its
own (the slice 3 plan's Wayback cell) without nesting a button inside a button. This also gives
the tab keyboard access it lacks today.

### A6. Does the Wayback compare pane click through?

No. `WaybackCompare.tsx` mounts the same `MhtmlViewer` (slice 1, D15), and moving the selection
from inside a comparison would swap the Capture being compared. `MhtmlViewer` gains a
`linkClicks` prop, on in the Page tab and off in the compare pane. The hover bubble and the menu
stay on in both.

### A7. What tests pin Part A?

- **Unit.** `classifyGuestClick`: same link press and release, different links, release off any
  link, middle button, each modifier, an empty press destination. The release forwarding in the
  guest mouse forwarder, beside the existing press case in `tests/main/guestMouseDown.test.ts`.
  The trail actions in `appStore`: push, pop, pop past a deleted Capture, clear on another
  selection, clear on Case change.
- **Component (jsdom).** `MhtmlViewer` with a mocked guest: a click on a held link selects it and
  pushes the trail; a click on a link the Case does not hold shows the bubble; a click with
  `linkClicks` off does nothing. `CaptureViewer` shows and runs Back. `LinksTab` opens an "In Case"
  row on click and on Enter, and does nothing for a same-page row.
- **E2E.** Extend `e2e/mhtml-link-interactivity.spec.ts`. The fixture Case gains a second Capture
  whose URL is one of the fixture's absolute links. Through the existing `sendInputEvent` harness:
  a left click on that link in the main frame and in the iframe opens the second Capture; Back
  returns; a click on a link the Case does not hold shows "Not in this Case"; a middle click and a
modified click
  do nothing. Every existing assertion still holds, above all that the sentinel server receives
  zero requests.

### A8. Evidence impact of Part A

`MhtmlViewer.tsx` is blocking tier in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, so the PR is
`evidence-affecting` and gets human review. No stored, anchored or exported value changes, and
neither the guard (`decideFrameNavigation` in `src/main/webviewPolicy.ts`, called from the
blocking-tier `src/main/index.ts`) nor the webview's `webpreferences` change. The PR's Evidence
impact section says that the guard's refusals are unchanged and that the E2E's zero-request
assertion still passes.

### A9. Files Part A is expected to change

`src/main/guestMouseDown.ts`, `src/shared/ipc.ts` (the release channel and payload),
`src/preload/index.ts` and `src/shared/birdbrainApi.ts` (the listener),
`src/renderer/components/captures/MhtmlViewer.tsx` (blocking), `guestLink.ts`
(`classifyGuestClick`), `CaptureViewer.tsx` (Back), `LinksTab.tsx`, `WaybackCompare.tsx` (the
prop), `src/renderer/stores/appStore.ts`, tests and the E2E fixture. About eleven source files, one
of them blocking tier.

## Part B: record where a link Capture came from

### B1. What does the record claim?

That the Operator chose Capture link on a link in Capture X, and that the link named address H.
It does not claim that X still links to H, that H served the same page when X was captured, or
that the Operator read X first. X's stored bytes are the evidence that X held the link; anyone can
check that by reading the links out of X's MHTML again.

### B2. Which fields?

Three optional fields on the `capture` Manifest Entry, written only by a Capture link job and
omitted from every other entry, so every existing canonical body and chain hash is unchanged:

- `linkedFromCaptureId`: the id of the Capture whose stored page held the link. Named after the
  existing `supersedesCaptureId` and `duplicateOfCaptureId` pattern.
- `linkedFromContentHash`: that Capture's Content Hash (ruling 2).
- `linkHref`: the link's address as the menu read it, which is the address the background render
  was sent to.

`linkHref` is not redundant with the entry's `url`. A background Capture stores the URL the bytes
came from: `recapture.ts` passes `rendered.finalUrl` as `url`, and on a redirect also passes it as
`finalUrl`. Neither field then holds the address that was requested. For a link Capture, the
requested address is the link's, so `linkHref` is the only record of what the page linked to when
a redirect intervened.

The method stays `background`. No value is added to `CAPTURE_METHODS`, because the acquisition
path is the same queue and renderer.

Considered for the Manifest, and settled as follows:

- **The source's Content Hash beside its id.** In a single-owner Case the id resolves to the
  source's own `capture` entry in the same chain, and ADR-0009 ships the full Manifest even in a
  selection export, so the hash is already reachable. In a Shared Case, a member could capture a
  link from a Capture in another member's chain, where this chain cannot resolve the id. Shared
  Cases keep one chain per member and members see each other's Exhibits, so that case is real,
  and the entry records `linkedFromContentHash` (ruling 2).
- **The frame the link sat in.** Electron's `context-menu` parameters carry `frameURL`, and a
  Links tab row carries `documentUrl` and `frame`. A link in an embedded advertising frame is a
  weaker connection than one in the article. Recording it adds a third field that the Page tab and
  the Links tab must supply alike. It is shown in the viewer only and not recorded in the
  Manifest.

### B3. Schema version and verifier sequencing

`ManifestCaptureEntrySchema` is `.strict()`, so a verifier that does not know the fields reads an
entry carrying them as a broken chain. The rule `exhibitNumber` follows has two halves, and the
fields take both:

- **Reader.** The refine in `src/shared/schemas.ts` accepts the fields only on an entry whose
  `schemaVersion` is at least 5, so a schema-4 verifier reports "verifier too old" (X25), not a
  broken chain. A second refine accepts them only as a complete set: an entry carrying one or two
  of the three is rejected, because an id without the hash loses the byte binding and a hash
  without the address loses what the relationship means.
- **Writer.** `appendManifestEntry` in `src/main/services/manifest.ts` stamps a `capture` entry at
  the highest of the type's minimum, `fieldMinReaderSchemaVersion`, and the caller's option,
  capped at `MANIFEST_SCHEMA_VERSION`. `fieldMinReaderSchemaVersion` raises only an entry carrying
  `exhibitNumber`, to 3. Without a matching change it would stamp 2 or 3 on an entry carrying the
  new fields, and the reader rule would reject the entry the build itself wrote. It learns the
  fields and returns 5 for an entry that carries them.

`MANIFEST_SCHEMA_VERSION` is 4 today (`src/shared/constants.ts`), and 5 is already claimed by the
chain-head anchoring design (`docs/specs/2026-10-02-chain-head-anchoring-design.md`, the
`timestamping` entry). ADR-0032's Egress fields and ADR-0035's artifact inventory also wait on a
verifier release. The three fields join whichever schema-5 verifier release ships first, rather
than taking a release of their own (ruling 3). The ADR records that choice. If no schema-5 release
is in flight when Part B is ready, Part B takes 5 itself and the next one takes 6. If a schema-5
verifier has already shipped without the fields, they take 6: that verifier passes the too-old
check at 5 and fails its strict parse, so stamping 5 would read as a broken chain in a release
already in recipients' hands. The number is settled when step 2 starts, against the releases that
have shipped, not against the ones in flight.

### B4. Order of work

1. **ADR.** `docs/adr/0040-a-link-capture-records-the-capture-it-came-from.md`, drafted on
   2026-10-04 with status Proposed, settling B1 to B3 and the Shared Case question. `CONTEXT.md` gains a relationship line beside the Recapture
   and Duplicate ones: a link Capture is a new Capture that names the Capture holding the link; it
   observed the destination afresh and is a new sighting, not a copy.
2. **Verifier release.** `src/shared/schemas.ts` learns the optional fields and both refine rules
   from B3, and `fieldMinReaderSchemaVersion` in `src/main/services/manifest.ts` returns 5 for an
   entry that carries them, so the reader and the writer halves of the rule land in one release.
   Verify-core round-trips an entry that carries them. Known-answer tests cover a schema-5 entry
   that passes, the same entry read by the schema-4 rules reporting that the verifier is too old,
   a schema-4 entry carrying the fields rejected, and each partial set (the id alone, the id and
   the hash, the hash and the address, and the rest) rejected. A writer test appends an entry
   carrying the fields and asserts `schemaVersion: 5`, beside the existing `exhibitNumber` case
   that asserts 3 (`tests/main/services/exhibitNumbering.test.ts`). A tagged release ships before
   step 3 merges.
3. **Writer.**
   - `RecaptureJob`, `RecaptureEnqueuePayload` and `useRecaptureMutations` gain a `linkedFrom`
     object holding the source Capture id and the link address. The renderer never supplies the
     Content Hash.
   - `recapture.ts` accepts a link job only when the payload's `urls` holds exactly one URL and it
     equals the link address, so a renderer defect cannot sign a relationship to an address the
     job did not render. It then checks in main that the source Capture exists and is in the
     job's Case, verifies the source's `capture` entry against the chain, and takes
     `linkedFromContentHash` from that entry, as the Duplicate path in `captureLifecycle.ts` takes
     `sourceEntry.contentHash`. The `captures` row is not the source: `updateRow` in Database Admin
     allows the `captures` table, so a row value is editable where a signed entry is not. A job
     that fails any check is rejected. The three fields then pass through
     `captureLifecycle.ingest`.
   - A migration (`pnpm db:migration:new link-capture-provenance`) adds `linked_from_capture_id`,
     `linked_from_content_hash` and `link_href` to `captures`. `CAPTURE_COLUMNS` in
     `src/main/services/db/captureRepo.ts` gains the three columns; its drift test against
     `PRAGMA table_info` fails until it does.
   - Case Archive. Export needs no change: `collectCapturesForCase` selects every column.
     `importCaptureRows` remaps `linked_from_capture_id` through `ctx.mapId`, beside the
     `supersedes_capture_id` and `duplicate_of_capture_id` cases, so an imported link Capture
     resolves its imported source rather than keeping the source installation's id.
     `CASE_ARCHIVE_SCHEMA_VERSION` in `src/main/services/caseArchive.ts` rises from 8 to 9, by
     that constant's own rule: a release that does not know the columns drops them on import,
     because its `CAPTURE_COLUMNS` does not read them, and the version gate turns that into the
     "update Birdbrain" refusal instead.
   - `useLinkMenuTarget` sends the source Capture id and the link address.
   - `CaptureViewer.tsx` shows a "From a link in <title>" link, which opens the source, beside the
     "Duplicate of" link.
   - `reportHtml.ts` adds the rows beside the "Supersedes" and "Duplicate of" rows.
   - A Recapture of a link Capture does not inherit the fields: it records its own
     `supersedesCaptureId`.

### B5. Tests for Part B

The schema and writer cases in step 2. In step 3: `tests/main/services/recapture.test.ts` covers
a link job that writes the three fields, a job whose source is in another Case, deleted or fails
verification (rejected), a job whose `urls` is empty, holds two addresses or differs from the
link address (rejected), and an ordinary job that writes none of them; a lifecycle test pins the
entry body with and without the fields; the migration test and the `CAPTURE_COLUMNS` drift test;
`tests/main/services/caseArchiveRoundTrip.test.ts` exports and imports a link Capture and asserts
that `linked_from_capture_id` is remapped, not copied, as its `supersedes_capture_id` case does;
the `CASE_ARCHIVE_SCHEMA_VERSION` pin in `tests/main/services/caseArchive.test.ts` moves to 9 and
its newer-version refusal cases still pass; `MhtmlViewer.test.tsx` pins the enqueue payload from
the menu; the report test pins the new rows. The E2E from Part A gains one step: Capture link on
a link the Case does not hold, wait for the stored event, and read the new Capture's "From a link
in" header.

### B6. Evidence impact of Part B

Evidence-affecting at blocking tier: `manifest.ts` in step 2, and `recapture.ts`,
`captureLifecycle.ts`, `caseArchive.ts` and `reportHtml.ts` in step 3, are blocking;
`schemas.ts` is advisory. Steps 2 and 3 are separate PRs, each with human
review and no auto-merge. Step 3 also touches more than ten files and adds a migration, so under
ADR-0016 its implementation plan needs the maintainer's approval before work starts.

## Rulings, 2026-10-04

The maintainer accepted each recommendation the first draft of this plan made.

1. **A link the Case does not hold (A4).** A click on such a link shows "Not in this Case" with
   a Capture link button. It is the action the Operator most likely wants, and it runs the same
   guarded path as the menu.
2. **The source's Content Hash (B2).** A member of a Shared Case can Capture a link from another
   member's Capture, so the entry records `linkedFromContentHash` beside the id. Ruled by the
   maintainer on 2026-10-04 after the first set of rulings, and recorded in ADR-0040.
3. **Schema number (B3).** The fields join the first schema-5 verifier release rather than taking
   a number of their own.

## Sequencing

Part A is independent of Part B and can ship first. Part B's step 3 depends on step 2's release.
Issue #1726 (refuse a public link that redirects to a private address) changes the same
background renderer path, but is independent of this slice; if it lands first, the
`recapture.test.ts` cases above are written against its version.

## Revisions

2026-10-06, after the pre-pass review of PR #1734: A5 applies A2's self-Capture rule to the Links
tab and makes the link text the button; B3 and B4 step 2 add the writer half of the schema rule,
the complete-set rule and the schema-6 case; B4 step 3 binds the job to one URL, reads the
Content Hash from the verified entry, and adds the `CAPTURE_COLUMNS`, import remap and archive
version changes. These are review findings adopted into the plan, not rulings.
