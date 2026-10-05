# Redesign wave 2: review verdict

Produced 2026-08-22 by the `ultracode` phase-3 pass over the seven wave-2 pull requests, before any
of them merged. Companion documents: `docs/plans/2026-08-21-redesign-wave2-ultracode-prep.md` (the
prep), `docs/plans/2026-08-21-wave2-phase1-findings.md` (the phase-1 findings this checks against).

Each pull request got one reviewer and then one independent skeptic whose instruction was to refute
every finding, defaulting to refuted when uncertain. A wave-level pass then performed the six merges
on a scratch branch and ran `pnpm typecheck` on the result. A final pass re-verified every blocking
claim against the branches and decided the cases where reviewer and skeptic disagreed.

Fifteen findings were refuted and dropped. What remains is below. Per-pull-request detail is in the
`Reviewer pre-pass` comment on each pull request; the non-blocking findings are filed as issues
#744 to #765.

# WAVE 2. FINAL VERDICT

Four of seven are not ready. The wave, fully merged, is green on every gate, but three of the four unready PRs ship a statement to the operator that the code does not honour, and one of them is the evidence-path PR whose entire reason for existing is that statement.

I re-verified every blocking claim against the branches myself. Citations below are ones I read, not ones I inherited.

---

## PER-PR VERDICTS (merge order)

| # | Ticket | Verdict | Reason |
|---|---|---|---|
| **709** | #395 selector origin | **Merge** | All three review findings were refuted; migration v29 is nullable-no-backfill as ruled, all six creation paths stamp, server-side stamp cannot be forged (`schemas.ts:177-186` + `captureServer.ts:468`), archive round-trip is non-vacuously tested. |
| **712** | #400 Signals | **Do not merge** | `signalsModel.ts:114` and `captureServer.ts:344` both tell the operator the per-case exclusion list blocks *every* capture route; `recapture.ts:123` ingests with no exclusion check at all. A false acquisition guarantee on the wave's evidence-affecting PR. |
| **710** | #397 three-column | **Merge after one line** | Sound throughout; the narrow-viewport details overlay (`captures.tsx:347`) is rendered outside `visibleCaptureColumns` with no Wayback guard, where the mock gates it at 13877. One-line fix, then merge. |
| **711** | #406 options page | **Merge** | Read-only claim holds end to end; the ruled monospace/no-second-webfont constraint verified against the built artifact, not the source. Survivors are a false build comment and three nits. |
| **713** | #390 Mentions | **Do not merge** | `mentionModel.ts:40` guards with `in`, so `constructor`/`__proto__`/`toString` pass, one pasted span crashes the editor subtree and then throws the exact "note cannot be saved" this PR claims to have eliminated. Also must carry the #716 route fix, which currently exists only on a branch that merges last. |
| **714** | #402 Overview | **Do not merge** | `backlinkMapModel.ts:243-247` + `:447`, at 20 notes the cap drops every entity, so the card prints "No Mentions to map yet." on a case that has Mentions and draws nothing while the header claims 20 nodes. |
| **715** | #404 tour | **Do not merge** | `OnboardingTour.tsx:67-73` starts the case chapter over a running intro without `close()`, so intro completion is never written; `isFreshInstall` is latched true forever (`settings.ts:111`, never cleared), so the welcome card re-fires on every launch. Two reachable paths, one of them the button the tour is ringing. |

---

## SURVIVING FINDINGS (most severe first)

**15 findings were refuted by the skeptics and are dropped**: #709  x 3, #712  x 3, #710  x 4, #711  x 4, #713  x 1, #714  x 0, #715  x 0.

### Blocking

