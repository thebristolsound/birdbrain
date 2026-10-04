# MHTML viewer interactivity, slice 1: link status, link menu, Links tab, capture a link

Orchestrated plan. The maintainer asked on 2026-10-02 for a self-grilled plan, two adversarial plan
reviews, then implementation, a PR, a review round, and a review request, without waiting for plan
approval. Revision 2 applies the plan reviews (see "Plan review dispositions"). Revision 3 applies
the review of the plan's own PR (see "PR review dispositions").

**Status on 2026-10-04.** Slice 1 merged to `main` as PR #1709 (squash 43db376d). The implementer
built it from revision 2 and recorded what was built, and where it departed from the plan, in
that PR's copy of this file. Revision 3 was written on the plan's own PR (#1716) while #1709 was in
review, and the merged code does not implement all of it. This file is the merge of the two copies:

- The decisions are revision 3's text, except D7, which is the corrected wording #1709 merged.
- An **As built** note under a decision says what the code on `main` does where that differs.
- A revision 3 decision that the code lacks is marked **Not implemented in slice 1** where it
  appears, and is listed in "Revision 3 against the merged code" as follow-up work.
- The Orchestration log keeps every entry from both copies.

Each As built note was checked against the code and tests on `main` at 43db376d on 2026-10-04. The
E2E specs it cites were read, not run again for this merge.

## Goal

Let the Operator read and act on the links inside a stored page without loosening the viewer's
posture. JavaScript stays off, no frame in the guest leaves the document it was loaded with, and the
guest reaches no network. Four things are new:

1. **Hover status.** The destination of the link under the pointer, shown in a status bubble.
2. **Link menu.** Right-clicking a link, an image or a text selection in the Page tab opens a menu:
   copy link address, copy link text, open the captured copy if the Case already holds one, capture
   the link.
3. **Links tab.** Every link in the stored page, parsed from the MHTML in the main process: anchor
   text, destination, `rel` values, kind, which frame it sits in, whether the Case already holds a
   Capture of it, and a flag when the anchor's text in the stored markup names a different host than
   the link goes to. The flag is a heuristic over the markup, not over what the page rendered.
4. **Capture this link.** Queues a background Capture of the link into the viewed Capture's Case
   through the existing recapture queue.

A prerequisite ships first in the same PR: the main-process navigation guard is tightened so it no
longer depends on the CSS that stops link clicks (D2).

Out of scope, and left for later slices: recording which Capture a new one was taken from (a new
Manifest field, needs an ADR and the ADR-0023 verifier sequencing), clicking a link to move through
the Case, a Wayback check for each link, bulk harvest, revealing hidden content, selection-to-Note,
the legacy HTML viewer's menu and Links tab, and running page scripts.

**As built.** One case falls short of "no frame leaves the document it was loaded with": a click
inside an archived iframe of an MHTML Capture can replace that iframe with another document from
the same archive. D2's As built note has the detail.

## Self-grill log

Each decision is answered from the repository, not from the maintainer. The source follows each.

**D1. Does any of this need JavaScript in the guest?** No. The `<webview>` tag emits
`context-menu` and `update-target-url` from Chromium itself (`node_modules/electron/electron.d.ts`,
the `WebviewTag` `addEventListener` overloads). The `context-menu` data is on `event.params`
(`linkURL`, `linkText`, `srcURL`, `selectionText`, `mediaType`, `x`, `y`), not on the event; a
small typed adapter reads it and is unit-tested against that shape. `MHTML_POLICY` in
`src/main/webviewPolicy.ts` keeps `javascript: false` and `allowedRequestHosts: []`.

**D2. What must change before the pointer-events CSS can go?** The injected
`a, area { pointer-events: none }` CSS in `MhtmlViewer.tsx` must go, because with it the hit test
skips the link: `linkURL` is empty and `update-target-url` never fires. Both plan reviews found that
the main-process guard does not fully stand in for it today:

- `src/main/index.ts` (`web-contents-created`) guards `will-navigate` and `will-redirect`, and
  sets `initialLoadDone` only when it allows one of those. The `src` load of a `<webview>` is
  browser-initiated and, per Electron's docs, raises no `will-navigate`, so `initialLoadDone`
  likely stays false until the first in-page navigation. The guard then judges that first
  navigation as the one allowed load, and `MHTML_POLICY.allowedPrefixes` is `file://`: a captured
  link to `file:///…` could move the evidence guest onto an arbitrary local file.
- `will-navigate` fires for the main frame only. `will-frame-navigate` covers every frame, and a
  Chrome MHTML stores each iframe as its own part, so a link inside an iframe is not guarded.
- Forms and `<meta http-equiv="refresh">` were never covered by the CSS, so the first gap may be
  reachable today. The implementer confirms or refutes this with the E2E fixture and the PR says
  which.

Decision: on partitions with `allowSubsequentNavigation: false` (MHTML and legacy HTML), the guard
moves to `will-frame-navigate` and is decided by a new pure function in `webviewPolicy.ts` that the
existing known-answer tests extend. After the guest's first main-frame document commits (recorded
from `did-start-navigation`/`did-finish-load` on the main frame, not from the guard's own allow),
no frame may start a cross-document navigation. Same-document navigation (a `#fragment` jump) is
allowed: it loads no document and sends no request. Wayback keeps its current behaviour.

**As built.** The pure function is `decideFrameNavigation` in `src/main/webviewPolicy.ts`, and
`guardEveryFrame` in `src/main/index.ts` asks it on `will-frame-navigate` and `will-redirect`. Its
cases are in the `decideFrameNavigation` block of `tests/main/webviewPolicy.test.ts`. Four things
differ from the decision as written, and the Orchestration log records each:

- The main frame's commit is recorded from `did-navigate`, and each frame's commit from
  `did-frame-navigate`, keyed by frame tree node id.
- Chromium serves the loads of an MHTML iframe from the archive without raising `will-frame-navigate`
  (the E2E measured this; `src/main/index.ts` says so beside the commit listener). The guard never
  sees those loads. That is why archived iframe parts render with no allowance in the guard. It is
  also why a click inside an archived iframe can swap it for another archive-served document. The
  main process notices a second commit in the same frame and sends `event:guestFrameReplaced`, and
  `MhtmlViewer.tsx` shows a notice with a Reload button.
- A `#fragment` link in the main frame does not scroll. Chromium resolves it against the part's
  `Content-Location`, which is not the stored file the frame shows, so it is a load of another
  document and the guard refuses it. A fragment link inside an iframe is a same-document jump and
  scrolls. `e2e/mhtml-link-interactivity.spec.ts` asserts both.
- For the navigations the guard does see, the rule for an embedded frame is the same on both
  partitions. Before the main frame commits, every embedded-frame navigation is refused. After it
  commits, a frame that has not committed a document may make one first load on `data:`, `about:`
  (which covers `srcdoc`) or `blob:`. Every other destination is refused, `file:`, `http`, `https`
  and `cid:` included, and a frame that has committed may not navigate again.

The remainder of D2 is revision 3's rule for embedded frames. **Not implemented in slice 1.**

Loads of an embedded frame that the archive itself drives (an iframe loading its own MHTML part
first) must still render, and that exception is bound to the archive, not to timing. The page's
author controls the markup, so an `<iframe src="file:///…">` with no archived part behind it would
otherwise load before the lock, and `MHTML_POLICY.allowedPrefixes` admits `file://`. The rule
revision 3 set for an embedded frame's navigation, before and after the main frame commits:

- A `file:` destination is always refused. `allowedPrefixes` exists for the main frame's one load
  of the Capture's own file; no archived part has a `file:` document URL that an embedded frame
  needs.
- Any other destination is allowed only as the frame's initial load, and only when it names a part
  of the archive: its URL equals the `Content-Location` of an HTML part, or is the `cid:` URL of a
  part's `Content-ID`. The main process reads the part locations with the D12 splitter when the
  guest is created. If they cannot be read, every embedded-frame navigation is refused and the
  frame stays empty.

Revision 3 also said the implementer may tighten this rule but may not loosen it. The merged code
has no archive-binding rule on either partition, so that sentence describes nothing that shipped.
Three facts bear on any follow-up, and the rule must not be built as written:

- Its premise does not hold. The rule decides archive-served iframe loads on
  `will-frame-navigate`, and Chromium does not raise that event for them.
- The D12 splitter returns no `Content-ID`. `listHtmlPartsInMhtml` returns each part's
  `Content-Location`, stored size and a `decode` function, so the `cid:` half of the rule has
  nothing to match against.
- A legacy HTML Capture is a bare HTML file with no MIME parts. Applied to that partition, the
  rule would refuse every embedded frame, including the `data:` and `srcdoc` frames that the
  merged guard allows and that `e2e/legacy-html-guard.spec.ts` expects to render.

Of the two `file:` cases revision 3 wanted pinned, one exists. The unit cases pin that the guard
refuses a `file:` load in an embedded frame, and `e2e/legacy-html-guard.spec.ts` asserts that a
relative iframe in a legacy Capture does not load a local file. The MHTML fixture has no iframe
pointing at a local file with no archived part behind it, so that case is not tested, and whether
Chromium raises `will-frame-navigate` for it is not measured.

`MhtmlViewer.tsx` and `src/main/index.ts` are blocking tier in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, so this is an Evidence-Affecting
Change and the E2E in D17 is its known-answer test.

**D3. What does a left click on a link do in this slice?** A `#fragment` link scrolls within the
page. Every other link does nothing: the guard blocks it. Click-through inside the Case is slice 2.
The hover bubble shows the Operator where the link goes, and the menu is one right-click away.

**As built.** A `#fragment` link scrolls only inside an iframe. In the main frame the guard
refuses it and the page does not scroll (D2, As built).

**D4. How does the menu open over a `<webview>`?** Right-clicks inside the guest never reach the
host DOM, so a Radix `ContextMenu` trigger cannot see them. Both reviews found the first draft's
"dispatch a synthetic `contextmenu` event" underspecified: `EntityContextMenu` reads its `target`
prop synchronously, so the event can open with the previous link's target. Decision, taken in order:

1. Keep `EntityContextMenu` and a new `link` target in `entityMenu.ts`, so the menu registry,
   hidden-action preferences and styling stay in one place (#701 pattern).
2. On the guest's `context-menu`, call `event.preventDefault()`, commit the new target with
   `flushSync`, then dispatch a `contextmenu` `MouseEvent` on the trigger wrapper at
   `rect.left + params.x`, `rect.top + params.y`, where `rect` is the webview's
   `getBoundingClientRect()` (viewport-relative, so it already reflects the outer pane's scroll).
3. A component test pins it before anything builds on it: two successive right-clicks on different
   links each open with their own target.
4. Dismissal: Escape, choosing an item, and any mouse-down in the guest close the menu. Guest
   input never reaches the host document, Electron does not deliver mouse listeners on a
   `<webview>`, and `focus` does not fire again while the guest keeps focus after the opening
   right-click. So the main process listens to `before-mouse-event` on the guest's `WebContents`
   and forwards a `mouseDown` to the host, which closes the menu. The real-guest E2E harness pins
   it: right-click a link, left-click elsewhere in the guest, and the menu is gone.

If step 3 cannot pass, the implementer stops and reports rather than building a second menu system.

**As built.** Step 2's arithmetic is not used. Electron's `context-menu` point is already in
window coordinates, so `MhtmlViewer.tsx` dispatches the event at `params.x`, `params.y` as given,
and the E2E spec compares the menu's position with the guest's. Step 4 is implemented as written:
`src/main/guestMouseDown.ts` reads `before-mouse-event` and sends `event:guestMouseDown`
(`tests/main/guestMouseDown.test.ts`), and the viewer closes the menu on it. The menu over the
guest is non-modal (`modal={false}`).

**D5. Which actions does the link menu carry?**

| Target                                                         | Actions                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `http`/`https` link                                            | Copy link address, Copy link text, Open captured copy (only when the Case holds one), Capture link |
| Other scheme (`mailto:`, `tel:`, `javascript:`, anything else) | Copy link address, Copy link text. Never executed, never captured                                  |
| Image (`mediaType: 'image'`)                                   | Copy image address, plus the link actions when the image is inside a link                          |
| Text selection, no link                                        | Copy text                                                                                          |

**As built.** A link on another scheme also lists Capture link, turned off, with the reason
"Not a web address" in the item. That follows criterion 4 of issue #1708 over this table.

Electron documents that `params.linkText` can be empty when the link's content is an image.
Revision 3 decided that Copy link text copies `linkText`, else `params.altText`, and is turned off
when both are empty, so the item never copies an empty string. **Not implemented in slice 1.** The
merged menu does not read `altText`. It turns Copy link text off whenever `linkText` is empty
(`linkMenuEntries` in `entityMenu.ts`, pinned in `tests/components/entityMenu.test.tsx`), so the
item never copies an empty string, and an image-only link has no text to copy.

"Open external browser" and "Look up in Wayback" stay out. The first sends the Operator's own
browser to the target outside the app; the second is slice 3.

**D6. Which Case does Capture link file into?** The viewed Capture's `caseId`, never the Active
Case. Source: `RecaptureEnqueuePayload` takes an explicit `caseId`.

**D7. Does Capture link need a new acquisition path?** No. `recapture:enqueue` with
`{ urls: [url], caseId }` and no `supersedesCaptureId` queues a fresh background Capture
(`useRecaptureMutations` in `src/renderer/lib/api/recapture.ts`). `recapture.ts` already refuses
non-`http(s)` URLs (`validateUrl`) and enforces the per-case exclusion list, reporting refusals in
`EnqueueResult.rejected`. The menu's scheme filter is a convenience; `validateUrl` is the backstop
for the scheme only, and the existing "rejects invalid URLs at enqueue with per-URL reasons" case
in `tests/main/services/recapture.test.ts` pins that refusal. The menu path's payload to
`recapture:enqueue` is pinned in `tests/components/MhtmlViewer.test.tsx`. `validateUrl` does not
refuse D9's addresses, so those refusals live in the menu only. (Revised in the review round:
the first wording promised a menu-to-`validateUrl` test and implied a wider backstop.) The toast
reports `accepted` or the rejection reason. `recapture.ts` and `backgroundRenderer.ts` are not
modified.

**D8. Is the Capture made from a link labelled with where it came from?** Not in this slice. It
records exactly what any other background Capture of that URL records. The PR's Evidence impact
section says so. Provenance is slice 2 and needs an ADR.

**D9. What guards Capture link?** The page's author chose these URLs, not the Operator, so two
guards apply in the menu:

- Capture link is turned off, with the reason in the item, for `localhost` and for literal
  loopback, private (RFC 1918, `fc00::/7`) and link-local addresses. That stops a captured page from
  naming the Operator's own network or the app's capture server as the link target directly. It
  does not stop the page from reaching them indirectly, and the PR must say so. A hostname that
  resolves to a private address is not caught. A public link that redirects to a private address
  is not caught either. `backgroundRenderer.ts` has no redirect handler, so nothing there stops
  the render following the redirect. The one later check on the final URL is the per-case
  exclusion match in `src/main/services/recapture.ts:150`, which runs after the render and does
  not look at address ranges. Closing that needs the non-public-address rule enforced on every navigation and request
  inside the background renderer, plus a test of a public-to-private redirect. That modifies
  `backgroundRenderer.ts`, which D7 keeps out of this slice, so it is an open maintainer decision
  rather than slice-1 work.
- No confirmation dialog for one link: it is a deliberate single-target act named by its label. Bulk
  harvest (later) needs a confirmation and detection of single-use tokens.

**As built.** `captureLinkBlockReason` in `src/renderer/components/captures/guestLink.ts` reads the
host after `URL` normalises it and refuses more than the ranges named above: any `.localhost`
name, the ranges its reasons call unspecified, shared (`100.64.0.0/10`), broadcast and
`multicast`, and the IPv6 forms that carry an IPv4 address. `URL` writes an IPv4-mapped host as
two hex groups, so
`[::ffff:127.0.0.1]` arrives as `[::ffff:7f00:1]`; the function turns those groups back into
dotted IPv4 and applies the IPv4 ranges. IPv4-compatible and NAT64 addresses are refused outright.
`tests/components/entityMenu.test.tsx` has a case for each of these. The redirect gap is unchanged:
#1709 modified neither `recapture.ts` nor `backgroundRenderer.ts`.

The render leaves Direct: the Egress setting (ADR-0032) is not built yet. The Evidence impact
section says the request goes from the Operator's own address, as every Recapture does today.

**D10. How does "Open captured copy" find the Capture?** `resolveCaptureForUrl` in
`src/shared/urlCanonicalize.ts` over the Case's captures list the renderer already holds. It drops
fragments and picks the newest match. Opening selects that Capture through the existing selection
path. `urlCanonicalize.ts` is not modified.

**D11. Where is the link list computed?** In the main process, from the stored MHTML, on demand.
It is derived display data: never stored, no migration, no Manifest Entry. A new
`captures:getLinks` channel in `src/shared/ipc.ts` returns a `CaptureLinks` result. The renderer
cannot compute it from the guest because the guest runs no script.

**D12. How are links parsed?** A new `src/main/services/captureLinks.ts`:

1. Reads the Capture's MHTML through the existing store.
2. Splits HTML parts with a new exported `extractHtmlPartsFromMhtml` in `mhtmlDecoder.ts`, returning
   `{ contentLocation, html }[]`. It parses each part's `Content-Location`, unfolding folded header
   lines. `extractHtmlFromMhtml` becomes a join over it, and a test pins its output byte-identical to
   the current function's over the existing fixtures, because it feeds text extraction.
3. Picks the main document: the part whose `Content-Location` equals the top-level
   `Snapshot-Content-Location` header Chrome writes, else the first HTML part. The rest are
   embedded frames.
4. Resolves each part's document URL: its `Content-Location` resolved against the Capture's URL
   (a `cid:` or unparseable location falls back to the Capture's URL); then a `<base href>`
   resolved against that; then each `a[href]` and `area[href]` against the result.
5. Parses with `cheerio`, already a dependency used by `extraction/sanitizer.ts`.

Budgets are this module's own, enforced before a part is decoded rather than after: a per-part
encoded-size ceiling, a part-count ceiling and a row ceiling. A skipped part is counted and
reported. If the main document is over budget, the result says so and the tab shows that state
instead of an empty list. `MAX_HTML_BYTES` is not reused: it means truncate-before-parse in the
sanitizer, not skip.

**As built.** Step 2 as written cannot meet the budget rule, because a list of decoded `html`
strings has already decoded every part. The merged decoder adds `listHtmlPartsInMhtml`
(`src/main/services/mhtmlDecoder.ts`), which returns the snapshot location and, for each HTML
part, its `Content-Location`, its stored size and a `decode` function that runs only when called.
`linksFromMhtml` checks each part's stored size against the ceilings and calls `decode` only for a
part it admits. `extractHtmlPartsFromMhtml` exists and is built on the same list, and
`extractHtmlFromMhtml` is the join over it; `tests/main/services/mhtmlDecoder.test.ts` pins the
joined output. There are four ceilings: the three named above and one on the total stored size of
the parts read. The splitter returns no `Content-ID`, and nothing in the merged code needs one.

**D13. What does the result carry?** The fields below are the ones in `src/shared/types.ts` as
built; the comments are this plan's:

```ts
interface CaptureLink {
  href: string // resolved; the raw attribute when it cannot be resolved
  rawHref: string // the attribute value as the HTML parser decodes it, unresolved
  text: string // trimmed, whitespace-collapsed anchor text; img alt when no text
  rel: string[] // lower-cased tokens, unioned across collapsed occurrences
  kind: 'http' | 'same-page' | 'mailto' | 'tel' | 'other'
  frame: 'main' | 'subframe'
  documentUrl: string // the resolved document URL of the part it came from
  occurrences: number // identical href+text+frame+documentUrl collapse into one row
  textHostMismatch: boolean
}

interface CaptureLinks {
  links: CaptureLink[]
  truncated: boolean
  skippedParts: { tooLarge: number; overPartCount: number; overTotalSize: number }
  mainDocumentSkipped: boolean
}
```

Revision 3 renamed two fields, `rawHref` to `attrHref` and `textHostMismatch` to
`domTextHostMismatch`, and had `skippedParts` as one number. **Not implemented in slice 1:** the
merged code keeps both revision 2 names. The reasons for the renames follow, each with what the
code does.

`same-page` compares against the link's own `documentUrl`, not the Capture's URL. That is why
`documentUrl` is part of the collapse key: the same `href` and text in two embedded frames with
different document URLs can be `same-page` in one and external in the other, and a merged row would
report only the first. The comparison drops the fragment from both sides first. `new URL` resolves
`#section` to the document URL plus the fragment, so a literal comparison would class every
fragment link as external. `linkKind` in `captureLinks.ts` strips the fragment, and
`tests/main/services/captureLinks.test.ts` pins `#comments`, an empty `href` and the document's own
URL with a fragment as `same-page`. The collapse key is implemented as written here.

The `href` attribute field does not hold the bytes stored in the MHTML. `cheerio` returns the
parsed attribute value, so `href="https://exa&#109;ple.com"` arrives as `https://example.com`, and
quoting and character reference spelling are gone. Revision 3 renamed the field `attrHref` and
documented it as the decoded value for that reason. In the merged code the field is still
`rawHref`, and its comment in `src/shared/types.ts` reads `The attribute exactly as stored`, which
is wrong for an attribute that holds a character reference. No renderer code reads `rawHref`, so
the Links tab does not present it as the stored source. No test covers an `href` that holds a
character reference. Recovering the lexical attribute from parser source locations is left for a
later slice.

The host mismatch flag fires when `text` parses as a URL or bare host whose normalised host differs
from the link's. Normalising lower-cases, converts to ASCII through `URL`, and strips one leading
`www.`. "Differs" means the hosts are not equal; registrable-domain matching would need a
public-suffix dependency and is out. The flag is a DOM-text heuristic. `text` comes from static
markup, so it does not know which text the captured CSS, a hidden ancestor, a pseudo-element or
layout made visible: a hidden hostname can raise the flag, and a hostname drawn only by CSS can
evade it. Revision 3 decided that the field name, the marker's label and its tooltip describe the
text as link text in the markup and never as visible text, and that the tooltip states that an
absent marker does not clear the link. **Not implemented in slice 1.** The merged flag is computed
as described, and it covers every `http:` or `https:` destination, `same-page` links included. Its
wording is revision 2's: the field is `textHostMismatch`, its comment in `src/shared/types.ts` says
`visible text`, the marker in `LinksTab.tsx` reads `Text names another host`, and its tooltip
does not say the flag is a markup heuristic or that an absent marker does not clear the link. "In
Case" is computed in the renderer with D10, not in main.

**D14. Where does the Links tab live?** A fifth viewer tab, `links`, after `text`, in
`CaptureViewer.tsx` (`TABS`, `TAB_LABELS`, `TAB_ICONS`, `CaptureViewerTab` in `appStore`). Every
record or switch keyed on `CaptureViewerTab` is updated. `activeViewerTab` is not persisted
(`appStore.ts`), so no stored value needs migrating; the implementer confirms. The tab lists rows
with text, host-emphasised destination, `rel` chips, kind, an embedded-frame marker, an "In Case"
badge and a mismatch marker labelled as a markup heuristic (D13). It has a search box and an
"External only" toggle. Right-clicking a row opens the same `link` menu target. A legacy HTML
Capture, a Capture with no MHTML, or an over-budget main document gets an empty state naming why.

**As built.** The mismatch marker is not labelled as a markup heuristic (D13). "External only"
filters by host, not by `kind`: `filterLinks` in `linksTabModel.ts` keeps web links whose host
differs from the Capture's own, so a fragment link on the Capture's host is left out whatever its
kind.

**D15. Does the Wayback compare pane get the same behaviour?** Yes, because it mounts the same
`MhtmlViewer`. `MhtmlViewer` gains a `caseId` prop; both call sites have the Capture.

**D16. Hover bubble placement and content?** Bottom-left of the Page pane, outside the guest,
showing the full destination, middle-truncated, cleared when `update-target-url` sends an empty URL.
Semantic theme tokens only.

**D17. What tests pin the claims?**

- **E2E harness first.** `e2e/page-tab-frame.spec.ts` notes that guest evaluation is unavailable.
  Input reaches the guest through the main process: `electronApp.evaluate` finds the guest
  `webContents` and calls `sendInputEvent` (mouse move, left, middle and right button, with
  modifiers) at coordinates known from the fixture, whose links are absolutely positioned by inline
  CSS. The implementer proves this harness on one hover before writing the rest.
- **E2E fixture.** An MHTML Capture whose main part and one iframe part hold: a relative link, an
  absolute external link, a `target=_blank` link, a `file:///` link, a form posting to `file:///`,
  and a `#fragment` link. Every external URL points at a sentinel HTTP server the test starts on
  `127.0.0.1`. The main part also holds an `<iframe src="file:///…">` with no archived part behind
  it, pointing at a sentinel local HTML file the test writes.
- **E2E assertions.** For left, middle, modifier and `_blank` clicks on every link and the form
  submit, in both frames: the guest's main-frame URL (fragment ignored) is unchanged, no frame
  committed a new document, no window opened, and the sentinel server received zero requests. The
  `#fragment` click scrolls and is allowed. With no input at all, the `file:///` frame that has no
  archived part never commits the sentinel file: no frame in the guest has its URL, while the
  archived iframe part still renders. Hover shows the destination in the bubble. Right-click opens
  the menu with Capture link; right-click on a second link opens with the second link.
- **Unit.** The new navigation decision in `webviewPolicy.ts` (initial load, post-load main frame,
  post-load embedded frame, same-document, each partition; an embedded frame's initial load of an
  archived `Content-Location`, of an archived `cid:`, of an `http` URL that is not archived, and
  of `file:` both before and after the main frame commits; unreadable part locations).
  `captureLinks` over fixtures: relative, absolute, `<base>` (absolute and relative), `area`,
  `mailto`, `javascript:`, fragment-only, iframe part with its own `Content-Location`, `cid:`
  location, folded header, duplicate collapse with `rel` union, mismatch flag (`www.`, case, IDN,
  and a hostname inside a `display: none` element that still raises it, pinning the heuristic's
  documented limit), a character-reference-encoded `href` that arrives decoded in `attrHref`, row
  cap, over-budget part, over-budget main document. `extractHtmlFromMhtml` byte-identical. The
  `context-menu` params adapter. `entityMenu` entries for each D5 target, including that a
  non-`http(s)` link and a private-address link never offer an enabled Capture link, and that Copy
  link text on an image-only link copies the alternative text and is turned off when the link has
  neither text nor alternative text.
- **Component (jsdom).** Links tab rendering, filtering, "In Case" badge, empty states. The menu
  opening with the right target on successive right-clicks. `MhtmlViewer` no longer injects the
  CSS. The existing renderer `preventDefault` listeners are kept, but a test of them is not counted
  as evidence that navigation is blocked: only the main-process guard blocks it.

**As built.** The tests are in `e2e/mhtml-link-interactivity.spec.ts`,
`e2e/legacy-html-guard.spec.ts` and, under `tests/`, `main/webviewPolicy.test.ts`,
`main/guestMouseDown.test.ts`, `main/services/captureLinks.test.ts`,
`main/services/mhtmlDecoder.test.ts`, `renderer/guestLink.test.ts`,
`renderer/linksTabModel.test.ts`, `components/entityMenu.test.tsx`,
`components/MhtmlViewer.test.tsx` and `components/LinksTab.test.tsx`. The list above differs from
them in these places:

- The E2E asserts that a main-frame `#fragment` click is refused and an iframe one scrolls, and
  that a click in the archived iframe reaches no network while the swapped frame is flagged. For
  the iframe, the spec records which document each click committed, so "no frame committed a new
  document" holds for the main frame only.
- **Not implemented in slice 1**, each a revision 3 addition: the fixture iframe pointing at a
  local file with no archived part, and its assertion; the unit cases for archived
  `Content-Location` and `cid:` loads and for unreadable part locations; the `display: none`
  hostname case; the character-reference `href` case; the alternative-text cases for Copy link
  text.

## Files expected to change

`src/main/index.ts` (blocking), `src/main/webviewPolicy.ts`,
`src/renderer/components/captures/MhtmlViewer.tsx` (blocking), `src/main/services/mhtmlDecoder.ts`
(blocking), new `src/main/services/captureLinks.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`,
`src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/shared/birdbrainApi.ts`,
`src/renderer/lib/api/captures.ts` (+ `keys.ts`), `src/renderer/components/contextmenu/entityMenu.ts`,
`src/renderer/components/captures/CaptureViewer.tsx`, `src/renderer/stores/appStore.ts`, a new
`LinksTab.tsx`, `WaybackCompare.tsx` (prop pass-through), tests, and an E2E fixture. Three
blocking-tier paths: the PR is `evidence-affecting` and is never auto-merged.

**As built.** #1709 also added `src/main/guestMouseDown.ts`, and under
`src/renderer/components/captures/` the files `guestLink.ts`, `linksTabModel.ts` and
`useLinkMenuTarget.ts`, and changed `EntityContextMenu.tsx`.

Revision 3 required `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` to change in
the same PR. Only its include list feeds the backstop, and neither new file matches an entry, so a
later PR touching only one of them would trip nothing. The PR was to add both as exact-path
blocking entries: `src/main/services/captureLinks.ts` (derives the links, destinations, frame
provenance and mismatch flag from stored evidence) and
`src/renderer/components/captures/LinksTab.tsx` (presents that interpretation to the Operator, as
`ForensicsTab.tsx` does for the hash chain). **Not implemented in slice 1.** #1709 did not change
the assessment, and neither file name appears in it on `main`. Its review round also declined to
add `webviewPolicy.ts` to the list, as governance outside the issue (2026-10-03 log entry).

Suggested commit order, so a reviewer can read the evidence-affecting part on its own: (1) guard
and its tests, (2) CSS removal, hover bubble and menu, (3) decoder split and `captureLinks`,
(4) Links tab.

## Plan review dispositions

Codex (`codex exec`, read-only) and Opus 5.5 at low effort reviewed revision 1.

| Finding                                                                                         | Source | Disposition                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guard misses `will-frame-navigate`; `initialLoadDone` lets the first in-page navigation through | both   | Applied: D2                                                                                                                                                                                            |
| E2E proves nothing about requests or the guard; needs `file:///` link and a request observer    | both   | Applied: D17 sentinel server, `file:///` link, form                                                                                                                                                    |
| Fragment links change the URL and contradict "clicks do nothing"                                | both   | Applied: D2, D3, D17                                                                                                                                                                                   |
| Synthetic `contextmenu` race with the static `target` prop; dismissal; successive clicks        | both   | Applied: D4                                                                                                                                                                                            |
| Coordinates must add the outer pane's scroll                                                    | Opus   | Not applied at the time, on the reasoning that `getBoundingClientRect` is viewport-relative. As built, the `rect` arithmetic is gone: Electron's point is already in window coordinates (D4, As built) |
| Event data is on `event.params`                                                                 | Codex  | Applied: D1                                                                                                                                                                                            |
| Per-part base resolution, iframe parts, `cid:`, folded headers                                  | both   | Applied: D12, D13                                                                                                                                                                                      |
| Size policy decodes before checking; `MAX_HTML_BYTES` means truncate                            | Codex  | Applied: D12, and met in the code by a list of parts that are not yet decoded (D12, As built)                                                                                                          |
| `rel` lost on collapse                                                                          | Codex  | Applied: D13 union                                                                                                                                                                                     |
| Host normalisation for the mismatch flag                                                        | Opus   | Applied: D13, exact host after normalising                                                                                                                                                             |
| Name `validateUrl` as the scheme backstop                                                       | Opus   | Applied: D7                                                                                                                                                                                            |
| Captured links can aim the renderer at the Operator's own network; say which Egress             | Opus   | Applied: D9                                                                                                                                                                                            |
| Renderer `preventDefault` test is not evidence                                                  | Opus   | Applied: D17                                                                                                                                                                                           |
| Fifth tab: exhaustive records, persistence                                                      | Opus   | Applied: D14                                                                                                                                                                                           |
| Guest input harness for E2E                                                                     | Codex  | Applied: D17 `sendInputEvent`                                                                                                                                                                          |
| Split into two PRs                                                                              | Opus   | Not applied: the maintainer asked for one PR. The suggested commit order gives the same reading path                                                                                                   |

## PR review dispositions

Codex reviewed the plan's own PR (#1716) three times: at aef57dbd (three findings, answered in
a2384533), at a2384533 (six findings, answered in f536aded, which is revision 3), and at f536aded
(five findings, answered in the merge with `main`). The last column is the state of the code on
`main` at 43db376d.

| Round | Finding                                                                                  | Disposition in the plan                                                                                                                       | In the merged code                                                                                   |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | The collapse key lacks the document's identity                                           | Applied: D13 adds `documentUrl` to the key                                                                                                    | Implemented                                                                                          |
| 1     | A public link can redirect the background render to a private address                    | Not applied: D9 records the gap as an open maintainer decision                                                                                | Gap open                                                                                             |
| 1     | Menu dismissal cannot rely on mouse events on the `<webview>`                            | Applied: D4 step 4 uses `before-mouse-event` in the main process                                                                              | Implemented                                                                                          |
| 2     | An initial `<iframe src="file:///…">` with no archived part loads before the lock        | Applied in revision 3: D2 binds embedded-frame loads to archived parts and refuses `file:`; D17 adds the fixture frame and the unit cases     | Not implemented. The guard refuses a `file:` embedded frame it sees; the MHTML case is untested (D2) |
| 2     | `captureLinks.ts` and `LinksTab.tsx` are on no evidence path list                        | Applied in revision 3: "Files expected to change" registers both as blocking                                                                  | Not implemented                                                                                      |
| 2     | `cheerio` returns the decoded attribute, so `rawHref` cannot be "exactly as stored"      | Applied in revision 3: D13 renames it `attrHref` and documents it as decoded; lexical recovery is a later slice                               | Not implemented: the field is `rawHref` and its comment still says "exactly as stored"               |
| 2     | The mismatch flag cannot know what was visible                                           | Applied in revision 3: D13, D14 and the Goal call it a DOM-text heuristic; the field is `domTextHostMismatch`                                 | Not implemented: the name, comment, label and tooltip are revision 2's                               |
| 2     | Copy link text copies an empty string on an image-only link                              | Applied in revision 3: D5 falls back to `altText` and turns the item off when both are empty                                                  | Partly: the item is off when the link text is empty; no `altText` fallback                           |
| 2     | This PR's closing keyword would close #1708 before the implementation lands              | Accepted, and not a change to this file: the plan PR's body references #1708 without a closing keyword                                        | Not a code matter. #1709 carried the closing keyword; #1708 read as open again on 2026-10-04         |
| 3     | D2 matches a `cid:` frame against `Content-ID`, which the D12 splitter does not return   | Plan corrected: D2 marks the archive-binding rule not implemented and records the missing `Content-ID` as a reason not to build it as written | No such rule in the code; nothing reads `Content-ID`                                                 |
| 3     | A literal comparison with `documentUrl` classes `#section` as external                   | Plan corrected: D13 says the fragment is dropped from both sides                                                                              | Implemented, with a test                                                                             |
| 3     | An IPv4-mapped IPv6 literal such as `[::ffff:127.0.0.1]` is outside the ranges D9 names  | Plan corrected: D9's As built note lists the ranges the code refuses                                                                          | Implemented, with tests                                                                              |
| 3     | The archive-binding rule would blank `data:` and `srcdoc` frames in legacy HTML Captures | Plan corrected: D2 records the rule the code applies on both partitions                                                                       | Not present: no archive-binding rule; first loads on `data:`, `about:` and `blob:` are allowed       |
| 3     | A splitter returning decoded `html` has already decoded an over-budget part              | Plan corrected: D12's As built note describes the list of parts that are not yet decoded                                                      | Not present: `decode` runs only for an admitted part                                                 |

## Revision 3 against the merged code

Each row is a revision 3 decision that the code on `main` does not implement. The detail is in the
decision named.

| Revision 3 decision                                                                                                                                             | Where                    | What the code does instead                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Embedded-frame loads are bound to archived parts by `Content-Location` or `Content-ID`                                                                          | D2                       | One first load on `data:`, `about:` or `blob:`; archive-served MHTML iframe loads never reach the guard |
| E2E case: an MHTML iframe pointing at a local file with no archived part                                                                                        | D2, D17                  | Not in the fixture; the unit cases and the legacy E2E cover `file:` in an embedded frame                |
| Copy link text falls back to `altText`                                                                                                                          | D5                       | The item is off when the link text is empty                                                             |
| `rawHref` becomes `attrHref`, documented as the decoded value                                                                                                   | D13                      | `rawHref`, with a comment that says "exactly as stored"                                                 |
| `textHostMismatch` becomes `domTextHostMismatch`; the label and tooltip say the text is read from the markup, and that an absent marker does not clear the link | D13, D14                 | `textHostMismatch`; the comment says "visible text"; the label and tooltip carry neither statement      |
| Tests for a `display: none` hostname, a character-reference `href`, and the `altText` cases                                                                     | D17                      | Not written                                                                                             |
| `captureLinks.ts` and `LinksTab.tsx` registered as blocking evidence paths                                                                                      | Files expected to change | The assessment is unchanged                                                                             |

Revision 3 decisions that the code does implement: the `before-mouse-event` dismissal (D4 step 4)
and `documentUrl` in the collapse key (D13). The redirect gap in D9 was a recorded gap in revision
3, not a decision to build, and is still open.

**Open question, with the maintainer.** Whether the merged code is reworked to revision 3, in
whole or row by row, is not decided, and this plan does not decide it. Until it is, the rows above
are follow-up candidates and not scheduled work. The 2026-10-03 log entry's instruction to bring
the implementation branch in line with revision 3 was not carried out before #1709 merged.

## Orchestration log

<!-- vale Vale.Spelling = NO -->
<!-- The entries from #1709 are kept as merged, so their spelling is not linted. -->

- 2026-10-02: self-grill and plan revision 1 written (a8cf5445).
  - Correction, 2026-10-04: a8cf5445 is on no branch. Revision 1 on the plan's branch is 58b00f5a.
- 2026-10-02: Codex and Opus 5.5 low reviewed revision 1; revision 2 applies them.
- 2026-10-02: issue #1708 filed (`ready-for-agent`, `evidence-affecting`); implementer dispatched on
  `feat/1708-mhtml-link-interactivity`. Next: open the PR, run the adversarial review round, apply,
  request the maintainer's review.
- 2026-10-02: implemented on `feat/1708-mhtml-link-interactivity` (guard, harness, hover and menu, `captureLinks`, Links tab); the E2E found the `file:///` gap unreachable before the change. Deviations, each measured by the E2E: Chromium serves an MHTML iframe's navigations from the archive without raising `will-frame-navigate`, so D2's guard cannot see them (zero requests, no window, no local file, but the iframe can show an error page, as before); a main-frame `#fragment` resolves against the part's Content-Location and is refused, so only iframe fragments scroll (D3); Electron's `context-menu` point is already in window coordinates, so D4's `rect + params` is replaced by the point as given; Capture link is shown disabled with its reason for non-web links, following the issue's criterion 4 over D5's table.
- 2026-10-03: review round on PR #1709. Against main, the legacy HTML viewer could be moved to a local file by a meta refresh and loaded a local file through a relative iframe (E2E, run on a build of main); both are now refused. A legacy subframe may make one first load on `data:`, `about:` or `blob:`; a frame that has committed may not navigate again. An MHTML iframe swapped by a click is reported by main and the viewer offers a reload. The link menu is non-modal over the guest; skip counts are split by ceiling and the archive read is async with a total ceiling; Capture link refuses more address ranges; D7 corrected; a three-part decoder pin added. Not applied: adding `webviewPolicy.ts` to the evidence path list (governance, outside this issue).
- 2026-10-03: Codex reviewed PR #1716; revision 3 applies its findings. Work on
  `feat/1708-mhtml-link-interactivity` that predates revision 3 must be brought in line with it.
- 2026-10-04: second review round on PR #1709. Two statements in the first 2026-10-02 implementation entry no longer hold and the 2026-10-03 entry replaces them: the `file:///` gap was unreachable in the MHTML viewer only, and a clicked MHTML iframe commits another document, not an error page. Deviations in the shipped code that this log had not recorded:
  - D2: `src/main/index.ts` records the main frame's commit from `did-navigate` and each frame's commit from `did-frame-navigate`, keyed by frame tree node id, not from `did-start-navigation` or `did-finish-load`.
  - D4.4: no listener on the webview element closes the menu. `src/main/guestMouseDown.ts` reads the guest's `before-mouse-event` and sends `event:guestMouseDown`, and the viewer closes the menu on it. Focus in the guest does not close the menu; a press does.
  - D12: `captureLinks.ts` splits with `listHtmlPartsInMhtml`, which returns each part's `Content-Location`, stored size and a `decode` function, so ceilings apply before decoding. `extractHtmlPartsFromMhtml`, the decoded list D12 names, is built on it. There is a fourth ceiling, on the total stored size of the parts read.
  - D13: rows collapse on `href`, text, frame and document URL, not on the first three alone. `skippedParts` is three counts, one for each ceiling, not one number. The mismatch flag covers every web destination (`http:` or `https:`), `same-page` links included.
  - Changed in this round: with no links and skipped frames, the tab shows the skip notices and says the part it read holds no links. Reading stops at the first link past the row ceiling, so a repeat count on a truncated list covers the page up to that point, and the notice says so. The renderer no longer keeps the link list after the tab closes and reads it again on every open, because an import can reuse a deleted Capture's id.

<!-- vale Vale.Spelling = YES -->

- 2026-10-04: #1709 merged to `main` (43db376d) before this plan's PR. `main` was merged into the
  plan's branch and the two copies of this file were combined: #1709's log entries and corrected D7
  are kept as merged, revision 3 is kept with As built notes, and the "Revision 3 against the merged
  code" section lists the revision 3 decisions the code lacks. The "PR review dispositions" section
  answers Codex's third review of #1716 (five findings at f536aded).
