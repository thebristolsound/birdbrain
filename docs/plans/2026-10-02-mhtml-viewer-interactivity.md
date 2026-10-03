# MHTML viewer interactivity, slice 1: link status, link menu, Links tab, capture a link

Orchestrated plan. The maintainer asked on 2026-10-02 for a self-grilled plan, two adversarial plan
reviews, then implementation, a PR, a review round, and a review request, without waiting for plan
approval.

## Goal

Let the Operator read and act on the links inside a stored page without loosening the viewer's
posture. JavaScript stays off, the guest still loads exactly one local file, and it still reaches no
network. Four things are new:

1. **Hover status.** The destination of the link under the pointer, shown in a status bubble.
2. **Link menu.** Right-clicking a link, an image or a text selection in the Page tab opens a menu:
   copy link address, copy link text, open the captured copy if the Case already holds one, capture
   the link.
3. **Links tab.** Every link in the stored page, parsed from the MHTML in the main process: anchor
   text, destination, `rel` values, kind, whether the Case already holds a Capture of it, and a flag
   when the visible text names a different host than the link goes to.
4. **Capture this link.** Queues a background Capture of the link into the viewed Capture's Case
   through the existing recapture queue.

Out of scope, and left for later slices: recording which Capture a new one was taken from (a new
Manifest field, needs an ADR and the ADR-0023 verifier sequencing), clicking a link to move through
the Case, Wayback lookups per link, bulk harvest, revealing hidden content, selection-to-Note, the
legacy HTML viewer, and running page scripts.

## Self-grill log

Each decision is answered from the repository, not from the maintainer. The source follows each.

**D1. Does any of this need JavaScript in the guest?** No. The `<webview>` tag emits
`context-menu` (with `linkURL`, `linkText`, `srcURL`, `selectionText`, `mediaType`, `x`, `y`) and
`update-target-url` from Chromium itself (`node_modules/electron/electron.d.ts`, the `WebviewTag`
`addEventListener` overloads and `ContextMenuEvent`). The policy in `src/main/webviewPolicy.ts`
(`MHTML_POLICY`) is unchanged.

