# Redesign program: `ultracode` session prep (wave 3)

Prepared 2026-08-23. Parent specification: #382. Companion documents:
`docs/plans/2026-08-21-redesign-wave2-ultracode-prep.md` (wave 2),
`docs/plans/2026-08-22-wave2-finish-status.md` (what wave 2 ended up waiting on),
`docs/plans/2026-08-19-wave1-implementation-notes.md` (adjudications that still bind).
Pixel truth: `docs/design-handoff/2026-08-21-birdbrain-standalone/`. Read that folder's README
first; the file ships packed, so a plain grep for `onClick` or `viewBox` finds nothing.

**This is the last wave.** It closes every remaining item on the redesign project board and every
open `redesign`-labelled issue that carries scope, which closes #382.

## Program state

Wave 2 merged completely on 2026-08-22: #709, #710, #711, #766, #777, #779, #786, plus the docs
pass #788. Verified against `origin/main` at `edc5db44`. `LATEST_SCHEMA_VERSION` is **30**
(`src/main/services/db/core.ts:6`, migrations tail is the v30 block) and
`CASE_ARCHIVE_SCHEMA_VERSION` is **3** (`src/main/services/caseArchive.ts:64`).

Seven board tickets remain, and every blocker outside the wave is closed. Eight more
`redesign`-labelled issues sit off the board; the maintainer ruled on 2026-08-23 that they join
this wave rather than outliving the program.

### The rules changed before this wave, deliberately

ADR-0014 (`docs/adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md`) landed first,
because wave 3 carries three evidence-affecting tickets against wave 2's one and wave 2 stalled on
merge-gate rules rather than on code. Three changes bear on how this wave runs:

- **The path list is tiered.** A `blocking` hit keeps the full ADR-0004 obligations; an `advisory`
  hit is a one-line reviewer disposition owing no Evidence impact section. The distribution block
  is advisory, so a lockfile change no longer drags a ticket into the evidence gate.
- **Three concurrent cycles, not one.** Which is what makes the three tracks below real.
- **Every agent branch is cut from `main`.** Not optional. Wave 2's four stacked branches are why
  #769 ran no CI at all, and three slots make stacking easy for the first time.

## Wave 3: the ticket set

### On the board

| Ticket | Area | Blocked by | Evidence |
| --- | --- | --- | --- |
| #391 notes selection-to-Selector/Tag | note editor selection bar, typed confirm popover, selector origin `note` | nothing | no |
| #392 extension write endpoints | `captureServer` routes, URL canonicalization, auto-capture-then-attach | nothing | yes |
| #398 selection-scoped export | `export.ts`, `manifest.ts` export entry, verifier reconciliation | nothing | yes |
| #399 export dialog, two classes | `ExportDialog`, `certification.ts`, case number, migration v31 | #398 | yes |
| #401 Wayback slide-out | `WaybackTab` to panel, sandboxed webview, refs in the report | #398 | **yes, see below** |
| #393 extension in-page bar | `content.ts` selection bar, suppression protocol | #392 | no |
| #405 case tour and demo Case | tour chapter, bundled Case Archive, import path | #399 | **see below** |

### Off the board

Three of these produce no `src/` code at all, which is exactly why they are easy to lose.

| Ticket | What it is | Needs a ruling |
| --- | --- | --- |
| #701 right-click context menus | 23 handlers across 13 entity kinds in the mock, zero in the app | yes |
| #702 top-bar Recording indicator | split out of #400 | yes |
| #704 Page-tab archived-copy banner | provenance surface the mock has and the app does not | yes |
| #695 per-list capture search | ruled out of #397 | yes |
| #707 tour affordances | in-app Browser surface, and the demo Case | yes |
| #699 Data Explorer scope | records a decision in #382 | yes |
| #663 capture-row hover checkbox | amends the bundle on `prototype/design-handoff-2026-08` | yes |
| #708 mock corrections | list to send back to the design side | no |

## Two label corrections, to make before dispatch

Both are triage misses. Naming them now costs a label; finding them at review costs a round.

**#401 is evidence-affecting and carries no label.** Two independent reasons. Its acceptance
criteria include a line reading `Pinned Wayback Refs appear in the Evidence Package report as
corroboration references`, which changes what ships inside a package. And `src/main/services/reportHtml.ts`
contains zero occurrences of `wayback` today, so that is new rendering in a blocking-tier file, not
a display tweak. It also rewrites `WaybackTab.tsx`, itself blocking-tier.

