# Wave 1 implementation notes (phase 1: understand)

Prepared 2026-08-19 by the ultracode understand workflow (run `wf_c93212f2-d67`: nine ticket readers plus one synthesizer, 10/10 agents completed). Inputs: the wave-1 issue bodies, the V2 design-handoff bundle on `prototype/design-handoff-2026-08` (`e967542`), the references-index spike verdict (`docs/specs/2026-08-18-references-index-spike.md`), and the tree at `origin/main` (`92c392d`). Parent prep doc: `docs/plans/2026-08-19-redesign-ultracode-prep.md`.

The synthesis comes first; the raw per-ticket reader notes follow it. Where a reader's open question was answered from the repository or the bundle, the answer lives in the synthesis section "Answered inline"; the remaining thirteen need Matt's ruling before their branches start.

All version constants verified against the tree (LATEST_SCHEMA_VERSION = 27, CASE_ARCHIVE_SCHEMA_VERSION = 2, migrations tail is the v27 block). Report follows.

## Conflict map (sharpened)

The prior map holds at the headline level but understates the shared IPC-spine overlap and misses two file-level contacts (#563/#395 on NewCaseWizard, #387/#400 on `urlPatterns`). "Independent: #403, #563, #622" is **false at file level** - all three touch shared spine files - but true at the component/behavior level; all their overlaps are append-only.

**Hot spot (serial order enforced):**
- `src/main/services/db/migrations.ts` - #389, #395, #400. Each appends an `if (version < N)` block. Serial: #389 -> #395 -> #400. Confirmed by all three file lists.
- `src/main/services/db/core.ts` - #389, #395, #400. Same serial order (LATEST_SCHEMA_VERSION bump rides the migration).
- `src/main/services/caseArchive.ts` - #389 bumps CASE_ARCHIVE_SCHEMA_VERSION 2->3; #395's reader speculated its own bump but #395's file list correctly shows no `caseArchive.ts` change (SELECT * export; import defaults `origin` to NULL; an old app importing a new archive drops a display-only field, which is tolerable and needs no refusal). **Adjudicated: only #389 bumps, to 3.** #395 and #400 ride v3 by merging after #389 and must not bump again.

**Captures sequence (strict serial, confirmed):**
- `src/renderer/components/captures/CaptureList.tsx`, `CaptureItem.tsx`, `src/renderer/routes/cases/$caseId/captures.tsx`, `src/renderer/stores/appStore.ts` - #396 then #397, same agent or #397 rebases on #396's merged row markup. #397's reader confirms it wraps everything #396 edits.
- e2e captures specifications - both add specifications and share seeding fixtures; second-to-land reuses the first's fixture.

**Selectors screen (parallel tolerable, confirmed):**
- `src/renderer/components/selectors/` - #395 confined to `SelectorTableRow.tsx`; #400 confined to `SelectorsOverview.tsx` + new `AutoCaptureExclusions.tsx`. No shared file if #395 keeps out of SelectorsOverview (its reader commits to this). Parallel OK; second resolves.

**Extension (boundary confirmed, sharper than prior map):**
- `extension/src/background.ts` - #387 (popup pre-filter, GET_STATE extension, comment rewrite) and #400 (one-line mirror at the status poll, ~line 320). #387 owns the file; the seam contract is that #387 routes every pattern lookup through `isIgnoredByUser()` so #400's delta stays one line. #387 should land first.
- `src/shared/schemas.ts` (CaptureServerStatus) - #400 extends it; #387 reads it but must not touch it. Also #397 adds settings keys elsewhere in the file - three tickets, disjoint regions, trivial.
- `src/shared/urlPatterns.ts` + `tests/shared/urlPatterns.test.ts` - #387 (comment-only, closing the documented popup gap) and #400 (validateIgnorePattern + effective-list helper). Trivial; #400 owns behavior.
- `src/main/services/captureServer.ts` - #395 (POST /api/selectors stamps origin) and #400 (blacklist reorder, /api/status). Different handlers, same file; serial by migration order anyway. Same for `tests/main/services/captureServer.test.ts`.

**Shared IPC spine (append-only, second-to-land resolves):**
- `src/shared/ipc.ts` - #389, #395, #400, #403, #622.
- `src/shared/types.ts` - #389, #395, #400, #403, #622.
- `src/main/ipcHandlers.ts` - #389, #400, #403, #622.
- `src/preload/index.ts` - #389, #403, #622.
- `src/shared/birdbrainApi.ts` - #389, #403 (note: #622's reader omitted it, but its new diagnostics bridge will need the typed method there too - count #622 in).
- `src/renderer/lib/api/keys.ts` - #403, #622, optionally #389.
- `tests/main/services/caseArchiveRoundTrip.test.ts` - #389, #395, #400. Append-only assertions.
- `tests/main/services/database.test.ts` - #389 (maybe), #395, #400.

**New contact the prior map missed:**
- `src/renderer/components/dashboard/cases/NewCaseWizard.tsx` - #395 (origin on the preset-selector create, ~line 74) and #563 (comment swap at ~line 129-131). Different regions, trivial merge; land #563 first since it's a same-day trivial PR.

## Migration order

Current `LATEST_SCHEMA_VERSION` is **27** (verified, `core.ts:6`; migrations tail is the v27 note-anchors block).

Merge order confirmed: **#389 -> #395 -> #400.**

- **#389** claims **v28** - `note_references` table + target index; bumps LATEST_SCHEMA_VERSION to 28. Also the only CASE_ARCHIVE_SCHEMA_VERSION bump (2->3).
- **#395** claims **v29** - `ALTER TABLE selectors ADD COLUMN origin TEXT`; bumps to 29. Its reader's draft says v28 - must renumber at branch time; do not hardcode 28 in prose or tests.
- **#400** claims **v30** - `capture_exclusions` + `capture_exclusion_mode` on `cases`; bumps to 30. Same renumbering note.
- Conditional: if the #403 selector-hit ruling adds `matched_at` to `selector_matches`, that becomes **v31** and serializes behind all three - a reason to ship #403 v1 without it.

## Phase-2 execution plan

**Batch 1 (parallel worktree agents, 5):**
- **#389** - evidence PR 1, owns v28, longest pole; start immediately.
- **#396** - captures sequence head. Buildable now: the bar-shape question is answerable from the bundle (session 8's inline bar is what the bundle landed on - screenshot 13, `MOTION.md`, and `Birdbrain.dc.html:1029` all agree; the ticket text is session-7 vintage). Build inline, note the AC-wording supersession in the PR.
- **#387** - extension popup; no migration, no evidence flag.
- **#563** - trivial comment-branch fix; merges same day.
- **#622** - evidence PR 3 in review order, but independent in code; build the app-side check now, hold the conditional verifier-CLI portion behind Matt's ruling (open question below).

**Deliberately held out of batch 1:** #403 - its spine-file overlap is tolerable, but its selector-hit ruling (open question) decides whether it needs a migration; start it once Matt rules, or start now scoped to capture+note events only.

**Batch 2 (each starts when its blocker merges):**
- **#395** - after #389 merges (claims v29, rebases spine files).
- **#397** - after #396 merges (rebases row markup and route layout).
- **#403** - after the ruling; after #389 merges if it takes the spine-file path anyway (cheap rebase).

**Batch 3:**
- **#400** - after #395 (claims v30) and after #387 (`background.ts` seam settled, mirror stays one line). Evidence PR 2 or 3 by review order.

**Expected PR merge order:** #563 -> #389 (human evidence review 1) -> #387 -> #396 -> #403 -> #395 -> #622 (human evidence review 2) -> #397 -> #400 (human evidence review 3, the heaviest). This spaces the three human evidence reviews so they never queue, keeps the migration chain in order, and lets the non-evidence UI tickets merge between reviews. ADR-0005's evidence gates (human review, no auto-merge on #389/#400/#622) apply regardless of batch parallelism.

**Answered inline from repository or bundle (removed from open questions):**
- #387 gear target: keep the `birdbrain://settings` deep link; the options page is stage 5, out of wave.
- #387 session button: keep the HOTFIX semantics (Stop only while a session is active) - the prototype's always-Stop presumes auto-capture, which is disabled (#211) until #600.
- #389 renderer query layer: defer to consumers #390/#392/#402 (wave 2); state the boundary in the PR.
- #395 CSV export: leave untouched; AC only requires row-detail visibility.
- #396 bar shape: inline session-8 bar (see batch 1).
- #400 invalid-regex retrofit: scope to the per-case path; file the global-list silent-skip as a separate issue per the repository defect-filing rule.
- #403 note-row clicks: follow the prototype (note rows open Notes with the note selected; capture/hit rows open the capture) - the AC sentence is capture-row shorthand; assert prototype behavior in e2e.
- #563: close via the AC's comment branch citing the V2 bundle (recessed = `bg-canvas` supersedes V1 `bg-elevated`); keep `rounded-xl` (zero pixel change, smaller diff); leave the committed V1 SCREEN_NOTES to the V2-bundle import; leave CreateCaseDialog untouched and file a dead-code removal issue.
- #622 surface: Diagnostics-only for wave 1; a fourth VerifyBar state ripples into the Overview the redesign owns.

## Evidence-gate checklist

**#389 (references index, archive v3):**
- Archive schema bump 2->3 and rationale: pre-v28 readers refuse a mention-bearing archive cleanly ("newer version") instead of failing opaquely mid-import on an unknown node type.
- The references index is derived and never travels - no new bytes need chain coverage; mentions ride in `body_doc`, already inside the `packageHash-committed` `data.json`.
- Id-remap behavior for mention targets, including the tag merge-by-name path (`ctx.mapTag`, not `ctx.mapId`), with membership checked against remapped ids.
- Fail-closed import: a malformed Mention fails the whole one-transaction import; no half-import.
- Known-answer round-trip coverage: export -> forced collisions -> import -> identical resolved references.
- ADR-0004 gate: the claim supported is "analyst cross-references survive archive transfer intact" - proves nothing about captured content; archive-export/import manifest entries unchanged in shape.
- Process: evidence-affecting label, human review, no auto-merge, coverage gates run.

**#400 (per-case exclusions):**
- Enforcement moves from a global pre-case check to a per-target-case effective list after case resolution - error precedence shifts (blocked URL + missing case now `404s` not `403s`); existing tests repinned deliberately.
- Override mode can **widen** acquisition against the operator's global policy - the sharp edge, stated plainly.
- Fail-open regular expression budget preserved (safeRegexTest 200 ms -> no-match): under override, one pathological pattern admits everything the global list would have caught.
- Extension mirror is feedback-only and lags the status poll; the server 403 is sole enforcement.
- Invalid patterns rejected at persist time for case lists; enforcement-time skip-don't-fail kept so one bad entry cannot disable the rest.
- Archives round-trip the acquisition policy (list + mode; legacy archives default null/'stack').
- A stated position on manifest visibility of exclusion-configuration changes and per-URL skips (see open question).

**#622 (unreconciled deletions):**
- Read-only reconciliation check on the evidence path: lenient manifest readers + verifyManifestChain; nothing writes `manifest.jsonl`; no schema or packaging change.
- Finding wording claims only what is known per ADR-0004: chain valid; capture row still present; on-disk file state unknown.
- Recovery is the pre-existing delete seam (withDeletionEntry) appending a new signed deletion entry - an evidence-path write, but not a new one; tested.
- If the verifier-CLI portion ships, it alters evidence-package verification output/interpretation (today this state already FAILs section 7.5 coverage) and is its own evidence-affecting change under ADR-0005.
- Imported-chain false-positive defense: join scoped to the scanned case's DB id, not the entry's embedded source `caseId`.

## Cross-ticket risks

- **Migration renumbering under parallelism.** All three schema readers drafted "v28." Whoever lands later renumbers `migrations.ts`, `core.ts`, and every test/prose mention. Mitigation: branches parameterize on LATEST_SCHEMA_VERSION, never hardcode the number; strict merge order #389->#395->#400.
- **Double archive-version bump.** #389's reader expected #395 to also bump CASE_ARCHIVE_SCHEMA_VERSION - a semantic, not textual, conflict if two branches each write 2->3. Adjudicated earlier: #389 alone bumps; #395/#400 branch after it merges.
- **Evidence-review throughput.** Three PRs need serialized human review, and #400 is the heaviest (override semantics + fail-open interaction + a possible manifest-entry-type ripple into shared/verify, the verifier CLI, and `VERIFY.md`). If the #400 manifest-visibility ruling adds an entry type, its review cost roughly doubles - get the ruling before the branch starts.
- **background.ts seam discipline.** If #387 lets the popup fetch/match patterns itself instead of going through `isIgnoredByUser()`, #400's "one-line mirror" becomes a real merge and the per-case source swap leaks into popup code. The seam contract is the whole reason the parallel is safe.
- **#403's migration escape hatch.** Ruling option (c) (`matched_at` column) turns the "conflicts with nothing" ticket into a fourth migration serialized behind #400 and touches the selector archive round-trip. Ship v1 with capture+note events unless Matt wants hits badly enough to pay that.
- **#397 open scope questions gate #396's successor.** The Wayback-tab split against #401 and the row-variant question decide how much of #397 exists; unresolved, the captures chain stalls after #396 merges.
- **Row-click contract across #403/#396/#397.** The feed's navigation lands on `setSelectedCaptureId` + `/cases/$caseId/captures`, the exact surface #396/#397 rework. Keep `selectedCaptureId` as the selection contract; #403's e2e should be written against post-#397 reality or expect one retarget.

## Open questions
Two of the thirteen were ruled on 2026-08-20 and are marked below. The remaining eleven still gate their branches.

1. **#389 - tag scoping (spike constraint 3): RULED 2026-08-20.** Accept any tag id with no case-membership check. Tags are global, and the alternative makes removing a tag from a case silently invalidate mentions that were valid when written. Record on the issue before implementation.
2. **#389 - `dbAdmin` escape hatch:** extend the Database Admin notes guard to `body_doc` writes in this PR (so the fourth write path cannot desync the new index), or file the pre-existing body-drift gap as a separate defect and keep #389 lean? Either way an issue gets filed for the pre-existing part.
3. **#395 - legacy origin mapping:** nullable with NULL = legacy (prototype-faithful, pill hidden for old rows - recommended) vs `NOT NULL DEFAULT 'manual'` (issue wording supports it, but stamps "Added by hand" on rows that actually came from the extension - a false provenance claim). Decides what old rows display forever.
4. **#395 - DataExplorer-minted selectors:** origin `'capture'` (value came from capture-derived data - recommended) or `'manual'`?
5. **#387 - popup page-status states:** nothing extension-side retains per-URL capture results and no server endpoint answers "was this URL captured." Ship only the states with real data (capturing / captured-this-popup-session / not-captured / can't-capture), or is a server lookup in scope for wave 1?
6. **#397 - row treatment + view toggle:** ticket says clock + short relative time, but the prototype's default detailed rows show the long form with no clock (clock+short is the compact list variant). Which ships, and is the detailed/list `capView` toggle in #397 scope?
7. **#397 - Wayback tab split vs #401:** does #397 ship a Wayback tab trigger rendering the existing WaybackTab content (and the hide-list-while-Wayback behavior), or does the tab arrive wholesale with #401, leaving #397 with three tabs?
8. **#397 - per-list capture search:** the prototype's list header has a `Search captures...` input the app lacks. In scope or a separate ticket?
9. **#400 - enforcement scope:** does the per-case list block MANUAL captures into that case (as the global list does today, test-pinned), or only auto/selector sources? The AC and the prototype footer copy disagree; this decides the server test matrix.
10. **#400 - card container:** build the prototype's per-case Auto-capture on/off switch as disabled/inert (no backing setting until #600), or mount the exclusion section without it?
11. **#400 - manifest visibility:** should exclusion-list/mode changes and/or per-URL blocked-capture events become manifest entries? Either adds an entry type rippling into shared/verify, the verifier CLI, and `VERIFY.md`; today neither is durably recorded, and ADR-0004 says skipped acquisitions are evidence-bearing. Ruling needed before the branch starts (see cross-ticket risks).
12. **#403 - selector-hit events:** `selector_matches` has no timestamp, so hit events cannot be dated as designed. (a) ship v1 with capture+note events only (recommended - avoids a fourth migration), (b) approximate with the capture's `created_at` (wrong for backfilled matches), or (c) add `matched_at` via migration v31?
13. **#622 - verifier CLI shape: RULED 2026-08-20.** Only enrich the reason text on the existing section 7.5 coverage failure. No new check, no `warn` status, no change to `PackageVerifyResult`. Softening an existing FAIL would change an evidentiary verdict, so the Diagnostics panel carries the surfacing work and the CLI keeps its current verdict shape.

## Per-ticket reader notes

### #387 - feat(extension): popup case select and ignore-list pre-filter

Rebuild the extension popup to the prototype's minimal layout: a "Logging to" case-name dropdown (menu titled "Set active case") over the one global active case, with a menu footnote saying switching here switches the app too; the no-case state becomes a single-row `Select a case...` in-place select (no link-out). Case binding stays pure global - per-tab binding was explicitly withdrawn in the prototype's session 5. Additionally, the popup's manual Capture path must pre-check the ignore list client-side (matching the context-menu path, which already runs DEFAULT_IGNORE + isIgnoredByUser before manualCaptureTab) instead of relying solely on the server 403; the server stays authoritative. The plumbing largely exists: /api/cases/:id/activate -> `sessionService.activateCase` -> event:sessionStateChanged -> useServerStatus already makes the app follow the switch, and /api/status already delivers settings.ignoredUrlPatterns to the extension on a `30s` alarm poll - so this is a popup UI rebuild plus closing the one documented pre-filter gap (background.ts:532-537 names the popup MANUAL_CAPTURE route as the only one where the server 403 is sole enforcement).

**Acceptance criteria.**
- Popup shows and sets the global active Case; app reflects the switch
- No-case state uses the single-row in-place select per the prototype
- Popup manual capture of an ignored URL is blocked client-side with immediate feedback; server enforcement unchanged
- Popup layout matches the prototype (bare status dot with tooltip, quiet match-summary line, right-click hint, footer gear)
- Extension unit tests cover the pre-filter and case-switch state handling
- Lint, typecheck, tests, extension build green

**Prototype references.**
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/09-browser-sim-extension-popup.png` - connected popup: logo+name header with bare 7px status dot (title tooltip), LOGGING TO label + case-name dropdown, 'Switch in app' accent link, page-status block ('Captured 4 min ago' / 'MHTML · sha256 verified · index #36'), quiet 'No selectors matched this page.' line, faint right-click hint, Stop session + Capture now (28px/4px), footer 'Open in Birdbrain' + gear + version
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/10-browser-sim-options-page.png` - demos the DEFAULT_IGNORE popup state on a chrome-extension:// page ('This page can't be captured / chrome-extension:// pages are always ignored', no Capture button); the options page itself is stage 5, out of scope for #387
- `Birdbrain.dc.html` lines ~3423-3520 - pixel truth for popup markup: header, 'Logging to' dropdown + 'Set active case' menu (228px, 6px radius, --color-card `bg`, shadow-overlay, footnote 'One active case - switching here switches the Birdbrain app too.'), no-case single-row select (28px, canvas fill, border-strong) + lock-icon privacy note card, disconnected state ('Birdbrain isn't running' + Retry connection), footer bar
- `Birdbrain.dc.html` lines ~7026-7115 - popup state derivation: pillLabel/pillDot (Offline #94a3b8 / No case #f59e0b / Recording #ef4444), pageStatusText/Sub variants, `matchSummary` format ('N selectors matched · M hits on this page' / 'No selectors matched this page.' / 'Selectors don't run on extension pages.'), showCaptureBtn gated on `capturable`, `sessBtn` styling
- `HANDOFF.md` sessions 4-7 - popup minimalization rationale, session-5 per-tab withdrawal ('pure global `extCase`'), session-7 'Extension popup case select' follow-up replacing the no-case link-out with the single-row select
- `README.md` 'Browser sim (extension surfaces)' Popup bullet + State Management `extCase` entry - semantics specification
- `IMPLEMENTATION_GUIDE.md` Stage 1 items 2-3 (popup case select, popup ignore-list pre-filter); `ENGINEERING_REVIEW.md` item 1 (withdrawn per-tab binding) and item 5 (pre-filter, sized small)
- `MOTION.md` 'Overlays' - the case menu uses the `.pop` entrance: scaleY(.92)->1 + fade, `130ms`, transform-origin top

**Files.**
- `extension/src/popup/popup.tsx` (modify) - Full rebuild to prototype layout: replaces Header/StatusCard/StatsGrid/CaseSelector(native select)/Footer with header (logo, name, bare status dot with title tooltip), connected 'Logging to' dropdown + 'Set active case' menu with footnote + 'Switch in app' link (birdbrain://open exists), page-status block, quiet match-summary line, right-click hint, Stop session/Capture now buttons, no-case single-row select + privacy note, disconnected state, footer (Open in Birdbrain / gear / manifest version). Pre-filter feedback: derive current-tab capturability, hide Capture and show 'This page can't be captured' state when ignored. `handleActivateCase/getCases/getStatus` already exist and stay
- `extension/src/background.ts` (modify) - Add the DEFAULT_IGNORE + isIgnoredByUser pre-check to the MANUAL_CAPTURE message handler (mirroring the context-menu path at lines 510-511) and `sendResponse` a blocked result ({blocked, pattern}) for popup feedback; rewrite the now-stale comment at lines 532-537 documenting the popup gap. Extend GET_STATE (or add a small message) so the popup can evaluate the current tab: expose userIgnoredPatterns or an isUrlIgnored answer, plus a per-tab selector-match cache (checkSelectorsOnTab discards match details after the badge update) for the 'N selectors matched · M hits' summary line. Keep all pattern-source reads behind isIgnoredByUser() - that is the #400 seam
- `extension/src/popup/popup.css` (modify) - Add the .pop menu entrance (scaleY(.92)->1 + fade, `130ms`) and status-dot pulse `keyframes`; token block already mirrors `globals.css` (light accent #5659f0 / dark #6467f2) so no token changes expected
- `src/shared/urlPatterns.ts` (modify) - Comment-only: the matchIgnoredUrl doc comment names 'the popup's Capture button' as the one live route with no pre-filter - update once the gap closes. No behavior change
- `tests/extension/popupPrefilter.test.ts` (create) - Background-side pre-filter tests using the existing `tests/extension` seam (mocked chrome global + vi.mock('@extension/utils/api')): MANUAL_CAPTURE of a DEFAULT_IGNORE URL and of a user-pattern URL never reaches sendMhtmlCapture and responds blocked with the matched pattern; a clean URL still captures; server-403 error path copy unchanged
- `tests/components/extension/popupCaseSelect.test.tsx` (create) - Popup component tests (must live under `tests/components/` - the jsdom vitest project's only .tsx include glob; a `tests/extension/*.test.tsx` would run in no project): case list renders from `getCases`, picking calls `activateCase` and updates the header, no-case state renders the single-row select, ignored-page state hides Capture and shows the can't-capture copy
- `extension/src/utils/api.ts` (modify) - Likely unchanged (`getStatus/getCases/activateCase/stopSession` all exist); touch only if the popup needs a helper it lacks. Listed so the reviewer checks nothing new was needed

**Migration.** None.

**IPC changes.** none - `extension/app` traffic is HTTP against the Hono capture server, not IPC; /api/status, /api/cases, /api/cases/:id/activate and event:sessionStateChanged already exist and are sufficient

**Archive impact.** none

**Evidence impact.** n/a - #387 is not flagged evidence-affecting. The client-side pre-filter only suppresses requests the server would 403; /api/captures enforcement (matchIgnoredUrl via safeRegexTest) and the ingest pipeline are untouched, so stored evidence, hashes and manifests are unaffected. The PR should still note one asymmetry (already pinned in `tests/shared/urlPatterns.test.ts`): the extension's platform RegExp has no timeout budget, so a catastrophically backtracking pattern that the server's `200ms` `vm` budget fails open on is now blocked client-side on the popup route too - strictly more conservative, never less.

**Tests.**
- `tests/extension/popupPrefilter.test.ts` (new; node vitest project, web `tsconfig` flavour like the rest of `tests/extension`) - MANUAL_CAPTURE pre-filter for DEFAULT_IGNORE and user patterns, blocked response shape, clean-URL passthrough
- `tests/components/extension/popupCaseSelect.test.tsx` (new; jsdom vitest project - .tsx under `tests/components` is the only glob that runs it; also lands in the web typecheck project) - case-switch state handling, no-case single-row select, ignored-page Capture suppression
- `tests/extension/manualCaptureConcurrency.test.ts` (existing) - reuse its chrome-mock seam; verify the added pre-check does not disturb the suppression-boundary assertions
- `tests/shared/urlPatterns.test.ts` (existing) - the pinned popup-gap known-answer comment may need its prose updated; semantics unchanged
- Definition-of-done fold-in: popup is a fixed 320px surface with its own token block (no --d-* density), so the density-steps requirement applies only to app screens; pixel-match against `Birdbrain.dc.html` lines 3423-3520, tokens only (raw colors allowed solely for status dot/session-button per the status-color exception), Escape closes the case menu, menu uses .pop `130ms` motion

**Conflicts with other wave-1 tickets.**
- `extension/src/background.ts` - #400's 'extension mirror' lands exactly where #387 works: userIgnoredPatterns / isIgnoredByUser() / the checkStatus() status-payload read. #387 must route every pattern lookup (including the new MANUAL_CAPTURE pre-check and anything exposed to the popup) through isIgnoredByUser() so #400's per-case source swap is a one-function delta. Do not let the popup fetch and match patterns itself
- `src/shared/schemas.ts` (CaptureServerStatus) - #400 will likely extend or re-scope ignoredUrlPatterns in the status payload; #387 must not touch this type
- `src/main/services/captureServer.ts` - #400 changes /api/status and the /api/captures 403 path for per-case exclusions; #387 makes no server change at all (that is the boundary: #387 owns the popup, server stays as-is)

**Risks.**
- MV3 service-worker eviction wipes background memory: a per-tab match cache or last-capture record dies on suspension, so the popup must degrade to neutral copy (or re-run CHECK_SELECTORS on open) rather than assume the cache exists
- Ignore-pattern freshness: background polls /api/status on a `30s` alarm (MV3 minimum), so a just-edited Settings pattern can lag the pre-filter by up to `30s`; the popup's own getStatus() on open narrows this, and the server 403 remains the backstop either way
- Regular expression evaluation in the pre-filter uses platform RegExp with no timeout (service worker has no `vm` sandbox) - a runaway user pattern stalls the extension side only; this is the existing documented trade-off in `background.ts`, not new exposure, but the popup path now inherits it
- The popup's 'Switch in app' link and app-follow behavior ride on useServerStatus's auto-navigate on sessionStateChanged; switching cases from the popup will also navigate the app to that case - matches the AC ('app reflects the switch') but worth confirming in the E2E-ish manual pass
- Coverage gate: vitest coverage excludes `extension/**`, so `scripts/diff-coverage.mjs` has no data for the popup/background lines - run pnpm test:coverage && pnpm coverage:diff anyway to confirm the changed `src/shared` comment lines do not trip the gate

**Open questions.**
- Page-status line data source (CONSTRAINT): the prototype shows 'Captured 4 min ago · MHTML · sha256 verified · index #36' for the current page, but nothing extension-side retains per-URL capture results (CaptureUploadResult returns `captureId/manifestIndex/hash` and is dropped; MV3 restarts lose any cache) and no server endpoint answers 'was this URL captured'. Which page-status states should wave 1 ship - only the ones with real data (capturing / captured-just-now-in-this-popup-session / not captured yet / can't be captured), or is a server lookup in scope?
- Footer gear target: the prototype's gear opens the extension options page, which is net-new and deferred to stage 5 (not in wave 1). Keep the gear on the existing birdbrain://settings deep link until the options page exists?
- Session button: the prototype's connected state always shows 'Stop session'; the current popup hides Start and shows Stop only while a session is active (auto-capture HOTFIX). Confirm #387 keeps the HOTFIX semantics rather than reintroducing a session toggle

### #389 - feat(notes): Mention schema and references index

Add a typed Mention inline node (`targetType` in {capture, selector, tag, note} + `targetId`, label as display cache) to the shared note-document schema, and have main extract mentions - synchronously, inside the same transaction as every note-body write - into a new normalized `note_references` index answering both directions (outgoing refs per note, backlinks per target, case-scoped). Cross-case references are rejected; deleted targets stay representable as broken. Case Archives carry Mentions inside `body_doc` only (the index is derived and re-extracted on import after id remap), and CASE_ARCHIVE_SCHEMA_VERSION bumps 2->3 so older releases refuse newer archives cleanly. Read IPC exposes references, backlinks, and (for #402) aggregate backlink counts. The scope is backend only: UI consumers #390/#392/#402 land later, so the schema and queries must serve them without them existing yet. The spike verdict (`docs/specs/2026-08-18-references-index-spike.md`) is the design input and its 10 constraints are an acceptance criterion.

**Acceptance criteria.**
- Mention node accepted by the shared note-document schema; docs without Mentions unaffected; plain-text derivation renders Mentions readably for search
- References index updated in the same transaction as the note write; no renderer-side extraction
- Cross-case references rejected; deleted targets surface as broken, never silently removed
- Case Archive export/import carries Mentions with id remapping intact; older-version refusal is clean and worded
- Backlinks and reference queries exposed over typed IPC, case-scoped
- Spike verdict constraints (#388) honored (all 10, restated in the issue's first comment)
- Lint, typecheck, tests, build green

**Prototype references.**
- `docs/specs/2026-08-18-references-index-spike.md` - THE design input: verdict (extract at save time, sync, main process, in-transaction; p50 0.7 ms) plus the 10 numbered constraints (`attr` validation in parseNoteDoc, extract from the validated PM tree, no case check recommended for tags, batched `json_each` membership check, no FK to targets, PK (`note_id`, ord), index is derived/never travels, plain-text write clears index, aggregate count query for #402, self-mention allowed)
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/05-notes-editor-mentions.png` - mention chips inline in the editor (@capture chip, #selector and #tag chips) and the context rail's LINKS OUT (outgoing refs with target-type labels) and LINKED MENTIONS (backlinks with snippets): the exact read shapes the new IPC queries must serve for #390/#392
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/02-case-overview-backlink-map.png` - wave-2 consumer boundary (#402): LINK MAP '10 nodes · 2 backlinks' over note/capture/selector/tag node types; needs the whole-case aggregate backlink-count query (spike constraint 9), not per-target queries; quick-notes panel shows the raw token grammar `@[capture|...]`, `#[sel|...]`, `#[tag|...]`, `@[note|...]`
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/README.md` 'Notes' section - mention grammar (@ entities, # tags), token syntax masked in list snippets, chips clickable per target type (wave-2 behavior the identity model must support: navigate by (`targetType`, `targetId`), never by reparsed label)
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/IMPLEMENTATION_GUIDE.md` Stage 2 - references index named the load-bearing data structure gating stages 3-4
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/ENGINEERING_REVIEW.md` item 6 - mentions+backlinks as the data-model-first item whose verdict gates features 7-8

**Files.**
- `src/shared/noteDoc.ts` (modify) - Add the Mention inline node to noteExtensions() (`attrs`: `targetType`, `targetId`, label; inline group; `renderText` so noteDocToText emits '@<label>' for FTS). Extend parseNoteDoc with the explicit `attr` validator (spike constraint 1: `targetType` `enum`, `targetId` non-empty string) since PM check() passes null `attrs`. Export an extraction seam that walks the VALIDATED PM tree (constraint 2) - likely have parseNoteDoc also return (or cache) the checked Node so extraction cannot see a node check() rejected. Module must stay React-free (main imports it).
- `src/shared/types.ts` (modify) - New domain types: MentionTargetType, NoteReference (`noteId`, ord, `targetType`, `targetId`, resolved/broken status, label), Backlink shape for per-target queries.
- `src/shared/ipc.ts` (modify) - New channels in IPC_CHANNELS + IpcInvokeContract: 'notes:references' (outgoing refs of a note with resolve status), 'notes:backlinks' (case-scoped backlinks for a (`targetType`, `targetId`)), 'notes:backlinkCounts' (whole-case aggregate map for #402, spike constraint 9).
- `src/shared/birdbrainApi.ts` (modify) - notes.references / notes.backlinks / notes.backlinkCounts method signatures on BirdbrainAPI.
- `src/preload/index.ts` (modify) - Three bridge() additions under the notes group (bridge is generic; signatures flow from IpcInvokeContract).
- `src/main/ipcHandlers.ts` (modify) - Register the three read handlers; extend the existing rethrowAnchorCaseMismatch pattern so a cross-case Mention rejection surfaces as a coded IpcFailure (for example MENTION_CASE_MISMATCH) on notes:create/notes:update, mirroring ANCHOR_CASE_MISMATCH.
- `src/main/services/db/noteReferenceRepo.ts` (create) - New per-domain repository owning the index SQL: rewrite-for-note (delete+insert, called inside the note-write transaction), batched per-type case-membership check (WHERE id IN (SELECT value FROM `json_each(`?)), constraint 4), referencesForNote with read-time resolve status (CASE `target_type` WHEN branches selecting 1, constraint 5), backlinksForTarget (GROUP BY `note_id`, constraint 6), backlinkCountsForCase, and rebuildForCase (repair/import path, constraint 7).
- `src/main/services/db/noteRepo.ts` (modify) - Wrap createNote/updateNote in `withTransaction`; on any `body_doc` write, extract from the validated tree and rewrite the index; a plain-text body-only write clears the index with `body_doc` in the same transaction (constraint 8). importNoteRows: remap Mention `targetId` `attrs` inside `body_doc` before insert - `ctx.mapId` for capture/selector/note targets, `ctx.mapTag` for tag targets (tags merge by name, not by ID_PROBE remap) - the same way `resolveAnchor` remaps anchors, then re-extract; index rows never travel.
- `src/main/services/db/migrations.ts` (modify) - Append v28 block: CREATE TABLE `note_references` (`note_id` TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, ord INTEGER NOT NULL, `target_type` TEXT NOT NULL, `target_id` TEXT NOT NULL, PRIMARY KEY (`note_id`, ord)); CREATE INDEX `idx_note_references_target` ON `note_references(target_type`, `target_id`). Backfill is provably empty (pre-v28 parseNoteDoc rejected unknown node types, so no stored doc can contain a Mention) - create-only is defensible; say so in the block comment.
- `src/main/services/db/core.ts` (modify) - LATEST_SCHEMA_VERSION 27 -> 28. `note_references` does NOT join ID_PROBE_TABLES (composite PK, no standalone id column).
- `src/main/services/caseArchive.ts` (modify) - CASE_ARCHIVE_SCHEMA_VERSION 2 -> 3 with a comment in the established style: a pre-v28 Birdbrain's parseNoteDoc rejects the Mention node, so importing any mention-bearing archive would fail mid-transaction with a schema error; the existing `schemaVersion` > gate turns that into the clean 'update Birdbrain' refusal. CaseArchiveData shape unchanged (index is derived, never travels).
- `src/main/services/db/dbAdmin.ts` (modify) - Scope pending open question 2: extend the notes guard in `validatedRow` to `body_doc` writes (parse via parseNoteDoc, derive body, rewrite the references index) so the administrator escape hatch - the fourth write path - cannot desync the index; today it guards only `anchor_json/anchor_kind` and already leaves `body/body_doc` drift possible (pre-existing gap worth filing regardless).
- `tests/shared/noteDoc.test.ts` (modify) - Mention node accepted; docs without Mentions unaffected (the 4 real v27 bodies validated unchanged in the spike); `attr` validator rejects missing/bogus `targetType` and non-string/empty `targetId`; block-level Mention rejected by check(); text derivation renders '@<label>'.
- `tests/main/services/noteReferences.test.ts` (create) - New node-flavour suite: index written in the same transaction (rejected save leaves prior index intact); cross-case capture/selector/note rejected, dangling target accepted and resolves broken; tag targets per the recorded ruling; plain-text write clears index; `deleteNote` cascades refs; deleting a target keeps the referrer's row and resolves broken; backlinks/references/counts query shapes; duplicate mentions preserve ord.
- `tests/main/services/caseArchiveRoundTrip.test.ts` (modify) - Mentions round-trip: export -> import with forced id collisions -> `targetIds` remapped (including a tag merged by case-insensitive name via `mapTag`) and re-extracted index matches; a mention of a note later in the same batch imports as dangling-then-resolved.
- `tests/main/services/caseArchive.test.ts` (modify) - Version-gate: `schemaVersion` 3 archive refused by a reader capped at 2 with the worded message; header `schemaVersion` now 3 (tests already read the constant, so most flow through).
- `src/renderer/lib/api/notes.ts` (modify) - Optional in #389: query options for references/backlinks/backlinkCounts (plus `keys.ts` entries). Defensible to defer to consumers #390/#392/#402 - decide in the PR and say which.

**Migration.** v28 (current LATEST_SCHEMA_VERSION is 27): CREATE TABLE `note_references` (`note_id` TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, ord INTEGER NOT NULL, `target_type` TEXT NOT NULL, `target_id` TEXT NOT NULL, PRIMARY KEY (`note_id`, ord)); CREATE INDEX `idx_note_references_target` ON `note_references(target_type`, `target_id`); `user_version` = 28. No FK to target tables (broken refs must stay representable, spike constraint 5). Backfill from `body_doc` is provably a no-op (pre-v28 parseNoteDoc rejected unknown node types) so the block can create-only, but the rebuildForCase helper must exist for the import/repair path (full re-extraction measured at 345 ms / 5k notes).

**IPC changes.** Three new read channels under the notes domain in `src/shared/ipc.ts`: 'notes:references' (`args`: `noteId` -> NoteReference[] with per-ref resolve status), 'notes:backlinks' (`args`: `caseId` + `targetType` + `targetId` -> backlink rows grouped by note), 'notes:backlinkCounts' (`args`: `caseId` -> aggregate count map, the shape spike constraint 9 mandates for #402's map). Plus contract entries, `birdbrainApi.ts` signatures, and preload bridges. No new write channels: notes:create/notes:update gain a new coded IpcFailure (MENTION_CASE_MISMATCH-style) for cross-case mention rejection, mirroring the existing ANCHOR_CASE_MISMATCH translation in `ipcHandlers.ts`.

**Archive impact.** CASE_ARCHIVE_SCHEMA_VERSION bumps 2 -> 3 (maintainer ruling 2026-08-19). Mentions travel only inside note rows' `body_doc` in `data.json` - the `note_references` table never travels (derived, spike constraint 7), so CaseArchiveData and counts are unchanged in shape. On import, importNoteRows must rewrite Mention `targetId` `attrs` BEFORE parse/store: `ctx.mapId` for capture/selector/note targets (collision remap), `ctx.mapTag` for tag targets (tags merge by case-insensitive name, so `mapId` never covers them), then re-extract the index - checking case membership against the REMAPPED ids, same as `resolveAnchor` does today. Insert order already places notes last, so membership checks see imported captures/selectors; a mention of a note later in the same batch is accepted as dangling and resolves after insert (read-time resolve status). Older releases (v2 readers) refuse a v3 archive via the existing 'created by a newer version of Birdbrain' gate in inspectCaseArchive - without the bump they would instead fail mid-import on an unknown node type with an opaque schema error. parseNoteDoc's new `attr` validation is inherited by import (constraint 1): a malformed Mention fails the whole one-transaction import rather than half-landing.

**Evidence impact.** What changes on the evidence path: the chain-verified .birdbrain archive's `data.json` content (`body_doc` may carry Mention nodes), the archive schema version (2->3), import-time id remapping now extending into note bodies, and stricter import validation. Untouched: manifest format and chain, signing, hashing, capture artifacts, `packageHash` recipe, `export.ts` evidence packages, and the standalone verifier. The PR's Evidence impact section must state: (1) the archive schema bump and its rationale - older Birdbrains refuse v3 cleanly instead of failing opaquely on an unknown node; (2) that the references index is derived and never travels, so no new bytes need chain coverage - the mentions themselves ride in `body_doc`, already inside the `packageHash-committed` `data.json`; (3) id-remap behavior for mention targets including the tag merge-by-name path, and that membership is checked against remapped ids; (4) that a malformed Mention fails the whole import transaction (fail-closed, no half-import); (5) known-answer round-trip coverage (export -> collide -> import -> identical resolved references); (6) ADR-0004 gate answers - the claim supported is 'analyst cross-references survive archive transfer intact', which proves nothing about captured content; custody effects: archive-export/import manifest entries unchanged in shape. Process obligations per the issue's triage comment mirroring #400: evidence-affecting label on the PR, human review, never auto-merge (ADR-0005), and the unattended-agent gate battery including pnpm test:coverage + coverage:diff.

**Tests.**
- `tests/shared/noteDoc.test.ts` (node flavour) - Mention schema acceptance, `attr-validator` rejections, block-level rejection, '@<label>' text derivation, no-mention docs unaffected
- `tests/main/services/noteReferences.test.ts` (create, node flavour) - transactional index rewrite + rollback, cross-case rejection per target type, dangling-accepted/broken-on-read, plain-text write clears index, delete cascade, ord/duplicate preservation, backlinks/references/counts queries
- `tests/main/services/caseArchiveRoundTrip.test.ts` - mention round-trip with forced id collisions incl. tag merge-by-name remap and post-import re-extraction
- `tests/main/services/caseArchive.test.ts` - v3 header written, newer-version refusal wording
- `tests/main/services/database.test.ts` - may need the v28 table in schema assertions (reads LATEST_SCHEMA_VERSION already)
- `tests/main/services/noteRichText.test.ts` - existing write-path suite; touch if create/update transaction wrapping shifts error surfaces
- All named suites are main/shared code -> `tsconfig.test.node.json` (no DOM lib); no .tsx, so no web-project involvement

**Conflicts with other wave-1 tickets.**
- `src/main/services/db/migrations.ts` - #395 (selector origin column) and #400 (auto-capture exclusions) both append a migration block; all three want v28, so landing order forces renumbering + LATEST_SCHEMA_VERSION rebases
- `src/main/services/db/core.ts` - LATEST_SCHEMA_VERSION bump collides with #395 and #400
- `src/main/services/caseArchive.ts` - #395 likely bumps CASE_ARCHIVE_SCHEMA_VERSION too (selector origin travels in archived selector rows; an older import would silently drop it), and #400 may if exclusions travel; two tickets bumping 2->3 independently is a semantic conflict, not just textual
- `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/birdbrainApi.ts`, `src/shared/types.ts` - #403 adds its recent-activity channel and #400 adds exclusion channels in the same files (append-only, low-risk textual conflicts)
- `src/main/ipcHandlers.ts` - #400 and #403 register handlers in the same file

**Risks.**
- Tag remap subtlety: tag mention `targetIds` must go through `ctx.mapTag` (merge-by-name), not `ctx.mapId` - a miss produces plausible-looking references pointing at pre-merge tag ids that silently resolve broken; the round-trip test must force this case
- parseNoteDoc tightening is retroactive on import: any archive whose `body_doc` contains a Mention with bad `attrs` fails the entire import transaction - correct per design (fail-closed) but the error message should name the note, or triage of a refused archive is miserable
- Database Admin escape hatch: `validatedRow` guards `anchor_json` but not `body_doc`, so an operator `body_doc` edit already desyncs body and would now also desync the index - pre-existing gap that becomes evidence-adjacent; file it as its own issue if kept out of scope (per repository defect-filing rule)
- Three evidence-affecting wave-1 tickets (#389, #395, #400) contend for the strict-serial agent-PR slot (ADR-0005) and for the same migration number - coordination cost is real
- FTS text change: mention labels enter `notes_fts` via the derived body on next save only; old notes are unaffected (no mentions can exist pre-v28), so no FTS rebuild - but reviewers may ask, so say it in the PR
- extraction seam design: parseNoteDoc discards the checked PM Node; returning it (or a second export) changes a shared-module signature that `noteRepo`, `dbAdmin`, and archive import all sit on - keep the change additive so #390's renderer editor work doesn't collide
- Definition-of-done pixel criteria do not apply (no UI ships here), but the schema must not foreclose the prototype's read shapes: per-type badges and snippets in the rail (05) and the 20-node aggregate map (02) are both served by the three queries listed earlier

**Open questions.**
- Spike constraint 3 (tag scoping) is still marked 'Maintainer to confirm' on the issue: recommendation is to accept any tag id with NO case-membership check (tags are global; the alternative - 'attached to >=1 capture in this case' - makes ordinary tag removal invalidate a previously valid Mention on next save). The choice must be recorded on the ticket before implementation.
- Should #389 extend the Database Admin notes guard (`dbAdmin.validatedRow`) to `body_doc` writes - deriving body and rewriting the references index - or file that as a separate defect? Today an operator `body_doc` edit bypasses body derivation entirely (pre-existing), and post-#389 it would also leave the index stale.
- Does 'exposed over typed IPC' include the renderer query layer (`src/renderer/lib/api/notes.ts` + `keys.ts` query options), or is that deferred to the first consumers (#390/#392/#402)? A backend-only scope is defensible; the PR should state the boundary either way.

### #395 - feat(selectors): record selector origin

Add an origin field to the Selector model recording where each selector came from, carried end-to-end: SQLite column via migration, Selector type, all creation paths (renderer IPC `create/bulkCreate`, the capture-server POST /api/selectors route used by the extension, NewCaseWizard presets), and Case Archive round-trip. Existing rows map to a defined legacy/manual origin. The prototype vocabulary is 'extension' | 'capture' | 'note' | 'manual'; the notes selection flow will set 'note' later - this ticket only makes the field exist and be visible. Origin must surface where an Operator can see it: in the current app that is the SelectorTableRow expanded row detail (the prototype renders it as a small bordered pill with a per-origin icon in the Signals detail panel).

**Acceptance criteria.**
- Migration adds origin with a sane default; existing Selectors readable unchanged
- All creation paths accept and persist origin; archives round-trip it
- Origin visible somewhere an Operator can see it (row detail or tooltip)
- Lint, typecheck, tests, build green

**Prototype references.**
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/Birdbrain.dc.html` lines 1995-1999 - pixel truth for the origin pill: rendered in the Signals right detail panel on the meta row next to the match-count label; pill is border 1px var(--color-border), `bg` var(--color-canvas), radius 9999px, padding 1px 8px, 10px text in var(--color-text-faint), with a 10px stroke icon; hidden entirely when the row has no origin (curSigHasOrigin gate)
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/Birdbrain.dc.html` lines 5778-5780 - label/icon maps: extension='Added from the extension'/#i-puzzle, capture='Added from a capture'/#i-camera, note='Added from a note'/#i-note, manual='Added by hand'/#i-pencil
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/Birdbrain.dc.html` lines 5758, 5075, 6886 - origin assignment in prototype flows: manual add-input -> 'manual'; selection->selector -> 'extension'|'note'|'capture' by scope; mention-create in notes -> 'note'
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/14-signals-match-mode-drawer.png` - Signals screen layout with right detail panel (Phone numbers signal); note the detail panel shows no origin pill for a seeded/origin-less row, confirming legacy rows show nothing rather than a fake origin
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/HANDOFF.md` line 259 and `README.md` line 136 - selectors created from notes carry origin: 'note' (future flow, not this ticket)
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/IMPLEMENTATION_GUIDE.md` line 49 - 'Add origin: note to the selector schema while building this' (mention/index stage gates on the field existing)

**Files.**
- `src/main/services/db/migrations.ts` (modify) - Append version-28 block: ALTER TABLE selectors ADD COLUMN origin TEXT (nullable; NULL = legacy). Current tail is version 27 (note anchors).
- `src/main/services/db/core.ts` (modify) - Bump LATEST_SCHEMA_VERSION 27 -> 28 (line 6).
- `src/shared/types.ts` (modify) - Add SelectorOrigin union ('manual' | 'capture' | 'note' | 'extension') and optional origin field on Selector (interface at line 579; absent = legacy row).
- `src/shared/ipc.ts` (modify) - Add optional origin to CreateSelectorParams (line 308) and to the per-entry shape in BulkCreateSelectorsParams (line 373). No new channels.
- `src/main/services/db/selectorRepo.ts` (modify) - INSERT column in `createSelector` (line 26) and bulkCreateSelectors (line 37); map origin in rowToSelector (line 279); importSelectorRows (line 310) adds s.origin ?? null so legacy archives import unchanged. collectSelectorsForCase is SELECT * so export picks the column up automatically. Validate origin against the union at the write boundary.
- `src/main/services/selectorLifecycle.ts` (modify) - bulkCreateSelectors mapping (line 102) explicitly lists fields - add origin so it is not dropped; `createSelector` passes `params` through untouched.
- `src/main/services/captureServer.ts` (modify) - POST /api/selectors handler (line 459) sets origin: 'extension' server-side - no wire-schema change to SelectorCreateSchema, no extension code change.
- `src/renderer/components/selectors/CreateSelectorCard.tsx` (modify) - `createSelector` call at line 50 passes origin: 'manual'.
- `src/renderer/components/selectors/BulkAddSelectorsModal.tsx` (modify) - `bulkCreate.mutateAsync` at line 100 tags each entry origin: 'manual'.
- `src/renderer/components/selectors/CreateSelectorPopover.tsx` (modify) - Generic popover used by DataExplorer; accept an origin prop (or default) so its create call persists origin.
- `src/renderer/components/dashboard/cases/DataExplorer.tsx` (modify) - Pass origin into CreateSelectorPopover at line 156 - selector minted from an extracted-data value; suggest 'capture' (value came from a capture), pending ruling in `open_questions`.
- `src/renderer/components/dashboard/cases/NewCaseWizard.tsx` (modify) - Preset-selector `createSelector` call at line 74 passes origin: 'manual'.
- `src/renderer/components/selectors/SelectorTableRow.tsx` (modify) - Render the origin pill in the expanded row-detail panel (the isExpanded <tr> starting ~line 178), matching the prototype pill: semantic tokens only (border-border, `bg-canvas`, text-text-faint), lucide icons per origin (Puzzle/Camera/StickyNote/Pencil analogues of #i-puzzle/#i-camera/#i-note/#i-pencil), hidden when origin is absent.
- `tests/main/services/database.test.ts` (modify) - Selector repository coverage lives here (`createSelector` imported at line 31): assert origin persists on `create/bulkCreate` and that a row inserted without origin reads back as legacy/undefined.
- `tests/main/services/selectorLifecycle.test.ts` (modify) - Assert bulkCreateSelectors threads origin through its explicit field mapping.
- `tests/main/services/captureServer.test.ts` (modify) - POST /api/selectors response selector carries origin 'extension'.
- `tests/main/services/caseArchiveRoundTrip.test.ts` (modify) - Round-trip a selector with origin set and one without; both survive import (origin preserved / absent respectively).
- `tests/components/SelectorTable.test.tsx` (modify) - Expanded row detail shows the origin label for an origin-bearing selector and nothing for a legacy one.

**Migration.** Current version: 27 (LATEST_SCHEMA_VERSION in `core.ts` line 6; tail block in `migrations.ts` is the note-anchors v27). Append:

if (version < 28) {
  db.transaction(() => {
    db.exec(`ALTER TABLE selectors ADD COLUMN origin TEXT`)
    `db.pragma('user_version` = 28')
  })()
}

Nullable, no backfill: NULL = legacy row, which matches the prototype (pill hidden when origin absent) and keeps existing selectors readable unchanged. Alternative if the maintainer prefers a defined value on every row: TEXT NOT NULL DEFAULT 'manual' - see `open_questions`. selectors table DDL is v3 (`migrations.ts` line 87); no index needed, origin is display-only.

**IPC changes.** No new channels. Extend existing payload types in `src/shared/ipc.ts`: CreateSelectorParams gains origin?: SelectorOrigin (used by selectors:create), and BulkCreateSelectorsParams entries gain origin? (`selectors:bulkCreate`). selectors:list/get/listActive responses carry the field automatically via the Selector type. Preload passes `params` objects through, so no preload edit.

**Archive impact.** Export: collectSelectorsForCase is SELECT *, so `data.json` selector rows gain origin with no `caseArchive.ts` change. Import: importSelectorRows in `selectorRepo.ts` lists columns explicitly and must add origin (s.origin ?? null); archives written before this change import with origin NULL (legacy), preserving readability. Archive verification hashes the package as exported, so no verifier or manifest-schema change; `data.json` has no Zod schema on import (JSON.parse cast in `caseArchive.ts` line 365). Extend `tests/main/services/caseArchiveRoundTrip.test.ts` both ways.

**Evidence impact.** Not flagged evidence-affecting in the wave roster, and it does not touch the capture manifest chain, hashing, or the verifier. The only evidence-path adjacency is the .birdbrain archive: exported `data.json` selector rows now carry an origin field, and legacy archives (field absent) import with origin unset. Suggested PR Evidence impact section: "Adds a display-only origin field to selector rows in archive `data.json`. No manifest, hash-chain, signature, or verifier change; pre-change archives verify and import unchanged (origin defaults to legacy/unset)."

**Tests.**
- `tests/main/services/database.test.ts` - repository persistence: origin on `create/bulkCreate`, legacy read-back (node `tsconfig` project)
- `tests/main/services/selectorLifecycle.test.ts` - origin survives the `bulkCreate` field mapping (node project)
- `tests/main/services/captureServer.test.ts` - POST /api/selectors mints origin 'extension' (node project)
- `tests/main/services/caseArchiveRoundTrip.test.ts` - origin round-trips; origin-less legacy archive imports clean (node project)
- `tests/components/SelectorTable.test.tsx` - origin pill renders in expanded row detail, hidden for legacy rows (web/jsdom project; .tsx lands there by the include split)
- `tests/components/CreateSelectorCard.test.tsx` - create call includes origin 'manual' (web project)

**Conflicts with other wave-1 tickets.**
- `src/main/services/db/migrations.ts` - #389 and #400 each append a migration block; version numbers must be renumbered by merge order
- `src/main/services/db/core.ts` - LATEST_SCHEMA_VERSION bump collides with #389 and #400
- `src/shared/types.ts` - #389 (Mention model) and #400 (exclusion types) also edit
- `src/shared/ipc.ts` - #389 adds channels and #400 extends payloads in the same file
- `src/main/services/captureServer.ts` - #400 edits the auto-capture path in this file; #395 edits the POST /api/selectors route (different handlers, same file - this is the named light overlap on the Signals ticket pair)
- `src/renderer/components/selectors/SelectorsOverview.tsx` - #400 adds the Auto-capture 'Never auto-capture' section on the Signals screen; #395 stays in `SelectorTableRow.tsx` but shares the screen, so keep row-detail changes out of SelectorsOverview to avoid textual conflict
- `tests/main/services/caseArchiveRoundTrip.test.ts` - #389 and #400 also extend round-trip assertions

**Risks.**
- Migration-number race: three wave-1 tickets (#389, #395, #400) append migrations; whoever merges later renumbers. Strict-serial agent WIP mitigates but branch prep should not hardcode 28 in prose or tests
- bulkCreateSelectors in `selectorLifecycle.ts` re-maps fields explicitly - forgetting the mapping silently drops origin while typecheck stays green (`params` type is a plain literal)
- importSelectorRows must default missing origin, or importing any pre-change archive throws on column count/NOT NULL depending on the DDL choice - pick nullable to keep this failure impossible
- UI definition of done: pill must use semantic tokens only and stay legible at all three density steps; the expanded row detail is inside the --d-row/--d-rowpad density system, so test at compact
- Prototype shows origin only in the right-hand Signals detail panel, which the current app does not have; #397/#400 do not build it either - the row-detail placement satisfies the AC ('row detail or tooltip') without inventing a panel
- The wire schema for the extension route (SelectorCreateSchema in `src/shared/schemas.ts`) must NOT accept origin from the client - server stamps 'extension'; letting the client assert origin would weaken the provenance claim the field exists to make

**Open questions.**
- Legacy mapping: nullable column with NULL = legacy (prototype-faithful: pill hidden for origin-less rows, screenshot 14 confirms) vs NOT NULL DEFAULT 'manual' (every row gets 'Added by hand', including rows that actually came from the extension pre-change - a false provenance claim). The issue's 'defined legacy/manual origin' wording supports either; recommend nullable, but this needs a maintainer ruling since it decides what old rows display forever
- What origin does a selector created from DataExplorer's CreateSelectorPopover get? The value comes from capture-derived extracted data, so 'capture' fits the prototype vocabulary, but the prototype only demos capture-viewer text selection for 'capture' - confirm, or fall back to 'manual'
- Should origin be user-visible-only or also join exports (getSelectorMatchesForExport CSV adds a column)? Ticket AC only requires visibility in row detail/tooltip; recommend leaving CSV untouched this ticket

### #396 - feat(captures): multiselect and floating action bar

Make the captures list consume the existing app-store multi-select state: a checkbox fades in on row hover and persists once anything is checked; plain click selects (details follow), `cmd-click` toggles, shift-click extends from an anchor, `cmd-A` selects the current filtered set, Escape clears, and selection survives filter changes and in-case navigation. Whenever the multi-set is non-empty an action bar appears with select-all + "N selected," Export / Tag / Favorite / Recapture / Delete, a divider, and X to clear. The bar drives the already-merged #394 batch backend (PR #638): `removeMany`, setFavoriteMany, addToCaptures, `enqueueCaptures`. Batch delete confirms the count and reports the prefix-commit result comprehensibly (deleted / `rolled_back` / `not_attempted` / rejected, retry via `failedIds`). Export opens the existing export flow case-scoped; the action is Favorite (existing favorites feature), never "Pin."

**Acceptance criteria.**
- All selection gestures work (hover checkbox, `cmd/shift/cmd-A`, Escape, anchor semantics); selection survives filters
- Floating bar matches the prototype (elevated surface, 28px buttons, rise animation) and drives the batch backend for Tag / Favorite / Recapture / Delete
- Batch delete confirms count and reports partial failure comprehensibly
- e2e covers select-act-clear round trip
- Lint, typecheck, tests, build green

**Prototype references.**
- `screenshots/13-captures-selection-bar.png` - session-8 pixel truth (recaptured at 6226x2330): the selection bar is INLINE at the top of the list column ('2 selected' + select-all checkbox left, five icon actions + divider + X right, accent-subtle background); multi-selected rows show accent rail + tint; note it is NOT a floating bottom-center pill
- `Birdbrain.dc.html` lines 1029-1058 (grep 'Selection actions') - exact bar markup: role=toolbar, animation `bbselbar` `150ms` var(--ease), background var(--color-accent-subtle), border-bottom var(--color-border), padding 5px 8px; select-all = 14px checkbox (2px radius) + 11px/600 tabular-nums 'N selected'; five 26x26 icon buttons (i-dl Export, i-tag Tag, i-pin 'Pin selection', i-refccw Recapture, i-trash Delete in #f87171), 16px x 1px divider var(--color-border-strong), 26x26 X 'Clear selection (Esc)'
- `HANDOFF.md` 'Multiselect' summary (~line 53) - gesture specification: hover checkbox sticky once checked, click selects + detail follows, `cmd` toggles, shift extends from anchor (row body or checkbox), select-all in bar, `cmd-A` = current filter, Escape clears, and selection survives filters and navigation
- `HANDOFF.md` Session 7 'Captures multiselect rework' (~line 413) - the floating bottom-center pill the ticket body describes (shadow-overlay, labeled actions, X/Esc); superseded by Session 8
- `HANDOFF.md` Session 8 'Selection toolbar' (~line 429) - the floating bar collided with the annotator toolbar and was replaced by the inline bar at the top of the list column (`bbselbar`); this is what the bundle landed on
- `HANDOFF.md` Session 3 comment fixes (~line 138) - selection rail removed for single selection (accent border + tint suffice); rail still shows for multi-select
- `MOTION.md` 'Overlays' - 'Inline selection bar (captures + notes lists, replaces the old floating toolbar): `bbselbar` - 4px drop-in + fade, `150ms`'; kill switches (prefers-reduced-motion, `html.bb-nomo`) must apply; no motion over `300ms`
- `MOTION.md` 'Micro-interactions' - capture rows (`.liftrow`) hover = tint overlay fade `120ms`, rows never move; the hover checkbox fade rides this hover state
- `style_sync_patch/SCREEN_NOTES.md` lines 78-83 - older footer-bar variant of the gesture notes (superseded on bar placement, gestures unchanged); line 71: selection bars 28px metric
- `IMPLEMENTATION_GUIDE.md` Stage 4 item 1 - sequencing: captures multiselect with the action bar, 'Confirm batch endpoints exist' (they do, #394 merged as PR #638)

**Files.**
- `src/renderer/stores/appStore.ts` (modify) - selectedCaptureIds: Set<string> plus toggleCaptureSelection / selectAllCaptures / clearCaptureSelection VERIFIED present (lines 8, 32-34, 68-81) but consumed nowhere except CaseWorkspace's case-switch clear. Add the shift anchor (for example selectionAnchorId: string | null) and a range-select action; selection already survives filter changes (nothing clears it) and in-case tab navigation (clear is keyed on `caseId` only, CaseWorkspace.tsx:22-27)
- `src/renderer/components/captures/CaptureList.tsx` (modify) - Wire modifier-aware row clicks (plain = `selectCapture` + details, `cmd` = toggle, shift = extend from anchor), hover-checkbox mode (persists while set non-empty), scoped `cmd-A` over `displayedCaptures` and Escape-to-clear, and mount the selection bar in the header area below the sort/filter row (prototype position). passes only `isSelected/onClick` to CaptureItem (lines 298-305)
- `src/renderer/components/captures/CaptureItem.tsx` (modify) - Add the fade-in hover checkbox (sticky once any row is checked), multi-selected visual state (accent rail + tint per session-3 note), and a modifier-aware click signature (today `onClick`: () => void, line 37)
- `src/renderer/components/captures/CaptureSelectionBar.tsx` (create) - New bar component per `Birdbrain.dc.html:1029` - select-all checkbox + tabular-nums count, Export / Tag / Favorite / Recapture / Delete, divider, X clear; `bbselbar-equivalent` entrance (`150ms` drop-in + fade, gated by useReduceMotion); consumes `removeMany/setFavoriteMany` (useCapturesMutations), addToCaptures (useTagsMutations), `enqueueCaptures` (useRecaptureMutations); Export opens the existing export dialog case-scoped (ExportDialog from components/export, today only opened via TopBar's ExportMenu)
- `src/renderer/components/captures/useCaptureSelection.ts` (create) - Optional but recommended: hook housing `anchor/range/cmd-A/Escape` gesture logic so CaptureList stays readable; testable in the web `tsconfig` project
- `src/renderer/routes/cases/$caseId/captures.tsx` (modify) - Batch delete confirmation dialog (confirm count, keep the existing 'Deleting is not redacting' manifest copy, then render the BatchDeleteResult: 'Deleted X of N', `rolled_back` stage, `not_attempted`, rejected shown-not-retried, retry button = `removeMany.mutate(failedIds`) per the brief's action-bar contract); reconcile selectedCaptureId when it was among `deletedIds` (existing single-delete logic lines 74-85)
- `src/renderer/components/captures/TagEditorPopover.tsx` (modify) - Likely reuse/extract for the bar's Tag action - a `tagId` must be picked before tags:addToCaptures; alternatively a small picker inside CaptureSelectionBar. Prototype shows only the icon button, no picker design
- `e2e/capture-multiselect.spec.ts` (create) - AC requires e2e select-act-clear round trip (select two rows, run a batch action, Escape/X clears, bar disappears). Existing captures coverage: `mhtml-capture.spec.ts` (capture write/verify), `capture-detail-panel.spec.ts` (details panel), `empty-captures-state.spec.ts`, `recapture.spec.ts` / `recapture-consent.spec.ts`, `annotation.spec.ts`, `screenshot-zoom-bar.spec.ts`, `density.spec.ts`
- `tests/renderer/stores/appStore.test.ts` (modify) - Extend for the new anchor/range actions and clear semantics
- `tests/components/CaptureSelectionBar.test.tsx` (create) - Web/jsdom project (.tsx lands there by include glob): count label, select-all tri-state, action wiring, partial-failure rendering
- `tests/components/CapturesRoute.test.tsx` (modify) - Existing route test - extend for bar visibility (non-empty set only, never on plain row click) and the batch-delete confirm/result dialog

**Migration.** None.

**IPC changes.** none - all four batch channels shipped with #394 (PR #638) and are live in `src/shared/ipc.ts`: `captures:deleteMany` (line 71/599, CaptureBatchPayload -> BatchDeleteResult), captures:setFavoriteMany (72/600), tags:addToCaptures (89/618), `recapture:enqueueCaptures` (77/607). Renderer hooks also merged: `useCapturesMutations(caseId).removeMany` + .setFavoriteMany (`src/renderer/lib/api/captures.ts:98-127`), `useTagsMutations(caseId).addToCaptures` (tags.ts:82), `useRecaptureMutations(caseId).enqueueCaptures` (recapture.ts:46). #396 adds no channels.

**Archive impact.** none - no schema, export, or import changes; case archive round-trip untouched

**Evidence impact.** n/a - not on the roster's evidence-affecting list. The UI drives the already-merged, already-reviewed #394 evidence path (`captures:deleteMany` writes ordinary deletion Manifest Entries, prefix-commit). The PR's Evidence impact section should state: no evidence-path code changed; the batch-delete UI consumes the #394 lifecycle as-is, and the confirm/result copy presents prefix-commit truthfully per `docs/specs/2026-08-19-batch-ops-interface-brief.md` ("Deleted X of N," `failedIds` retryable, rejected shown not retried, no atomicity claim).

**Tests.**
- `tests/renderer/stores/appStore.test.ts` - anchor/range/clear actions (node-flavour project)
- `tests/components/CaptureSelectionBar.test.tsx` - new, web-flavour project (all .tsx under `tests/` go there; jsdom Vitest project)
- `tests/components/CapturesRoute.test.tsx` - bar visibility + batch-delete confirm/partial-failure dialog
- `tests/renderer/lib/queries.test.ts` - already covers the #394 hooks (merged); no change expected
- `e2e/capture-multiselect.spec.ts` - new specification for the select-act-clear round trip (AC); `density.spec.ts` pattern available for the three-density legibility check
- Gates: pnpm lint, pnpm typecheck (six projects), BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test, pnpm build, plus pnpm test:coverage + pnpm coverage:diff (CI fails below 90% changed-line coverage)

**Conflicts with other wave-1 tickets.**
- `src/renderer/components/captures/CaptureList.tsx` - #397 (three-column rework) reworks the same list column; prep plan (`docs/plans/2026-08-19-redesign-ultracode-prep.md:36`) mandates strict sequence, #396 first, #397 wraps what #396 edited
- `src/renderer/components/captures/CaptureItem.tsx` - #397 restyles rows (clock icon + relative times, 12px titles, logo-silhouette thumbnails) on top of #396's checkbox/rail changes
- `src/renderer/routes/cases/$caseId/captures.tsx` - #397 replaces the fixed 380px/400px columns with resizable/collapsible ones; #396 touches the same file for the delete dialog wiring
- `src/renderer/stores/appStore.ts` - #396 adds the selection anchor; #397 may touch the same store around panelCollapsedForced/layout state
- No file overlap with #387, #389, #395, #400, #403, #563, or #622

**Risks.**
- Bundle divergence on the bar's very shape (see open question) - pixel-match sign-off is impossible until it is ruled; building the ticket-text floating pill contradicts screenshot 13, `MOTION.md`, and the prototype HTML
- The prototype's fourth action is titled 'Pin selection' with the pin glyph; the ticket rules Favorite, never Pin - implement against the existing favorites feature (setFavoriteMany, `captureFavorites` query keys) and pick a favorite/star glyph, not the prototype's pin
- Favorite on a mixed selection: setFavoriteMany takes an explicit boolean; decide set-true-unless-all-favorited (or similar) - neither ticket nor prototype specifies
- Tag action needs an interaction the prototype does not design: a `tagId` must be chosen before tags:addToCaptures (all-or-nothing, one `txn`)
- `cmd-A` and Escape are global keys: `cmd-A` must be scoped so it does not hijack text inputs (search box, note editors), and Escape ordering vs open menus/dialogs matters (useClickOutside menus, delete dialog already use it)
- Selection survives filters, so selectedCaptureIds can contain rows the current filter hides - define select-all checkbox tri-state and 'N selected' against the visible (`displayedCaptures`) vs total set; ticket says `cmd-A` selects the current filter
- Batch delete is prefix-commit: the mutation succeeds even on partial failure, so the result dialog must key off `outcomes/failedIds`, not `isError`; retry payload is `failedIds`, rejected ids are shown but never retried
- Batch recapture rides the existing main-side queue and consent handling (`src/main/services/recapture.ts`); verify the consent flow fires for `enqueueCaptures` fan-out (`recapture-consent.spec.ts` covers the single path)
- Definition of done: tokens only (bar = `bg-accent-subtle` / border / text tokens; delete red is a status-color exception), `bbselbar` motion gated by reduce-motion kill switches, legible at all three density steps (density shipped with #384, closed)
- AnimatePresence `popLayout` + stagger on the list may fight the checkbox fade-in and bar entrance; `MOTION.md` forbids stagger on filter/search changes

**Open questions.**
- Which bar does AC #2 score against? The ticket body and IMPLEMENTATION_GUIDE (both session-7 vintage) specify a floating bottom-center pill - elevated on shadow-overlay, 28px LABELED buttons, rise animation. Session 8 of the same bundle replaced it because it collided with the annotator toolbar: an INLINE, icon-only bar (26px buttons, tooltips) at the top of the list column with the `bbselbar` drop-in, and that is what screenshot 13, `MOTION.md` ('replaces the old floating toolbar'), and `Birdbrain.dc.html:1029` (the pixel truth) all show. The two are mutually exclusive; the AC phrase 'floating bar matches the prototype' cannot be satisfied as written. Constraint recorded - maintainer must rule which surface (and therefore labeled-28px vs icon-26px) is authoritative for #396.

### #397 - feat(captures): three-column layout rework (resizable columns, no Source tab, relative times)

Rework the Captures screen into the designed three-column layout: the capture list and details columns become drag-resizable (list 240-560px, default 316; details 320-680px, default 400, per the prototype's `startResize`) and each collapsible to a 40px icon rail with animated width; layout state persists sensibly. Viewer tabs become Screenshot / Page / Text / Wayback with the Source tab removed (Page IS the MHTML) - a settled session-5 design decision that deliberately reverses upstream's Wayback demotion. List rows get a clock icon + short relative time with the full timestamp on hover, 12px titles, and generated logo-silhouette thumbnails (masked `logo.png` at 20px/28% opacity on the tinted gradient). The details-panel collapse rail already exists (settings.detailsPanelCollapsed + viewport forcing below 1100px); this ticket adds resizing, the list-column rail, the tab change, and the row restyle. Blocked by #384 (closed/merged), sequenced after #396 in the same files.

**Acceptance criteria.**
- Columns resize within bounds with col-resize cursor and collapse to rails; layout state persists sensibly
- Tab set matches design; no Source tab; existing tab content unaffected
- Relative times with hover-full-timestamp on rows
- e2e covers resize/collapse and tab presence
- Lint, typecheck, tests, build green

**Prototype references.**
- `screenshots/03-captures-list-viewer.png` - pixel truth: three columns (list w/ search + sort/filter header + detailed rows, viewer with Screenshot/Page/Text/Wayback tab group + Download + '1 / 156' pager, details panel with Capture/Verified head, SOURCE/CAPTURED/TAGS/NOTES sections); detailed rows show hostname + long relative time ('2 hours ago'), tag chips, provenance dot on thumbnail
- `HANDOFF.md` 'Captures screen' + Session 2 bullets - Source tab removed (tabs Screenshot/Page/Text/Wayback), list column hidden while Wayback active; 'Both viewer columns are resizable (drag handles, 240-560 list / 320-680 details) and collapsible to 40px rails'; thumbnails are a masked Birdbrain-logo silhouette on the tinted gradient
- `HANDOFF.md` Session 4 'Capture list dates' - compact list rows: clock icon + short relative time (fmtAgoShort), hover = full timestamp (`fmtFull`); detailed rows got the same hover; Session 5 decision: 'Captures viewer tabs - prototype wins' (item 11)
- `Birdbrain.dc.html` ~4195-4217 `startResize` - bounds list 240/560 (default 316), details 320/680 (default 400); `mousemove` drag, body cursor col-resize + user-select none during drag; ~930/1656: 7px invisible handle at column edge, hover tint accent 40%
- `Birdbrain.dc.html` ~1129-1145 collapsed list rail (40px: expand chevron, camera + capture count, prev/next capture buttons) and ~1775-1797 details rail (expand, favorite star, open URL, tags/notes icons with count badges), rail animation `bbdrawer` `150ms`; ~4779-4786 showCapList/capListRail logic (`viewerTab` !== `wayback`)
- `Birdbrain.dc.html` ~4145-4166 `fmtAgo` ('2 hours ago' long form), fmtAgoShort (`now/5m/3h/2d/1w`), `fmtFull` (weekday, month day, year, h:mm); row usage ~1092 (detailed: long ago, title=tsFull hover, no clock) and ~1116-1119 (compact list row: 9px clock icon + `agoShort`, 10px, tabular-nums, title=tsFull)
- `Birdbrain.dc.html` ~1077 detailed-row thumbnail - 36x56, 2px radius, border-strong, tinted gradient + centered `src/renderer/assets/logo.png` at 20px, opacity .28, grayscale(1) brightness(1.9), provenance dot bottom-right; row 4px radius, 2px selection rail, 12px/500 titles
- `MOTION.md` Overlays - details panel and Wayback panel fade-in only (`bbfade` `150ms`, same right-edge slot, never width-animate: opposing-motion rule); collapsed 40px rail keeps `bbdrawer` `150ms`; `liftrow` row hover = tint overlay, no transform; :focus-visible 2px accent outline
- `style_sync_patch/SCREEN_NOTES.md` 'Captures' - tab decision restated; row titles 12px; list-row relative times are body type with tabular-nums, full timestamp on hover; hashes/timestamps-as-evidence stay font-mono 11px; search field recessed standard, left icon inset 28px

**Files.**
- `src/renderer/routes/cases/$caseId/captures.tsx` (modify) - Layout owner: replace fixed w-[380px] list / w-[400px] details with resizable widths + drag handles; add list-collapse rail state; keep the viewport<1100 forced-collapse + overlay panel behavior; wire persistence
- `src/renderer/components/captures/CaptureViewer.tsx` (modify) - Remove 'source' from ViewTab/TABS/TAB_LABELS and its content branch (lines 19-27, 255-264); add `wayback` tab trigger; keep Screenshot/Page/Text content branches and roving-tabindex keyboard handling
- `src/renderer/components/captures/CaptureList.tsx` (modify) - Header per design (collapse-list chevron next to CaptureMenu; possibly search input pending ruling); pass a time tick so relative times stay fresh; footer count row unchanged
- `src/renderer/components/captures/CaptureItem.tsx` (modify) - 12px titles (text-sm->text-xs), hostname loses font-mono, replace local `formatTimestamp` with shared helper: clock icon + short relative time, title= full timestamp; thumbnail becomes logo-silhouette on tinted gradient (`assets/logo.png` exists)
- `src/renderer/components/captures/CaptureListRail.tsx` (create) - Collapsed 40px list rail: expand chevron, capture-count icon button, prev/next capture buttons (prototype ~1129-1145)
- `src/renderer/components/captures/useColumnResize.ts` (create) - Drag-resize hook: pointer capture, clamp to [240,560]/[320,680], col-resize body cursor + user-select none during drag, commit-on-release for persistence
- `src/renderer/components/captures/CaptureDetailsRail.tsx` (modify) - Align rail buttons with prototype details rail (expand/star/open-URL/tags+notes count badges) - already close, cosmetic pass only
- `src/renderer/components/captures/CaptureDetailsPanel.tsx` (modify) - Only if the maintainer rules the Wayback section moves out of the panel when Wayback becomes a viewer tab (see open question 2); otherwise untouched
- `src/renderer/lib/formatRelativeTime.ts` (modify) - Add short-format helper (`now/5m/3h/2d/1w`) and a full-timestamp formatter to pair with useTimeTick; existing long form stays for details panel
- `src/shared/types.ts` (modify) - If settings persistence chosen (matches existing detailsPanelCollapsed at line 200): add captureListWidth, detailsPanelWidth, captureListCollapsed to BirdbrainSettings
- `src/shared/schemas.ts` (modify) - Zod defaults for the new settings keys (beside detailsPanelCollapsed at line 538)
- `src/main/services/settings.ts` (modify) - Defaults for the new keys (beside detailsPanelCollapsed at line 71); settings are a zod-validated JSON file, no DB involved
- `e2e/annotation.spec.ts` (modify) - Line 118 clicks getByRole('tab', { name: 'Source' }) - breaks the moment the tab is removed; retarget
- `e2e/captures-layout.spec.ts` (create) - AC coverage: drag-resize within bounds, collapse/expand both rails, tab presence (Screenshot/Page/Text/Wayback, no Source)
- `tests/components/CapturesRoute.test.tsx` (modify) - Extend existing route tests with resize/collapse persistence and rail rendering
- `tests/components/CaptureItem.test.tsx` (create) - Row time rendering: short relative time, hover title carries full timestamp, thumbnail fallback
- `tests/lib/formatRelativeTime.test.ts` (modify) - Known-answer tests for the short format and full-timestamp helper

**Migration.** None.

**IPC changes.** none - layout persistence rides the existing generic settings:get/settings:update channels (or `localStorage`, per the annotation-editor precedent)

**Archive impact.** none - pure renderer/view-layer change plus optional settings keys; nothing touches case archive export/import

**Evidence impact.** n/a - removing the Source tab changes only what the viewer renders, not what is captured, hashed, or manifested; raw source remains available via CaptureDownloadMenu

**Tests.**
- `e2e/captures-layout.spec.ts` (new): resize within bounds with col-resize cursor, collapse to 40px rails and expand, tab presence incl. absence of Source - Playwright, requires pnpm build first
- `e2e/annotation.spec.ts`: update line 118's Source-tab click
- `tests/components/CapturesRoute.test.tsx` (web `tsconfig` project, .tsx -> jsdom Vitest project): layout state, rails, forced-collapse overlay still reachable
- `tests/components/CaptureItem.test.tsx` (new, web project): short relative time + hover full timestamp + silhouette thumbnail fallback
- `tests/lib/formatRelativeTime.test.ts` (web project): short-format and full-format known answers
- Density DoD: verify list rows honor --d-itemy/--d-itemx/--d-listgap (already in `globals.css`) at all three steps; `e2e/density.spec.ts` exists as a pattern

**Conflicts with other wave-1 tickets.**
- `src/renderer/components/captures/CaptureItem.tsx` - #396 reworks the row checkbox (hover fade-in, sticky, anchor semantics); #397 restyles the same rows (titles, times, thumbnails). Sequenced after #396: rebase row markup on #396's version
- `src/renderer/components/captures/CaptureList.tsx` - #396 adds selection gestures (`cmd/shift-click`, `cmd-A`, Escape) and select-all wiring; #397 changes the header (collapse toggle) and adds the time tick
- `src/renderer/routes/cases/$caseId/captures.tsx` - #396 most likely mounts the floating bottom-center action bar in this route; #397 rewrites the entire column layout around it
- `src/renderer/stores/appStore.ts` - #396 consumes/extends multi-select state (selectedCaptureIds, anchor); #397 may add list-collapse UI state here if not persisted via settings
- e2e capture specifications - both tickets add/modify e2e in the captures area; #396's select-act-clear round trip and #397's resize/collapse specification will share seeding fixtures

**Risks.**
- Stale relative times: rows never re-render as time passes (CaptureItem computes once); pair the shared helper with useTimeTick (`60s`, as CaptureDetailsPanel already does) or times freeze
- The viewport<1100 forced-collapse + overlay-panel path (`captures.tsx` lines 49-60, 136-151) is deliberate narrow-window reachability for custody/Wayback/tags - the resizable layout must preserve it, and min widths (240 list + 320 details + viewer) exceed narrow viewports, so forcing must override user widths
- Persisting width per `mousemove` would spam settings IPC + disk writes - commit on drag release (or debounce); prototype writes state per move but it has no IPC
- Removing the 'source' branch also removes a `contentType='html`' fetch path; legacy pre-v11 `html` captures still use the Page-tab iframe branch - keep that fetch intact
- Motion rules: details/Wayback panels must fade only (opposing-motion rule, `MOTION.md`); only the collapse-to-rail animates width (`150ms`); gate all of it on useReduceMotion as the route already does
- Tokens-only DoD vs existing raw colors in CaptureItem (`rgba` THUMB_COLORS, `bg-gray-900/50`, fill-yellow-500): thumbnail tints and the favorite star are plausibly status/severity exceptions, but new layout chrome must be semantic tokens; the prototype thumbnail uses the same tinted-gradient approach
- `readme-screenshots.spec.ts` and `theme-screenshots.spec.ts` render the captures screen - regenerated screenshots will change; not assertion failures but review noise
- CI coverage gate: `scripts/diff-coverage.mjs` requires 90% of changed lines covered - the resize hook and rail components need direct tests, not just e2e

**Open questions.**
- Row time treatment conflict between ticket copy and pixel truth: the ticket says rows show a clock icon + short relative time, but the prototype's detailed rows (the 03 screenshot, default `capView` 'detailed') show the long form ('2 hours ago') with no clock icon - clock + fmtAgoShort belongs only to the compact 'list' row variant. Which treatment do the shipped rows get, and is the prototype's detailed/list view toggle (`capView`) in #397 scope at all?
- Wayback tab scope split against #401 (which owns the 436px slide-out, side-by-side compare, and sandboxed `webview`): does #397's 'tab set matches design' mean shipping a Wayback tab trigger that renders the existing WaybackTab content (and removing the details-panel Wayback section), or does the Wayback tab arrive wholesale with #401, leaving #397 with three tabs? The prototype also hides the list column while Wayback is active (showCapList logic) - #397 or #401?
- The prototype's list-column header includes a `Search captures...` input (recessed standard); the current app has only the global TopBar case search. Is per-list capture search in #397's 'layout as designed' scope or a separate ticket?

### #400 - feat(capture): per-case auto-capture exclusions (stack/override global)

Each case gets a collapsible "Never auto-capture" section on the Signals screen (SelectorsOverview): monospace exclusion chips accepting domains or `/regex/` patterns with Enter-to-add and removal, plus a "Stack on global / Override global" segmented toggle; the collapsed header summarizes ("3 exclusions · + global") and a footer explains the modes and points at the global list in Settings. Enforcement is server-authoritative in `captureServer` against the target case, with exact stack-vs-override semantics over the existing three-form pattern grammar (regular expression literal / glob / substring), invalid regular expression surfaced at persist time, and regular expression evaluation kept on the existing 200 ms `vm` budget (safeRegexTest). The extension mirrors the effective list for immediate feedback via the /api/status poll but is never the enforcement point. Case archives round-trip the list and mode. Evidence-affecting: exclusions change what gets acquired, and override mode can admit URLs the global policy blocks.

**Acceptance criteria.**
- Case-owned exclusion persistence with migration; archives round-trip it
- Server rejects excluded auto-captures per mode semantics; invalid regular expression is surfaced, never silently ignored; regular expression evaluation is time-budgeted
- Signals UI matches the prototype (chips, toggle, summary, footer)
- Extension shows immediate feedback from the mirrored effective list
- Service-seam tests cover stack/override matrices and bad-regex cases
- ADR-0004 obligations addressed; PR marked evidence-affecting - human review, no auto-merge
- Lint, typecheck, tests, build green
- Blocked by #384 (style sync) - CLOSED, unblocked

**Prototype references.**
- `Birdbrain.dc.html` lines ~1801-1846 - pixel truth for the Auto-capture card on Signals: card header (camera icon, title, muted one-liner), summary button with 180° chevron rotate (.`15s`), role=switch toggle, and the expanded section: 'Never auto-capture' 10px/600/uppercase label, role=radiogroup segmented Stack on global / Override global (22px buttons, accent-subtle `bg` + accent `fg` when active, border-strong group border, 4px radius), pill chips (9999px, border-strong, surface `bg`, mono 11px, text-secondary, 14px remove button), borderless mono inline input placeholder 'domain or /pattern/ - Enter to add', 10px text-faint footer
- `Birdbrain.dc.html` lines ~4528-4551 - behavior truth: acExclOpen/acExclMode state, summary string ('N exclusions · + global' vs '· overrides global'), Enter-to-add with trim + duplicate skip, and both footer copy strings (override: `Only these patterns are excluded for this case - the global ignore list ... is bypassed.`; stack: `Applied on top of the global ignore list ... Matching pages are never captured, even by selectors.`)
- `screenshots/06-signals-auto-capture-exclusions.png` - Signals screen with the card collapsed: '3 exclusions · + global' summary left of the toggle, dark theme, compact density
- `screenshots/14-signals-match-mode-drawer.png` - same card at top (collapsed summary visible); the match-mode drawer itself is adjacent context, not owned by #400
- `HANDOFF.md` ~237-244 ('Auto-capture exclusions (Signals) - done') - notes the global list pointer text is fictional ('Settings -> Privacy, 12 entries'); and ~335 session-5 decision: 'item 10 deferred until auto-capture returns'
- `README.md` ~151-156 (Signals section), ~238 (Enter confirms in exclusion input), ~258 (acExclMode: 'stack' | 'override' + per-case list is the specified state)
- `ENGINEERING_REVIEW.md` item 10 - 'Settings schema + capture-server filter logic change'
- `MOTION.md` - kill switches apply; no width animation on the section (only the chevron .`15s` rotate is specified); density via --d-card padding

**Files.**
- `src/main/services/db/migrations.ts` (modify) - Append v28 block: ALTER TABLE cases ADD COLUMN `capture_exclusions` TEXT (JSON array, NULL = none) and `capture_exclusion_mode` TEXT NOT NULL DEFAULT 'stack'. Current tail is v27 (note anchors).
- `src/main/services/db/core.ts` (modify) - LATEST_SCHEMA_VERSION 27 -> 28 (coordinate with #389/#395, which also append migrations).
- `src/main/services/db/caseRepo.ts` (modify) - Row mapping gains `captureExclusions/captureExclusionMode`; `updateCase` persists them (UPDATE sets name/description/archived only); importCaseRow's explicit column INSERT adds both (defaults null/'stack' for legacy archives). collectCaseRow is SELECT * so export rides free.
- `src/shared/types.ts` (modify) - Case gains `captureExclusions`: string[] and captureExclusionMode: 'stack' | 'override' (repository supplies defaults so the domain type stays non-optional).
- `src/shared/ipc.ts` (modify) - UpdateCaseParams (line ~285) gains optional `captureExclusions/captureExclusionMode`; no new channel - cases:update carries it.
- `src/shared/urlPatterns.ts` (modify) - Add validateIgnorePattern() (surfaces unparseable `/regex/` at add/persist time - matchIgnoredUrl deliberately skips bad patterns at enforcement and must keep doing so) and an effective-list/mode helper (stack = global + case, override = case only) so server and tests share one definition.
- `src/main/services/captureServer.ts` (modify) - Move the isUrlBlacklisted check (at line ~296, before `caseId` resolution) to after the target case is resolved; evaluate the effective per-case list via safeRegexTest (200 ms `vm` budget, fail-open - unchanged semantics); 403 body + skip event name the pattern and whether it was a global or case rule. /api/status additionally sends the active case's effective list (for example effectiveIgnoredUrlPatterns) for the extension mirror.
- `src/shared/schemas.ts` (modify) - CaptureServerStatus (line ~128) gains the mirrored effective-list fields; `extension/src/utils/api.ts` already types getStatus() with this interface so the extension side rides the type.
- `src/main/ipcHandlers.ts` (modify) - cases:update path rejects invalid patterns (IpcFailure) before persist - validation may live in `caseRepo.updateCase` instead; either way surfaced, never silently dropped.
- `src/renderer/components/selectors/AutoCaptureExclusions.tsx` (create) - New card/section per prototype: collapsible header with summary + chevron, segmented mode toggle, chips + Enter-to-add mono input with inline invalid-pattern error, footer copy per mode pointing at the real global list location (Settings -> Capture Preferences). Uses useCasesMutations().update from `src/renderer/lib/api/cases.ts` (no new query layer needed).
- `src/renderer/components/selectors/SelectorsOverview.tsx` (modify) - Mount the Auto-capture card at the top of the Signals screen (no auto-capture card exists today).
- `extension/src/background.ts` (modify) - Minimal mirror delta at the status poll (~line 320): userIgnoredPatterns = status.effectiveIgnoredUrlPatterns ?? status.ignoredUrlPatterns ?? []. isIgnoredByUser and its two live pre-filter routes (context-menu capture, checkSelectorsOnTab) then reflect case exclusions automatically. #387 owns the popup and its pre-filter.
- `src/main/services/caseArchive.ts` (modify) - Likely no structural change - `data.json` case row is collectCaseRow (SELECT *) and import goes through `caseRepo.importCaseRow`; touch only if the archive header/report should surface the exclusion count. Round-trip assertions land in tests.
- `tests/main/services/captureServer.test.ts` (modify) - Extend the existing blacklist tests (lines ~482-560): stack/override matrix x source auto/manual/selector, per-case vs global rule in the 403 body, invalid-regex persist rejection, budget fail-open pin with injected budget, /api/status effective list.
- `tests/shared/urlPatterns.test.ts` (modify) - Known answers for validateIgnorePattern and the effective-list computation across the three pattern forms.
- `tests/main/services/caseArchiveRoundTrip.test.ts` (modify) - Exclusions + mode survive export/import; legacy archive without the columns imports with null/'stack' defaults.
- `tests/main/services/database.test.ts` (modify) - Migration v28: columns exist, defaults correct, legacy rows read back as empty list + stack.
- `tests/components/AutoCaptureExclusions.test.tsx` (create) - jsdom/web project (flat `tests/components/` layout, cf. `CreateSelectorCard.test.tsx`): chips add/remove, Enter-to-add with trim + duplicate skip, mode toggle, collapsed summary text, invalid-pattern error shown.

**Migration.** v28 (current LATEST_SCHEMA_VERSION = 27):
ALTER TABLE cases ADD COLUMN `capture_exclusions` TEXT;              -- JSON array of pattern strings; NULL = none
ALTER TABLE cases ADD COLUMN `capture_exclusion_mode` TEXT NOT NULL DEFAULT 'stack';  -- 'stack' | 'override'
`db.pragma('user_version` = 28')
JSON-column-on-cases chosen over a `case_capture_exclusions` table: patterns have no independent identity, lists are small and ordered, and it keeps archive round-trip (SELECT * export) and ID_PROBE_TABLES untouched. Version number must be coordinated with #389 and #395, which also append blocks.

**IPC changes.** No new channels. UpdateCaseParams in `src/shared/ipc.ts` gains optional `captureExclusions`?: string[] and captureExclusionMode?: 'stack' | 'override' (rides the existing cases:update); Case in `src/shared/types.ts` gains both fields. The extension-facing change is HTTP, not IPC: CaptureServerStatus in `src/shared/schemas.ts` gains the mirrored effective-list fields served by GET /api/status.

**Archive impact.** Exclusion list + mode must round-trip. Export is free (`caseArchive` `data.json` embeds the raw cases row via collectCaseRow's SELECT *); import requires adding both columns to `caseRepo.importCaseRow's` explicit INSERT, defaulting null/'stack' for legacy archives. Forward-compatible the other way: an old app importing a new archive ignores the unknown keys. Add round-trip + legacy-archive assertions to `caseArchiveRoundTrip.test.ts`. No manifest-chain or verifier change unless exclusion events become manifest entries (open question).

**Evidence impact.** Exclusions change what the server refuses to acquire, so this is on the evidence path end to end. What changes: (1) enforcement moves from a single global pre-case check (`captureServer.ts` ~line 296) to a per-target-case effective list evaluated after case resolution - error precedence shifts (blocked URL + missing case now `404s` not `403s`) and existing tests pin the old order; (2) override mode is the sharp edge - it BYPASSES the global ignore list for that case, so a per-case setting can widen acquisition relative to the operator's global policy, not just narrow it; (3) fail-open timeout semantics are preserved (safeRegexTest returns no-match when the 200 ms `vm` budget expires, so a pathological regular expression admits rather than refuses - under override with one bad pattern that means everything global would have caught is admitted); (4) the extension mirror is feedback only and lags the status-poll cadence - the server 403 remains the sole enforcement, and the popup Capture path (per #387's scope) reaches the server unfiltered today. The PR's Evidence impact section must state all four, plus: invalid patterns are rejected at persist time (never silently skipped for case lists, while enforcement-time skip-don't-fail is kept so one bad global entry cannot disable the rest), archives round-trip the acquisition policy, and a position on manifest visibility. On that last point: today a blocked capture emits only an ephemeral renderer CaptureEvent ('skipped') - nothing manifest-visible - while ADR-0004 says failed/partial captures are evidence-bearing events that must not be silently discarded; manifest entry types are capture/deletion/timestamp/export/archive-export/import, and adding an exclusion-configuration or skip entry type ripples into `src/shared/verify/manifestChain`, the verifier CLI, and `VERIFY.md`. The PR must say which (if either) of configuration-change events and per-URL skip events becomes manifest-visible and why.

**Tests.**
- `tests/main/services/captureServer.test.ts` (node project) - stack/override matrix x source auto/manual/selector; per-case vs global rule named in 403 body and skip event; invalid-regex persist rejection; budget fail-open pinned with injected `budgetMs` (per `safeRegex.ts` #330 pattern); /api/status effective list for the active case
- `tests/shared/urlPatterns.test.ts` (node project) - validateIgnorePattern known answers and effective-list computation across regex/glob/substring forms and both modes
- `tests/main/services/caseArchiveRoundTrip.test.ts` - exclusions + mode round-trip; legacy archive without columns imports with defaults
- `tests/main/services/database.test.ts` - migration v28 columns, defaults, legacy-row readback
- `tests/components/AutoCaptureExclusions.test.tsx` (web/jsdom project - .tsx lands there by construction) - chips, Enter-to-add trim/dupe-skip, mode toggle, collapsed summary string, invalid-pattern error, footer copy per mode; definition-of-done: semantic tokens only, hover/empty/keyboard states, legible at all three --d-* density steps

**Conflicts with other wave-1 tickets.**
- `src/main/services/db/migrations.ts` + `src/main/services/db/core.ts` (LATEST_SCHEMA_VERSION) - #389 (references index migration) and #395 (selector origin migration) both append version blocks; whoever lands later renumbers
- `src/shared/ipc.ts` - #389 adds a references domain; #395 touches selector create `params`; #400 edits UpdateCaseParams
- `src/shared/types.ts` - #395 (Selector.origin) and likely #389 share it; #400 widens Case
- `extension/src/background.ts` - #387 (popup Capture ignore pre-filter + popup case select) works the same isIgnoredByUser / userIgnoredPatterns seam; #400 keeps its delta to the one status-poll mirror line
- `src/shared/schemas.ts` (CaptureServerStatus) - #387's popup reads the same status payload #400 extends
- `src/renderer/components/selectors/SelectorsOverview.tsx` - #395's creation-path changes touch the same screen/directory
- `src/main/services/caseArchive.ts` / archive round-trip tests - #389 and #395 also extend archive round-trip

**Risks.**
- Override mode widens acquisition against global policy and interacts with the fail-open regular expression budget - the single most scrutinized point at the evidence gate; must be explicit in the PR
- Enforcement reorder (blacklist check after case resolution) changes error precedence pinned by existing `captureServer` tests; repin deliberately, not incidentally
- Extension auto-capture is HOTFIX-disabled (#211) and returns only via #600/ADR-0013 (window-scoped passive capture) - the 'auto' enforcement path is testable server-side but not exercisable end-to-end from the extension yet; the handoff itself recorded 'item 10 deferred until auto-capture returns'
- Mirror staleness: the extension's effective list refreshes on the status poll, so a just-edited exclusion lags in badge/context-menu feedback; server stays authoritative
- Widening the Case domain type ripples across every renderer consumer; repository-supplied defaults keep it non-optional
- Prototype footer text is fictional (Settings -> Privacy, 12 entries) - real location is Settings -> Capture Preferences 'Ignored URL patterns' and the count must be live
- Prototype exclusion chips are 9999px pills; the bundle's radii rule reserves pills for status pills/dots - markup is pixel truth here, don't 'fix' it to 4px
- Agent workflow: pnpm test:coverage + pnpm coverage:diff must pass (90% changed-line gate CI enforces beyond pnpm test)

**Open questions.**
- Scope of enforcement: does the per-case list block MANUAL captures into that case (the global list does today, test-pinned), or only auto/selector sources? The AC says 'rejects excluded auto-captures' but the prototype's stack-mode footer says 'Matching pages are never captured, even by selectors' - pick one; it decides the server matrix
- The prototype card pairs the exclusion section with a per-case Auto-capture on/off switch that has no backing setting today (global autoCaptureMode is inert per #570, restoration is #600). Does #400 build the card container with the switch (disabled/inert), or attach the exclusion section without it until #600 lands?
- Manifest visibility (the PR must take a position): should exclusion-list/mode changes and/or per-URL blocked-capture events become manifest entries? Either adds a new entry type rippling into shared/verify, the verifier CLI, and `VERIFY.md`; today neither is recorded anywhere durable
- Invalid-regex surfacing scope: only the per-case add/persist path, or also retrofit add-time validation to the global list in CapturePreferences (whose bad entries are silently skipped at enforcement today)?

### #403 - feat(dashboard): cross-case recent-activity feed

Below the dashboard hero/case grid, returning operators get a "Recent activity" feed replacing Quick Start: a flat chronological list of the last 10 events across all cases (captures, selector hits, note edits), each row an event icon + truncating label + case-type-tinted chip + provenance dot + relative time, with row click jumping to the capture in its case. First run keeps Quick Start. The feed must be backed by a bounded, typed cross-case query in the data layer (SCREEN_NOTES calls it "the new captures-across-cases repository function + IPC channel," engineering-review item 14) - never fetch-everything-and-sort in the renderer. Blocker #384 (style sync patch) is closed, so the ticket is unblocked.

**Acceptance criteria.**
- Bounded cross-case recent-activity query with stable ordering and explicit event types
- Feed renders per the prototype; row click navigates to the Capture in its Case
- First-run still shows Quick Start; feed appears once activity exists
- e2e covers feed rendering and navigation
- Lint, typecheck, tests, build green

**Prototype references.**
- `screenshots/01-dashboard.png` - pixel truth for the feed below Recent Cases: 'RECENT ACTIVITY' 10px uppercase eyebrow + hairline rule + 'last 10 events · all cases' right label; bordered 6px-radius card of rows (icon, 12px label, case chip, green provenance dot on verified rows, right-aligned relative time)
- `Birdbrain.dc.html` lines ~514-541 - feed markup: row anatomy (13px icon, min-w-0 truncating label, chip via color-mix 25% border / 10% `bg` of the case color, 6px provenance dot with title tooltip, 64px right-aligned 10px time), rows are <button class="hovrow"> (hover = var(--color-elevated)), and the dashed-border empty state: 'No activity yet - captures, selector hits, and note edits land here.'
- `Birdbrain.dc.html` ~4166-4194 dashActivityRows() - the three event types (capture / hit / note), icons (#i-camera, #i-crosshair, #i-note), `iconColor` accent for hits vs text-faint, labels (`Captured ...`, `N new selector hits on ...`, `Edited note - ...`), and click targets: note events open the Notes view with the note selected, capture/hit events open Captures with the capture selected, else case overview
- `Birdbrain.dc.html` ~4221 provenance() - dot colors: verified #34d399, tampered #f87171, legacy #fbbf24, default text-faint; transparent dot when the event has no status (note/hit rows)
- `Birdbrain.dc.html` ~4450-4518 - gating: vQuickStart = `firstRun`, `vActivity` = `!firstRun`, `actEmpty` when `!firstRun` && no rows (so a returning operator with zero events gets the empty feed, not Quick Start)
- `style_sync_patch/SCREEN_NOTES.md` Dashboard section (~lines 21-39) - feed replaces Quick Start once a case has activity; 'Needs the new captures-across-cases repository function + IPC channel (engineering review item 14)'
- `HANDOFF.md` Session 2 'Dashboard ultrawide' bullet; `ENGINEERING_REVIEW.md` item 14 ('view-layer; the feed needs a cheap recent activity across cases query'); `IMPLEMENTATION_GUIDE.md` stage 5 item 1
- `MOTION.md` line 27 - .stag stagger applies to the dashboard case grid; feed rows get only the .hovrow hover treatment, no stagger specified

**Files.**
- `src/main/services/db/activityRepo.ts` (create) - New repository module owning the cross-aggregate query (satisfies the `getDb` lint fence - raw connection only under `src/main/services/db/`; precedent: `diagnosticsRepo` for cross-aggregate reads). listRecentActivity(limit = 10): UNION of per-source bounded subqueries (captures by `created_at`, notes by `updated_at`, selector hits pending the timestamp ruling), each ORDER BY ts DESC LIMIT n, joined to cases for name/type, final ORDER BY ts DESC, id tiebreak for stable ordering. Neither `caseRepo` nor `captureRepo` fits: the events span captures, notes and `selector_matches`.
- `src/shared/types.ts` (modify) - Add RecentActivityEvent discriminated union - kind: 'capture' | '`selectorHit`' | 'note', `caseId`, `caseName`, `caseType`, `captureId`?, `noteId`?, label fields, `occurredAt` (ISO), and lastVerifiedStatus for the provenance dot (matches Capture.lastVerifiedStatus: HashVerification['status']).
- `src/shared/ipc.ts` (modify) - New invoke channel CASES_RECENT_ACTIVITY: '`cases:recentActivity`' plus contract entry { `args`: [limit?: number]; result: RecentActivityEvent[] } (alternative: a new activity: domain; cases domain recommended since it already owns the cross-case dashboard reads).
- `src/main/ipcHandlers.ts` (modify) - Register `handle(IPC_CHANNELS.CASES_RECENT_ACTIVITY, ...)` delegating to `activityRepo.listRecentActivity`.
- `src/preload/index.ts` (modify) - Expose the bridge in the cases group (`recentActivity`: bridge(IPC_CHANNELS.CASES_RECENT_ACTIVITY)).
- `src/shared/birdbrainApi.ts` (modify) - Add the typed method to the BirdbrainAPI cases surface (renderer types come from here via `src/renderer/env.d.ts`).
- `src/renderer/lib/api/keys.ts` (modify) - Add `queryKeys.recentActivity`.
- `src/renderer/lib/api/cases.ts` (modify) - Add recentActivityQueryOptions following the existing `queryOptions` factory pattern.
- `src/renderer/components/dashboard/RecentActivityFeed.tsx` (create) - The feed section per prototype: SectionLabel-style eyebrow header + rule + 'last 10 events · all cases', bordered card of button rows (hover `bg-elevated`, truncating label, case chip, 6px provenance dot via getProvenanceColor, formatRelativeTime for the time column), dashed empty state. Case-chip colors need the case-type->color mapping private to `CaseCard.tsx` (CASE_ICONS: amber/sky/pink/accent) - extract to a small shared module under dashboard/ rather than duplicating.
- `src/renderer/components/dashboard/Dashboard.tsx` (modify) - Query the feed; render RecentActivityFeed instead of QuickStartGuide once past first run (recommended mapping: cases.length === 0 -> Quick Start; otherwise feed, with the prototype's empty state when zero events). Row-click handler: `setSelectedCaptureId(captureId`) then navigate to /cases/$caseId/captures (capture selection is Zustand state, not a route search `param` - see routes/cases/$caseId/captures.tsx line 34); note rows per the maintainer ruling below.
- `tests/main/services/activityRepo.test.ts` (create) - Node-flavour repository test: bounded limit, stable ordering across mixed sources (`created_at` vs `updated_at`, id tiebreak), explicit event types, case name/type join, empty DB.
- `tests/components/RecentActivityFeed.test.tsx` (create) - Web-flavour (jsdom project) component test: renders rows, empty state, row-click callback fires with the right target.
- `e2e/dashboard-activity.spec.ts` (create) - AC-required e2e: first-run dashboard shows Quick Start; after creating a case + capture the feed renders; clicking a row lands on that capture in its case.

**Migration.** None.

**IPC changes.** One new invoke channel: `cases:recentActivity` - `args` [limit?: number], result RecentActivityEvent[] (recommended over a new activity: domain to keep the preload surface small). No new event: channels. Touches `src/shared/ipc.ts` (IPC_CHANNELS + contract map), `src/main/ipcHandlers.ts`, `src/preload/index.ts`, `src/shared/birdbrainApi.ts`.

**Archive impact.** none - the feed is a derived, read-only query over existing tables (captures, notes, `selector_matches`, cases); no new persisted state, so `caseArchive` export/import round-trip is untouched. (Only exception: if the maintainer rules to add `selector_matches.matched_at`, that column would need collect/import handling in the selector archive path - see open questions.)

**Evidence impact.** n/a

**Tests.**
- `tests/main/services/activityRepo.test.ts` (node `tsconfig` flavour - main/shared code): bounded limit, stable ordering with id tiebreak, explicit event kinds, cross-case join, empty result
- `tests/components/RecentActivityFeed.test.tsx` (web `tsconfig` flavour, jsdom Vitest project - `.test.tsx` lands there by construction): row rendering, empty state, click targets, semantic tokens only apart from the sanctioned provenance/status raw colors
- `e2e/dashboard-activity.spec.ts` (`e2e/tsconfig.json`): Quick Start on first run, feed after activity exists, row click navigates to the capture in its case - the AC names e2e explicitly
- Definition-of-done fold-in: pixel-match at compact density (the --d-* density system from merged #384), hover (`bg-elevated`) and empty states per the bundle, keyboard reachability free via <button> rows, formatRelativeTime (existing helper in `src/renderer/lib/formatRelativeTime.ts`) for the time column

**Conflicts with other wave-1 tickets.**
- `src/shared/ipc.ts` - shared with #389 (references-index IPC) and #400 (auto-capture exclusions IPC); all sides append channels + contract entries, so textual-merge-only conflict
- `src/main/ipcHandlers.ts` - shared with #389 and #400 (handler registrations)
- `src/preload/index.ts` and `src/shared/birdbrainApi.ts` - shared with #389 and #400 (bridge methods for their new channels)
- `src/shared/types.ts` - shared with #389 (Mention types), #395 (selector origin field) and likely #400; append-only
- Conditional only: `src/main/services/db/migrations.ts` + `core.ts` (LATEST_SCHEMA_VERSION) with #389/#395/#400 IF the selector-hit ruling adds a `matched_at` migration - otherwise #403 adds no migration
- Verdict on the conflict map: 'conflicts with nothing' holds at the component/repository level (no other wave-1 ticket touches dashboard components, `activityRepo`, or `lib/api/cases.ts`) but is false for the shared IPC spine files listed earlier; all are append-only merges. Behavioral (not file) coupling with #397: the row-click contract (appStore.setSelectedCaptureId + navigate to /cases/$caseId/captures) is the surface #397 reworks

**Risks.**
- `selector_matches` has no timestamp (PK selector_id+capture_id only, never altered through schema v27), so the prototype's 'N new selector hits' events cannot be dated as designed - the main design risk; see open questions
- Stable-ordering AC: the query mixes `captures.created_at` and `notes.updated_at` (both TEXT ISO); ORDER BY ts DESC with id tiebreak must be tested, and grouping of hit counts per capture (`3 new selector hits on ...`) needs a defined window if hits ship
- Performance: no index exists on `captures(created_at`) or `notes(updated_at`) - per-source ORDER BY + LIMIT subqueries keep the result bounded but scan their tables; acceptable at desktop scale, and an optional `idx_captures_created_at` can follow later without blocking (kept out to avoid a migration this wave)
- #397 reworks the captures screen the row click lands on; if both are in flight, coordinate on selectedCaptureId remaining the selection contract
- Case-chip colors come from the case-type mapping private to `CaseCard.tsx` (CASE_ICONS: amber/sky/pink + accent default, matching prototype caseIcons[cs.type].color); extracting it risks a small `CaseCard.tsx` touch - provenance dot and case-type colors are the sanctioned raw-color exceptions, everything else tokens only
- Repository background-job gates apply: pnpm test:coverage + pnpm coverage:diff (90% changed-line threshold) on the final tree, not just lint/typecheck/test/build

**Open questions.**
- CONSTRAINT: selector-hit events cannot be implemented as designed - `selector_matches` carries no timestamp column, so hit events have no independent time to order by. Options for a ruling: (a) ship v1 with capture + note events only, (b) approximate hit time with the matched capture's `created_at` (wrong for matches backfilled when a selector is created after the capture), or (c) add `matched_at` via migration (v28: ALTER TABLE `selector_matches` ADD COLUMN `matched_at` TEXT - backfill from the capture's `created_at`; this serializes against the #389/#395/#400 migrations and contradicts the 'conflicts with nothing' map, and would also touch the selector archive round-trip)
- Note-event row clicks: the AC says every row click 'navigates to the Capture in its Case', but the prototype (dashActivityRows open()) navigates note rows to the Notes view with the note selected and only capture/hit rows to the capture. Which behavior should ship and be asserted in e2e?

### #563 - New-case wizard description textarea renders on `bg-canvas`, not the screen notes' `bg-elevated`

Bug filed off #425: the V1 handoff screen notes ruled the wizard description textarea `rounded-xl, bg-elevated, border-border-strong`; the Textarea primitive bases on `bg-canvas` and the NewCaseWizard call site overrides only radius/density, so the field renders on `bg-canvas`. The issue's AC allows either adding `bg-elevated` at the call site or carrying a sourced comment recording the deviation. The V2 bundle (wave-1 pixel truth) has since revised the ruling: the description textarea is now "6px, recessed fill" - and recessed is defined in the same doc as `bg-canvas` + border-border-strong, with HANDOFF.md's standardization pass stating the recessed input treatment "replaces the elevated/surface/canvas mix." So the shipped `bg-canvas` is correct under V2, and the fix is the AC's comment branch: replace the stale V1-sourced comment at the call site (and in the test) with a V2-sourced one, keeping the primitive untouched.

**Acceptance criteria.**
- The description textarea either renders on `bg-elevated` or carries a sourced comment saying why it does not
- pnpm lint, pnpm typecheck, BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test, pnpm build, pnpm test:coverage, pnpm coverage:diff all pass
- (From the body) Check `CreateCaseDialog.tsx` at the same time, since the notes cover all three wizard files

**Prototype references.**
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/style_sync_patch/SCREEN_NOTES.md` 'New case wizard' (lines 122-129): V2 token ruling - wizard fields are the one input exception (14px, px-3 py-2 via `className`); 'Description textarea 6px, recessed fill'. 'Recessed standard' is defined at line 14 as `bg-canvas` + border-border-strong
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/HANDOFF.md` 'Standardization pass - all seven screens', Controls bullet: `One input: recessed - --color-canvas fill, --color-border-strong border, 4px radius... Replaces the elevated/surface/canvas mix` - the explicit reversal of the V1 `bg-elevated` ruling
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/Birdbrain.dc.html` line 3528 (data-screen-label="New Case Wizard"): the V2 prototype reworked the wizard entirely - the description textarea there is border:none, background:transparent inside a stepper flow. That rework is not a wave-1 ticket; the SCREEN_NOTES token ruling is the actionable truth for the current screen
- No wizard screenshot exists in the bundle (screenshots/ has 14 `PNGs`, none of the wizard)
- Contrast with the repository's committed V1 notes at `docs/design-handoff/2026-08-10-birdbrain-prototype/style_sync_patch/SCREEN_NOTES.md` lines 99-107, which is what the issue quotes (rounded-xl, `bg-elevated`, border-border-strong)

**Files.**
- `src/renderer/components/dashboard/cases/NewCaseWizard.tsx` (modify) - Replace the stale comment preceding the Textarea (lines 129-131, cites the V1 rounded-xl ruling) with a V2-sourced comment: `bg-canvas` is kept deliberately because the V2 screen notes rule 'recessed fill' and `HANDOFF.md` replaced the elevated input mix. No token change - `className` stays resize-none rounded-xl px-3 py-2 text-sm (rounded-xl already aliases to the 6px ceiling via the `globals.css` radius collapse, --radius-xl: var(--radius)=0.375rem). Optionally rename rounded-xl to rounded-lg to match the V2 '6px' wording - zero pixel change, but it forces a test-assertion edit; keeping rounded-xl with the updated comment is the smaller diff
- `tests/components/NewCaseWizard.test.tsx` (modify) - Update the comment block (lines 25-28) that cites the V1 #425 rounded-xl ruling, and add a background-token assertion beside the radius one: `description.className` `toContain('bg-canvas`') and `not.toMatch(/bg-elevated/`), so a future sweep that re-adds `bg-elevated` must revisit the V2 note. Web `tsconfig` project, jsdom environment (directive already present)
- `src/renderer/components/ui/textarea.tsx` (modify) - NO change - listed to record the decision: the primitive base (`bg-canvas` border-border-strong rounded-md) is exactly the V2 recessed standard and is shared by `AIConfig`, AddUrlsBox, ReportProblemDialog, BulkAddSelectorsModal (whose bulk-paste textarea is separately ruled `bg-canvas` at SCREEN_NOTES line 88) and CreateCaseDialog. The fix belongs at the call site (comment only), never on the primitive
- `src/renderer/components/dashboard/cases/CreateCaseDialog.tsx` (modify) - Named in the issue as worth checking. It uses the bare primitive (compact 12px density, 4px radius) - off the V2 wizard exception (14px/px-3 py-2, 6px). But it is unreferenced anywhere in `src/` or `tests/` (dead code path; the /cases/new route renders NewCaseWizard). Recommend no restyle; either leave untouched or add nothing - see open question on disposition

**Migration.** None.

**IPC changes.** none

**Archive impact.** none

**Evidence impact.** n/a - the issue body states it explicitly: `src/renderer/components/dashboard/**` is on the exclusion list in `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` and neither file is an include-list exception

**Tests.**
- `tests/components/NewCaseWizard.test.tsx` - existing component test (jsdom, matched by `tsconfig.test.web.json` via .tsx glob). Extend the existing `rounds the name input...` specification or add a sibling it() asserting the description textarea keeps `bg-canvas` and never gains `bg-elevated`; refresh the stale V1-citation comment. If rounded-xl is renamed to rounded-lg, the assertions at lines 33-38 must change in the same commit
- Gate note: the production-side change is comment-only, so pnpm coverage:diff reports no new uncovered executable lines; run pnpm test:coverage + pnpm coverage:diff after the final edit per the unattended-job carve-out

**Conflicts with other wave-1 tickets.**
- `src/renderer/components/dashboard/cases/NewCaseWizard.tsx` - #395 (selector origin) touches selector creation paths, and NewCaseWizard creates preset selectors via `createSelector` (line 74), so #395 almost certainly edits this same file. Different regions (submit handler vs the description field JSX), trivial merge, but sequence-aware
- No other wave-1 ticket touches `textarea.tsx`, `CreateCaseDialog.tsx`, or the wizard test

**Risks.**
- An implementer following the issue text literally adds `bg-elevated` - that contradicts the V2 bundle the wave names as pixel truth (SCREEN_NOTES 'recessed fill' + HANDOFF 'replaces the elevated/surface/canvas mix'). The resolution must be the AC's comment branch, citing V2
- The V2 prototype's wizard screen markup (`Birdbrain.dc.html:3528`) shows a full rework with borderless transparent fields; do not pixel-match the raw markup for this ticket - no wave-1 ticket covers the wizard rework, and the SCREEN_NOTES token ruling is the applicable truth
- The repository's committed V1 notes (`docs/design-handoff/2026-08-10-.../SCREEN_NOTES.md`) still say `bg-elevated`, so the new code comment and the old doc will disagree until the V2 bundle lands in the repository - the comment should cite the V2 bundle path/date explicitly
- Definition-of-done fold-in: no visual change means no density/hover regression surface; the wizard field stays the one 14px/px-3 py-2 density exception per V2, which the current `className` already implements

**Open questions.**
- V1-vs-V2 ruling conflict: the issue's quoted source (`bg-elevated`) is superseded by the V2 bundle (recessed fill = `bg-canvas`). Confirm #563 closes via the AC's comment branch with a V2 citation and no visual change - and whether the maintainer wants the committed V1 SCREEN_NOTES copy annotated/superseded in this PR or left to the wave's V2-bundle import
- `CreateCaseDialog.tsx` is unreferenced in `src/` and `tests/` (dead code; /cases/new renders NewCaseWizard). The issue asks to check it - disposition wanted: leave as-is, restyle to the V2 wizard exception anyway, or file a separate removal ticket
- Cosmetic-only: keep rounded-xl (current, asserted by the #425 test, aliases to 6px via the radius collapse) or rename to rounded-lg to match the V2 note's '6px' literally? Both render identically; renaming forces test edits

### #622 - diagnostics: surface unreconciled deletion entries (chain valid, capture row still live)

Build a read-only check that joins manifest `deletion` entries against live `captures` rows and reports each deletion entry whose `captureId` still has a live row as an `unreconciled-deletion` finding, surfaced in Settings -> Diagnostics. The state arises when `withDeletionEntry` (`manifest.ts` write-ahead seam) `fsyncs` the deletion entry but the process dies before `store.deleteArtifacts`/`captureRepo.deleteCapture` complete (or the rollback truncate itself fails - captureLifecycle.ts:566 deliberately rethrows there): the chain verifies valid while the DB disagrees. Automatic repair is impossible (the manifest holds the claim, not the data); recovery is re-running delete, which appends a clean entry - verified feasible because `deleteArtifacts` guards each unlink with `existsSync` (captureStore.ts:226-237), so already-gone files don't throw. The ticket also asks for a recorded decision on whether the standalone verifier reports the same finding for a package.

**Acceptance criteria.**
- Finding is produced for the crash state (valid trailing deletion entry + live capture row) and not for a clean case
- Wording states exactly what is known per ADR-0004: chain valid; capture row still present; files state unknown
- Recovery action (re-run delete on that capture, appending a clean entry) documented and tested
- Verifier CLI decision recorded and, if in scope, implemented

**Prototype references.**
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/Birdbrain.dc.html` ~lines 3122-3150 (the `stDiagnostics` sc-if block): the prototype's Diagnostics tab is only a card header (10px uppercase faint title, 28px/4px-radius buttons 'Export logs' / 'Report a problem') plus a mono log viewer - it renders no snapshot sections and no unreconciled-deletion UI, so there is NO pixel truth for the new finding section; follow the existing DiagnosticsPanel Section/StatBlock idiom
- `/tmp/bb-handoff-2026-08/design_handoff_birdbrain_prototype/screenshots/08-settings.png`: shows the Settings shell restyle (Capture tab selected; Diagnostics is a sidebar item but its panel is not depicted)
- `HANDOFF.md` 'Monospace' notes + `README.md` style summary: mono is machine output only (hashes, ids, diagnostics log); numerics take tabular-nums; all surfaces/borders/text from --color-* tokens (status/severity colors like red/amber remain the allowed exception, matching the current panel)

**Files.**
- `src/main/services/deletionReconciliation.ts` (create) - The check lives in a service, not `diagnosticsRepo`: `diagnosticsRepo` is DB-only (`getDb`) and the manifest is a per-case JSONL file. Enumerate `caseRepo.listCases(`), read each case's manifest via `readManifestSnapshot(store.caseDir(caseId`)) (lenient `readEntries`), run verifyManifestChain per case so the 'chain valid' claim is actually established, collect deletion entries, join `captureId` against `captureRepo.getCapturesByIds` scoped to the scanned case's DB id (NOT the entry's `caseId` field - imported chains carry the source `caseId`). No new SQL, so the `getDb` lint fence is untouched. Guarded like `diagnosticsRepo`: uninitialized db/storage yields an empty/unavailable result, never a throw.
- `src/shared/types.ts` (modify) - Add UnreconciledDeletionFinding: `caseId`, `caseName`, `captureId`, `manifestIndex`, entry timestamp, `operatorName`, optional reason (the #580 reason field distinguishes self-test cleanup from operator deletion).
- `src/shared/ipc.ts` (modify) - New channel DIAGNOSTICS_UNRECONCILED_DELETIONS: 'diagnostics:unreconciledDeletions' ({ `args`: []; result: UnreconciledDeletionFinding[] }). Deliberately NOT folded into diagnostics:get - the panel polls that every `2s` and this check readFileSync's every case manifest + verifies signatures on the main process.
- `src/main/ipcHandlers.ts` (modify) - Register the handler next to the existing DIAGNOSTICS_GET registration (line ~765).
- `src/preload/index.ts` (modify) - Add bridge entry to the diagnostics namespace (line ~174).
- `src/renderer/lib/api/diagnostics.ts` (modify) - Add on-demand `queryOptions` (no `refetchInterval`; fetched on mount / manual refresh).
- `src/renderer/lib/api/keys.ts` (modify) - Add query key alongside queryKeys.diagnostics.
- `src/renderer/components/settings/DiagnosticsPanel.tsx` (modify) - New Section in the Snapshot tab listing findings with ADR-0004 wording (chain valid; capture row still present; files state unknown) and the recovery instruction (re-run delete on the capture). Empty state: 'none found'. Reuse the Section/list-row idiom; ids in mono per the bundle's monospace rule; keep findings out of the redacted Copy-report payload or redact capture/case identifiers consistently with `handleCopy's` existing policy.
- `src/shared/verify/evidencePackage.ts` (modify) - CONDITIONAL (verifier-CLI decision): a package-level analogue would flag deletion entries whose `captureId` appears in evidence.json's capture list. Note: section 7.5 coverage already hard-FAILs this state ('`evidence.json` lists capture X absent from the verified manifest'), and CheckStatus has no 'warn' value - see open questions.
- `src/verifier/cli.ts` (modify) - CONDITIONAL: only if a new check status/name is added; `printReport` maps pass/fail/skip today.
- `src/main/services/verifyRunbook.ts` (modify) - CONDITIONAL: packaged `VERIFY.md` text may need a sentence if verifier output gains the finding.

**Migration.** None.

**IPC changes.** One new channel: `diagnostics:unreconciledDeletions` (`args`: []; result: UnreconciledDeletionFinding[]), added to IPC_CHANNELS, the payload map, and the preload `diagnostics` bridge. Kept separate from `diagnostics:get` because DiagnosticsPanel polls that snapshot every `2s` and this check is a full per-case manifest read + signature verification on the main process.

**Archive impact.** None on the export/import round-trip: no format, schema, or manifest change. Imported chains are safe from false positives - deleted captures are never imported (no live row exists under either original or remapped id), and the join is scoped to the scanned case's DB id rather than the entry's embedded source `caseId`, so ID_PROBE_TABLES collision remapping cannot alias a finding onto another case's capture.

**Evidence impact.** The app-side change is read-only on the evidence path - verified against the code: the check uses `readManifestSnapshot/readEntries` (lenient read-only parsers) and verifyManifestChain; nothing writes `manifest.jsonl`, no schema change, no change to chain-verification or export-packaging semantics. The PR Evidence impact section must state: (1) adds a read-only reconciliation check joining manifest deletion entries against live capture rows, surfaced in Settings -> Diagnostics; (2) the finding's wording claims only what is known - chain valid, capture row still present, on-disk file state unknown (ADR-0004); (3) the recovery action is the pre-existing, unchanged delete seam (withDeletionEntry), which appends a new signed deletion entry - an evidence-path write, but not a new one; (4) IF the verifier-CLI portion ships, that alters evidence-package verification output and its interpretation (today this state already produces a section 7.5 coverage FAIL) and must be called out as its own evidence-affecting change, gated per ADR-0005.

**Tests.**
- `tests/main/services/deletionReconciliation.test.ts` (new, node project): build the crash artifact with appendManifestEntry + a live row in a temp db/case dir -> finding produced; clean case -> none; chain-invalid case -> reported as chain-invalid, not as unreconciled-deletion; imported-chain shape (entry `caseId` != scanned case id) -> no false positive
- `tests/main/services/captureLifecycle.test.ts` (node project, exists): recovery-path test - re-run delete on the artifact state (files already gone), assert a clean deletion entry appends, row deleted, chain valid, finding clears; the batch-ops brief's 'crash mid-item' seam (#394) already asserts the on-disk state to reuse
- `tests/components/DiagnosticsPanelUnreconciled.test.tsx` or extend an existing settings component test (web project, jsdom): section renders findings with the ADR-0004 wording and the empty state
- `tests/shared/verify/evidencePackage.test.ts` (node project, exists): only if the verifier-CLI decision lands as implemented

**Conflicts with other wave-1 tickets.**
- `src/shared/ipc.ts` - also edited by #389 (mention/references channels), #400 (per-case exclusion channels), #403 (recent-activity query channel); channel-constant merge conflicts likely
- `src/shared/types.ts` - same tickets add domain types
- `src/main/ipcHandlers.ts` and `src/preload/index.ts` - same tickets register/bridge their channels
- `src/main/services/captureLifecycle.ts` - #622 only adds tests against it, but #396 consumes the merged #394 `deleteMany` surface; test-file overlap in `tests/main/services/captureLifecycle.test.ts` is possible with #396
- `DiagnosticsPanel.tsx`, `deletionReconciliation.ts` - no other wave-1 ticket touches them

**Risks.**
- Cost of the honest claim: to state 'chain valid' per ADR-0004 the service must actually run verifyManifestChain (signature verification over every entry) per case, plus a full manifest read - do this on demand only, never inside the `2s`-polled diagnostics:get, or the check itself becomes the event-loop stall the panel exists to report
- `readEntries` is lenient (bad lines -> {}), so a corrupt deletion line silently drops out of the scan; running verifyManifestChain first and reporting chain-invalid separately keeps the finding from claiming validity over a chain it cannot see
- Copy-report leakage: DiagnosticsPanel's `handleCopy` redacts paths/URLs before the clipboard; the new findings carry case/capture ids and operator names and need the same treatment decided deliberately
- Export interaction already exists: a package exported in this state packages the live row (possibly with its content file missing) while the chain-derived active set excludes it, so the verifier already FAILs coverage and capture-content checks - the diagnostics finding explains a state the export path surfaces confusingly
- Definition-of-done (density/tokens): the new section must hold up at all three density steps and use semantic tokens; the prototype gives no pixel truth for it, so match the existing panel idiom and the bundle's mono/tabular-nums rules

**Open questions.**
- Verifier CLI (AC4): PackageVerifyResult's CheckStatus is 'pass'|'fail'|'skip' - there is no 'warn', and section 7.5 coverage already hard-FAILs a package exported in this state. Should the finding (a) be a new named check using 'skip' with an explanatory reason, (b) introduce a 'warn' status (shape change to PackageVerifyResult, `cli` `printReport`, and tests), or (c) only enrich the existing coverage-FAIL reason text? Softening the existing FAIL to a warning would change an evidentiary verdict and needs a maintainer ruling.
- Scope of the in-app surface: the issue says Settings -> Diagnostics 'and/or in-app verify output for the case'. VerifyBar takes only verified/unverified/tampered counts, so adding a fourth state ripples into `overviewModel` and the Overview layout owned by the redesign - is Diagnostics alone acceptable for wave 1?
