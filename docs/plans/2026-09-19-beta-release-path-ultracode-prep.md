# Public beta release path: `ultracode` session prep

Prepared 2026-09-19 against `origin/main` at `634b6b0b` (CI green). Parent brief:
`docs/specs/2026-09-06-public-beta-brief.md`, approved 2026-09-06. Companion documents:
`docs/plans/2026-08-15-pre-ship-validation-gate.md` (gate v1),
`docs/plans/2026-08-30-exhibit-model-rulings.md` (X1-X45, which bind), ADR-0023, ADR-0024, and
`docs/plans/2026-08-29-wave4-round2-ultracode-prep.md` (the prep shape and the fleet rules this
document carries forward). Ruling comments posted on the issues outrank this document where they
conflict.

**The session's completion test is the brief's four triggers.** The beta cuts when, in order, the
exhibit chain lands (#1156), a CI-built candidate passes gate v1, both observed sessions run on it
with no floor finding, and the download page and the release-notes preamble are in place (#1246,
#1247). This session delivers the pull requests that make a candidate ready to cut. The tag, the gate
run, and the observed sessions (#1237) stay with the maintainer. Two blockers that fail gate v1 on
the AppImage leg and the smoke checklist ride with the set: #653 and #628.

## Program state

- `LATEST_SCHEMA_VERSION` is **34**, `CASE_ARCHIVE_SCHEMA_VERSION` is **6**,
  `MANIFEST_SCHEMA_VERSION` is **3**. None of the five tickets migrates any of them. evidence.json
  is written at `schemaVersion: 1` (`src/main/services/export.ts:709`) and #1156 takes it to 2.
- **The exhibit chain is one ticket from done.** #1146, #1147, #1148 (as PR #1469), #1149, #1150
  and #1151 are merged. #1156 (`803e`) is the remainder and is trigger 1.
- **One open agent PR.** #1485 (`agent/797-capture-entry-http-status-final-url`, draft,
  `evidence-affecting`, `agent-pr`, CI green at head) holds the ADR-0028 dispatch slot. It shares
  `src/main/services/reportHtml.ts` and the frozen-hash fixture in
  `tests/shared/verify/manifestSchema3.test.ts` with #1156. This session's PRs run off the slot
  (`agent-authored` only, never `agent-pr`), so #1485 blocks nothing here; it decides a rebase.
- **Identities.** Branches push over the maintainer's SSH login, which carries `workflow` scope,
  so #1247's workflow-file change is deliverable from this session; #1374 bites only the Actions
  host. The machine-account token file is present locally (`birdbrain-agent`, `repo` scope,
  expires 2026-11-16), so PRs open as the machine account through `agh` while branches push over
  SSH. If `agh pr create` refuses the #1247 branch, the fallback is bare `gh`, which the
  implementer contract permits for off-slot work.
- **The carried-forward rule tickets are closed.** #964 (`extension/**` unscored), #965 (REST
  PATCH body updates) and #969 (one reviewer at a time) are all closed, so those three rules lapse.
  One reviewer at a time stays as this session's own rule.
- **Vale** needed `vale sync` in this worktree; the Google package is now present. `actionlint`,
  `yamllint` and `shellcheck` are not installed, and nothing in the repository parses `release.yml`
  as YAML.
- **`website/node_modules` is absent** in a fresh worktree; a root `pnpm install` never reaches it.

### Rules that carry forward

Opus at `max` is the ceiling and the floor for every fleet agent, passed as `model: 'opus'` on every
`Agent` and `agent()` call because the session is a Fable session. `Closes #N` on line 1 of every
body. `pnpm preflight` at head, regenerated after any push. Labels in the create call, verified by
a direct read of `repos/thebristolsound/birdbrain/issues/<n>/labels`. Every branch cut from
`main`, never from another PR's branch. One `birdbrain-reviewer` at a time, a pre-pass on every PR
before it is handed to the maintainer. Nothing auto-merges. At most two defects filed per PR,
user-visible or evidence-affecting only (ADR-0028). Every PR linked to this thread through
`link_pull_request`.

## The set

| Ticket | Trigger | Ruling | Tier at head | File cluster | Batch | Dispatch condition |
| --- | --- | --- | --- | --- | --- | --- |
| #1156 | 1 | X44, D1-D14 below; two maintainer decisions open | blocking (eleven files) | exhibit export | A | after plan approval and the export-entry ruling; not gated on #1485 |
| #653 | gate v1, AppImage leg | 2026-08-20 brief plus the 09-19 amendment | blocking (`src/main/index.ts`, incidental) | extension: path | B1 | now |
| #628 | gate v1, smoke step 3 | 09-19 intake correction | blocking (`session.ts`) | extension: heartbeat | B2 | now |
| #1246 | 4 | 09-19 triage comment | none | docs site | C | now; merges last before the tag |
| #1247 | 4 | 09-19 triage comment | advisory (`release.yml`) | release notes | D | now; interactive session, SSH push, never `queued` |

**#1246 and #1247 were `needs-triage` on 2026-09-19 and never carried `ready-for-agent`.** The
acceptance criteria were written from the brief into a triage comment on each and the label
swapped in this session; the brief is approved, so that step is mechanical. Both stay off the
`queued` frontier: #1247 because the machine PAT cannot push `.github/workflows/**` (#1374,
twice-proven loss on #483 and #593), and both because this session runs them itself.

**#628 failed the bar at intake on two points and was corrected in place.** It had no
verification path and no evidence-affecting call, while its diff edits
`src/main/services/session.ts`, blocking tier at path list row 202. The intake comment supplies the
path, resolves the ambiguous AC 3, corrects four stale anchors, names #630 and #814 as the surfaces
tickets, and the label was applied at intake, following the 2026-08-30 precedent for #682, #813,
#918, #665, #675 and #824.

**#1156 fails the bar as written on four criteria and one verification gap, and every one is
correctable by ruling rather than by re-cut.** The corrections are decisions D5 and D6 below and go
on the issue once the plan is approved. It stays `ready-for-agent`.

## Intake findings and decisions taken

Every decision below is taken under ADR-0015 with its class named, is open to veto, and is posted to
the issue before the implementer starts. Anything marked **maintainer** is not taken.

### #1156 (blocking, XL)

Stale in the body at head: the verifier is not silent about Exhibits (it prints one SKIP per
`exhibit` and `derivation` entry at `src/shared/verify/evidencePackage.ts:515-546`, and #1156
removes that loop); the only Derived Files that exist are Capture thumbnails
(`src/main/services/exhibitBackfill.ts:45`, X34), so attachment, image, and document commit with none
(X43); a Derived File has no Exhibit Number (X31); selection reaches the exporter only through
`captureIds` from the captures table; `verify.sh` (`src/main/services/verifyScript.ts`) is a seventh
surface, packaged by `export.ts:620`, capture-only, and on neither tier of the path list; the report
derives Exhibit Numbers by sort position (`reportHtml.ts:290`) against X18; the report's Exhibit
modules short-circuit on `options.include.captures`; timestamp tokens for committed Exhibits are
dropped by `buildTimestampTokenPaths` (`export.ts:932-947`) against X26; the block on #1148 is
cleared.

- **D1, package layout (pattern-following, X4).** Non-Capture Exhibit bytes ship under the kind
  subdirectory the Case store uses (`attachments/`, `images/`, `documents/`,
  `src/main/services/captureStore.ts:42-44`), keyed by Exhibit id with the stored extension, the
  way `pages/{captureId}.mhtml` is keyed; Derived Files sit beside their parent with the suffix the
  store uses (`_thumb.jpg`). evidence.json records every path; VERIFY.md and `verify.sh` name the
  same layout.
- **D2, thumbnails ship (pattern-following, ADR-0023 "Exports follow the kind").** A Capture's
  thumbnail is a Derived File anchored by a `derivation` entry (X34), so the package ships it and
  the verifier binds it. This is the only Derived File at head and the subject of the
  tampered-Derived-File KAT.
- **D3, selection scope (pattern-following, X35 and the #985 ruling).** `captureIds` carries
  Exhibit ids unchanged, because a Capture's Exhibit id is its capture id and the id space is one.
  No new key, no manifest schema bump. The verifier resolves the scope against the Exhibit set.
  AC 3 is met at the `generateReport` API with a KAT; no Data-screen export selection lands here.
  A selection-scoped package states the count of committed Exhibits left out, as #985 did for
  notes.
- **D4, the signed export entry's `verificationResult`: maintainer.** See the "Outstanding inputs" section.
- **D5, verification path (mechanical).** `pnpm build:verifier` runs before the test run, because
  `tests/verifier/binary.test.ts:60` is `describe.skipIf(!haveBinary)` and neither `pnpm preflight`
  nor CI builds the binary; the PR body reports the binary KATs as run, with the count. Adding the
  step to preflight is process work and stays out (ADR-0028).
- **D6, acceptance criteria amended (mechanical).** AC 1: each committed non-Capture Exhibit
  ships with the Derived Files the model holds for it, none at head; Captures ship with their
  thumbnail. AC 2: a tampered Derived File fails as "Exhibit N, derivation `<name>`," and AC 3: as D3.
  AC 5: the tampered-Derived-File KAT uses a Capture thumbnail.
- **D7, the verifyDerivedFiles advisory closes here (placement).** One binding predicate in
  `src/shared/verify/` (parent Exhibit id resolves to an entry the chain carries, output path
  equals the stored path, output hash equals the recomputed bytes; a manifest index alone never
  binds), called from both the package verifier and `src/main/services/exhibits.ts`. The grounds
  are the floor: if the app and the standalone verifier can disagree on the same bytes, one of them
  mis-attests.
- **D8, no pooled content (mechanical sequencing).** No Working Copy opt-in exists at head
  (`ExportOptions` has no pool key). The body's "plus pooled files only by opt-in" is a follow-up
  ticket citing ADR-0024, not scope here.
- **D9, the report's Exhibit index lands here (mechanical sequencing).** The `exhibitIndex`
  module at `reportHtml.ts:769-845` gains kind and origin columns; the ticket permits it.
- **D10, `verify.sh` is the seventh surface (placement).** `verifyScript.ts` is extended with
  VERIFY.md, and the PR adds its blocking-tier row to
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, the precedent being
  `docs/plans/2026-09-14-data-explorer-completion.md`.
- **D11, the SKIP loop goes (mechanical sequencing).** `evidencePackage.ts:515-546` and its KAT at
  `manifestSchema3.test.ts:771-845` are removed with the binding work.
- **D12, implementation rules (pattern-following, X18 and X26).** `buildExhibits` reads the stored
  Exhibit Number; the Exhibit modules render whenever the package holds Exhibits, not only when
  captures are included; `buildTimestampTokenPaths` covers committed Exhibits' tokens.
- **D13, docs in the same PR (placement).** `README.md:50-54` (the zip contents enumeration).
  `website/content/docs/birdbrain-technical-whitepaper.mdx:168` is the same enumeration and belongs
  to #628's file in the conflict map; it goes in the PR findings list.
- **D14, KAT shape (test shape).** One fixture Case (a Capture with its thumbnail, a committed
  attachment, image and document) reused by `export.test.ts`, `evidencePackage.test.ts` and
  `binary.test.ts`; the pre-scope fixture under `tests/shared/verify/fixtures/` still passes and the
  PR reports it. The PR states whether `e2e/export.spec.ts` gains a mixed-kind case or why it stays
  capture-only, because preflight does not run Playwright and CI does.

Findings for the PR body, not scope: `nextExhibitNumber` is `MAX + 1` and reuses a deleted top
number against X18 (`exhibitRepo.ts:56-61`); `docs/adr/` holds two files numbered 0029.

### #653 (blocking by `src/main/index.ts`, M)

Stale at head: the body's "contributor to #628" hypothesis (independent root causes: 10 s is
shorter than 30 s on every platform); AC 4 contradicts the body's own all-platform design; AC 5 is
already satisfied by `tests/main/services/extensionPath.test.ts:35-56`; the sketch's
`app.getPath('userData')` breaks both harnesses that redirect user data;
`src/main/services/demoCase.ts:42-44` cites `getExtensionPath` as its mirror. Playwright launches
the app from the build directory, not the packaged app, and `package-smoke.mjs` launches once, so nothing automated exercises the
relaunch at head.

Decisions, all posted as the 09-19 amendment: stage-beside-then-atomic-rename with a stamp file
written last (pattern, `src/main/services/db/dbSnapshots.ts:453-462`); `extensionPathExists()` true
only when the stamp matches; a failed sync logs and surfaces `EXT_NOT_FOUND`, never aborts launch;
user data resolved through `BIRDBRAIN_USER_DATA`; one call in the `whenReady` chain of
`src/main/index.ts`, accepting the blocking fire as incidental and labelling the PR; AC 4 and AC 5
amended; tests on real temporary directories mocking `'fs'`, not `'node:fs'`;
`scripts/package-smoke.mjs` gains a second launch against the same user-data directory asserting the
copy persists, which on the AppImage leg is the relaunch; the gate document's sections 3 and 5 gain
the human checks. The tester guide is not this PR's file. The two-loadable-copies hazard for
existing Windows and `.deb` testers goes in the findings list and the guide's upgrade note (#1246).

### #628 (blocking by `session.ts`, S)

Stale at head: four of seven anchors, the "capture round-trip refreshes it" claim (`POST
/api/captures` never touches the session), "three surfaces" (four, plus #630 and #814 exist),
silence on `birdbrain-technical-whitepaper.mdx:99` and on the six tests that pin the 10 s default.

Decisions, all posted as the 09-19 correction: module-level defaults 90 000 ms and 15 000 ms as the
body pins; `captureServer.ts` untouched, the middleware idea in the findings list; the six
existing tests pinned to `extensionTimeoutMs: 10_000`; AC 3 read the strong way (one `touchExtension()` call, monitor
ticks only); the whitepaper line corrected in the PR; `capture-pipeline.mdx` left to #1485.

### #1246 (none, M)

Stale at head: the three August stale facts are already fixed (#443, #444); there is no lapse,
wave or invitation text to remove; the brief's "export remains the only user-driven backup" is
false (Backup Database exists), and its "reaches every NSIS and AppImage install" understates the
`.deb`, which downloads updates and installs only on Restart to update
(`src/main/services/updater.ts:66-99`); `download.mdx` does not exist; `index.mdx:25` is the only
live internal link to the guide and is missing from the body's Where list.

Decisions, all in the triage comment: keep the filename and slug, retitle; `title` and
`description` frontmatter; placement between `index` and `tester-guide` in both manifests; the
corrected backup and `.deb` sentences; the feedback ask verbatim on the download page with the
guide pointing at it; FUSE text copied from `release.yml`; no version or date; `./name.mdx` links;
`docs/agents/website.md`'s internal-link count kept true; the guide's Updating section written
against #653's behaviour. Out of scope and in the findings list: `README.md:104`, the privacy
whitepaper's macOS-on-request line, `release-macos.yml` (a maintainer-dispatched workflow is not a
request channel).

### #1247 (advisory, S)

Stale at head: there is no `workflow_dispatch` on `release.yml`; the download page does not yet
exist; the here-document is unquoted with backticks escaped and a 10-column body indent that YAML strips,
so a line at another indent changes the published markdown.

Decisions, all in the triage comment: preamble under its own H2, preceding the download table; the four
statements worded from the brief; macOS paragraph to "not published, unsupported, notarization is
the blocker"; closing link to `/docs/download/` with the guide secondary; everything else in the
here-document byte-identical; a raw-text regression test in `tests/packageSmokeWorkflow.test.ts`; no
`workflow_dispatch` added.

## Conflict map

The rule is that no two parallel implementers edit the same file. Ownership is assigned so the
four batches can run at once.

- **`website/content/docs/tester-guide.mdx`** belongs to #1246. #653 does not touch it; the
  rewrite describes the post-#653 extension folder, and #1246 merges after #653.
- **`website/content/docs/birdbrain-technical-whitepaper.mdx`** belongs to #628 (line 99). #1156
  leaves line 168 in its findings list.
- **`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`** belongs to #1156 (the
  `verifyScript.ts` row). #653's exclusion-row wording is a findings note.
- **`README.md`** belongs to #1156 (lines 50-54). #1246's two macOS lines are findings.
- **`src/main/services/captureServer.ts`** is touched by nobody in this set; #628's middleware
  option and #653's status-field option are both rejected. PR #1485 edits it.
- **`src/shared/schemas.ts`** is #1156's alone in this set; #1485's hunk is in a different region.
- **`.github/workflows/release.yml`** is #1247's alone. #1246 deletes the guide's macOS section
  that line 64 points at, and #1247 rewrites that line, so the coupling is merge order, not text.
- **PR #1485** shares `reportHtml.ts` (an import and one line in `renderExhibit`) and
  `manifestSchema3.test.ts` (four hunks, none in the SKIP describe; the `FROZEN_ENTRY_HASHES` array
  is shared) with #1156. Whichever merges second rebases; the reviewer checks that #1485's
  `httpStatus` and `finalUrl` row survives in `renderExhibit` if #1156 is the one rebasing.

## Batch shape

All four batches start together; the binding constraint is the maintainer's review queue.

- **A, #1156.** One `birdbrain-implementer`, one PR, `evidence-affecting`, human review. Starts
  after the plan is approved and the export-entry decision is ruled, from `main`, not waiting on
  #1485. If the maintainer wants a split, the only testable seam is exporter plus evidence.json
  first with the SKIP loop still in place, then binding plus guard removal; verifier-first cannot
  be proven because the suite's only packages come from the same head.
- **B1, #653** and **B2, #628.** Two implementers, two PRs, no shared file. Both PRs carry
  `evidence-affecting` because each fires the blocking tier by path. Two PRs rather than one: the
  root causes are independent, the evidence arguments differ (incidental fire against the
  case-routing row), and one logical change per commit.
- **C, #1246.** One implementer, five files, no label. The PR stays open until the cut.
- **D, #1247.** One implementer in a local worktree, pushed over SSH, never `queued`.

Merge order the maintainer controls: #653, #628, and #1156 as reviewed; #1247 then #1246 as the
last two merges before the tag, so that trigger 4 holds and the release notes' download link
resolves at the first tag that renders them.

## Workflow shape

Phase 1 ran as one `Workflow` (`beta-path-phase1-reground`, run `wf_7256a36a-ed4`): five readers,
one adversarial refuter per reader, one completeness critic, eleven agents, all Opus at `max`. The
refuters overturned twenty reader claims across the five tickets, most usefully the #653
write-order contradiction and the #1156 seam direction; the critic supplied the conflict map's
doc-file collisions. Phase 2 is five `Agent` calls (`birdbrain-implementer`, `isolation:
'worktree'`, `model: 'opus'`), each told it runs on its own with no dispatcher above it, so it opens nothing itself and returns
branch, sha, title, body path and labels; the session opens each draft PR through `agh` with the
labels in the create call, reads them back, and links the PR. Phase 3 is one `birdbrain-reviewer`
at a time, a pre-pass per PR, and the sha pinned before and after.

## Review load

Three human reviews on evidence-affecting PRs (#1156, #653, #628) and two on unlabelled ones
(#1246, #1247), none auto-merging. #1156 is the long pole at XL; the other four are S to M and
should reach the maintainer within the first review day.

## Outstanding inputs

Two things the maintainer owes, each stated in full.

1. **The signed export entry's `verificationResult` (#1156, D4).**
   `ManifestExportVerificationResultSchema` is `.strict()` with `captureCount`, `verifiedCount`,
   `tamperedCount` and `missingCount`. Option (i): leave the shape alone; the signed entry counts
   Captures, while evidence.json, report.html and certification.html count every kind, and the
   Evidence impact section states the asymmetry; a follow-up widens the entry at the next
   `MANIFEST_SCHEMA_VERSION` bump after `validateExportEntry` is routed through the too-old
   screen. Option (ii): widen it now, before any verifier is distributed, at the cost of a larger
   #1156. Recommendation: (i), because the entry's statements stay true and the beta is not the
   moment to enlarge the long pole; the counter-argument is that the beta is the last moment a
   shape change costs nothing in the field.
2. **Plan approval for #1156 under ADR-0016**, which covers D1-D14 in the preceding section. #653 and #628 also touch
   a blocking-tier file each; their plans are the intake comments already posted and are included
   in the same approval.

## What the maintainer still does by hand to reach the tag

Merge the five PRs in the order the "Batch shape" section gives. Cut a `v*` tag on a commit with a green `main` run. Run gate
v1 (`docs/plans/2026-08-15-pre-ship-validation-gate.md`) on the CI-built Windows NSIS and Ubuntu
AppImage artifacts, including the new Open-extension-folder relaunch check in section 3 and the
upgrade path in section 5. Run the two observed sessions (#1237) on that candidate; a floor finding
cancels the cut. Build the verifier locally from the tagged commit for section 4.

## Outcome, 2026-09-19

Every batch produced a PR the same day; none merged, by design.

| Ticket | PR | State at end of session | Pre-pass |
| --- | --- | --- | --- |
| #628 | #1490 | ready for review, `evidence-affecting`, CI green | approve, round 2 |
| #1246 | #1491 | draft, merge-gated on #1493, CI green for a docs-only diff | request changes by design: both pages describe the #653 extension folder, which is true only after #1493 merges; a delta pass follows a back-merge of `main` once it has |
| #1247 | #1492 | ready for review, CI green including the Package smoke matrix | approve, round 1 |
| #653 | #1493 | ready for review, `evidence-affecting`, CI green including both smoke legs | approve, round 7; the smoke's second launch now proves the copy persists across launches with different extraction directories |
| #1156 | #1494 | ready for review, `evidence-affecting`, CI green | approve, round 7; a twelve-state Derived File consistency test pins enclosure, index, report, certification and both verifiers |

Two things happened that the plan did not foresee. GitHub Actions stopped starting jobs at
09:33 UTC with a billing message and resumed at about 10:00; every run that failed at startup
was re-run at its head. And the #1156 and #653 review loops each took seven rounds: the code
verdicts settled by round 3 and 4, and the remaining rounds were sentence accuracy in comments
and PR bodies, which the reviewer's truth rule treats as blocking on an evidence PR.

Two decisions were taken under ADR-0015 during the loops and are open to veto. Unanchored
Derived Files (X34) are held back from both export classes and disclosed; on a broken chain the
files with entries still ship and both documents say the chain did not verify. The extension
path has two predicates: a consistent copy (manifest present, stamp readable) is advertised even
when its stamp is stale, and only a missing or inconsistent copy yields the not-found error.

One question stays with the maintainer, restated in full on PR #1494: a Working Copy discloses a
held-back or lost Derived File only as an integer in `WORKING-COPY.json`, because that class
carries no report and no certification by design; is that enough disclosure for that class?

### Later the same day

An outside review of PR #1494 at `a373a04c` found three defects: a fabricated Exhibit row in
`evidence.json` still verified PASS because reconciliation compared ids only, certification
counted a chain-unverified Derived File as enclosed without checking the packaged path, and
`verify.sh` did not normalise backslash storage paths. All three were fixed with regression
tests at `0fb5d6de` and approved on a delta pass. The maintainer then merged #1490, #1492,
#1493 and #1494.

With #1493 on `main`, #1491 took a back-merge (head `aac48556`), passed the ADR-0025 delta pass
against the merged extension-path code, and was marked ready. It is the last merge before the
tag. Two advisories remain on the tester guide (lines 144 and 149) and one carried-forward
finding on `evidencePackage.ts`: legacy `captures` rows are still reconciled by id alone.