**#405 is evidence-adjacent and carries no label.** The demo Case imports through
`src/main/services/caseArchive.ts`, blocking tier. #707 already names the risk in plain terms: an
operator who exports the demo Case by accident hands a court a case full of fixture data. The
ticket has no acceptance criterion covering that, and it needs one before it is dispatchable.

## Rulings needed before dispatch

None of these has acceptance criteria until it is answered. This is the prep phase's real work, and
seven of the eight are maintainer calls rather than engineering ones.

1. **#701 context menus.** Adopt at all? If yes, one shared component plus a per-kind action
   registry, or per-surface? Every action needs a keyboard route or the menu is unreachable without
   a pointer. Interacts with #686 and #687, both already fixing renderer menu-role problems, so
   those two should land first whatever the answer.
2. **#702 Recording indicator.** `autoCaptureMode`, `sessionActive`, or both with a stated rule for
   auto-capture on with no session? And does the Connected chip really hide while recording, given
   that it is the operator's only signal that captures can arrive?
3. **#704 archived-copy banner.** Capture time, verification state, both, or neither? Every viewer
   tab or the Page tab only? How does it compose with the Wayback pane's own non-evidence label,
   which #401 is separately building?
4. **#695 per-list search.** What it searches (title, title plus URL, or FTS), how it divides
   labour with `SearchBar`, and its precedence against active selector filters.
5. **#707 Browser affordance.** Does birdbrain get an in-app browsing surface at all? This is a
   product question well beyond a tour step, and "no" is a complete answer that closes half the
   ticket.
6. **#405 demo Case marking.** How a demo Case is distinguishable in an export. Needs an answer
   before #405 is dispatchable, and the answer becomes an acceptance criterion.
7. **#699 Data Explorer.** Option 1 (record it as Out of Scope in #382) or option 2 (a scoped
   Stage 4 sibling with a prototype reference attached). The issue itself argues option 1 and I
   agree: no prototype artifact for the screen exists beyond `SCREEN_NOTES.md:73`.
8. **#663 hover checkbox.** Confirm the metrics #396 derived from the selection bar, or restore the
   row markup to the bundle and recapture screenshot 13.

## Conflict map

Lighter than wave 2's. The three tracks barely touch each other; the contention is inside track A.

**Migration order.** Only **#399** needs schema, claiming **v31** for the Case `case_number`
column, and it bumps `LATEST_SCHEMA_VERSION` to 31. Nothing else in the wave migrates, so there is
no ordering constraint between tickets on `migrations.ts` or `core.ts` for the first time in three
waves. #399 also round-trips the field through `caseArchive.ts`; per the wave-1 adjudication a
plain additive column that an old app drops on import does **not** need a
`CASE_ARCHIVE_SCHEMA_VERSION` bump, so it stays at 3.

**The export chain, `src/main/services/export.ts` and `manifest.ts`.** #398 and #399 both write
here and #401 adds to the report. Strict serial, #398 first.

- #398 adds `scope` and `captureIds` to the `export` entry at `manifest.ts:291-303` and its call
  site at `export.ts:387-395`. **Both fields must be omitted when absent, never `null` or `''`.**
  `appendManifestEntry` canonicalizes `{...entry, index, prevHash, schemaVersion}` through
  `canonicalStringify` and hashes that (`manifest.ts:357-364`), so an always-present field rewrites
  every legacy entry's canonical body and breaks the chain on existing packages. The file already
  documents this pattern four times for `screenshotHash`, `headers`, `tls` and `method`. Follow it
  rather than reinventing it; it is also exactly what #398's backward-verification criterion asks
  for.
- #399 extends `certification.ts` and `ExportDialog.tsx` on top of that.
- #401 adds pinned-ref rendering to `reportHtml.ts`, which has no wayback code today, so its region
  is disjoint from #398's and #399's.

**`src/shared/verify/**` and `src/verifier/**`.** #398 alone. No other ticket touches the verifier.

**The capture server, `src/main/services/captureServer.ts`.** #392 alone in this wave. It adds
token-guarded write routes beside the existing ones; the guard at `captureServer.ts:147-158` already
covers every state-changing endpoint, so new routes inherit it rather than re-implementing it.

**`extension/src/`.** #393 owns `content.ts` and the selection bar; #392 does not touch the
extension. #393 must route its bar through the existing suppression protocol in
`extension/src/captureSuppression.ts` rather than adding a second mechanism (#386 exists precisely
because injected UI landed inside captured bytes).

**The note editor, `src/renderer/components/notes/`.** #391 alone. `NoteEditor.tsx` is 128 lines and
`useNoteEditor.ts` 126, both small enough that the selection bar belongs in a new sibling rather
than inside either.

