# Redesign program: `ultracode` session prep (wave 3)

Prepared 2026-08-23. Parent specification: #382. Companion documents:
`docs/plans/2026-08-21-redesign-wave2-ultracode-prep.md` (wave 2),
`docs/plans/2026-08-22-wave2-finish-status.md` (what wave 2 ended up waiting on),
`docs/plans/2026-08-19-wave1-implementation-notes.md` (adjudications that still bind).
Pixel truth: `docs/design-handoff/2026-08-21-birdbrain-standalone/`. Read that folder's README
first; the file ships packed, so a plain grep for `onClick` or `viewBox` finds nothing.

**This is the last wave.** It closes every remaining item on the redesign project board and every
open `redesign`-labelled issue that carries scope, which closes #382.

**Amended 2026-08-23, after the rulings below.** The wave is **thirteen** items, not fifteen: #663,
#699 and #707 closed as resolved rather than built, and #803 (the Data screen rebuild) was scoped in
their place. It carries **five** evidence reviews.

## Program state

Wave 2 merged completely on 2026-08-22: #709, #710, #711, #766, #777, #779, #786, plus the docs
pass #788. Verified against `origin/main` at `edc5db44`. `LATEST_SCHEMA_VERSION` is **30**
(`src/main/services/db/core.ts:6`, migrations tail is the v30 block) and
`CASE_ARCHIVE_SCHEMA_VERSION` is **3** (`src/main/services/caseArchive.ts:64`).

**Amended again 2026-08-23, after phase 1.** A thirteen-reader `ultracode` pass read every ticket
against `origin/main` at `0bf207e5` and corrected this document in nineteen places, each marked
below with **Corrected after phase 1**. The two that change what an implementer does are the #398 chain-break
mechanism (it is not in `manifest.ts`) and #393's evidence tier (blocking, not none). Phase 1's
notes, its sharpened conflict map, its eleven blocking questions and its readiness verdict per
ticket are in `docs/plans/2026-08-23-wave3-phase1-understand-notes.md`.

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
| #393 extension in-page bar | `content.ts` selection bar, suppression protocol | #392 | **yes, see below** |
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

**#401 is evidence-affecting.** *Corrected after phase 1: the label was applied, so this line was
stale.* Two independent reasons. Its acceptance
criteria include a line reading `Pinned Wayback Refs appear in the Evidence Package report as
corroboration references`, which changes what ships inside a package. And `src/main/services/reportHtml.ts`
contains zero occurrences of `wayback` today, so that is new rendering in a blocking-tier file, not
a display tweak. It also rewrites `WaybackTab.tsx`, itself blocking-tier.

**#405 is evidence-affecting.** *Corrected after phase 1: it carries the label already, and
"adjacent" understates it. The demo mark's round trip runs through `caseRepo.importCaseRow` and the
fresh-install operator-name question sits inside `caseArchive.ts`, both blocking tier.* The demo
Case imports through
`src/main/services/caseArchive.ts`, blocking tier. #707 already names the risk in plain terms: an
operator who exports the demo Case by accident hands a court a case full of fixture data. The
ticket has no acceptance criterion covering that, and it needs one before it is dispatchable.

**#393 is evidence-affecting and carried no label.** *Found by phase 1; the label has since been
applied.* Three independent blocking-tier paths: `extension/src/content.ts` (assessment:162), where
the bar mounts; `extension/src/background.ts` (:161), because the content script imports nothing
from `utils/api` and its only fetch is a `data:` URL, so every server call is relayed through the
service worker; and `extension/src/utils/api.ts` (:164), where those relayed calls land.
Substantively too: the change injects a persistent element into the page that `saveAsMHTML`
serialises and every screenshot slice renders, which is the defect class #386 was opened for.

## Rulings, all eight settled 2026-08-23

Recorded on each issue. Three of the eight ended in a closure rather than a build.