**B1 · #712 · `src/renderer/components/signals/signalsModel.ts:114` (and `captureServer.ts:344`)**
Footer: *"Matching pages are never captured for this case, by any route, including manual capture."* Verified: the only enforcement site is `captureServer.ts:351`; `git grep -l matchIgnoredUrl\|resolveEffectiveIgnorePatterns` on the branch returns `captureServer.ts`, `urlPatterns.ts`, `extension/background.ts` and nothing else. `recapture.ts:123` calls `captureLifecycle.ingest` directly, reachable live from `CaptureMenu.tsx:163 -> AddUrlsBox -> ipcHandlers.ts:702` and from bulk recapture at `:718`. `recapture` is a distinct `CaptureSource` and `recapture.ts` is itself on the evidence path list.
**Fix:** enforce at the recapture seam (reject/skip with a `skipped` CaptureEvent for parity), or narrow both strings to the routes actually covered and file the gap.

**B2 · #713 · `src/renderer/components/notes/mention/mentionModel.ts:40`**
`typeof value === 'string' && value in MENTION_SIGIL`, confirmed verbatim on `origin/wave2/390`. Eight `Object.prototype` names pass. Pasted `data-target-type="constructor"` is accepted by `rendererNoteExtensions.ts:70`, `resolveMention` reads `loaded['constructor']` (truthy), falls off its default-less switch, returns `undefined`, and `MentionChip.tsx:102` throws inside a node view, the error boundary at `__root.tsx:134` unmounts the route body and the draft is gone. Suppress that and `parseNoteDoc` throws. Every existing test picks a value that misses the hole.
**Fix:** `Object.hasOwn(MENTION_SIGIL, value)`; same discipline for `loaded[...]`, `MENTION_ROUTES`, `ICONS`; add `default` arms to the two switches; add prototype names to `mentionModel.test.ts:86`.

**B3 · Wave · `MentionChip.tsx:108` + `mentionModel.ts` `MENTION_ROUTES`**
`tsc -p tsconfig.web.json` fails `TS2322` on `/cases/$caseId/selectors` for the entire window between #713 and #715 merging, because the fix lives only on `wave2/integration`. **Verified independently:** the integration fix (`72d35948`) also leaves `CLICK_HINT.selector = 'click to edit the rule'` (`mentionModel.ts:115-119`) while `handleOpen` navigates to `/signals` with **no target**, and `SignalsOverview.tsx:97` is `allSignals.find(...) ?? allSignals[0] ?? null` with `selectedId` as local `useState`. So the chip promises to open a rule and opens a *different* one. The capture case was solved one line earlier at `:107`.
**Fix:** move both the route retarget and a `selectedId` hand-off (search param or store field) onto #713's own branch; correct `CLICK_HINT`.

**B4 · #714 · `src/renderer/components/overview/backlinkMapModel.ts:243-247, :447`**
`ranked.slice(Math.max(0, NODE_CAP - noteCount))` with `noteCount >= 20` drops every entity; `:250` then drops every edge; `isEmpty: edges.length === 0` -> `emptyReason: 'no-mentions'`. The card renders "No Mentions to map yet." and suppresses all 20 note pills while the header says "showing 20 of 22 nodes." At 19 notes the same case draws fine. Contradicts the module's own docstring at `:231` ("Notes are never dropped"). The 24-note test asserts only `edges: []`.
**Fix:** derive `isEmpty` from the pre-cap edge list and add a third state for "the ceiling ate every entity"; extend the cap test to assert `emptyReason`.

**B5 · #715 · `src/renderer/components/onboarding/OnboardingTour.tsx:67-73` + `useTourEngine.ts:141-152`**
`start()` `setState`s over a running chapter; `close()` is the only caller of `completionAfter`. Verified `isFreshInstall` is written once at `settings.ts:111` and read at `tourSteps.ts:251`, nothing ever clears it. Two reachable paths: (a) create a case mid-intro -> case chapter pre-empts, intro completion lost; (b) **the skeptic's stronger one**, intro step 3 rings the whole `ExtensionBanner` card, whose Setup Guide button (`ExtensionBanner.tsx:64`) fires `startTour('ext')` from *inside* the ring (`CoachMark.tsx:146` is `pointer-events-none`), and an `auto:false` replay writes nothing at all. Welcome card re-fires every launch.
**Fix:** guard the auto-fire on `!engine.chapter`, or have `start()` `close()` the chapter it displaces. Add a test for fresh-install -> create-case-mid-intro; every existing case test pre-seeds `{intro:true}`.