**D2. What must change in the viewer for those events to carry a link?** The injected
`a, area { pointer-events: none }` CSS in `MhtmlViewer.tsx` must go. With it, the hit test skips the
link, so `linkURL` is empty and `update-target-url` never fires. The navigation block does not rest
on that CSS: `src/main/index.ts` (`web-contents-created`) runs `decideWebviewNavigation` on
`will-navigate` and `will-redirect` and refuses every load after the first on the MHTML partition,
and `setWindowOpenHandler` denies every new window. Removing a defence-in-depth layer is an
Evidence-Affecting Change (`MhtmlViewer.tsx` is blocking tier in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`), so an end-to-end test must pin that
a left click, a middle click and a `target=_blank` click on a link leave the guest on its file and
send no request.

**D3. What does a left click on a link do in this slice?** Nothing visible: the main-process guard
blocks it as today. Click-through inside the Case is slice 2. The hover bubble tells the Operator
where the link goes, and the menu is one right-click away.

**D4. How does the menu open over a `<webview>`?** Right-clicks inside the guest never reach the
host DOM, so the existing Radix `ContextMenu` trigger cannot see them. Recommended: reuse
`EntityContextMenu` with a new `link` target in `entityMenu.ts`, opened by dispatching a synthetic
`contextmenu` `MouseEvent` on the trigger wrapper at the guest's `x`/`y` translated by the
webview's `getBoundingClientRect()`. This keeps the menu registry, hidden-action preferences and
styling in one place (#701 pattern). A native Electron `Menu.popup` would be a second menu system.
If the synthetic event proves unworkable with Radix, the implementer stops and reports rather than
building a parallel menu.

**D5. Which actions does the link menu carry?**

| Target | Actions |
|---|---|
| `http`/`https` link | Copy link address, Copy link text, Open captured copy (only when the Case holds one), Capture link |
| Other scheme (`mailto:`, `tel:`, `javascript:`, anything else) | Copy link address, Copy link text. Never executed, never captured |
| Image (`mediaType: 'image'`) | Copy image address, plus the link actions when the image is inside a link |
| Text selection, no link | Copy text |

"Open external browser" and "Look up in Wayback" stay out. The first sends the Operator's own
browser to the target outside any Egress setting; the second is slice 3.

**D6. Which Case does Capture link file into?** The viewed Capture's `caseId`, never the Active
Case. The Operator is reading that Case's evidence. Source: `RecaptureEnqueuePayload` takes an
explicit `caseId`.

**D7. Does Capture link need a new acquisition path?** No. `recapture:enqueue` with
`{ urls: [url], caseId }` and no `supersedesCaptureId` already queues a fresh background Capture
(`src/renderer/lib/api/recapture.ts`, `useRecaptureMutations`). `recapture.ts` already enforces the
per-case exclusion list and reports refusals in `EnqueueResult.rejected`. The toast reports
`accepted` or the rejection reason. `recapture.ts` and `backgroundRenderer.ts` are not modified.

**D8. Is the Capture made from a link labelled with where it came from?** Not in this slice. It
records exactly what any other background Capture of that URL records. The PR's Evidence impact
section says so. Provenance is slice 2 and needs an ADR.

**D9. Is a confirmation needed before Capture link?** No for one link: it is a deliberate,
single-target act, and the menu label names it ("Capture link"). The toast says the Capture was
queued. Bulk harvest (later) needs a confirmation and token detection. Rationale recorded for the
maintainer to veto: links with side effects (sign-in, unsubscribe) are a real risk, but the existing
add-URL path carries the same exposure without a dialog.

**D10. How does "Open captured copy" find the Capture?** `resolveCaptureForUrl` in
`src/shared/urlCanonicalize.ts` over the Case's captures list the renderer already holds (React Query
cache). Opening selects that Capture in the Captures screen through the existing selection path.
No new main-process query. `urlCanonicalize.ts` is not modified.

**D11. Where is the link list computed?** In the main process, from the stored MHTML, on demand.
It is derived display data: never stored, no migration, no Manifest Entry. A new
`captures:getLinks` channel in `src/shared/ipc.ts` returns `CaptureLink[]`. The renderer cannot
compute it from the guest because the guest runs no script.

**D12. How are links parsed?** A new `src/main/services/captureLinks.ts` reads the Capture's MHTML
through the existing store, takes the HTML parts, and parses them with `cheerio` (already a
dependency, used by `extraction/sanitizer.ts`). It collects `a[href]` and `area[href]`. Relative
hrefs resolve against `<base href>` when present, else the part's `Content-Location`, else the
Capture's URL. The current decoder only returns the parts concatenated, which loses per-part
`Content-Location`, so `mhtmlDecoder.ts` gains an exported `extractHtmlPartsFromMhtml` returning
`{ contentLocation, html }[]`, and `extractHtmlFromMhtml` becomes a join over it. A test pins that
`extractHtmlFromMhtml` output is byte-identical before and after for the existing fixtures, because
that function feeds text extraction (blocking tier).

**D13. What does one link row carry?**

```ts
interface CaptureLink {
  href: string              // as resolved; the raw attribute when it cannot be resolved
  rawHref: string           // the attribute exactly as stored
  text: string              // trimmed, whitespace-collapsed anchor text; img alt when no text
  rel: string[]             // lower-cased tokens
  kind: 'http' | 'same-page' | 'mailto' | 'tel' | 'other'
  occurrences: number       // identical href+text pairs collapse into one row
  textHostMismatch: boolean // visible text parses as a URL or host that differs from href's host
}
```

`same-page` is a link whose resolved URL differs from the Capture's URL only by fragment. The list
is capped at 5,000 rows after collapsing, and the response says when it was truncated. HTML parts
over `MAX_HTML_BYTES` (sanitizer) are skipped and counted, never silently dropped. "In Case" is
computed in the renderer with D10, not in main.

**D14. Where does the Links tab live?** A fifth viewer tab, `links`, after `text`, in
`CaptureViewer.tsx` (`TABS`, `TAB_LABELS`, `TAB_ICONS`, and `CaptureViewerTab` in `appStore`).
It lists rows with text, host-emphasised destination, `rel` chips, kind, an "In Case" badge and a
mismatch marker. It has a search box and an "External only" toggle. Right-clicking a row opens the
same `link` menu target. For a legacy HTML Capture or a Capture with no MHTML, the tab shows an empty
state naming why.

**D15. Does the Wayback compare pane get the same behaviour?** Yes, because it mounts the same
`MhtmlViewer`. `MhtmlViewer` gains a `caseId` prop; both call sites have the Capture.

**D16. Hover bubble placement and content?** Bottom-left of the Page pane, outside the guest,
showing the full destination, middle-truncated, cleared when `update-target-url` sends an empty URL.
Semantic theme tokens only.

**D17. What new tests pin the claims?**

- Unit: `captureLinks` over fixture MHTML (relative, absolute, `<base>`, `area`, `mailto`,
  `javascript:`, fragment-only, duplicate collapse, mismatch flag, cap and truncation flag, oversize
  part skipped and counted).
- Unit: `extractHtmlFromMhtml` byte-identical over existing fixtures.
- Unit: `entityMenu` entries for each D5 target, including that a non-`http(s)` link never offers
  Capture link.
- Component (jsdom): Links tab rendering, filtering, "In Case" badge; `MhtmlViewer` no longer
  injects the pointer-events CSS and still prevents `will-navigate`/`new-window`.
- E2E (`e2e/page-tab-frame.spec.ts` or a sibling): load a Capture whose MHTML contains a plain link,
  a `target=_blank` link and an absolute external link. Left-click, middle-click and click the
  `_blank` link; assert the guest URL is unchanged and no new window opened. Right-click a link and
  assert the menu shows Capture link. Hover a link and assert the bubble shows its destination.

## Files expected to change

`src/renderer/components/captures/MhtmlViewer.tsx` (blocking), `src/main/services/mhtmlDecoder.ts`
(blocking), new `src/main/services/captureLinks.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`,
`src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/shared/birdbrainApi.ts`,
`src/renderer/lib/api/captures.ts` (+ `keys.ts`), `src/renderer/components/contextmenu/entityMenu.ts`,
`src/renderer/components/captures/CaptureViewer.tsx`, `src/renderer/stores/appStore.ts`, a new
`LinksTab.tsx`, `WaybackCompare.tsx` (prop pass-through), tests. More than ten files and two
blocking-tier paths: the PR is `evidence-affecting` and is never auto-merged.

## Orchestration log

- 2026-10-02: self-grill and plan written.
