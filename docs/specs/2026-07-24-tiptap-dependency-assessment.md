# Tiptap dependency assessment

Date: 2026-07-24
Status: research assessment (no code changes)
Scope: evaluate Tiptap (https://tiptap.dev/docs) as a new dependency for (1) rich-text note taking and (2) a future customizable report generator, against Birdbrain's Electron + React 19 + SQLite/FTS5 stack.

## Verdict: adopt (MIT packages only)

Everything both use cases need is in the MIT-licensed open-source packages — no Tiptap account, no private registry, no cloud subscription. The pricing page states it plainly: "The Tiptap Editor is open source (MIT) and free. Only platform features and cloud documents are priced" (https://tiptap.dev/pricing).

Recommended packages (all MIT, all versioned in lockstep at 3.29.0 as of 2026-07-24, per https://registry.npmjs.org):

- `@tiptap/react` + `@tiptap/pm` + `@tiptap/core` — editor in the renderer
- `@tiptap/starter-kit` — baseline nodes/marks (includes Link and Underline in v3)
- `@tiptap/static-renderer` — headless JSON → HTML/Markdown/React in the main process (reports, FTS)
- Optional per feature: `@tiptap/extension-mention` (+ `@tiptap/suggestion`), `@tiptap/extension-list` (task lists), `@tiptap/extension-table`, `@tiptap/extension-image`, `@tiptap/markdown`

Caveats that keep this from being an unqualified adopt:

- First-party PDF/DOCX export is a paid cloud service; our PDF path must be DIY (static-render to HTML + Electron `printToPDF`, which Birdbrain already does for captures in `src/main/services/pdfExport.ts`). This is acceptable — see Report generator below.
- One open React 19 bug (#7543) involving `ReactNodeViewRenderer` remount; Tiptap's optional prebuilt UI Components library currently "works best with React 18". Core `@tiptap/react` officially supports React 19. Build our own toolbar UI (we would anyway, for theme tokens).
- v3 shipped mid-2025 after a breaking v2→v3 migration, and the 3.0.1 release notes say "4.0.0 will not be far away" — budget for a future major.

## 1. Licensing and pricing

Open source (MIT), verified via npm registry `license` fields at version 3.29.0: `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/html`, `@tiptap/static-renderer`, `@tiptap/markdown`, `@tiptap/extension-mention`, `@tiptap/extension-table`, `@tiptap/extension-task-list`, `@tiptap/extension-image`, `@tiptap/extensions` (https://registry.npmjs.org/@tiptap/core, .../@tiptap/react, etc.). The GitHub repo license is MIT (https://github.com/ueberdosis/tiptap, license per https://api.github.com/repos/ueberdosis/tiptap).

Paid (Tiptap Platform plans: Start $59/mo, Team $179/mo, Business $1,199/mo, Enterprise custom — https://tiptap.dev/pricing):

- Real-time collaboration, document history/version compare, comments, in-line AI, hosted cloud documents (https://tiptap.dev/pricing)
- Conversion — DOCX and Markdown import, DOCX/PDF/ODT/EPUB/Markdown export via Tiptap's service: "Conversion is a Pro package included with all Tiptap subscriptions" and requires access to the private npm registry (https://tiptap.dev/docs/conversion/getting-started/overview)
- Pro extensions (`@tiptap-pro/*`) install from Tiptap's private npm registry (`registry.tiptap.dev`) with a personal access token; "A Tiptap account is required to access Pro extensions. Select extensions such as Snapshots, Comments, and some features of AI Toolkit also require an active subscription" (https://tiptap.dev/docs/guides/pro-extensions)
- Paid add-ons: AI Toolkit, Tracked Changes (https://tiptap.dev/pricing)

Nuance on Markdown: the pricing page lists Markdown import/export under paid plans, but that refers to the Conversion REST service. The `@tiptap/markdown` extension itself is open source (MIT on npm, https://registry.npmjs.org/@tiptap/markdown) and Tiptap's announcement calls it "an open-source Markdown extension ... fully bidirectional" (https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap).

Nothing required for Birdbrain's two use cases is behind the paywall. Documents stored in our own SQLite database never touch Tiptap Cloud and don't count toward any plan: "Local documents in your own database do not count" (https://tiptap.dev/pricing).

## 2. Current version and maintenance

- Latest stable: v3.29.0, released 2026-07-24 (https://github.com/ueberdosis/tiptap/releases). v2 is superseded; v3 went stable as 3.0.1 in July 2025 ("This is the stable release for 3.0.0" — https://github.com/ueberdosis/tiptap/releases/tag/v3.0.1; "we're announcing the release of the stable version of Tiptap 3.0" — https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable).
- Cadence: multiple releases per month (v3.25.0 2026-06-03 through v3.29.0 2026-07-24, ten releases in ~7 weeks per https://github.com/ueberdosis/tiptap/releases).
- Activity: ~37.8k stars, ~3.1k forks, 827 open issues+PRs, last push 2026-07-24 (https://api.github.com/repos/ueberdosis/tiptap). Tiptap self-reports "over nine million downloads per month on npm" (https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable).
- v2→v3 migration (moot for us — we'd start on v3, but indicative of churn style): package consolidation (`@tiptap/extension-table` absorbs row/cell/header; `@tiptap/extension-list` absorbs list packages; utility extensions moved to `@tiptap/extensions`), tippy.js replaced by Floating UI with a new required `@floating-ui/dom` peer for menus, `shouldRerenderOnTransaction` now off by default, UMD builds removed (https://tiptap.dev/docs/guides/upgrade-tiptap-v2).
- React 19: `@tiptap/react@3.29.0` peer-depends on `react` / `react-dom` `^17.0.0 || ^18.0.0 || ^19.0.0` (https://registry.npmjs.org/@tiptap/react/latest). Tracker history shows a wave of React 19 fixes landed and closed (#6110, #6386, #6405, #7314, #7549 — https://github.com/ueberdosis/tiptap/issues?q=react+19). One still open as of today: #7543, a `flushSync` error when remounting `useEditor` with an existing ID and `ReactNodeViewRenderer` (https://github.com/ueberdosis/tiptap/issues/7543). Separately, the optional UI Components library (copy-paste components, not npm packages) warns: "the UI Components work best with React 18 ... some components may not yet be fully compatible" with React 19 (https://tiptap.dev/docs/ui-components/getting-started/overview).

## 3. Architecture fit (storage, FTS, headless generation)

Tiptap wraps ProseMirror ("built on top of ProseMirror" — https://tiptap.dev/docs/editor/getting-started/overview); the document is a ProseMirror doc, and Tiptap documents both JSON and HTML as first-class persistence formats via `editor.getJSON()` / `editor.getHTML()`, with JSON described as "more like what Tiptap uses under the hood" and easier to traverse programmatically (https://tiptap.dev/docs/guides/output-json-html). JSON is the right storage format for us: it round-trips losslessly, survives schema evolution better (unknown content can be handled via the invalid-schema strategies — https://tiptap.dev/docs/conversion/getting-started/overview), and is trivially stored as TEXT in SQLite.

Headless generation in the main process (no DOM, no BrowserWindow):

- `generateText(json, extensions)` from `@tiptap/core` is exported (verified in `@tiptap/core@3.29.0` `dist/index.d.ts`) and its implementation is DOM-free — it builds the schema, hydrates the node via `Node.fromJSON`, and walks it with text serializers (verified in `dist/index.js` at unpkg.com/@tiptap/core@3.29.0). This is the FTS plain-text extractor.
- `@tiptap/static-renderer` renders JSON to HTML strings, Markdown, or React elements with "no browser, DOM or even an editor instance" required (`renderToHTMLString`, `renderToMarkdown`, `renderToReactElement` — https://tiptap.dev/docs/editor/api/utilities/static-renderer). MIT, React peer optional per entry point (https://registry.npmjs.org/@tiptap/static-renderer/latest).
- `@tiptap/html` also provides server-side `generateHTML`/`generateJSON` but uses a virtual DOM and peer-depends on `happy-dom ^20.8.9` (https://tiptap.dev/docs/editor/api/utilities/html, https://registry.npmjs.org/@tiptap/html/latest). Note the docs caution: `generateHTML` from `@tiptap/core` is browser-only; the `@tiptap/html` variant is the server-safe one (https://tiptap.dev/docs/editor/api/utilities/html). Prefer `@tiptap/static-renderer` — no DOM shim at all.

### FTS5 strategy for Birdbrain

Current model (src/main/services/db/migrations.ts, v10 block): `notes(title, body)` with a contentless-mirror `notes_fts USING fts5(title, body, content=notes)` maintained by AFTER INSERT/DELETE/UPDATE triggers; `noteRepo.ts` matches against `notes_fts`. If `body` became Tiptap JSON, the triggers would index raw JSON noise.

Proposed: keep `body` as the FTS-indexed plain text and add a `body_doc` column for the JSON document.

- Renderer saves both: the editor's `getJSON()` output, plus nothing else — plain text is derived in the main process at write time via `generateText(json, extensions)` so renderer and main can't disagree.
- `body` stays the trigger-indexed plain text (zero migration churn for `notes_fts`, existing plain-text notes remain valid), `body_doc TEXT` (nullable) holds serialized JSON; legacy notes have `body_doc = NULL` and render as plain text.
- The extension list used for `generateText`/static rendering in main must match the renderer's editor extensions — factor a shared `noteExtensions()` module (schema-only, no React node-view imports) under `src/shared/` or duplicated deliberately with a test pinning parity.

## 4. Bundle size and dependency weight

Install weight (npm `dist.unpackedSize`, v3.29.0 / current ProseMirror, via registry.npmjs.org):

- `@tiptap/core` 2.4 MB; `@tiptap/react` 482 KB; `@tiptap/starter-kit` 53 KB; `@tiptap/extensions` 405 KB; `@tiptap/pm` 17 KB (re-export shim)
- 13 `prosemirror-*` packages pulled by `@tiptap/pm` totaling ~2.9 MB unpacked (largest: prosemirror-view 881 KB, prosemirror-model 518 KB, prosemirror-tables 447 KB) (https://registry.npmjs.org/@tiptap/pm/latest lists the 13 deps)
- Optional: `@tiptap/static-renderer` 869 KB, `@tiptap/html` 56 KB (+ happy-dom peer — already a Birdbrain devDependency, would need promotion to dependency if used), `@tiptap/markdown` 409 KB (+ `marked`)

Unpacked size overstates shipped size — packages ship ESM built with tsup (UMD removed in v3 — https://tiptap.dev/docs/guides/upgrade-tiptap-v2) and Tiptap's pitch is explicitly modular: "Add only the extensions you need ... Keep the bundle small" (https://tiptap.dev/docs/editor/getting-started/overview). Non-ProseMirror transitive deps are minimal: `@tiptap/react` adds only `fast-equals` and `use-sync-external-store` (https://registry.npmjs.org/@tiptap/react/latest). For an Electron renderer bundled by Vite, none of this affects startup meaningfully if the editor route is code-split.

Electron-specific issues: a GitHub issue search for "electron" in ueberdosis/tiptap returns 7 results, all closed and none an actual Electron incompatibility (https://github.com/ueberdosis/tiptap/issues?q=electron). Expected — the renderer is Chromium, Tiptap's primary target.

## 5. Report generator suitability

- Custom node types: first-class. `Node.create` with custom schema/attributes, plus interactive node views — including React components via `ReactNodeViewRenderer` (https://tiptap.dev/docs/editor/extensions/custom-extensions, https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views). v3 also added MarkViews with React support (https://github.com/ueberdosis/tiptap/releases/tag/v3.0.1). A `captureRef` atom node carrying `{captureId, hash, label}` attributes with a React node view in the editor and a custom `nodeMapping` in the static renderer for export is exactly the supported pattern — the static renderer accepts per-node/per-mark mappings and `unhandledNode` hooks (https://tiptap.dev/docs/editor/api/utilities/static-renderer).
- Templates/placeholders: `Placeholder` ships free in `@tiptap/extensions` (https://tiptap.dev/docs/guides/upgrade-tiptap-v2 lists it there); report templates are just stored JSON documents pre-seeded with our custom nodes — no product feature needed. Tiptap's "Templates" product is prebuilt editor UI, not document templates (https://tiptap.dev/docs/ui-components/getting-started/overview).
- HTML export: free and headless via `renderToHTMLString` (https://tiptap.dev/docs/editor/api/utilities/static-renderer).
- PDF export: first-party PDF export is part of the paid Conversion service, subscription plus private registry (https://tiptap.dev/docs/conversion/getting-started/overview, https://tiptap.dev/pricing). DIY path: static-render report JSON to HTML in the main process, wrap in a print stylesheet, load into the existing hidden-BrowserWindow `printToPDF` pipeline Birdbrain already uses for capture PDFs (`src/main/services/pdfExport.ts`). Print styling is plain CSS under our control.
- DOCX export: paid only (Conversion service — https://tiptap.dev/docs/conversion/getting-started/overview). Out of scope; Markdown/HTML exports cover the open formats.
- Read-only/preview: a read-only editor instance gives pixel-identical rendering, or static-render to React elements for a pure preview without editor weight (https://tiptap.dev/docs/guides/output-json-html, https://tiptap.dev/docs/editor/api/utilities/static-renderer).

## 6. Editor features for notes

- StarterKit (v3) includes nodes Blockquote, BulletList, CodeBlock, Document, HardBreak, Heading, HorizontalRule, ListItem, OrderedList, Paragraph, Text; marks Bold, Code, Italic, Link, Strike, Underline; plus Dropcursor, Gapcursor, Undo/Redo, ListKeymap, TrailingNode — individually configurable/disableable (https://tiptap.dev/docs/editor/extensions/functionality/starterkit).
- Task lists: `TaskList`/`TaskItem` in MIT `@tiptap/extension-list` (https://tiptap.dev/docs/guides/upgrade-tiptap-v2; license via https://registry.npmjs.org/@tiptap/extension-task-list/latest).
- Mentions: MIT `@tiptap/extension-mention` with `@tiptap/suggestion` (https://registry.npmjs.org/@tiptap/extension-mention/latest); v3 menus position via Floating UI (https://tiptap.dev/docs/guides/upgrade-tiptap-v2). Natural basis for `@capture` / `#tag` references in notes.
- Tables: MIT `@tiptap/extension-table` (consolidated row/cell/header, TableKit — https://tiptap.dev/docs/guides/upgrade-tiptap-v2, https://registry.npmjs.org/@tiptap/extension-table/latest).
- Markdown: first-party open-source `@tiptap/markdown` (MIT, MarkedJS-based, CommonMark-compliant, GFM via `markedOptions: { gfm: true }`) — bidirectional parse/serialize, `editor.getMarkdown()`, `setContent(md, { contentType: 'markdown' })`, per-extension `parseMarkdown`/`renderMarkdown` hooks for custom nodes; "works identically in browser and server environments" (https://tiptap.dev/docs/editor/markdown, https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage, https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap). Caveat: the docs flag it as "an early release and can be subject to change" (https://tiptap.dev/docs/editor/markdown). The community `tiptap-markdown` package is no longer needed. `@tiptap/static-renderer` also does JSON → Markdown independently (https://tiptap.dev/docs/editor/api/utilities/static-renderer).
- Images: MIT `@tiptap/extension-image` (https://registry.npmjs.org/@tiptap/extension-image/latest). For Birdbrain, image nodes should reference case-directory files rather than base64 blobs; that is a custom-attribute configuration, not a product limitation.

## 7. Alternatives (brief)

- Lexical (`lexical` / `@lexical/react` 0.48.0, MIT — https://registry.npmjs.org/lexical/latest): Meta's editor framework. Fully open source with no paid tier, but still 0.x with its own breaking-change cadence, a different (non-ProseMirror) document model, and we'd hand-build markdown round-tripping, static HTML generation, and mentions plumbing that Tiptap ships as maintained packages.
- BlockNote (`@blocknote/core` 0.52.1, MPL-2.0 — https://registry.npmjs.org/@blocknote/core/latest): batteries-included block editor built on Tiptap/ProseMirror. Fastest path to a Notion-like UI, but 0.x, MPL rather than MIT, its styled UI would fight Birdbrain's Tailwind token system, and its export add-ons are dual-licensed GPL-3.0/proprietary (`@blocknote/xl-pdf-exporter` is "GPL-3.0 OR PROPRIETARY" — https://registry.npmjs.org/@blocknote/xl-pdf-exporter/latest), i.e. a sharper open-core split than Tiptap's.
- Plain ProseMirror (`prosemirror-model` etc., MIT — https://registry.npmjs.org/prosemirror-model/latest, https://prosemirror.net): maximal control, zero commercial pressure, but we would reimplement the extension system, React bindings, and every convenience Tiptap wraps. Tiptap is effectively the maintained ProseMirror distribution; dropping to raw ProseMirror later remains possible because the stored JSON is a ProseMirror document.
- Milkdown (`@milkdown/kit` 7.21.3, MIT — https://registry.npmjs.org/@milkdown/kit/latest): markdown-first ProseMirror editor. Good if markdown were the storage format, but our storage format is JSON and the report generator needs rich custom nodes, where Tiptap's ecosystem is deeper.

Tiptap remains the recommendation: ProseMirror foundation, MIT for everything we need, first-party headless rendering and markdown, and React 19 support in the core bindings.

## 8. Risks

- Open-core trajectory: recent movement has been toward open source, not away — v3 open-sourced formerly-Pro extensions (drag handle, emoji, math, file handling, and more) under MIT (https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable, https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap). The same announcement, however, sunset the free tier of Tiptap Cloud (https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap), and collaboration/comments/history/AI/conversion are firmly paid (https://tiptap.dev/pricing). Mitigation: depend only on public-registry `@tiptap/*` MIT packages; treat anything scoped `@tiptap-pro/*` as off-limits.
- Private registry/account: only Pro extensions require the account plus a personal token that "does not expire" (Tiptap's own security warning — https://tiptap.dev/docs/guides/pro-extensions). Not applicable if we stay MIT-only; also a reason to stay MIT-only.
- Breaking changes: v2→v3 was a significant migration (package renames, menu system swap — https://tiptap.dev/docs/guides/upgrade-tiptap-v2), a 3.0.0 tag had to be deprecated after an accidental release, and the team wrote "4.0.0 will not be far away" (https://github.com/ueberdosis/tiptap/releases/tag/v3.0.1). Because notes/reports persist as ProseMirror JSON, editor-API churn does not endanger stored data, but expect periodic upgrade work. Pin minor versions; all `@tiptap/*` packages must move in lockstep (peer deps are exact-version — https://registry.npmjs.org/@tiptap/react/latest).
- React 19 edges: open issue #7543 (`flushSync` on `useEditor` remount with React node views — https://github.com/ueberdosis/tiptap/issues/7543); UI Components library not yet fully React 19-ready (https://tiptap.dev/docs/ui-components/getting-started/overview). Mitigation: stable editor mount keys, own toolbar UI, exercise note editing in Playwright.
- Markdown extension maturity: flagged "early release ... may have edge cases" with known limits (single child node per table cell, comments not representable — https://tiptap.dev/docs/editor/markdown). Treat markdown as an import/export convenience, never the storage format.
- Schema drift: FTS text, report HTML, and the editor must share one extension list; an extension added in the renderer but not in main-process rendering silently drops content at export (unhandled nodes — https://tiptap.dev/docs/editor/api/utilities/static-renderer). Mitigation: single shared extension module plus a round-trip unit test (JSON → text/HTML) in `tests/`.

## Proposed integration sketch

Storage

- `notes.body_doc TEXT` (new, nullable): serialized Tiptap/ProseMirror JSON (`editor.getJSON()` — https://tiptap.dev/docs/guides/output-json-html). `NULL` = legacy plain-text note.
- `notes.body` (existing): derived plain text, produced in the main process by `generateText(doc, noteExtensions())` (`@tiptap/core`, DOM-free — verified against the 3.29.0 dist source) at create/update time. Existing `notes_fts` triggers and `noteRepo` search continue to work unchanged.
- New migration bumps `user_version`; no FTS rebuild needed since `body` semantics are unchanged.

Shared schema module

- `noteExtensions()` returning `[StarterKit.configure(...), TaskList, TaskItem, Mention(configured for captures/tags), CaptureRef, ...]`, importable from both renderer and main. Keep React node views out of this module (register them renderer-side) so the main process only loads schema-bearing extensions.

Renderer

- `NoteEditor` component wrapping `useEditor` from `@tiptap/react` (peer-compatible with React 19 — https://registry.npmjs.org/@tiptap/react/latest), themed with existing semantic tokens; read-only mode for NoteCard previews (or `renderToReactElement` for cheap static previews — https://tiptap.dev/docs/editor/api/utilities/static-renderer).
- IPC payloads gain `bodyDoc?: string`; main derives `body` server-side rather than trusting a renderer-computed text.

Reports (later)

- Report = a document using `noteExtensions()` plus report-only nodes (`captureRef`, `captureScreenshot`, `selectorTable`, metadata blocks). Assembly = programmatic JSON construction from case data.
- Export: main process `renderToHTMLString` with custom `nodeMapping` for report nodes (https://tiptap.dev/docs/editor/api/utilities/static-renderer) → print CSS → existing hidden-window `printToPDF` pipeline (`src/main/services/pdfExport.ts`). Markdown export via `renderToMarkdown` or `@tiptap/markdown` serialization.

Dependency additions (all public npm, MIT): `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/static-renderer`, plus feature extensions as adopted (`@tiptap/extension-mention`, `@tiptap/suggestion`, `@tiptap/extension-list`, `@tiptap/markdown`). Roughly 2.9 MB of ProseMirror packages plus ~3.5 MB of Tiptap packages unpacked in `node_modules` (npm registry `dist.unpackedSize`, 2026-07-24); renderer bundle impact is bounded by ESM tree-shaking and code-splitting the editor route.