### Major

**M1 · #712 · `AutoCaptureCard.tsx:96` -** "while browsing, any page matching an enabled selector is captured automatically." `background.ts:630-633` has both auto-capture producers inside the HOTFIX comment block. The operator flips the switch and browses believing acquisition is happening. The card already has the disclosure pattern at `:141-146` for the `auto` mode. **Fix:** one line beside the switch naming #600.

**M2 · #712 · `signalsModel.ts:148-155` -** `/etc/passwd` -> `{pattern:'etc', isRegex:true}`. Verified the arithmetic on-branch. Retro-matching then writes false `selector_matches` rows that ride in case archives, with no notice. The exclusion input four inches above rejects the identical shape (`urlPatterns.ts:114-124`). The pinning test is titled *"leaves a path-like value alone"* while asserting the opposite. **Fix:** require both leading and trailing slash; rename the test.

**M3 · #712 · `BulkImportDrawer.tsx` -** confirmed by grep: the drawer's only inputs are the textarea, the regex checkbox and Import. The deleted `BulkAddSelectorsModal.tsx` carried a `.txt/.csv` file input and a label prefix. Nothing on Signals can set a label afterwards, `SignalsOverview.tsx:141` renames via `updateSelector({pattern})`. Directly against AC "No capability is lost" and the body's "deliberate superset."

**M4 · #715 · `tourSteps.ts:73, :113` -** `viewertabs` lives below `CaptureViewer.tsx:83`'s early return and nothing auto-selects a capture; `noteeditor` mounts only while editing and `NotesOverview` starts `showCreateForm` false. The case chapter auto-fires on a fresh install's first case: zero captures, zero notes. 2 of 6 marks take the missing-anchor fallback **every run**, the path built as insurance is the guaranteed path.

**M5 · #714 · PR body Evidence impact -** claims "matches five entries"; it matches six. The omitted one is `src/main/services/db/**` (assessment:123), the entry the PR's new SQL lands in, and the one the maintainer's "evidence-affecting: no" ruling never considered (that ruling names two renderer files and was written believing the main-process side was already done).

### Minor (abbreviated)