1. **#701 context menus.** Adopt, one shared component plus a per-kind registry, one ticket.
   **Four kinds** (capture, note, selector, tag), not the mock's thirteen. **The menu is an
   accelerator, never the sole route**: every action must also be reachable inline or by keyboard.
   `ui/` has no menu primitive today. *Corrected after phase 1: the accessible one does not have to
   be written.* `radix-ui` ^1.6.1 is already a **production** dependency (`package.json:145`), it
   re-exports `@radix-ui/react-context-menu` 2.3.2, and the repository already consumes it at
   `ui/tabs.tsx:3` with shadcn configured in `components.json`. Adopting it is a zero-new-dependency
   change supplying roles, roving `tabindex`, typeahead, focus return, Escape, outside-click, portal
   and collision-aware positioning. Hand-rolling those is roughly 250 avoidable lines that the
   90%-changed-line coverage gate then has to cover, and this repository has already got it wrong
   three times: `CaptureMenu`, `CaptureDownloadMenu` and `ExportMenu` all carry `role=menu` and
   Escape and zero focus management. This moves #701 from large to medium. *Also corrected: the
   #686/#687 ordering is soft, not hard.* A context menu is `role=menu`, never `role=dialog`, so
   neither fix reaches its code path, and the Escape-precedence mechanism #701 needs already exists
   and is tested (`useCaptureSelection.ts:85`). Keep a preference that #686 goes first if both hold
   a slot, since it owns that file; do not gate #701's dispatch on it. `file`, `folder`, `part`
   and `ledger` are deferred to #803, which builds the rows they attach to.
2. **#702 Recording indicator.** Reflects `sessionActive`, not `autoCaptureMode`, and **the Connected
   chip never hides**. Both are divergences from the mock, recorded on #708. Auto-capture stays a
   Signals concern, shown where it is set.
3. **#704 archived-copy banner.** States the **capture time**, on the **Page tab only**. Verification
   state stays with `ProvenanceBadge` so the two cannot drift. No collision with #401's non-evidence
   label, which is a different and stronger claim on a different tab.
4. **#695 per-list search.** A **client-side title and URL filter** over the loaded list, not FTS.
   `SearchBar` finds across the case; this narrows what is on screen. Intersects with selector
   filters, and one control clears both.
5. **#707 Browser affordance.** **No.** Birdbrain gets no in-app browsing surface; capture happens in
   the operator's real browser through the extension, and a second acquisition path was never asked
   for. Recorded on #708. **#707 closed**, its demo-Case half folded into #405.
6. **#405 demo Case marking.** A **demo flag on the Case**, surfaced in the export dialog and stated
   in the Certification. It rides **#399's v31 migration** alongside `case_number`, so #399 lands the
   field and #405 consumes it. Export is not blocked and the package still verifies; the fix is that
   it now says what it is.
7. **#699 Data Explorer.** **Option 2, and my earlier reading was wrong.** #699's body says no
   prototype artifact exists beyond `SCREEN_NOTES.md:73` and I repeated it. The standalone mock
   carries a full retooling: a three-group tree (Data Sources, Views, Results), an artifact table with
   a per-artifact `SHA-256` column, and tabs for Extracted Text, MHTML Parts, Headers & TLS, Manifest Ledger and
   Properties. Scoped as **#803**, evidence-affecting, **re-presenting existing data only**.
   `network.har` is excluded because the app captures no HAR; that is **#804**, a spike, because it is
   new acquisition with a credential-disclosure problem attached. **#699 closed** in favour of #803.
8. **#663 hover checkbox.** **Closed, no work.** The V2 bundle it targets was superseded by the
   standalone mock, and #708 item 9 already ruled the app keeps the checkbox with
   `e2e/capture-multiselect.spec.ts` green. The metrics #396 shipped are the record.

### What the rulings changed about the wave

- **Sixteen items became thirteen.** #663, #699 and #707 closed; #803 was added.
- **#803 is the wave's newest and largest unknown**, and it is evidence-affecting. It did not exist
  when this document was written this morning.
- **#399 grew by one column.** v31 now carries `case_number` and the demo flag.
- **Seven evidence reviews.** *Corrected after phase 1; this line said five.* #392, #393, #398,
  #399, #401, #405, #803.
- #804 is filed but **not in the wave**. It is `needs-triage` and needs four questions answered
  before it can be scoped.

## Conflict map

Lighter than wave 2's. The three tracks barely touch each other; the contention is inside track A.

**Migration order.** Only **#399** needs schema, claiming **v31**, and it bumps
`LATEST_SCHEMA_VERSION` to 31. *Corrected after phase 1: v31 carries **both** the Case
`case_number` column **and** ruling 6's demo flag. This paragraph said `case_number` alone, which
contradicts the rulings section two pages above it; an implementer reading only the map writes a
one-column migration and #405 is blocked.* Nothing else in the wave migrates, so there is no
ordering constraint between tickets on `migrations.ts` or `core.ts` for the first time in three
waves.