**Selector creation.** #391 creates selectors with `origin: 'note'`.
`SELECTOR_ORIGINS = ['extension', 'capture', 'note', 'manual']` already exists at
`src/shared/types.ts:660`, so this is a call-site value, not a schema change. #395 did the work.

**Shared IPC spine.** #391, #392, #398, #399, #401 all append to `src/shared/ipc.ts`,
`src/shared/types.ts` and `src/main/ipcHandlers.ts`. Append-only as always; second-to-land resolves.
All three are **advisory** tier since ADR-0014, so touching them no longer pulls a ticket into the
evidence gate on its own.

**Onboarding.** #405 alone, and it lands last by construction: it spotlights five screens that the
rest of the wave builds.

## Track shape and merge order

Three tracks, one per slot.

- **Track A, export.** #398 → #399, then #401 joins behind #398. Two evidence reviews plus #401's.
  The deepest chain and the wave's critical path.
- **Track B, extension and server.** #392 → #393. One evidence review.
- **Track C, independent.** #391 first, then the ruled extras #701, #702, #704 as their rulings
  land.

Paperwork items (#699, #663, #708, and the #695 and #707 outcomes) take no slot and can land any
time after their rulings.

**#405 goes last and alone**, after #399 merges and after the case tour's five target screens exist.

Merge order: **#398 → #392 → #391 → #399 → #401 → #393 → #701/#702/#704 → #405.**

## Session process rules

Unchanged from wave 2 except where ADR-0014 moved them.

- Agent-written diffs open as `birdbrain-agent`, draft, labelled `agent-authored`, `agent-pr` when
  they take a slot. Reviewer pre-pass on every push.
- #392, #398, #399 and #401 carry `evidence-affecting`, an Evidence impact section, human review,
  and never auto-merge (ADR-0004, ADR-0005, unchanged by ADR-0014).
- Non-evidence tickets in this wave (#391, #393, and the extras) may auto-merge on required checks
  green plus an `agent/pre-pass` success verdict.
- Verify loop per PR: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`,
  `pnpm build`, plus `pnpm build:extension` when `extension/` changed, plus `pnpm test:coverage`
  and `pnpm coverage:diff` re-run after any edit.
- Definition of done per screen: pixel-match at compact density, hover/empty/keyboard states per the
  bundle, tokens only, legible at all three density steps.
- Anything infeasible as designed: send back the constraint, never a redesign.
- Keep the hosting session open, or resume with `resumeFromRunId`. Background workflows die with the
  session, which is the wave-1 lesson and it has not changed.

## Verification beyond the standard loop

**#398 backward verification, proven not asserted.** Run the standalone verifier against a
pre-scope fixture package and confirm it passes unchanged. The known-answer fixtures its acceptance
criteria call for go in `tests/shared/verify/`, beside `canonicalJson.test.ts` and
`manifestChain.test.ts`.

**#401 webview posture.** The acceptance criteria ask for the posture to be verified by tests where testable and
documented where not, which is the right split. `src/main/index.ts` already enforces
evidence-viewer invariants and is blocking tier; whatever the panel needs belongs there rather than
in a second place.

**E2E per ticket** as each specifies: selection-to-selector round trip (#391), HTTP-seam tests
covering happy path, auth failure, capture failure and duplicate-URL resolution (#392), preset
selection and both export classes (#399), open-panel/pin/compare (#401), the full case tour
including the delete ending (#405).

## Suggested workflow shape

Same three phases as waves 1 and 2, one Workflow call per phase, results read between them.

1. **Understand.** One reader per ticket. Cheaper than wave 2's pass for the seven board tickets,
   whose grounding is in this document; more expensive for the eight extras, which have no prep
   comments at all and five of which need rulings before a reader can say anything useful. Run the
   rulings first and the readers after.
2. **Implement.** One agent per ticket in worktree isolation, three concurrent, the export chain
   serialized, each ending with the full verify loop and a draft PR.
3. **Review.** Adversarial verify per PR: acceptance criteria, pixel conformance, the evidence gate
   on the four labelled tickets, and the tiered backstop everywhere.

## Open items

- **The eight rulings above gate the wave's second half.** #391, #392 and #398 are dispatchable
  today and do not wait on any of them.
- The sixteen queued fixes (#662, #667, #670, #671, #681, #683, #686, #687, #688, #689, #691, #692,
  #771, #782, #534, #764) no longer wait for a wave boundary now that there are three slots. #686
  and #687 should precede #701.
- #764 (re-ratify #402's evidence disposition) and #771 (a tour chapter displaced on its first step
  is recorded complete) are both still open and both touch surfaces this wave extends. #771 in
  particular lands in #405's territory.