- **#710 `captures.tsx:347`**, details overlay ungated on Wayback; mock gates it at 13877. Reachable below 1100px.
- **#710 `CaptureListRail.tsx:23` / `captures.tsx:331`**, both rails lose the width animation and main's `transition-[width] duration-150` is deleted. The skeptic found MOTION.md quoted in-repo at `docs/plans/2026-08-19-wave1-implementation-notes.md:462`: it says the *panel* never width-animates and *the rail keeps bbdrawer 150ms*, the opposite of what the PR body used it for.
- **#710 `CaptureItem.tsx:147`**, the list view silently drops the background-recapture badge that main renders under the comment "Distinguish background recaptures from operator-witnessed captures." Persisted view preference; evidentiary distinction gone at list level.
- **#712 `SignalRow.tsx:70-72`**. Backspace/Delete on a focused row deletes with no confirmation. Verified `listTags()` is `SELECT * FROM tags` (not case-scoped) and `capture_tags` declares `ON DELETE CASCADE` (`migrations.ts:43`), one reflex keystroke on Case A strips a tag from every capture in every case.
- **#712 `AddSelectorRow.tsx:45`**, accepts an uncompilable regex with no validation and no preview; `safeRegexTest` answers false forever, so the row shows count 0 indistinguishable from "no matches yet."
- **#712 `SignalDetailRail.tsx:262`**, "Filter in Captures" navigates with no filter for tags (`appStore` has `activeSelectorFilters` only).
- **#712 `ipcHandlers.ts:182-190`**, the main-process half of "invalid regex is surfaced" is entirely uncovered; the harness exists two files away.
- **#713 `dialog.tsx:19` / suggestion plugin**. Escape is consumed while the plugin is `active` even at zero candidates, so the first Escape no-ops in every dialog. Two-press Escape, draft preserved (skeptic's downgrade accepted).
- **#713 PR body**, "presentational lines the e2e loop exercises" is false for `CaptureDetailsPanel.tsx:462`, a behavioural guard covered by neither suite.
- **#714 `theme-screenshots.spec.ts:96`**, the added wait resolves in the same commit as the one above it (`overview-map-canvas` renders unconditionally), so the comment asserts settling the code does not do.
- **#714 `backlinkMapModel.ts:261`**, lattice rows grow 1:1 with notes against a fixed canvas; pills overlap at high note counts.
- **#715 `useTourEngine.ts:239`**, this PR's own last commit added `&& isRectVisible(...)`, so an anchor scrolled out of view leaves the ring frozen over unrelated content with the dim still at 0.
- **#715 `useTourEngine.ts:185`**, the measurement effect deps on the whole `state`, so toggling the install disclosure re-fires `scrollIntoView` and yanks the page.
- **#715 `WelcomeCard.tsx:18`**, `aria-modal="true"` with no focus trap, no `inert`, no Escape handler, over a deliberately live page.
- **#711 `vite.config.ts:73`**, the new comment justifies the swallowed error with a case that cannot occur (`contentConfig` registers no plugins, verified by the skeptic running the content build); what it actually swallows is a broken build that then ships `options_ui` pointing at a missing page.
- **#711 `OptionsApp.tsx:88`**, with the app closed the page says the pairing token is unavailable, but the extension holds it in `chrome.storage.local` and can read it with no network.
- **#713/#714/#715 PR bodies**, three separate wrong line citations into the evidence-path assessment doc; substance correct each time, credibility cost in the artifact a human uses to ratify the label.

### Nits (rolled up, not itemised)

Prettier drift on two new CSS files and two hunks; `backlinks` never singularised; dead `mapLabels.note` entry; unreachable `?? targetType` arm; stale `backlinkCountsForCase` docstring contradicted 15 lines below it; dead `highlightRegexSyntax`; a reordered assertion pair in `urlPatterns.test.ts`; hand-maintained `EMITTED_ANCHORS` set that cannot catch anchor removal; raw hex `TYPE_COLORS`; install-row title prefix the mock does not render; `CLAUDE.md:10` "background and popup bundles only."

---

## The blocking set

**Must change before anything merges:**

1. **B1**, #712 recapture enforcement or honest copy. *(code)*
2. **B2**, #713 `Object.hasOwn` guard + default switch arms + prototype test values. *(code)*
3. **B3**, the `MENTION_ROUTES` fix moves onto #713's branch, with the `CLICK_HINT` string corrected and a target handed to Signals. *(code, plus a branch move)*
4. **B4**, #714 empty-state derivation. *(code)*
5. **B5**, #715 chapter-displacement guard, both paths. *(code)*
6. **Docs that will be published false.** `website/content/docs/screenshots.mdx:85-100` keeps "### Selectors" and "### Tags" sections embedding PNGs `readme-screenshots.spec.ts` no longer produces (`:557` is now Signals, `:571` says "there is no separate Tags route left to photograph"), and no Signals section was added; `README.md:75` lists selectors, tags and the removed setup guide; `tester-guide.mdx:162` still tells round-1 testers "the first-run wizard prompts you" after #404 deletes it; `screenshots.mdx:21-37` pairs new walkthrough captions with unchanged wizard PNGs. **All verified on `origin/wave2/404`.** May land as one separate docs PR, but not after the wave.
7. **Labels.** Confirmed by `gh api`: only #712 carries `evidence-affecting`. See §5, one maintainer action, not a code change.
8. **CI.** #712, #713, #714, #715 have never run a single check (`ci.yml:6-7` is `pull_request: branches: [main]`). Each must be retargeted to `main` and go green before it merges.