*Corrected after phase 1: the archive round trip is not in `caseArchive.ts`.* That file holds no
`cases` column list. `collectCaseRow` is `SELECT *`, so both new columns travel into `data.json`
with no code at all. The import half is `caseRepo.importCaseRow:148-169`, a hand-written
nine-column INSERT where a column absent from the list is silently dropped. #399 must add both
columns there in one edit, or #405 re-opens a blocking-tier file to add the second. Per the wave-1
adjudication a plain additive column that an old app drops on import does **not** need a
`CASE_ARCHIVE_SCHEMA_VERSION` bump, so it stays at 3. Phase 1 contested that for the demo flag
specifically, on the grounds that a flag whose purpose is to warn a court is the "silently discard"
limb the constant's own comment describes. The ruling can stand, but it should stand on the demo
flag's own merits rather than on a precedent set by a display-only column.

**The export chain, `src/main/services/export.ts` and `manifest.ts`.** #398 and #399 both write
here and #401 adds to the report. Strict serial, #398 first.

- #398 adds `scope` and `captureIds` to the `export` entry at `manifest.ts:291-303` and its call
  site at `export.ts:387-396`. **Both fields must be omitted when absent, never `null` or `''`.**
  The conclusion holds. **The mechanism this document gave for it was wrong, and it pointed
  implementers at the wrong file.** *Corrected after phase 1.* Adding a key to a TypeScript input
  type cannot touch entries already on disk, because verification re-canonicalizes each entry from
  its own parsed JSON, so a legacy entry keeps its bytes and its hash. The two ways this really
  breaks a legacy chain both live in **`src/shared/schemas.ts:373-389`**, which this document never
  named: the schema is `.strict()`, so a required key makes every legacy `export` entry fail the
  parse with `Invalid entry shape`, and a Zod `.default()` injects the key into
  `schemaResult.data`, which the chain walker pushes and re-hashes, giving `Entry hash mismatch`.
  New keys are therefore `.optional()` with **no** `.default()`. The writer-side omission rule
  survives for a different reason: writing `scope: 'case'` produces a new on-disk shape that
  already-distributed verifier binaries reject under `.strict()`. `manifest.ts` already documents
  the omit-when-absent pattern for `screenshotHash`, `headers`, `tls` and `method`; follow it, and
  add `src/shared/schemas.ts` to the ticket's starting-file list.
- #399 extends `certification.ts` and `ExportDialog.tsx` on top of that, and rebuilds the dialog
  wholesale.
- #401 adds pinned-ref rendering to `reportHtml.ts`, which has no wayback code today. *Corrected
  after phase 1: its region is not disjoint.* `reportHtml.ts` cannot render refs the export never
  loaded, so #401 also writes the `ExportData` literal at `export.ts:262-291`, the same
  blocking-tier file #398 edits, and the mock puts a Pinned Wayback snapshots block inside the
  export dialog (template 12797-12811), so #401 also writes `ExportDialog.tsx` after #399 rebuilds
  it. Neither file appeared in this document's #401 row. #401 should extend the existing
  per-exhibit corroboration block at `reportHtml.ts:964-978` rather than add a tenth
  `ReportModuleId`, which would raise the collision odds with #399.

**`src/shared/verify/**` and `src/verifier/**`.** *Corrected after phase 1: not #398 alone.*
#399's acceptance criterion 2 asks the standalone verifier to say "not a verifiable object" rather
than FAIL for a Working Copy. Today `verifyEvidencePackage` returns `pass: false` with
"manifest.jsonl missing from package" (`evidencePackage.ts:88-95`) and `cli.ts` exits 1. There is no
third outcome and no marker check, and that decision lives in the same blocks #398 rewrites to scope
the capture set. Strict serial, #398 lands the shape change including any widening of
`PackageVerifyResult`, #399 supplies only the Working Copy marker and its detection. Two branches
independently widening that type is a semantic conflict a textual merge will not catch.

**The capture server, `src/main/services/captureServer.ts`.** #392 alone in this wave. It adds
token-guarded write routes beside the existing ones. *Corrected after phase 1: the unqualified form
of this claim is dangerous.* The guard at `captureServer.ts:147-156` tests
`c.req.method === 'POST'` and nothing else, and Hono runs middleware registered before the matching
route. A new route inherits the guard **if and only if it is a POST registered after the `app.use`
block**. Registering above it, or using GET, PUT, PATCH or DELETE for a write, produces an
unauthenticated write endpoint on loopback, and nothing in the code prevents either. This bears
directly on #392's URL-lookup route, which reads like a GET and would leak whether a case holds a
given URL to any local process. Tracked as #817.

