# Wave 3 phase 2 intake: the 23 rulings and the recording plan

Written 2026-08-24, during the phase-2 intake session. The maintainer answered every blocking
question phase 1 raised (`docs/plans/2026-08-23-wave3-phase1-understand-notes.md`), plus the
follow-ups those answers forced and the readiness items the eleven-question list did not cover.
This document exists so the recording pass and the phase-2 dispatch can execute from any machine;
nothing below has been posted to GitHub yet except where the "Already done" section says so.

Companion documents: `docs/plans/2026-08-23-redesign-wave3-ultracode-prep.md` (the wave plan this
amends), `docs/plans/2026-08-23-wave3-phase1-understand-notes.md` (the questions, the per-ticket
readiness lists, and the reader notes every ruling below grounds against).

## Already done, this session

- **#702 is implemented.** Draft PR #822, `fix(shell): keep the Connected chip visible during an
  active session (#702)`, branch `agent/702-recording-indicator` cut from `origin/main` at
  `1b3059dc`, head `cd919164`. Labels `agent-authored` + `agent-pr` verified by direct label read.
  Verify loop: lint, typecheck, build green; its three new tests pass; `coverage:diff` reports
  `NOT SCORED — no instrumented source lines changed` (the src change is a pure deletion, as the
  acceptance-criteria comment predicted). 14 test failures on the Windows host were proven
  pre-existing and environmental, and filed as **#821** (invisible to ubuntu-only CI).
- **`agent/pre-pass` on #822 is `pending`** at `cd919164`, posted per the dispatch contract. The
  reviewer has NOT run. Left standing deliberately: pending is the same state the gate's own seed
  writes for an unreviewed agent PR. The recording plan below includes running the pre-pass.
- Nothing else. No ruling comments posted, no tickets filed, no prep-doc amendment.

## The rulings

Numbered R1–R23. Where a ruling **overrides** phase 1's recommendation it says so; four do.
"Q*n*" references the blocking-question numbering in the phase-1 notes.

### Track A — export and evidence

**R1 (Q1, #398/#399) — trusted `captureIds` ships as a signed `export-entry.json` package
member.** Restructure `generateReport` so `buildEvidenceZip` returns entries plus `packageHash`
without writing; append the manifest entry (rolling back via the existing `rollbackManifestEntry`
on failure); then `unshift` the full signed line into the zip as `export-entry.json`, exactly the
way `evidence.json` is unshifted — outside artifacts and outside `packageHash`. The verifier
checks that file's signature against the bundled public key, checks its `prevHash` equals the
bundled chain head, recomputes its `entryHash`, and only then trusts its `captureIds`. The cheaper
alternative — reconciling against `evidence.json` with the scope labelled untrusted — is
**explicitly rejected**: `evidence.json` is declared untrusted by the verifier's own code, and a
tamperer could pad `captureIds` to explain away a removed capture (the #580 detection class).

**R4 (Q4, #399) — notes become real package content; extracted text and selector hits do not.
A Working Copy DOES append a manifest export entry**, carrying `exportClass: 'working-copy'`
declared `.optional()` on the strict schema and **omitted** for evidence exports — never `null`,
never `'evidence'` — following the omit-when-absent discipline `manifest.ts` already applies. The
schema edit is coordinated with #398, since both land in the same union member
(`ManifestExportEntrySchema`, `src/shared/schemas.ts:373-389`).

**R3 (Q3, #401) — JavaScript is ON in the Wayback replay webview, and every item in the
hardening list is mandatory**, not defence-in-depth: dedicated partition; `will-attach-webview`
with a `src` allow-list restricted to `https://web.archive.org/web/`; permission request and check
handlers denying everything; `will-download` prevented; `setWindowOpenHandler` denying; guest
navigations confined to the same prefix. The decision is extracted to a pure
`src/main/webviewPolicy.ts` with unit tests (the `windowSize.ts` / `windowReveal.ts` precedent),
replacing the single hard-coded `file://` rule at `index.ts:234-247` with a partition-aware
policy. A wrong discriminator silently loosens the MHTML evidence viewer; this is the branch's
highest-risk edit. Related: #810.

**R22 (#401) — the compare panel's left pane is the LIVE MHTML webview**, not the stored
screenshot. **Overrides** the recommendation. Consequence accepted with it: two live guests in
one panel under two partitions with different policies, so `webviewPolicy.ts` must discriminate
correctly between the `mhtml-sandbox` partition (javascript off, `file://` once) and the Wayback
partition (javascript on, archive.org prefix only) — the exact case the partition-aware rewrite
exists for, now load-bearing rather than theoretical.

**R7 (Q7, #405) — the bundled demo Case imports with an explicit synthetic attribution rather
than a relaxed gate.** Import it with the fixed operator string `Birdbrain demo fixture`, recorded
in the import custody entry, so the manifest says truthfully who imported it and the
operator-name gate stays intact for real archives. The fixture archive is checked in under
`resources/` and shipped via `build.extraResources` beside the extension entry — it verifies its
chain against the key bundled inside itself, so no build-time signing. Pair it with a test that
imports the shipped fixture against the current schema, so a later migration the frozen fixture
cannot satisfy fails CI rather than an operator's first launch.

**R12 (#771) — the #771 fix is FOLDED INTO #405.** Both edit `useTourEngine.start()` (:176-201)
and `completionAfter`; one branch owns both changes rather than two serialized PRs on the same
function. #771 stays open until #405 lands and is closed by it. (Phase 1 made no recommendation
here; it required only that the ordering be ruled before #405 starts.)

### Track B — extension and server

**R2 (Q2, #392) — the extension supplies the auto-capture bytes.** The tag and note routes accept
an optional multipart MHTML payload in the shape `POST /api/captures` already takes; the flow
canonicalizes, looks up an existing Capture, and if none exists ingests the supplied payload first
and attaches only after ingest returns. Method stays `'extension'` (operator-witnessed, honestly),
the no-orphan criterion is structural, #393's inline progress is a spinner on one awaited fetch,
and no polling route exists. This is also why the URL-lookup route exists.

**R23 (#392) — the URL-lookup route is a POST, token-guarded**, body `{caseId, url}`, registered
after the `app.use` guard block so it inherits the middleware. No GET, no hand-rolled per-route
auth — the drift #817 warns about.

**R8 (Q8, #393) — the in-page bar's Selector action is ONE CLICK**, matching the existing
context-menu path and the acceptance criterion. The mock's two-step typed confirm popover with
'Watch for new hits' and 'Backfill — scan N existing captures' toggles is **filed as its own
ticket**, blocked on the server capabilities those toggles need (see "Tickets to file" below).
#391 takes the same one-click-versus-popover answer in the renderer, subject to R17.

### Track C — renderer chrome and data

**R5 (Q5, #701) — the missing inline routes ARE built.** **Overrides** the intersection-only
recommendation. The menus ship the mock's fuller action sets, and the accelerator rule is
satisfied by building the missing inline/keyboard routes: copy URL, copy `SHA-256`, duplicate,
per-entity export, merge tags, backfill selector.

**R13 (#701) — structure: capability tickets first.** One ticket per missing capability, filed
now, landing as small independent PRs. #701 itself ships the menu primitive plus the per-kind
registry, consuming whatever capabilities have landed at the time it merges; the registry absorbs
late arrivals at near-zero cost. #701 stays medium and keeps its auto-merge eligibility. Non-goals
unchanged from phase 1: #701 does not refactor `CaptureMenu`, `CaptureDownloadMenu` or
`ExportMenu` onto the new primitive, and does not build the mock's 'Customise this menu' mode.

**R14 (#701) — all six capabilities are built THIS WAVE.** **Overrides** the defer-the-colliding-
two recommendation. Consequences accepted with it: per-entity export reaches `export.ts` and
serializes behind #401 at the tail of track A; backfill-selector reaches `selectorLifecycle.ts`;
both are evidence-affecting, human-reviewed, never auto-merge. The wave's evidence-review count
rises from seven to **nine** (plus #391 if its tier verification below says so).

**R20 (#701) — the capture context menu is selection-aware.** Right-clicking a row that is part
of the current multi-selection acts on the whole selection, with menu items pluralized ('Delete 3
captures…'); right-clicking an unselected row acts on that row alone.

**R9 (Q9a, #391) — a note–tag relation IS built.** **Overrides** the capture-or-disabled
recommendation. New `note_tags` table and migration. Scope consequences the ticket must absorb:
the migration block in `migrations.ts`, repo SQL, new IPC surface (channels + preload bridge +
types + handlers — phase 1's "#391 appends to none of them" no longer holds), and the case-archive
round trip (`note_tags` into export/import plus `ID_PROBE_TABLES` for id-collision remapping).
The recording pass must verify #391's evidence tier against
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` before dispatch (see checklist).

**R15 (#391) — Tag semantics: the tag attaches to the note ALWAYS, and ALSO to the capture when
the note is anchored to one.** So capture-level filtering and Signals coverage still see tags
created from notes, and the action never throws or silently no-ops in any of the four NoteEditor
mounts. Create-or-reuse by name still applies: look the tag up first, because `tags.name` is
UNIQUE and `createTag` is a bare INSERT that throws on a duplicate (#811).

**R16 (#391) — migration numbers are assigned by merge order.** Migrations are append-only:
whichever branch merges first appends the next block and bumps `LATEST_SCHEMA_VERSION`. #391
keeps its early track-C slot and will likely take **v31** (`note_tags`), making #399's two-column
Case migration **v32**. Every document and issue comment that pins "#399 = v31" gets a one-line
correction (the prep doc's migration paragraph, #399's grounding comment, the #405 ruling
comment). If #399 somehow lands first, the numbers swap and no document needs a second edit —
that is the point of assigning at merge time.

**R17 (#391) — the Backfill checkbox renders CHECKED and DISABLED** with copy saying backfill
always runs, matching the mock's pixels and telling the truth about `selectorLifecycle`'s
unconditional backfill. No parameter is threaded into `selectorLifecycle.ts`. (Distinct from the
backfill-selector INLINE capability R14 puts in #701's set — that is a new user-invokable rescan,
a separate ticket.) Divergence recorded on #708.

**R10 (Q10, #695) — the one clear control clears EVERYTHING narrowing the list**: query, selector
filters, format, date, favourites-only. One handler surfaced in three places: a widened narrowing
strip naming every active narrowing with one ×, the dropdown's 'Clear all filters' item, and the
narrowed empty state (which the app currently lacks). `countActiveFilters` stays menu-scoped so
the Filter badge keeps meaning what the menu shows; a separate `isNarrowed` predicate covers the
rest. The two defects phase 1 named are in scope: the empty-state branch that renders 'No captures
yet' on a zero-match query, and the badge-count coupling.

**R18 (#704) — the archived-copy banner ALSO appears on legacy `format: 'html'` captures**, with
format-accurate copy (it must not say MHTML). The provenance claim — an archived copy captured at
a stated time — is equally true for pre-v11 captures.

**R19 (#704) — the banner carries the CAPTURE TIME ONLY.** No 'scripts and network disabled'
claim, no truncated hash. Verification state stays with `ProvenanceBadge` and the viewer posture
stays with the viewer, so nothing can drift (ruling 3's constraint). Divergence recorded on #708.
Mount in `CaptureViewer.tsx`, never `MhtmlViewer.tsx` — the merge-gate condition from phase 1.

**R6 (Q6, #803) — four labelled branches, and the per-part `SHA-256` is computed at display
time.** Split: (a) main-side readers plus IPC plus known-answer tests; (b) screen shell plus the
E2E and docs rewrite; (c) the remaining tabs; (d) the four deferred context-menu kinds, after
#701. Every split branch keeps the `evidence-affecting` label. The MHTML Parts hash column is
computed over the raw encoded bytes at display time, labelled `SHA-256 (computed now)` with a
one-line statement that only the whole MHTML file is anchored in the manifest; never a shield or
the word verified; the part menu's 'Verify against manifest' item is dropped; the mock's caption
is replaced wholesale.

**R21 (#803) — the extracted-data IOC browser survives as an indicators view INSIDE the new
screen**, re-presenting the IOC table, its search, and the To-selector pivot over the five
existing `extractedData` channels. The pipeline stays readable and the pivot stays alive. A
divergence-by-addition from the mock, recorded on #708. Fits #803's re-presenting-existing-data
charter. The phase-1 AC corrections stand: search filters the table, not the tree; no per-artifact
integrity flags; tree row height `var(--d-tree)`; Headers & TLS presents no request headers the
app never captured and labels the TLS chain by `refetchedAt`, never "at capture time" (ADR-0002).

**R11 (Q11, #708) — the deliverable is a tracked document and #708 stays OPEN** as the intake
queue: `docs/specs/2026-08-23-standalone-mock-corrections-brief.md`, the dated snapshot actually
sent to the design side, split into 'Needs a design decision' and 'Recorded deviations, no
response wanted' with counts in the opening line, dropping items the tree has already closed.
Not in `docs/design-handoff/`, whose README forbids editing bundle contents.

## Consequence roll-up

- **Seven new tickets to file** (see below): six capability tickets plus the #393 popover ticket.
- **Evidence reviews: nine known** — #392, #393, #398, #399, #401, #405, #803, per-entity export,
  backfill-selector — **plus #391 pending its tier verification** (R9 moved it into `migrations.ts`
  and the archive round trip; the assessment doc decides).
- **v31/v32 assigned at merge time** (R16); the prep doc's "only #399 migrates" claim is dead.
- **#391 grew from medium to large**: migration + repos + IPC spine + archive round trip.
- **#405 absorbs #771** (R12).
- **#401 runs two live guests** (R22), making the partition-aware `webviewPolicy.ts` load-bearing.
- **Track A serialization unchanged**: #398 → #399 → #401 → #405, strict, every branch cut from
  `main` after the previous merges. Per-entity export joins the tail behind #401.

### Amended merge order

#702(#822, done) → #398 → #392 → #695 → #391 → [copy-URL, copy-SHA-256, duplicate, merge-tags —
small, any order, track C] → #399 → #401 → #393 → backfill-selector → #701 → #704 → per-entity-
export → popover ticket → #803a → #803b → #803c → #803d → #405.

The four non-colliding capability tickets land early so #701's registry has real actions to
consume. Backfill-selector needs only `selectorLifecycle.ts` and is independent of track A; it
lands before #701 for the same reason. Per-entity export waits for #401 (export chain tail). The
popover ticket waits for backfill-selector (its Backfill toggle) and is not blocked on
auto-capture work — its Watch toggle ships disabled if #386's HOTFIX still stands, stated in its
body. #708's brief takes no slot and can land any time.

## Execution plan

Three recording agents, one docs agent, one review pair. Each item is a comment to POST (never an
issue-body edit), a label to set (verify by direct label read,
`gh api repos/thebristolsound/birdbrain/issues/<n>/labels`, never the search index), or a ticket
to file. Comment style: head with `## Ruling, 2026-08-24 (wave-3 phase 2 intake)`, state the
ruling declaratively, ground it in file:line facts from the phase-1 notes, and **name the
override explicitly wherever a ruling contradicts phase 1's recommendation** (R5, R14, R9, R22) —
future readers will find the notes recommending otherwise, and the comment must out-rank them.

### Recorder A — track A (#398, #399, #401, #405, #771)

- **#398**: post R1. Include the phase-1 readiness items: an explicit note that the 2026-08-23
  ruling supersedes ADR-0009's 'scope always present' consequences bullet and its claim that
  Package Verification is untouched; an acceptance criterion for the frozen pre-scope fixture
  package (none exists in `tests/fixtures` today; known-answer fixtures go in
  `tests/shared/verify/`); starting-file additions `src/shared/schemas.ts` (new keys `.optional()`
  with no `.default()`) and `src/main/services/verifyRunbook.ts:136-137`. Confirm `ready-for-agent`
  present. **Dispatchable immediately after recording.**
- **#399**: post R4 + R16's v-number note (write the migration block as next-version-at-merge;
  two-column scope unchanged) + the divergence statements (the mock's unconditional custody card
  and its Examiner/analyst vocabulary are diverged from — recorded on #708) + restate that
  `CASE_ARCHIVE_SCHEMA_VERSION` stays 3 on the demo flag's own merits, not the display-column
  precedent. Blocked by #398; no `ready-for-agent`.
- **#401**: post R3 + R22. Add the phase-1 acceptance criterion the issue lacks: reconcile
  `e2e/captures-layout.spec.ts:124-129` (asserts today's full-bleed layout and the
  `wayback-lookup-btn` testid the redesign removes). Name `export.ts` (the `ExportData` literal at
  :262-291) and `ExportDialog.tsx` as files it writes after #398/#399. Pinned refs render in the
  existing per-exhibit corroboration block (`reportHtml.ts:964-978`), per the corrected prep doc.
  Blocked by #398, #399; no `ready-for-agent`.
- **#405**: post R7 + R12. Also absorb into the comment: the ruled acceptance criteria (demo flag
  surfaced in the export dialog and stated in the Certification, consuming #399's column); the
  fact that the ten-step case chapter already exists and matches the mock, so this is a
  fixture-and-import ticket; the fact that `deleteCase` removes only the DB row (#816), so the
  delete-demo tour ending must not claim a clean removal. Blocked by #399, #401; no
  `ready-for-agent`.
- **#771**: one-line comment — folded into #405 by maintainer ruling 2026-08-24, closes with it.

### Recorder B — track B (#392, #393) + one filing

- **#392**: post R2 + R23. Add the phase-1 acceptance line: the new shared URL canonicalizer is
  added to the Acquisition include list of
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` at blocking tier in the same PR
  (the #227/#400 amendment precedent). Confirm `ready-for-agent` present. **Dispatchable
  immediately after recording.**
- **#393**: post R8. Restate the two settled directives from the corrected prep doc: extend
  `captureSuppression.ts` with a latch plus a release message from the restore effect, and add the
  bar's host id to `removeInjectedBirdbrainUi` (a teardown alone silently reopens #386). Blocked
  by #392; no `ready-for-agent`; `evidence-affecting` already applied.
- **File the popover ticket**: typed confirm popover for Selector creation (Watch for new hits +
  Backfill toggles) across the extension bar and the renderer. Labels `enhancement`, `redesign`.
  Blocked on backfill-selector (below); Watch toggle ships disabled while auto-capture is
  HOTFIX-disabled, stated in the body. Cite R8.

### Recorder C — track C (#391, #695, #701, #704, #708, #803) + six filings

- **#391**: post R9 + R15 + R16 + R17. **Verify the evidence tier first**: read
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` for `migrations.ts`, the db
  repos, and `caseArchive.ts`/`caseRepo.importCaseRow`; apply `evidence-affecting` if any hit is
  blocking-tier, and say which paths fired in the comment. Correct the grounding comment's
  CreateSelectorPopover instruction (phase 1: wrong on both counts, and following it reaches
  `DataExplorer.tsx`). Apply `ready-for-agent` (it is fully ruled and unblocked; auto-merge
  eligibility follows the tier verdict).
- **#695**: post R10 including the two named defects. Apply `ready-for-agent`.
- **#701**: post R5 + R13 + R14 + R20 + the two non-goals. Apply `ready-for-agent` (primitive +
  registry can start now; the registry consumes capabilities as they land).
- **#704**: post R18 + R19 + the mount constraint (CaptureViewer yes, MhtmlViewer never). Blocked
  by #401; no `ready-for-agent`. Remove `needs-triage` if present (the body claims it; the label
  read decides).
- **#708**: post R11, plus the new divergence-register entries this intake produced: #391 backfill
  checkbox checked+disabled (R17); #391 note-tag semantics extend the mock's note-only tagging
  (R15); #704 banner carries capture time only and appears on legacy html (R18, R19); #803
  indicators view added, computed-now hash caption, dropped 'Verify against manifest' item,
  reduced request panel, `refetchedAt` TLS heading (R6, R21); #399 custody-card and
  Examiner-vocabulary divergences (R4's comment); #393 one-click selector without the popover
  (R8). Replace `needs-triage` with `ready-for-agent` — the deliverable is now fully specified.
- **#803**: post R6 + R21 with the phase-1 AC corrections listed under R21, plus the backstop
  mitigation: keep `DataExplorer.tsx` as the mounted entry file with new components nested under
  `dashboard/cases/data/`, or amend the include list in the same PR. Note the QUERY_DOMAINS trap
  (`logSafe.ts:219`). Stays `not-ready` for dispatch until the split branches are cut; no
  `ready-for-agent` on the parent issue.
- **File six capability tickets**, each citing R5/R13/R14, each `enhancement` + `redesign`, sized
  from the phase-1 #701 appendix (notes lines 1173-1294) which maps the mock's per-kind action
  sets:
  1. Copy URL (capture) — inline route + menu item. `ready-for-agent`.
  2. Copy `SHA-256` (capture) — inline route + menu item. `ready-for-agent`.
  3. Duplicate (capture) — inline route + menu item. `ready-for-agent`.
  4. Merge tags — inline route + menu item; touches `tagRepo` (mind #811's UNIQUE constraint).
     `ready-for-agent`.
  5. Backfill selector — user-invokable rescan; touches `selectorLifecycle.ts`, **blocking tier**:
     label `evidence-affecting`, human review, never auto-merge. `ready-for-agent`.
  6. Per-entity export — touches `export.ts`, **blocking tier**: label `evidence-affecting`.
     Blocked by #401 (export chain tail); NO `ready-for-agent` until #401 merges.

### Docs agent — prep-doc amendment (after B and C return ticket numbers)

Branch from `origin/main`. Amend `docs/plans/2026-08-23-redesign-wave3-ultracode-prep.md`:
add a "Phase 2 intake rulings, 2026-08-24" section pointing at this document and the issue
comments; correct the migration paragraph (merge-order assignment, #391's `note_tags`); correct
the evidence-review count (nine known + #391 pending tier); insert the seven new tickets into the
merge order and track listing (as amended above); note #401's two-guest consequence. Run `vale`
on the touched files. Draft PR, label `agent-authored` (verify by direct read), conventional
`docs(plans):` subject.

### Review pair — #822 pre-pass

`agent/pre-pass` is already `pending` at `cd919164`. Spawn `birdbrain-reviewer` on PR #822
(read-only), then post the pre-pass comment on the PR and the verdict status per the dispatch
skill: `success` ("Approved for human review. n non-blocking findings.") or `failure` (shortest
true summary, ≤140 chars), with `target_url` pointing at the pre-pass comment. Never leave the
sha without a terminal status. #822 is non-evidence: on verdict `success` plus every required
check green, it is auto-merge eligible under ADR-0014 — apply the dispatch skill's section 2a
conditions rather than merging on the two facts alone.

### After recording

#398 and #392 are the next dispatches (two free slots; #822 holds the third until it merges).
Effort per the phase-1 recommendation: `max` for #398/#399/#803, `high` for
#392/#393/#401/#405/#695/#391/#701, `medium` for #702(done)/#704/#708; the capability tickets run
`medium` except backfill-selector and per-entity export at `high`. Track A's questions are all
answered, so the track no longer stalls: dispatch #398 immediately, #399 when it merges.