**Follow-up issues to file (name them, or they vanish):**

| Title | Source |
|---|---|
| `fix(signals): auto-capture card claims behaviour the extension does not perform` | M1 |
| `fix(signals): inline add-row silently rewrites a path into a truncated regex` | M2 |
| `fix(signals): bulk import lost the file picker and label prefix` | M3 |
| `fix(onboarding): viewertabs and noteeditor anchors never resolve on a fresh case` | M4 |
| `docs(evidence-paths): Evidence impact for #402 undercounts the db/** hit` | M5 |
| `fix(captures): details overlay is not gated on the Wayback tab` | #710 |
| `fix(captures): collapsed rails lost the 150ms width animation MOTION.md requires` | #710 |
| `fix(captures): list view drops the background-recapture badge` | #710 |
| `fix(signals): Backspace on a focused tag row deletes it from every case, unconfirmed` | #712 |
| `fix(signals): add-selector row accepts an uncompilable regex` | #712 |
| `fix(signals): "Filter in Captures" does nothing for tags` | #712 |
| `test(ipc): cover the setAutoCapturePolicy validation seam` | #712 |
| `fix(notes): mention suggestion swallows the first Escape when nothing matched` | #713 |
| `fix(overview): lattice rows outgrow the map canvas on note-heavy cases` | #714 |
| `fix(overview): theme-screenshot wait on overview-map-canvas is a no-op` | #714 |
| `fix(onboarding): stale ring when the anchor scrolls out of view` | #715 |
| `fix(onboarding): install-disclosure toggle re-triggers scrollIntoView` | #715 |
| `fix(onboarding): welcome card claims aria-modal without behaving modally` | #715 |
| `fix(extension): options page reports a cached token as unavailable when the app is closed` | #711 |
| `fix(build): extension HTML rewrite swallows a real failure and ships a broken options_ui` | #711 |
| `docs(evidence-paths): add CaptureItem.tsx to the interpretation-surfaces include list` | #710 |
| `chore: prettier drift in extension CSS and two wave-2 hunks` | #711/#714 |
| `chore(overview): CLAUDE.md component map still lists SelectorCoverageBlock` | wave |
| `chore(ci): stacked wave PRs run no checks, decide the policy` | wave |

---

## Evidence verdict on #712

**Is the Evidence impact section substantive?** Yes, in form, it names five specific ways an evidentiary result could change (acquisition absence with no manifest record, override making a case more permissive than global, refusal-precedence reordering, widened fail-open surface, advisory-only extension mirror), states what verification proves and does not prove, and surfaces the `CASE_ARCHIVE_SCHEMA_VERSION` tension rather than hiding it. **But it fails on substance at the one point that matters**: it asserts enforcement "against every live capture route, manual included." That is false. A gate artifact that overstates enforcement coverage is precisely what the section exists to prevent. Not satisfied until corrected.

**Does the known-answer test cover the affected method?** Yes, and it is genuinely extended rather than sitting untouched beside changed code. `tests/shared/urlPatterns.test.ts` gains two describes on the new pure functions: `validateIgnorePattern` accepts all three pattern forms, rejects empty/whitespace with an exact reason, surfaces the engine's message for `/[/`, rejects `/abc/q`, rejects `/some/path`, and **explicitly accepts** `/(a+)+$/` so the write seam is not mistaken for protection against slow patterns; `resolveEffectiveIgnorePatterns` covers global-first ordering, dedupe, override, empty-override and no-input-mutation. The pre-existing `matchIgnoredUrl` table and the evaluator-divergence describe are correctly untouched, neither function changed. Backward verification holds: no `ManifestEntrySchema` variant, `src/shared/verify/**` and `src/verifier/cli.ts` absent from the diff, and `perCaseExclusions.test.ts:288-308` asserts a blocked capture adds no manifest line. One note for the record: `606a2b2c` moved `/some/path` from accepted to rejected mid-branch, the row was corrected, not derived once.