**`extension/src/`.** #393 owns `content.ts` and the selection bar; #392 does not touch the
extension. #393 must route its bar through the existing suppression protocol in
`extension/src/captureSuppression.ts` rather than adding a second mechanism (#386 exists precisely
because injected UI landed inside captured bytes). *Corrected after phase 1: that constraint is
unbuildable read literally.* The existing protocol is a stateless one-way strip with no page-side
restore and no in-force flag; it covers the toast and the highlights only because both are
background-driven and the background gates them. A bar raised by a page `mouseup` cannot be gated
that way. #393 must **extend** the protocol with a latch plus a release message from the restore
effect, and must add the bar's host id to `removeInjectedBirdbrainUi`, which that module's own
header comment says is kept in step by hand. Registering a teardown alone silently reopens #386.
Neither `captureSuppression.ts` nor `captureHygiene.ts` is on the evidence path list in either
direction; tracked as #807.

**The note editor, `src/renderer/components/notes/`.** #391 alone. `NoteEditor.tsx` is 128 lines and
`useNoteEditor.ts` 126, both small enough that the selection bar belongs in a new sibling rather
than inside either.

**Selector creation.** #391 creates selectors with `origin: 'note'`.
`SELECTOR_ORIGINS = ['extension', 'capture', 'note', 'manual']` already exists at
`src/shared/types.ts:660`, so this is a call-site value, not a schema change. #395 did the work.

**Shared IPC spine.** *Corrected after phase 1 on three counts.* #392, #398, #399, #401 **and
#803** append to `src/shared/ipc.ts`, `src/shared/types.ts` and `src/main/ipcHandlers.ts`.
**#391 appends to none of them**: every channel and payload field it needs already exists, including
`origin` on `CreateSelectorParams` (`ipc.ts:337-343`) and `'note'` in `SELECTOR_ORIGINS`
(`types.ts:660`). And **`src/preload/index.ts` belongs on this list** and was missing from the map
entirely; it enumerates every channel by hand, so each new channel needs an explicit bridge entry.
Append-only as always; second-to-land resolves. All are **advisory** tier since ADR-0014, so
touching them no longer pulls a ticket into the evidence gate on its own.

**Onboarding.** #405 alone, and it lands last by construction: it spotlights five screens that the
rest of the wave builds.

## Track shape and merge order

Three tracks, one per slot.

- **Track A, export.** #398 → #399, then #401 joins behind #398. Two evidence reviews plus #401's.
  The deepest chain and the wave's critical path.
- **Track B, extension and server.** #392 → #393. One evidence review.
- **Track C, independent.** *Corrected after phase 1, which reordered this track and added two
  tickets to it.* Cheapest first: **#702** (a three-line deletion in `ConnectionStatus.tsx`; the REC
  pill already ships at `TopBar.tsx:118-123`), then **#695**, #391, #701, #704, then #803's menu
  split. All non-evidence and auto-merge-eligible except #704, which stays non-evidence only if it
  mounts in `CaptureViewer.tsx` and never edits `MhtmlViewer.tsx`.

**#695 is not paperwork.** *Corrected after phase 1.* Ruling 4 rules it to be **built**: a
client-side title and URL filter across three renderer files plus tests. This document listed it
among the paperwork items, which dropped it from every track and from the merge order. Its ruling
premise does hold, verified: `listCaptures` is `SELECT *` with no `LIMIT`, the query fetches once
with no pagination, and `CaptureList` maps every capture with no windowing, so a client-side filter
searches 100% of the case and can produce no false negative.

