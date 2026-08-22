# Redesign program: `ultracode` session prep (wave 2)

Prepared 2026-08-21. Parent specification: #382. Companion docs: `docs/plans/2026-08-19-redesign-ultracode-prep.md` (wave 1), `docs/plans/2026-08-19-wave1-implementation-notes.md` (adjudications that still bind), `docs/plans/2026-08-20-wave1-batch1-crosscheck.md` (the blocking questions this prep resolves). Pixel truth: `docs/design-handoff/2026-08-21-birdbrain-standalone/` (see the screen map below).

## Program state

Wave 1 merged completely on 2026-08-21: #668, #666, #673, #664, #677, #674 (plus #638 the day before). Both batch-2 triggers fired: #389 landed, so #395 claims migration v29; #396 landed, so #397 is unblocked.

The frontier (open program tickets with zero open blockers, in the 08-14 ordering-table order): #395, #406, #397, #400, #390, #402, #398, #392, #404. The maintainer chose seven for wave 2 on 2026-08-21, deferring the evidence-heavy export/server pair (#398, #392) to wave 3 so this wave costs one evidence review, not three.

Separately, triage on 2026-08-21 produced twelve `ready-for-agent` bug fixes (#662, #667, #670, #671, #681, #683, #686, #687, #688, #689, #691, #692). Maintainer ruling: they do not join the wave. They queue for the serial `/dispatch` routine after the wave merges, because #683, #686, and #687 edit capture surfaces #397 rewrites. The dispatch hold stays on until then.

## Wave 2: the ticket set

Each ticket carries a wave-2 prep comment dated 2026-08-21 with its rulings, corrected grounding (file:line against the post-wave-1 tree), and verification path. All seven are labeled `ready-for-agent`.

| Ticket | Area | Evidence-affecting |
| --- | --- | --- |
| #395 selector origin | migration v29, `selectorRepo`, five creation paths, archive round-trip, row detail | no; backstop fires on `db/**` |

**#400 is now an XL.** It absorbed the Signals screen consolidation on 2026-08-21. Size the wave around that.
| #397 three-column layout rework | `captures/` route, viewer tabs, `capView` toggle, resize panels | no; backstop fires on the lockfile |
| #400 per-case exclusions **and the Signals rebuild** | migration v30, `captureServer`, whole Signals screen, removal of `/selectors` and `/tags`, one-line extension mirror | yes; human review, no auto-merge |
| #390 Mention editing UI | notes editor, chips, suggestion popup, snippet rendering | no, if the diff stays renderer-side |
| #402 consolidated Overview with backlink map | `overview/`, first SVG primitive, backlink query layer | no; backstop may fire on `overviewModel.ts` |
| #404 coach-mark engine and intro tour | tour engine, `__root.tsx`, extension-setup removal, settings keys | no; backstop fires on `schemas.ts` |
| #406 read-only extension options page | `extension/` options entry, manifest, Vite HTML rewrite, popup gear | no; backstop fires on `manifest.json` |

## Screen map: ticket to mock

Single design source: `docs/design-handoff/2026-08-21-birdbrain-standalone/Birdbrain-standalone.html`
(maintainer ruling 2026-08-21). It supersedes the V1 bundle in this repository and the V2
bundle on the `prototype/design-handoff-2026-08` branch. Read that folder's README first,
because the file ships packed and a plain grep for `onClick` or `viewBox` finds nothing.

Line numbers below are into the unpacked template (16161 lines), produced by the snippet in
that README.

**Build the default variant.** The mock carries editable props, and the defaults are the
design: `overviewVariant: consolidated`, `density: compact`, `mentionStyle: chip`. The
`classic` variant restores the Selectors and Tags screens and the Overview's
selector-coverage card, and it is the arrangement this wave replaces. Reading `navDefs`
without applying the variant filter is how I mis-reported the navigation as keeping three
overlapping screens.

| Ticket | Screen label in the mock | Template line |
| --- | --- | --- |
| #395 selector origin | Signals, detail rail | 10818 |
| #397 three-column layout rework | Captures | 9942 |
| #400 per-case exclusions | Signals, Auto-capture card | 10818 |
| #390 Mention editing UI | Notes, `chip` mention style | 11219 |
| #402 consolidated Overview and backlink map | Case Overview, `consolidated` branch | 9620 |
| #404 coach-mark engine and intro tour | Dashboard, plus the `data-tour` anchors | 9343 |
| #406 read-only extension options page | Chrome Extension | 12176 |

The mock declares eight `data-tour` anchors for #404: `browser`, `caseswitcher`, `export`,
`linkmap`, `newcase`, `noteeditor`, `selectors`, `viewertabs`. The app declares none.

Two findings from reading the mock on 2026-08-21, both cross-cutting and neither owned by a
wave-2 ticket:

- **Right-click context menus.** The mock binds 23 context-menu handlers across 13 entity
  kinds: capture, case, event, file, folder, ledger, link, note, part, selector, snapshot,
  suggestion, tag. The app has zero (`grep -rn onContextMenu src/renderer/` returns nothing).
  Tracked as #701 and ruled: shared component plus registry, wave 3, no wave-2 hooks.
- **Signals replaces Selectors and Tags.** Ruled 2026-08-21, #700 closed. The mock settles it
  itself: `overviewVariant` defaults to `consolidated`, and in that mode the sidebar filters
  out the Selectors and Tags entries (template lines 13481-13482). The standalone Selectors
  and Tags screens are its `classic` branch, kept for comparison. #400 builds the
  consolidated page and removes both routes; the deletion list is on that ticket.

## Rulings recorded 2026-08-21 (all on the issues)

- #395: origin column is nullable TEXT, NULL = legacy; the DataExplorer popover path records `'capture'`; the flask-opened row-detail panel is an accepted surface.
- #397: both prototype time treatments ship behind the `capView` detailed/list toggle; the Wayback tab ships here, hosting existing `WaybackTab` content, and the details-panel Wayback section is removed (#401 swaps the tab's content later); per-list search stays out (#695); `react-resizable-panels` approved as a new dependency.
- #400: the per-case list blocks every capture source, manual included, matching the global list; manifest visibility lives in #694, not here. **Amended 2026-08-21 after the standalone mock landed:** #400 also rebuilds the Signals screen, and the auto-capture switch ships wired to `autoCaptureMode`. My earlier "omit the switch" instruction was wrong; `autoCaptureMode: z.enum(['auto','notify','per-case'])` has been in `schemas.ts:530` all along, and #570 removed only its control. The top-bar Recording indicator is out of scope and is #702.
- #395, amended 2026-08-21: origin renders per the four values and icons in the mock (`extension`, `capture`, `note`, `manual`), and renders nothing when absent. #395 puts it in the current row detail; #400 carries it into the rebuilt detail rail. My earlier acceptance of the flask-opened "Test matches" panel as the final surface was wrong.
- #701 context menus, ruled 2026-08-21: adopt them, built as one shared component plus a per-kind action registry, in wave 3. **Wave 2 leaves no hooks.** No speculative row handlers, no element boundaries kept back.
- #390: tag Mentions accept any tag id (re-confirming the 2026-08-20 ruling already encoded in `noteReferenceRepo.ts:16-26`); `@tiptap/suggestion@3.29.0` approved as a new dependency.
- Follow-up fixes: dispatch after the wave, not in it.

## Conflict map: what can run in parallel

- `src/main/services/db/migrations.ts` and `core.ts`: #395 (v29) then #400 (v30). Serial, fixed merge order, same rule as wave 1. Neither bumps `CASE_ARCHIVE_SCHEMA_VERSION` (stays 3, adjudicated 2026-08-19).
- `src/main/services/captureServer.ts`: #395 (`POST /api/selectors` stamps origin) and #400 (block reorder, `/api/status` effective list). Different handlers, but the migration order serializes them anyway.
- `src/renderer/components/selectors/` and `tags/`: no longer parallel. #395 adds origin to `SelectorTableRow.tsx`; #400 then rebuilds the whole screen and must preserve it. Strict order, #395 first, and #400 owns both directories.
- `extension/src/`: #400's delta is the one-line mirror at `background.ts:347-348` (the `isIgnoredByUser` seam held from wave 1); #406 owns `PopupApp.tsx`'s footer, the new `options/` directory, `manifest.json`, and `vite.config.ts`. Disjoint; parallel is fine.
- `package.json` and `pnpm-lock.yaml`: #390 adds `@tiptap/suggestion`, #397 adds `react-resizable-panels`. The second to land rebases the lockfile and re-runs `pnpm install`. Both hit the distribution backstop.
- #390 and #402 both extend `src/renderer/lib/api/notes.ts` and the query keys. Append-only; tolerable in parallel.
- #404 is the cross-cutting one: `__root.tsx` (route removal, tour mount), `CommandPalette.tsx`, `ExtensionBanner.tsx`, `About.tsx`, `schemas.ts`, `settings.ts`, plus `CLAUDE.md`/`AGENTS.md` route maps. Nothing else in the wave touches those files, but merge it last so `data-tour` anchors land on final layouts.
- E2E: #397 owns fixing `annotation.spec.ts` (Source-tab click), `capture-detail-panel.spec.ts` (width scheme), and the screenshot baselines; #404 owns `app-lifecycle.spec.ts` and `readme-screenshots.spec.ts`. Disjoint specs; `capture-multiselect.spec.ts` must stay green untouched.

Merge order: **#395 -> #400 -> #397 -> #406 -> #390 -> #402 -> #404.** The schema pair goes first in migration order; #397 early so baseline churn settles; #404 last.

## Session process rules (unchanged from wave 1)

- Agent-written diffs open as `birdbrain-agent`, draft, labelled `agent-authored` (off-slot). Reviewer pre-pass on every one.
- #400 carries `evidence-affecting` plus an Evidence impact section, gets human review, and never auto-merges (ADR-0004, ADR-0005).
- Verify loop per PR: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, plus `pnpm build:extension` when `extension/` changed, plus `pnpm test:coverage` and `pnpm coverage:diff` re-run after any edit.
- Definition of done per screen: pixel-match at compact density, hover/empty/keyboard states per the bundle, tokens only, legible at all three density steps.
- Anything infeasible as designed: send back the constraint, never a redesign.
- Keep the hosting session open for the duration, or resume with `resumeFromRunId`; background workflows die with the session (wave-1 lesson).

## Suggested workflow shape

One Workflow call per phase, results read between phases:

1. Understand. One reader per ticket: its prototype bundle section, its prep comment, the current files its comment cites. Output: implementation notes per ticket, sharpening this conflict map. Cheaper than wave 1's pass because the grounding comments already carry the file lists.
2. Implement. One agent per ticket in worktree isolation, #395/#400 serialized, each ending with the full verify loop and a draft `agent-authored` PR.
3. Review. Adversarial verify per PR: acceptance-criteria and pixel conformance, the evidence gate on #400, coverage of the named e2e breakage lists.

Wave 3 opens as wave 2 merges: #391 unblocks when #390 and #395 land; #398 is already unblocked and brings #399 and #401 behind it; #392 brings #393; #405 waits for #404, #390, #399, #400, #402.

## Open items

- ~~#700 blocks #400.~~ Ruled 2026-08-21 and closed: Selectors and Tags are removed when Signals lands. **Nothing now gates the wave.**
- #702 (top-bar Recording indicator) needs a ruling on whether it reflects `autoCaptureMode`, the existing `sessionActive`, or both. Does not gate the wave.
- #698 (orphaned `AnalysisTab`, filed during this prep) is `ready-for-human`: the remount surface needs a ruling. It does not gate the wave.
- The twelve fixes from the 2026-08-21 triage sweep hold for `/dispatch` after the wave merges.