**Does enforcement actually block every capture source including manual?** **No.** `captureServer.ts:351` covers the three wire sources on `POST /api/captures`, so the *extension's* manual capture is genuinely blocked, and the forged-origin test is real. But `recapture` is a distinct `CaptureSource` and never touches the server. I traced it: `CaptureMenu.tsx:163 -> AddUrlsBox.tsx -> ipcHandlers.ts:702 -> recapture.ts:123 -> captureLifecycle.ingest`, with no policy read anywhere in `recapture.ts` or `captureLifecycle.ts`. The page is rendered, hashed, stored, and written into the manifest chain. The maintainer's 2026-08-21 ruling was "every source"; the shipped matrix test covers three of four. **This is the claim the ticket exists to make, and it is the one that fails.**

---

## The label question, judged on contents

Confirmed by direct label read (not the lagging search index): #712 alone carries `evidence-affecting`; the other six carry `agent-authored` only. Six diffs hit the path list.

| PR | Backstop hits | Ruling holds on contents? |
|---|---|---|
| **709** | `db/**`, `captureServer.ts`, `selectorLifecycle.ts`, `ipc.ts`, `types.ts` | **Yes.** No hashing/canonicalisation/signing/timestamping/verification code; `git grep -i selector` over `shared/verify/`, `verifier/`, `manifest.ts`, `hash.ts`, `certification.ts` returns nothing. Display provenance about a search pattern; forward-only through `data.json`, and archives re-hash their own bytes. |
| **710** | `package.json`, `pnpm-lock.yaml` | **Yes.** Renderer chrome plus one dep. The compensating control the maintainer named was performed: the reviewer re-derived `react-resizable-panels@4.12.3`'s sha512 against the published tarball, MIT, zero runtime deps, no lifecycle script. |
| **711** | `extension/manifest.json`, `utils/api.ts`, `PopupApp.tsx`, `vite.config.ts` | **Yes.** Both trees built and `cmp`'d: `background.js` and `content.js` byte-identical, `sendMhtmlCapture` untouched, no new permission. Popup re-bundling only. |
| **712** | ten entries | **Correctly labelled.** |
| **713** | `package.json`, `pnpm-lock.yaml` | **Yes.** `src/shared/noteDoc.ts` genuinely untouched and pinned by four schema-fidelity KATs; everything else is on the exclusion list. |
| **714** | six, incl. `db/**` | **The ruling holds, but its stated basis does not.** The disposition names two renderer files "while moving blocks" and was written believing the main-process side was already built. The diff adds a new SQL query, an IPC channel, a preload bridge, and a shared type. I re-derived the substance and nothing evidentiary changes (`referenceEdgesForCase` is read-only over derived state). **This one needs re-ratification against what it actually contains, not re-application of a prediction.** |
| **715** | `settings.ts`, `schemas.ts`, `types.ts` | **Yes.** Two onboarding UI keys; the three export/archive settings readers consume `operatorName` only, untouched. The first-launch `settings.json` write was traced to its one branching consumer and is safe. |

**I am not overriding the maintainer on any of the seven.** The one I would push back on is **#714**: not because the answer is wrong, but because the answer given was to a different question. Ask for it again in one sentence, against the six-path diff.

---

## Merge sequence

Base branches today: #709->`main`, #712->`wave2/395`, #710->`main`, #711->`main`, #713->`wave2/397`, #714->`wave2/400`, #715->`wave2/integration`.