Paperwork items (#699, #663, #708, and the #707 outcome) take no slot and can land any time after
their rulings.

**#405 goes last and alone**, after #399 merges and after the case tour's five target screens exist.

Merge order, *revised after phase 1*: **#702 → #398 → #392 → #695 → #391 → #399 → #401 → #393 →
#701 → #704 → #803a-d → #405.** Four substantive changes. #695 and #803 were both absent from the
old order, the first misfiled as paperwork and the second created by ruling 7 the same day this
document was written. The export chain deepens from three to four, #398 → #399 → #401 → #405,
because #401 must now write `ExportDialog.tsx` after #399 rebuilds it and #405 consumes #399's v31
demo column. And #702 moves to the front because it is a single deletion that warms a slot at
near-zero cost while track A's three blocking questions are answered.

## Session process rules

Unchanged from wave 2 except where ADR-0014 moved them.

- Agent-written diffs open as `birdbrain-agent`, draft, labelled `agent-authored`, `agent-pr` when
  they take a slot. Reviewer pre-pass on every push.
- #392, #398, #399 and #401 carry `evidence-affecting`, an Evidence impact section, human review,
  and never auto-merge (ADR-0004, ADR-0005, unchanged by ADR-0014).
- Non-evidence tickets in this wave (#391 and the extras; **not #393**, see above) may auto-merge
  on required checks
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
in a second place. *Corrected after phase 1: right about the destination, wrong about the shape.*
The handler at `index.ts:234-247` enforces one hard-coded rule, allow a single initial navigation
whose URL starts with `file://` and block everything else, for **every** webview in the app, and it
is simultaneously the MHTML evidence viewer's only navigation guard. A Wayback webview must load
`https://web.archive.org` and tolerate its redirects, so #401 has to **modify** that invariant into
a partition-aware policy rather than add beside it, and a wrong discriminator silently loosens the
evidence viewer. There is no `will-attach-webview` handler anywhere in `src/`, no permission handler
on any renderer-facing session, and no `will-download` listener. Extract the decision to a pure
`src/main/webviewPolicy.ts` with unit tests, following the `windowSize.ts` and `windowReveal.ts`
precedent. This is the branch's highest-risk edit. Related: #810.

**E2E per ticket** as each specifies: selection-to-selector round trip (#391), HTTP-seam tests
covering happy path, auth failure, capture failure and duplicate-URL resolution (#392), preset
selection and both export classes (#399), open-panel/pin/compare (#401), the full case tour
including the delete ending (#405).

## Model and effort per phase

Ruled 2026-08-23. Waves 1 and 2 set neither, so every agent inherited the session model at default
effort. That is the gap this section closes.

**Phase 1, understand: uniform `high` effort, session model.** All thirteen readers and the
synthesizer. The alternative considered was tiering by expected difficulty, with `low` for the
already-ruled small tickets (#702, #704, #695, #708) and `high` for the unknowns (#803, #398, #392).
Rejected: the tiering depends on my guess about which tickets are easy, and #699 is this morning's
evidence that such a guess can be wrong in the expensive direction. Uniform `high` costs more and
cannot under-resource a reader I misjudged.

**Phase 2, implement: session model, tiered effort.** *Settled after phase 1.* `max` for #398,
#399 and #803, each of which carries an unresolved mechanism plus a very-large or deep-serial diff.
`high` for #392, #393, #401, #405, #695, #391 and #701. `medium` for #702, #704 and #708, each a
single file plus a test with no open mechanism. The tiering this paragraph refused to guess at is
now measured: it moved five tickets in both directions, #702 down to a three-line deletion and #399
and #803 up to very-large. Running phase 2 uniformly at `max` would spend the most on a deletion.

Original wording follows. Decide it when phase 1's output shows which
tickets are actually hard rather than which ones look it.

**Phase 3, review: `fable` for the adversarial verify stage.**

The reason is the only measured model finding this repository has.
`docs/plans/2026-08-16-codex-doc-curator.md` records an A/B (n=3x3) in which Opus invented an
unsupported claim twice and Fable never did, which is why the doc curator runs Opus as author and
Fable as reviewer. A fabricated finding on an evidence-affecting pull request costs a real review
round, so the failure mode matches the job.

**State the caveat wherever this is cited:** that A/B measured prose editing under hard numeric
limits, not code review. Carrying it across is a reasonable bet, not an established result. Five of
this wave's thirteen tickets are evidence-affecting, so if Fable's verify output turns out worse
here, that is worth recording as a second data point rather than quietly reverting.

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
  and #687 preceding #701 is a preference rather than a requirement; see ruling 1 above.
- **#771 must be ruled or declared out of #405's scope before #405 starts.** *Added after phase 1.*
  Its options 2 and 3 both edit `useTourEngine.start()` at 176-201 and `completionAfter`, which
  #405 also edits for the delete-demo ending. This document named #771 as adjacent but gave it no
  ordering.
- **Phase 1 filed twelve defects** the readers found outside every wave-3 ticket: #807 to #818.
  Three are evidence path-list gaps, and #810 and #817 are security findings on the webview
  partition and the capture-server token guard.
- #764 (re-ratify #402's evidence disposition) and #771 (a tour chapter displaced on its first step
  is recorded complete) are both still open and both touch surfaces this wave extends. #771 in
  particular lands in #405's territory.
