# MHTML viewer interactivity, slice 1: link status, link menu, Links tab, capture a link

Orchestrated plan. The maintainer asked on 2026-10-02 for a self-grilled plan, two adversarial plan
reviews, then implementation, a PR, a review round, and a review request, without waiting for plan
approval. Revision 2 applies the plan reviews (see "Plan review dispositions").

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
   Capture of it, and a flag when the visible text names a different host than the link goes to.
4. **Capture this link.** Queues a background Capture of the link into the viewed Capture's Case
   through the existing recapture queue.

A prerequisite ships first in the same PR: the main-process navigation guard is tightened so it no
longer depends on the CSS that stops link clicks (D2).

Out of scope, and left for later slices: recording which Capture a new one was taken from (a new
Manifest field, needs an ADR and the ADR-0023 verifier sequencing), clicking a link to move through
the Case, Wayback lookups per link, bulk harvest, revealing hidden content, selection-to-Note, the
legacy HTML viewer's menu and Links tab, and running page scripts.

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
  likely stays false until the first in-page navigation. That first navigation is then judged as
  "the one allowed load", and `MHTML_POLICY.allowedPrefixes` is `file://`: a captured link to
  `file:///…` could move the evidence guest onto an arbitrary local file.
- `will-navigate` fires for the main frame only. `will-frame-navigate` covers every frame, and a
  Chrome MHTML stores each iframe as its own part, so a link inside an iframe is not guarded.
- Forms and `<meta http-equiv="refresh">` were never covered by the CSS, so the first gap may be
  reachable today. The implementer confirms or refutes this with the E2E fixture and the PR says
  which.