1. **Decide merge method first.** The last five commits on `main` are single-parent squashes. If you squash-merge the stack, every child's merge base becomes today's `main`, so a child that was *merged* onto its parent will re-present the whole parent diff in its PR view and in `coverage:diff`. **Rebase each child onto `main` after its parent lands, do not merge `main` into it.**
2. **#709 -> `main`.** Clean, green, no dependents blocked.
3. **#712 fixes -> rebase onto `main` -> re-run CI -> merge.** Its base disappears at step 2. This is the PR that most needs its first-ever CI run.
4. **#710 (one-line overlay fix) -> merge.** Base is already `main`; independent of the Signals work. Can go in parallel with 3.
5. **#711 -> merge.** Independent; extension-only.
6. **#713 fixes -> rebase onto `main`.** The rebase **must** carry `MENTION_ROUTES` -> `/signals`, the `CLICK_HINT` correction, and the Signals target hand-off. Verify with `tsc -p tsconfig.web.json` on the rebased branch *alone*, not on the stack.
7. **#714 fixes -> rebase onto `main` -> re-ratify the label question -> merge.**
8. **#715 fixes -> retarget from `wave2/integration` to `main` -> rebase.** `wave2/integration` does not survive; once step 6 carries the route fix, integration commits `72d35948`/`9afe596c` become redundant and should be dropped in the rebase rather than replayed, check for a conflict against #713's version.
9. **Docs PR** (blocking item 6) any time before the last of these lands.
10. Delete `wave2/integration` and the two `scratch/review-wave2*` branches the wave check left behind.

---

## Disagreements I decided

1. **#710, the "Wayback tab hides the list" finding. Reviewer major, skeptic refuted. Skeptic wins.** Decided by `CaptureViewer.tsx:145-190`: the four-button tablist and Back arrow render under exactly the condition that makes `waybackActive` true, so the operator is never stranded, and the mock's own `showCapList` at 13795 has no selection guard at all, making the branch *more* conservative than the design. Dropped.
2. **#712 exclusion-editor lost write, reviewer major, skeptic refuted. Skeptic wins.** The mechanism is real (`AutoCaptureCard.tsx:58-64` composes from cache; `caseRepo` does a whole-list `UPDATE`), but the window is one local IPC round trip to better-sqlite3 and the input clears at `:77` between submissions. No concrete input produces the wrong result. Dropped, optimistic update is still worth doing.
3. **#713 Escape swallow, reviewer major, skeptic minor. Skeptic wins.** Decided by outcome: the draft is preserved (that is what the guard is for) and the cost is a second Escape press. Real, filed, not blocking.
4. **#709/#711 missing label, reviewer major, skeptics refuted. Skeptics win.** Decided by `docs/plans/2026-08-21-redesign-wave2-ultracode-prep.md:20-27` and the dated per-ticket comments on #395 and #406, both of which name the exact backstop that would fire. A documented ruling is not a missed gate. Rolled up to §5 as one confirmation item rather than five findings.
5. **#715 docs caption vs stale PNG, reviewer major, skeptic minor. Neither, exactly.** On its own it is minor (it swaps which half of an already-stale pair is wrong). Combined with the Selectors/Tags sections, the README line and the tester-guide sentence, the wave publishes four false operator-facing statements. **Promoted to a wave-level blocker, dischargeable in one docs PR.**
6. **#714 `evidence-impact-undercounts`, reviewer major, skeptic confirmed major, but I split it.** The *enumeration error* is major (§2 M5). The *label* question it implies is a maintainer re-ratification (§5), not a code change. Decided by `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md:123` and judgment call 8 at `:282-285`, which records `db/**` as deliberately broad.
7. **The `CLICK_HINT` falsehood, found by nobody in the per-PR passes, only at wave level; I verified and promoted it to blocking.** Decided by `mentionModel.ts:115-119` read against `SignalsOverview.tsx:97` (`?? allSignals[0]`) and `MentionChip.tsx:107`, where the identical problem was solved for captures one line earlier. Shipping a tooltip that says "click to edit the rule" onto a screen that opens a different rule is the same class of defect as B1: a promise the code does not keep.