Decision: on partitions with `allowSubsequentNavigation: false` (MHTML and legacy HTML), the guard
moves to `will-frame-navigate` and is decided by a new pure function in `webviewPolicy.ts` that the
existing known-answer tests extend. After the guest's first main-frame document commits (recorded
from `did-start-navigation`/`did-finish-load` on the main frame, not from the guard's own allow),
no frame may start a cross-document navigation. Subframe loads that the archive itself drives
(an iframe's initial load of its own MHTML part) must still render; the implementer establishes the
exact rule empirically and pins it. Same-document navigation (a `#fragment` jump) is allowed: it
loads no document and sends no request. Wayback keeps its current behaviour.

`MhtmlViewer.tsx` and `src/main/index.ts` are blocking tier in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, so this is an Evidence-Affecting
Change and the E2E in D17 is its known-answer test.

**D3. What does a left click on a link do in this slice?** A `#fragment` link scrolls within the
page. Every other link does nothing: the guard blocks it. Click-through inside the Case is slice 2.
The hover bubble tells the Operator where the link goes, and the menu is one right-click away.

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
4. Dismissal: Escape, choosing an item, and any pointer-down or focus in the guest close the menu.
   The last needs a listener on the webview element, because guest input never reaches the host
   document.

If step 3 cannot pass, the implementer stops and reports rather than building a second menu system.

**D5. Which actions does the link menu carry?**

| Target | Actions |
|---|---|
| `http`/`https` link | Copy link address, Copy link text, Open captured copy (only when the Case holds one), Capture link |
| Other scheme (`mailto:`, `tel:`, `javascript:`, anything else) | Copy link address, Copy link text. Never executed, never captured |
| Image (`mediaType: 'image'`) | Copy image address, plus the link actions when the image is inside a link |
| Text selection, no link | Copy text |

"Open external browser" and "Look up in Wayback" stay out. The first sends the Operator's own
browser to the target outside the app; the second is slice 3.

**D6. Which Case does Capture link file into?** The viewed Capture's `caseId`, never the Active
Case. Source: `RecaptureEnqueuePayload` takes an explicit `caseId`.

**D7. Does Capture link need a new acquisition path?** No. `recapture:enqueue` with
`{ urls: [url], caseId }` and no `supersedesCaptureId` queues a fresh background Capture
(`useRecaptureMutations` in `src/renderer/lib/api/recapture.ts`). `recapture.ts` already refuses
non-`http(s)` URLs (`validateUrl`) and enforces the per-case exclusion list, reporting refusals in
`EnqueueResult.rejected`. The menu's scheme filter is a convenience; `validateUrl` is the backstop,
and a test pins that the menu path reaches it. The toast reports `accepted` or the rejection
reason. `recapture.ts` and `backgroundRenderer.ts` are not modified.

**D8. Is the Capture made from a link labelled with where it came from?** Not in this slice. It
records exactly what any other background Capture of that URL records. The PR's Evidence impact
section says so. Provenance is slice 2 and needs an ADR.

**D9. What guards Capture link?** The page's author chose these URLs, not the Operator, so two
guards apply in the menu:

- Capture link is disabled, with the reason in the item, for `localhost` and for literal loopback,
  private (RFC 1918, `fc00::/7`) and link-local addresses. That stops a captured page from aiming
  the background renderer at the Operator's own network or at the app's capture server. A hostname
  that resolves to a private address is not caught; the PR says so.
- No confirmation dialog for one link: it is a deliberate single-target act named by its label. Bulk
  harvest (later) needs a confirmation and detection of single-use tokens.

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
   subframes.
4. Resolves each part's document URL: its `Content-Location` resolved against the Capture's URL
   (a `cid:` or unparseable location falls back to the Capture's URL); then a `<base href>`
   resolved against that; then each `a[href]` and `area[href]` against the result.
5. Parses with `cheerio`, already a dependency used by `extraction/sanitizer.ts`.

Budgets are this module's own, enforced before a part is decoded rather than after: a per-part
encoded-size ceiling, a part-count ceiling and a row ceiling. A skipped part is counted and
reported. If the main document is over budget, the result says so and the tab shows that state, not
"no links". `MAX_HTML_BYTES` is not reused: it means truncate-before-parse in the sanitizer, not
skip.

**D13. What does the result carry?**

```ts
interface CaptureLink {
  href: string              // resolved; the raw attribute when it cannot be resolved
  rawHref: string           // the attribute exactly as stored
  text: string              // trimmed, whitespace-collapsed anchor text; img alt when no text
  rel: string[]             // lower-cased tokens, unioned across collapsed occurrences
  kind: 'http' | 'same-page' | 'mailto' | 'tel' | 'other'
  frame: 'main' | 'subframe'
  documentUrl: string       // the resolved document URL of the part it came from
  occurrences: number       // identical href+text+frame collapse into one row
  textHostMismatch: boolean
}

interface CaptureLinks {
  links: CaptureLink[]
  truncated: boolean
  skippedParts: number
  mainDocumentSkipped: boolean
}
```

`same-page` compares against the link's own `documentUrl`, not the Capture's URL. The host mismatch
flag fires when the visible text parses as a URL or bare host whose normalised host differs from the
link's. Normalising lower-cases, converts to ASCII through `URL`, and strips one leading `www.`.
"Differs" means the hosts are not equal; registrable-domain matching would need a public-suffix
dependency and is out. "In Case" is computed in the renderer with D10, not in main.

**D14. Where does the Links tab live?** A fifth viewer tab, `links`, after `text`, in
`CaptureViewer.tsx` (`TABS`, `TAB_LABELS`, `TAB_ICONS`, `CaptureViewerTab` in `appStore`). Every
record or switch keyed on `CaptureViewerTab` is updated. `activeViewerTab` is not persisted
(`appStore.ts`), so no stored value needs migrating; the implementer confirms. The tab lists rows
with text, host-emphasised destination, `rel` chips, kind, a subframe marker, an "In Case" badge
and a mismatch marker. It has a search box and an "External only" toggle. Right-clicking a row opens
the same `link` menu target. A legacy HTML Capture, a Capture with no MHTML, or an over-budget main
document gets an empty state naming why.

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
  `127.0.0.1`.
- **E2E assertions.** For left, middle, modifier and `_blank` clicks on every link and the form
  submit, in both frames: the guest's main-frame URL (fragment ignored) is unchanged, no frame
  committed a new document, no window opened, and the sentinel server received zero requests. The
  `#fragment` click scrolls and is allowed. Hover shows the destination in the bubble. Right-click
  opens the menu with Capture link; right-click on a second link opens with the second link.
- **Unit.** The new navigation decision in `webviewPolicy.ts` (initial load, post-load main frame,
  post-load subframe, same-document, each partition). `captureLinks` over fixtures: relative,
  absolute, `<base>` (absolute and relative), `area`, `mailto`, `javascript:`, fragment-only, iframe
  part with its own `Content-Location`, `cid:` location, folded header, duplicate collapse with
  `rel` union, mismatch flag (`www.`, case, IDN), row cap, over-budget part, over-budget main
  document. `extractHtmlFromMhtml` byte-identical. The `context-menu` params adapter. `entityMenu`
  entries for each D5 target, including that a non-`http(s)` link and a private-address link never
  offer an enabled Capture link.
- **Component (jsdom).** Links tab rendering, filtering, "In Case" badge, empty states. The menu
  opening with the right target on successive right-clicks. `MhtmlViewer` no longer injects the
  CSS. The existing renderer `preventDefault` listeners are kept, but a test of them is not counted
  as evidence that navigation is blocked: only the main-process guard blocks it.

## Files expected to change

`src/main/index.ts` (blocking), `src/main/webviewPolicy.ts`,
`src/renderer/components/captures/MhtmlViewer.tsx` (blocking), `src/main/services/mhtmlDecoder.ts`
(blocking), new `src/main/services/captureLinks.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`,
`src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/shared/birdbrainApi.ts`,
`src/renderer/lib/api/captures.ts` (+ `keys.ts`), `src/renderer/components/contextmenu/entityMenu.ts`,
`src/renderer/components/captures/CaptureViewer.tsx`, `src/renderer/stores/appStore.ts`, a new
`LinksTab.tsx`, `WaybackCompare.tsx` (prop pass-through), tests and an E2E fixture. Three
blocking-tier paths: the PR is `evidence-affecting` and is never auto-merged.

Suggested commit order, so a reviewer can read the evidence-affecting part on its own: (1) guard
and its tests, (2) CSS removal, hover bubble and menu, (3) decoder split and `captureLinks`,
(4) Links tab.

## Plan review dispositions

Codex (`codex exec`, read-only) and Opus 5.5 at low effort reviewed revision 1.

| Finding | Source | Disposition |
|---|---|---|
| Guard misses `will-frame-navigate`; `initialLoadDone` lets the first in-page navigation through | both | Applied: D2 |
| E2E proves nothing about requests or the guard; needs `file:///` link and a request observer | both | Applied: D17 sentinel server, `file:///` link, form |
| Fragment links change the URL and contradict "clicks do nothing" | both | Applied: D2, D3, D17 |
| Synthetic `contextmenu` race with the static `target` prop; dismissal; successive clicks | both | Applied: D4 |
| Coordinates must add the outer pane's scroll | Opus | Not applied: `getBoundingClientRect` is viewport-relative and already includes it. D4 says so and the E2E pins it |
| Event data is on `event.params` | Codex | Applied: D1 |
| Per-part base resolution, iframe parts, `cid:`, folded headers | both | Applied: D12, D13 |
| Size policy decodes before checking; `MAX_HTML_BYTES` means truncate | Codex | Applied: D12 |
| `rel` lost on collapse | Codex | Applied: D13 union |
| Host normalisation for the mismatch flag | Opus | Applied: D13, exact host after normalising |
| Name `validateUrl` as the scheme backstop | Opus | Applied: D7 |
| Captured links can aim the renderer at the Operator's own network; say which Egress | Opus | Applied: D9 |
| Renderer `preventDefault` test is not evidence | Opus | Applied: D17 |
| Fifth tab: exhaustive records, persistence | Opus | Applied: D14 |
| Guest input harness for E2E | Codex | Applied: D17 `sendInputEvent` |
| Split into two PRs | Opus | Not applied: the maintainer asked for one PR. The commit order above gives the same reading path |

## Orchestration log

- 2026-10-02: self-grill and plan revision 1 written (a8cf5445).
- 2026-10-02: Codex and Opus 5.5 low reviewed revision 1; revision 2 applies them.
- 2026-10-02: implemented on `feat/1708-mhtml-link-interactivity` (guard, harness, hover and menu, `captureLinks`, Links tab); the E2E found the `file:///` gap unreachable before the change. Deviations, each measured by the E2E: Chromium serves an MHTML iframe's navigations from the archive without raising `will-frame-navigate`, so D2's guard cannot see them (zero requests, no window, no local file, but the iframe can show an error page, as before); a main-frame `#fragment` resolves against the part's Content-Location and is refused, so only iframe fragments scroll (D3); Electron's `context-menu` point is already in window coordinates, so D4's `rect + params` is replaced by the point as given; Capture link is shown disabled with its reason for non-web links, following the issue's criterion 4 over D5's table.
