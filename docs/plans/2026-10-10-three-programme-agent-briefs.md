# Agent briefs for Shared Cases, the capture engine and the Case investigation view

**Status:** active

Reflects `origin/main` at `df531d36` (PR #1795 merged) and a verification pass on 2026-10-10
that checked each brief against its issue, the specs and the code. Schema version 37,
`MANIFEST_SCHEMA_VERSION` 5, `CASE_ARCHIVE_SCHEMA_VERSION` 8. Revised the same day with the
maintainer's 74 numbered rulings of 2026-10-10 (listed under "Ruled on 2026-10-10") and the issues
filed from them.

This plan orders the remaining work on three programmes into briefs that agents can run
unattended, grouped into waves that order the work so that briefs in one wave do not collide.
Each brief names the issue it works (or "to file"), what it depends on, the files it starts in,
what proves it done, and whether it is evidence-affecting. Many briefs here have no issue yet.
Dispatch only works a `ready-for-agent` and `queued` issue, so each brief becomes an issue that
meets the ready-for-agent bar in `docs/agents/triage-labels.md` before an agent takes it.

Sources: the [collaborative cases design](../specs/2026-09-19-collaborative-cases-design.md)
and tracking issue #1508; [ADR-0034](../adr/0034-the-app-acquires-and-the-extension-is-a-companion.md),
[ADR-0035](../adr/0035-one-transaction-record-per-capture.md) and the
[capture engine first slice](../specs/2026-09-30-capture-engine-design.md); the
[Case investigation engine](../specs/2026-10-02-case-investigation-engine-design.md), the
[Case retrieval pipeline](../specs/2026-10-02-case-retrieval-pipeline-design.md),
[ADR-0042](../adr/0042-investigation-records-are-case-data-outside-the-manifest.md), the
[view feasibility assessment](../specs/2026-10-04-case-investigation-view-feasibility-assessment.md)
and the [retrieval first-slice plan](2026-10-09-case-retrieval-first-slice.md). Four docs this plan
briefed are on draft PRs: the CE-P plan (`docs/plans/2026-10-10-capture-engine-first-slice.md`,
#1803), the stage-2 spec (`docs/specs/2026-10-10-capture-engine-launched-browser-design.md`,
#1804), the CI-P plan (`docs/plans/2026-10-10-case-investigation-engine.md`, #1805) and the
anonymous-team sync spike (`docs/specs/2026-10-10-anonymous-team-sync-spike.md`, #1806).

## What limits parallelism

**The maintainer's review bounds throughput.** Almost every code brief below touches a
blocking-tier path, so it needs the maintainer's review and never auto-merges. Unattended work
stays in dispatch's two slots, at most six cycles a day
([ADR-0045](../adr/0045-dispatch-runs-two-slots-every-hour.md)). The maintainer ruled on
2026-10-10 (ruling 3) that larger parallel batches run only in interactive sessions the
maintainer watches: no unattended lane runs beyond the two slots, and no new spend bound is set.
The waves below are an ordering, and each wave's agent count is the most that can run at once in
a watched session. Whoever runs a wave, cap the evidence-affecting PRs waiting on review at two
(ADR-0045). A wave's code PRs open only as earlier ones merge.

**Four things serialize across all three programmes.** Two briefs that hold the same lane must
not be in flight at once.

| Lane | Rule | Briefs that hold it, in proposed order |
|---|---|---|
| Database migration | One migration PR open at a time. `pnpm db:migration:new` writes N+1 in `core.ts` and `migrations.ts`, so two branches cut from `main` both write 38. The version goes to whichever merges first. | Whichever is ready first takes it. Expected order: CI-3 (no gate left), SC-2 (gates cleared 2026-10-10; one migration that rebuilds the working-layer constraints, see SC-2), CE-P step 2 (CE-6), CI-9 and the ADR-0040 link-capture writer (slice-2 plan step 3). CE-3 joins only if it mirrors the Egress fields onto `captures`. #1498, re-triaged on 2026-10-10, joins with its migration; it stays off the dispatch list until the maintainer answers the schema-version question asked on the issue. The maintainer keeps #811 out of the queue, or folds it into SC-2, while SC-2 holds `tagRepo.ts`. |
| Manifest schema | A verifier release ships before any writer of the new fields merges (ADR-0023). | beta.23 (#1799) ships as is, carrying only #1747's schema-5 (Egress) reader (ruling 19). CE-3, the writer of the schema-5 fields, merges after beta.23 is tagged. Then, under one number: CE-P step 1 (CE-5), the ADR-0040 verifier step (after #1736 accepts ADR-0040), and #1498's verifier step. #586's schema step takes a later number (the delivery roadmap's 2026-10-26 ruling). The release carrying CE-5's verifier follows; then CE-P's writer steps 6, 9 and 10 merge, and the stage-2 verifier step (CE-S2) takes the next number. SC-5 joins only if the node key cannot persist, and #1638's fix joins if #1812's rule adds a signed field. |
| Case Archive version | One bump in flight; each takes the next number at merge. | SC-2 (if its migration changes what an archive carries), the ADR-0040 link-capture writer, CI-9b, CE-P step 3 (the first slice's one bump, which merges before any CE-P writer step; ruling 33), #1813 once its option is chosen, and CE-3 if it mirrors Egress columns, in the order they become ready. |
| Hot files | Rebase cost, not correctness. Merge in the stated order. | `backgroundRenderer.ts`: CE-1, CE-2, CE-3, #1499, then CE-P steps 6, 9 and 10. `recapture.ts`: CE-2, CE-3, #1499, the link-capture writer, then CE-P steps 6, 9 and 10. `captureLifecycle.ts`: #1815, CE-3, CI-4, SC-2b, CE-10, then CE-P steps 3, 6, 9 and 10 (step 3 may land earlier at rebase cost only), then the stage-2 clicked-Capture step. `captureRepo.ts`: CI-1, SC-2b, CI-5, CE-P step 2, CI-14. `noteRepo.ts`: CI-1, then SC-2. `manifest.ts`: SC-1, #1815 (if it changes `withDeletionEntry`), SC-2, CE-P step 1, SC-6. `trustedTime.ts` and `timestampWorker.ts`: SC-1, then SC-2b and SC-4. `settings.ts`: CE-3, CE-4, then SC-5. `OperatorConfig.tsx`: CE-3. `TopBar.tsx`: CE-4, then SC-8. `caseArchive.ts`: SC-2 and CE-3 (only if they bump the archive version), CI-4, then the link-capture writer, CI-9b, CE-P step 3 and #1813 in the Case Archive lane's order. `exhibitBackfill.ts`: #1814, #1813, then SC-2b. `export.ts`: #1814 and #1815 (if either changes it), SC-4 (if packages carry receipt stamps), CE-P step 4, then CI-13. `verifyScript.ts` and `verifyRunbook.ts`: SC-V, SC-4 (if packages carry receipt stamps), CE-P step 4. |

Outside this plan: #1638's fix, rewritten once #1812's note is approved, joins the `manifest.ts`
hot-file list, and the manifest schema lane if the note's rule adds a signed field. #1523
(ruling 14: imported Captures start unverified; `ready-for-agent`) changes how the Case Archive
import writes Capture rows (`importCaptureRows` in `captureRepo.ts`), so it takes its turn in that
file's order after CI-1. An issue outside this plan that needs a lane a brief here
holds stays out of the queue until the lane frees, or takes a slot in the stated order.

`src/shared/ipc.ts`, `ipcHandlers.ts` and `src/preload/index.ts` change in most briefs. The
additions only append, so a rebase resolves them; they are not a lane.

## Decisions and approvals the maintainer owes

Each row blocks only the briefs named. The waves also assume the maintainer applies `queued` to
each brief's issue as its wave opens; each to-file brief is filed and triaged then.

| Gate | Blocks |
|---|---|
| Read the capture engine first-slice spec and the CE-P plan (#1803), with rulings 25 to 35 folded in, and approve both on the PR (rulings 36, 71). | CE-P steps 1 to 10 (step 0 does not wait) |
| Read the stage-2 spec (#1804), with rulings 37 to 56 folded in, and approve it on the PR (ruling 71). | CE-S3, CE-A and the stage-2 code briefs |
| Read the CI-P engine plan (#1805), with rulings 57 to 69 folded in, and approve it on the PR (ruling 71). | CI-8 onward, including CI-9b, CI-10a, CI-D1, CI-D2, CI-R, CI-E and CI-B; CI-S through the E23 amendment #1805 applies |
| Tag 1.0.1-beta.23 from #1799 as it is, carrying only #1747's schema-5 reader (ruling 19). Its release notes tell Shared Case members to upgrade together. | Merging CE-3 |
| Tag a release carrying CE-P step 1's verifier, with the ADR-0040 schema step under the same number (ruling 19; #586's step moved to a later number by the delivery roadmap's 2026-10-26 ruling). Its release notes tell Shared Case members to upgrade together. | Merging CE-P steps 6, 9 and 10; the stage-2 verifier step's place in the manifest schema lane |
| Designer revises the Shared Case members mock: items 19, 24, 25, the "Verified" label, and the ADR-0032 notice that teammates and the relay see the Operator's addresses while the Egress is not Direct, on the Members tab and the sync pill. Ruling 18 keeps the notice in this revision. SC-3's spike adds evidence for its copy: a teammate can learn every interface address on the Operator's machine. | SC-8 |
| Sign off `checkFieldHit` (retrieval plan Ruling 4). | CI-6 merge, and through it CI-7 and CI-11 |
| Confirm, from CI-B's run, that the base-layer bar is met and the safety gate passes on the synthetic Case, with thresholds set on variant A and the bar confirmed on variant B (ruling 64). The bar and the gate are in the engine spec's "Evaluation and first slice" section. | CI-V5 merge and any release that shows the Investigate section |
| An ADR choosing the AI layer's local model and runtime, and the open questions G3 and G7 in the view brief. | The AI layer's local option and later view states; not briefed |
| Approve CE-A's browser cookie-import ADR (ruling 72). | The cookie-import ticket under #541, which is also grilled before it is ready-for-agent |
| If CE-3 is still waiting on beta.23 when SC-5 is otherwise ready, choose: hold SC-5 for CE-3, or merge SC-5 without the non-Direct Egress state and file a follow-up that adds it once CE-3 merges. | SC-5 |
| Pick an option on #1813. The issue recommends option (a): the archive carries every anchored Derived File. | #1813, and its place in the Case Archive lane |
| Answer the schema-version question asked on #1498. | #1498's place in the migration lane and on the dispatch list |
| Rule on stage-2 decision D18 (glossary), which stays open. The stage-2 spec recommends adding a Capture Scope entry to `CONTEXT.md` and amending its Active Case entry when #600 lands. | The `CONTEXT.md` changes in the stage-2 passive capture step (#600) |
| Designer designs from CE-U's brief in the Birdbrain UI design project. | The stage-2 clicked-Capture step (through the feasibility pass on the mock), CI-14, CI-V1's header count and CI-V4's gap-list entry |
| Decide where in the app #1816 shows the capture engine's facts. | #1816's re-triage to ready-for-agent |

### Ruled on 2026-10-10

The maintainer ruled on the gates below on 2026-10-10. The numbers are the rulings' own, as cited
on the issues they changed. Two earlier gates that no ruling settled now sit in the briefs they
block: a test-only SOCKS5 server dependency (CE-3, only if it takes one) and what a Timestamp
Token attests for a Capture without MHTML (stage 4, in the Capture engine briefs' opening).

- **Queue (1).** `queued` on #1713 (SC-1), #1693 (CE-1), #1726 (CE-2) and #1590 (CI-1).
- **Synthetic Case size (2).** 1,000 Captures, for CI-2's baseline and CI-E's engine runs.
- **Parallel agents (3).** Dispatch's two slots carry unattended work; larger batches run only in
  watched interactive sessions (What limits parallelism).
- **Anonymous-team mode (4).** No-go on `@number0/iroh` 1.1.0, recorded on #1697, which stays
  open for the human Tor and two-network measurements. Not briefed.
- **Sync approvals (5, 9, 11, 12).** `cborg` 6.1.3 for CBOR (SC-2); a newer-version `lastError`
  kind (SC-2, SC-8); base32 written in the app against the RFC 4648 test vectors (SC-6);
  `qrcode-generator` 2.0.4 for the invite QR code (SC-8, or SC-6).
- **Member identity (6).** One signing key per installation, spec decision 6 unchanged; SC-D
  documents cross-group linkage and that anonymous members use a pseudonym display name.
  Revisited with anonymous mode.
- **Received Captures (7, 8).** SC-2b re-derives display fields from the received files and
  applies a received deletion as the author's own deletion does.
- **Labels and triage (10, 17).** `evidence-affecting` on #1512 and #1515; #1513 split into #1809
  (SC-5) and #1810 (SC-6); #1241 re-triaged to ready-for-agent with the two-member fixture; SC-2b
  filed as #1811.
- **#1638, #1523 and #1657 (13 to 15).** An agent writes the fork-authorship note first (SC-F,
  #1812); #1523 clears the three `last_verified_*` columns on import; #1657 closed for its scope,
  with #1813 to #1815 filed for its three remaining gaps.
- **Relay hosting (16).** First testers use n0's public relays. One real sync between two machines
  through a relay is recorded before the tester handoff, and the project hosts a relay only if a
  tester cannot reach n0's.
- **Members mock notice (18).** The ADR-0032 notice stays in the designer's revision; it is not
  copy-only.
- **beta.23 (19).** Ships as is; the ADR-0040 and #586 schema steps share the later release with
  CE-5's verifier.
- **Update checks (20).** `electron-updater` traffic follows the Egress and fails closed (CE-3).
- **#598 (21).** Extraction runs in a utility process (CE-10); #598 is ready-for-agent.
- **Persona re-triage (22).** #1505 closed as superseded by CE-S2; `persona-window` left #1498's
  scope.
- **#1694, #804, #635 and #1667 (23, 24).** #1694 closed and its display filed as #1816; #804
  closed; #635 folded into CE-S3 and closed; #1667 closes when CE-P step 6 records its background
  half, and its extension half closes in favor of CE-S3.
- **First slice (25 to 35).** The `warcio` licence, the test readers, the probe rerun policy, the
  spec's open questions 1 and 2, and the CE-P plan's open questions A to F. CE-P lists the ones
  that change its steps.
- **Stage 2 (37 to 56).** The stage-2 spec's decisions D1 to D23, except D18, which stays open
  (gates table). CE-S2 lists the ones that change this plan.
- **Investigate section (57).** Option (a): CI-V1 registers the route and components, and CI-V5
  adds the `Sidebar.tsx` and command palette entries.
- **MCP and Withheld (58).** MCP tools list a withheld Exhibit with its mark and never return its
  content or values drawn from it; the implementing brief, still to file ("MCP tools and Withheld
  from analysis"), audits every registered tool.
- **CI-P (59 to 69).** E23 approved as proposed, which rules #543 for a Shared Case; CI-P's open
  questions answered; the four brief splits taken. The CI briefs carry each ruling.
- **Designer items (70).** The Withheld from analysis mark and the "not read" count join CE-U.
- **Approvals (36, 71).** The rulings fold into this plan and the four briefed docs; the
  maintainer then reads #1803, #1804 and #1805 and approves each on its PR.
- **Browser cookie import and cookies at rest (72, 73).** CE-A and CE-AR.
- **Invites (74).** `bbinvite1` carries only the node identity and relay URL, never a direct
  address (SC-5, SC-6).

## Waves

A wave starts when its gates clear and the briefs it depends on have merged. Waves overlap:
a lane moves to its next brief as soon as its own dependencies merge.

| Wave | Shared Cases | Capture engine | Case investigation | Agents |
|---|---|---|---|---|
| 0, now | SC-1, SC-7, SC-F, #1814, #1815; delivered: SC-3 (#1806) | CE-1, CE-2, CE-P step 0, CE-U, CE-AR; delivered: CE-P (#1803), CE-S2 (#1804) | CI-1, CI-3; delivered: CI-P (#1805) | 12 |
| 1 | SC-2, SC-V, #1813 | CE-3, CE-A | CI-2 | 6 |
| 2 | SC-2b, SC-4 | CE-4, CE-D1 (docs), CE-S3 (spec), CE-P steps 1 and 7 | CI-4, CI-8 | 9 |
| 3 | SC-5, SC-6 | CE-10, CE-P steps 2 and 8 | CI-5, CI-V1 | 7 |
| 4 | SC-8, SC-9, SC-D (docs), SC-E | CE-P steps 3 and 5 | CI-6, CI-9, CI-10a, CI-E, CI-V2, CI-V3, CI-V4 | 13 |
| 5 | | CE-P steps 4 and 6 | CI-7, CI-9b | 4 |
| 6 | | CE-P step 9 | CI-10, CI-D1, CI-D2, CI-R, CI-14 | 6 |
| 7 | | CE-P step 10 | CI-11, CI-12, CI-S | 4 |
| 8 | | #1816 | CI-13, CI-B | 3 |
| 9 | | | CI-V5 | 1 |

The Agents column counts the briefs in each wave that still need an agent. It is the most that
can run at once in a session the maintainer watches (ruling 3); unattended, dispatch runs two.
Delivered docs wait on the maintainer's reading and run no agent. The stage-2 code briefs are
not in the table yet: they are filed once the stage-2 spec is approved (see CE-S2). Nor is the
ruling 58 brief, "MCP tools and Withheld from analysis", which no plan has placed yet.

Wave 0 has four docs agents (SC-F, CE-P step 0, CE-U and CE-AR) and eight code agents. Seven of
the code briefs (SC-1, #1814, #1815, CE-1, CE-2, CI-1 and CI-3) touch blocking-tier paths and need
the maintainer's review; SC-7 does not. Under the review cap of two, those seven code PRs open in
turn, and the four docs PRs need the maintainer's approval.

## Shared Cases briefs

Steps 1 to 3 merged (PRs #1518, #1571, #1626). These briefs finish steps 4 to 7 and the defects
that block a tester build. Nothing in `src/main/services/sharing/` exists yet.

**SC-1. Trusted time reads every accepted chain (#1713).** Wave 0, queued 2026-10-10, no
dependencies. Evidence-affecting.
- Starts in `trustedTime.ts`, `timestampWorker.ts`, and the read side of `manifest.ts`.
- Done when another member's stamped Capture reads as stamped, and a chain that failed
  verification contributes nothing.
- Verify with `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` on the trusted-time tests, then
  `pnpm preflight`.
- Merges before SC-4. Both edit `trustedTime.ts` and `timestampWorker.ts` (SC-1 widens the
  entries `resolveTrustedTime` and `buildTrustedTimeIndex` pass; SC-4 adds receipt-stamp
  reporting), so the order saves rebase work. It is not a correctness dependency.

**SC-2. Transport interface, in-process transport and sync session (#1512).** Wave 1. Its gates
cleared on 2026-10-10: `cborg` 6.1.3 is approved for the wire format (ruling 5), one signing key
per installation stands (ruling 6), the newer-version `lastError` kind is approved (ruling 9), and
#1512 carries `evidence-affecting` (ruling 10). It takes the migration lane after CI-3.
Evidence-affecting: it writes `merge` entries and accepts remote chains and Exhibit bytes.
`ManifestEntrySchema` already defines `merge`, so this needs no manifest schema bump.
- Starts in a new `src/main/services/sharing/`, `manifest.ts` (`appendManifestEntry`, remote
  chain files), `noteRepo.ts`, `tagRepo.ts`, the annotations path, and the IPC files. Builds the
  blob list from one shared list of the hash fields a capture entry anchors (`contentHash`,
  `screenshotHash`, `textHash` today). CE-P step 1 (CE-5) adds the Transaction Record and PDF
  hashes to it, and whichever of the two merges first creates the list (CE-P plan D2 names it
  `CAPTURE_ENTRY_HASH_FIELDS` in `src/shared/verify/manifestChain.ts`).
- Takes the migration lane before writing code. Migration 36 added `author_installation_id`,
  `version`, `deleted_at` and `row_signature` to notes, annotations, tags, `exhibit_tags` and
  `note_tags`, but the constraints do not fit per-author rows. One migration covers PR #1571's
  five findings: the global UNIQUE on `tags.name` in the base schema in `migrations.ts` (which
  fails a remote member's tag that shares a local tag's name), `annotations` keyed by `capture_id`
  alone, no `tags.created_at` for the color rule, no sync columns on `annotation_pins`, and
  author-less primary keys on `exhibit_tags` and `note_tags`. It states whether the Case Archive
  needs a bump (an older importer drops `tags.created_at` and the `annotation_pins` sync columns,
  and merges two members' same-name tags into one in `insertImportedRows` in `caseArchive.ts`).
  If it does, SC-2 takes the Case Archive lane and bumps `CASE_ARCHIVE_SCHEMA_VERSION`.
- Done when the issue's two- and three-peer tests pass (first and incremental sync, revocation
  mid-session, a forged entry, a blob hash mismatch, transitive rows, and exactly one `merge` per
  session that brings new entries), a peer not in the roster cannot obtain entries or blobs, and
  every remote file becomes visible only after its hash matches the entry.
- Also done when tests show three things. First, an entry above the local schema version stops
  that member's chain at that index and sets the newer-version `lastError` kind instead of a
  forged verdict, and later entries resume after an upgrade. Second, a Settings > Database edit
  to a synced table either re-signs and re-versions the row or the app refuses it for Shared
  Cases. Third, after a snapshot restore the next local write gets a version above every version
  peers hold (for example, from a high-water mark in `sync-state.json`, which a database restore
  does not revert).
- If CE-P step 9 or 10 merges first, SC-2 adds the two-peer test that the receiver hash-checks
  the Transaction Record or PDF before showing it and that its Shared Case walk passes (ruling 34).
- In the same PR, amends `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`: the
  session, entry-acceptance and blob-acceptance modules under `src/main/services/sharing/` go on
  the blocking tier, and the transport interface and `IrohTransport` go on the advisory tier or
  the exclusion list, with the reason (the #227 and #515 precedents).

**SC-2b. Apply received entries to the local database (#1811).** Wave 2, after SC-1 and SC-2;
merges before SC-8. Evidence-affecting (`src/main/services/db/**`, `captureLifecycle.ts`).
- SC-2 writes no `captures`, `exhibits` or `capture_texts` rows for another member's Captures, so
  without this brief a joined member's app lists none of the Owner's Captures.
- Rulings 7 and 8: display fields no signed entry carries, such as a Capture's title, are
  re-derived from the received files, with no new signed rows. A received `deletion` removes the
  Capture from the local list and deletes the local replica files, as the author's own deletion
  does; the `deletion` entry stays in the author's chain, and the receiver writes none of its own.
- Starts in the sharing session module, `captureLifecycle.ts` (`runPostCaptureWork`,
  `runDataExtraction`, `deleteOne`), `exhibitRepo.ts`, `captureRepo.ts`, `mhtmlDecoder.ts` (for
  the received title), `timestampWorker.ts` and `exhibitBackfill.ts`.
- Done when, after a `MemoryTransport` sync, the receiver lists the remote member's Captures and
  Exhibits with author and Member Code, shows each title as its received MHTML carries it, finds
  their text in Case search, has their `extracted_data` rows (and field records once CI-4 has
  merged), shows their Derived Files, and resolves their Trusted Time through SC-1; this
  installation's timestamp worker and startup backfill write nothing for another member's
  content; and after the sender deletes a Capture and the peers sync again, the receiver no longer
  lists it, its replica files are gone, and the Shared Case walk still passes.
- Verify with the two-peer `MemoryTransport` tests, then `pnpm preflight`.

**SC-3. Spike: can sync hide every member's address? (#1697).** Wave 0, delivered as draft PR
#1806. Not evidence-affecting.
- `docs/specs/2026-10-10-anonymous-team-sync-spike.md` answers #1697's four questions:
  `@number0/iroh` 1.1.0 exposes neither `clear_ip_transports` nor `proxy_url`; the relay client
  speaks only HTTP `CONNECT` to a proxy, and only in Rust; two endpoints exchanged a payload
  through n0's relay, with no Tor run possible; and the binding has no relay-only mode, while a
  ticket built without addresses carries none. End-to-end sync timing moved to SC-5's smoke test.
- Ruling 4: anonymous-team mode is a no-go on `@number0/iroh` 1.1.0, recorded on #1697, which
  stays open for the human Tor and two-network measurements. Ruling 74 settles the spike's open
  question 2: invites carry only the node identity and relay URL.
- The spike's "Verdict for SC-5" findings are folded into SC-5.

**SC-4. Trusted Time on `merge` entries (#1515).** Wave 2, after SC-1 and SC-2 merge.
Evidence-affecting (label applied 2026-10-10), blocking tier.
- Starts in `timestampWorker.ts`, `trustedTime.ts`, `src/shared/verify/`, `src/verifier/`. If
  packages are to carry receipt stamps, it also starts in `export.ts`, `verifyScript.ts` and
  `verifyRunbook.ts`.
- Done when a session that writes a `merge` submits exactly one stamp of its Entry Hash
  (`subject: 'entry'`), a session without one submits none, content stamps are unchanged, and a
  known-answer test passes against a real DigiCert token.
- Also done when the PR states, in one line each for the standalone verifier, the package checker
  (`evidencePackage.ts`), `verify.sh` and `VERIFY.md`, whether it reports the receipt stamp, with
  a test for each that does.

**SC-5. Iroh transport and packaging (#1809, split from #1513).** Wave 3, after SC-2 and draft PR
#1806 merge, and after CE-3 (#1695) merges unless the maintainer lets SC-5 merge without the
non-Direct Egress state (see the gates table). Not evidence-affecting while the node key persists
(#1513: "the transport itself is not on the evidence path").
- Covers `IrohTransport` over `@number0/iroh` 1.1.0, pinned exactly; node-key persistence (the
  spec's open question 1), which stores the 32-byte secret key, encrypted with the operating
  system's credential store when available, and passes it to `secretKey` at every start; a
  loopback smoke test behind an environment flag; `sharing:isAvailable`; `sharing:setRelayUrl`;
  and the binding's packages in `asarUnpack` in `package.json`.
- From the spike: no code calls a `watch*` method on 1.1.0, which aborts the process, so the
  transport polls `paths()` and `addr()`; and the PR checks that the main-process build resolves
  the binding, whose `main` and `types` fields name missing files.
- The ticket `listen` hands out carries the node id and relay URL only, never a direct address
  (ruling 74).
- If the node id changes across restarts despite the stored key, the work stops for re-triage: a
  rotation path in `member-add` (`ManifestMemberAddEntrySchema` in `src/shared/schemas.ts`, a
  `.strict()` schema pinned at 4) would make SC-5 evidence-affecting and put it in the manifest
  schema lane, with a verifier release before any writer.
- Carries ADR-0032's requirement: when the Egress is not Direct, sync still runs and the sharing
  state says so, so SC-8 can show the notice that teammates and the relay see the Operator's
  addresses. The notice's wording and placement are in the designer's revision of the members
  mock (ruling 18); SC-5 supplies the state only. The state reads CE-3's Egress setting, which
  main lacks. If CE-3 is still waiting on its release, the maintainer picks: SC-5 waits, or it
  merges without the state and a follow-up adds it once CE-3 merges.
- Done when the smoke test passes and times one sync session, the part of #1697's question 3
  that SC-3 could not run. The PR states a manual check for a human to run: the binding loads on
  three platforms, and an Intel Mac reports unavailable instead of crashing.
- Also done when `SECURITY.md` Network egress, the `features.mdx` Network use list and the privacy
  whitepaper's outbound list name the n0 relay, peer connections, the inbound listener,
  port-mapping requests to the local router, and the ADR-0032 IP disclosure, including that a
  teammate can learn every interface address on the Operator's machine.

**SC-6. Invite, join and roster writers (#1810, split from #1513).** Wave 3, after SC-2; merges
after SC-V. Runs alongside SC-5. Evidence-affecting.
- Rulings: `join` sends the installation's existing public key, with no per-case or per-Persona
  key (ruling 6); base32 for `bbinvite1` is written in the app against the RFC 4648 test vectors,
  with no dependency (ruling 11); if SC-6 renders the invite's QR code in the main process it takes
  `qrcode-generator` 2.0.4, and otherwise SC-8 does (ruling 12); the invite carries only the node
  identity and relay URL (ruling 74), and the PR amends the collaborative cases design's "Invite
  and join" paragraph to match.
- Covers the `bbinvite1` format, the `join` and `welcome` handshake over `MemoryTransport`
  (treating the Iroh ticket as opaque), the `member-add`, `member-revoke` and `exclude` writers,
  and the IPC for invite, join, approve, decline, revoke, exclude, `getMembers`, `syncNow` and
  `sharing:cancelInvite`.
- Also covers the Owner's own first `member-add`, setting `cases.shared_at` and
  `owner_installation_id`, and `memberCode` on new `exhibit` entries.
- Done when the base32 code passes the RFC 4648 test vectors, a reused or expired invite fails
  with a named error, and a join from the wrong node fails the signature check. Creating the first
  invite writes the Owner's own `member-add` and sets `shared_at` and `owner_installation_id`; the
  PR states and tests whether new `exhibit` entries carry `memberCode`; a cancelled invite refuses
  a later join with the named error; and every entry it writes is stamped at a version the
  1.0.1-beta.22 verifier reads, so `MANIFEST_SCHEMA_VERSION` stays 5.
- Whichever of SC-5 and SC-6 merges second wires `IrohTransport` into the invite flow.

**SC-7. Seeded development profile (#1241).** Wave 0. Re-triaged to ready-for-agent on
2026-10-10 with the two-member fixture (ruling 17). Not evidence-affecting.
- Adds `pnpm dev:seed` with cases, captures, notes, tags and Selectors, plus a two-member Shared
  Case: the Owner's chain with signed `member-add` entries for both members and a second
  `manifest.<installationId>.jsonl`, hand-signed the way
  `tests/main/services/sharedCaseExport.test.ts` builds them, with `case_members` filled as the
  derived cache.
- SC-8's acceptance criteria name this fixture, and e2e and the app driver can share it.

**SC-8. Members UI (#1514).** Wave 4, after the designer's mock revision, SC-2b, SC-7, CE-3, the
IPC types from SC-5 and SC-6, and #1514's relabel to `ready-for-agent`. Evidence-affecting.
- Approved for it on 2026-10-10: `qrcode-generator` 2.0.4 for the Owner-side invite QR code,
  unless SC-6 renders it (ruling 12), and the newer-version `lastError` kind (ruling 9).
- Triage re-makes #1514's call ("No. Renderer only"): `ManifestLedger.tsx` and `ledgerModel.ts`
  sit under `src/renderer/components/data/**`, blocking tier, so the PR carries
  `evidence-affecting` and gets human review.
- Starts in `src/renderer/routes/__root.tsx` (the `/cases/$caseId` route tree, where the
  `/settings` child goes), `TopBar.tsx`, `CommandPalette.tsx`, `NewCaseWizard.tsx`,
  `src/renderer/components/data/ManifestLedger.tsx`.
- Done when every surface in the members brief renders in light and dark from the `pnpm dev:seed`
  two-member fixture with no unqualified assurance words; the Integrity label reads "Verified"
  instead of "Chain verified"; and the newer-version `lastError` kind and the non-Direct Egress
  notice render.

**SC-9. Sync service (to file).** Wave 4, after SC-5 and SC-6. Evidence-affecting by path
(`src/main/index.ts` is blocking tier).
- Spec decision 13 makes sync automatic (app start, a 60-second timer, Sync now). Neither #1512,
  #1809 nor #1810 owns the timer, the startup run or the listening endpoint.
- Starts in a new sharing service module and `src/main/index.ts`.
- Done when, with fake timers over `MemoryTransport`, a session runs at startup for every shared
  Case, repeats every 60 s while a peer is reachable, and stops for revoked members; the endpoint
  listens while the app is open and closes on quit; and `getSyncState` reports `peersReachable`
  from this service.

**SC-V. `verify.sh` checks Shared Case packages (to file).** Wave 1, no code dependency (the
schema-4 verifier shipped in 1.0.1-beta.22); merges before SC-6. Evidence-affecting, blocking
tier.
- PR #1626 kept this out and filed no issue. `verify.sh` reads `deletion` and `capture` entries
  from `$MANIFEST_FILE` only. Landing the fix before SC-6 means no Shared Case package ships with
  the old script.
- Starts in `verifyScript.ts`, `verifyRunbook.ts` and
  `tests/main/services/sharedCaseExport.test.ts`.
- Done when `verify.sh` verifies each member chain under its `member-add` key, checks every
  `merge` head, and binds remote Captures and Exhibits to their author's chain, or reports
  INCOMPLETE (exit 3), never PASS, for any member chain it does not check; and a two-member
  package with one forged remote entry fails under `runVerifyScript`.

**SC-E. Two-instance Shared Case e2e (to file).** Wave 4, after SC-2b, SC-6 and SC-7, alongside
SC-8. Evidence-affecting by path (a test-only Capture Server port override in
`src/main/index.ts`).
- The spec's Testing section asks for this test. A second instance cannot boot today: the Capture
  Server port is fixed (`CAPTURE_SERVER_PORT` in `src/shared/constants.ts`) and boot aborts on
  `EADDRINUSE`.
- Starts in `e2e/fixtures/electronApp.ts`, a new e2e spec, and a test-only transport bridge
  behind an environment flag.
- Done when two instances invite, join and sync one Capture, and the receiver shows it with the
  Owner's Member Code prefix.

**SC-D. Shared Cases docs (to file).** Wave 4, beside SC-8; merges before the tester build. Docs
only.
- Scope: a Shared Cases section in `threat-model.mdx` (what a Shared Case protects and what it
  does not, from the collaborative cases design's Evidence impact item 2, and the key held per
  member); that one signing key per installation lets two groups that share a member link that
  member, with the advice that anonymous members use a pseudonym as their name (ruling 6); the
  `features.mdx` "one investigator on one machine" limit line; a tester-guide section on invite,
  join, revoke and n0's public relays (ruling 16); and `CONTEXT.md` terms for Member and Invite
  plus the Entry Hash subject of a Timestamp Token.
- Verify with `.claude/hooks/vale-prose.sh --base origin/main` and `pnpm dlx mint broken-links`.

**SC-F. Fork authorship design note (#1812).** Wave 0. Docs only.
- #1638: after a Shared Case fork the app accepts the forking member as the author of every
  Exhibit the old Owner wrote. Ruling 13: before any code, an agent writes a short note proposing
  a stricter rule, likely a signed fork marker on the `import` entry, for the maintainer's
  approval; #1638 then becomes a fix an agent can take.
- The note answers the three questions in #1638's 2026-10-05 triage comment, recommends one rule,
  says what the app reports for a fork made before the rule exists, and states whether the fix
  joins the manifest schema lane and where it falls in the `manifest.ts` order.
- Starts in `manifest.ts` (`heldBy`, `authorChainOf`), `caseArchive.ts` (`planImportChains`,
  `attributeForkedExhibits`), the `import` entry schema in `src/shared/schemas.ts`, and
  `src/shared/verify/sharedCase.ts`, read only.
- Deliverable: `docs/specs/2026-10-NN-fork-authorship-design.md`. Verify with
  `.claude/hooks/vale-prose.sh --base origin/main`.

**Case Archive fixes left by #1657.** #1657 closed on 2026-10-10 as done for its scope
(ruling 15). PR #1672 found three gaps, each filed as its own issue and each evidence-affecting.

**#1813. Case Archives carry the Derived Files a chain anchors.** Wave 1, once the maintainer picks
an option on the issue (gates table; the issue recommends option (a): the archive carries every
anchored Derived File, and the import restores each with its `derived_files` row). Under
option (a) it takes the Case Archive lane.
- A package exported from an imported Case fails both its checks when the source installation had
  already made thumbnails, because a Case Archive carries no thumbnail files.
- Starts in `caseArchive.ts`, `src/main/services/db/derivedFileRepo.ts` and `exhibitBackfill.ts`.
- Done when an imported Case whose source chain anchors thumbnails exports a package that passes
  `verify.sh` and the in-app package verifier, the round-trip test carries a thumbnail and its
  `derived_files` row, an archive at the previous version still imports, and a native Case's
  package bytes are unchanged.

**#1814. Thumbnails made after a renamed import.** Wave 0.
- After an import renames colliding records, the next launch's backfill signs each thumbnail
  under the new id, while the export names files the way the signed history does, so the in-app
  package check fails.
- Starts in `exhibitBackfill.ts` (`backfillThumbnail`), `export.ts` (`resolveChainNames`) and
  `tests/main/services/importedCasePackage.test.ts`.
- Done when the renamed-import test, extended to run the startup backfill before the export,
  passes `verify.sh` and the in-app package verifier, and a native Case's backfill entries and
  package bytes are unchanged.

**#1815. Deleting a renamed Capture.** Wave 0.
- A `deletion` signed under a renamed Capture's new id leaves both verifiers expecting that
  Capture's page, screenshot and token.
- Starts in `captureLifecycle.ts` (`deleteOne` and the `deleteMany` path), `manifest.ts`
  (`withDeletionEntry`), `export.ts` (`resolveChainNames`) and `deletionReconciliation.ts`.
- Done when a package exported after deleting a renamed Capture, through `delete` and through
  `deleteMany`, passes both checks and encloses none of its files, and deleting a Capture whose id
  was never renamed writes the same `deletion` entry as today.

## Capture engine briefs

Stage 1 adds new artifacts to the background renderer. Stage 2 (launched Chromium) has a spec
under review (CE-S2). Stage 3 (the Companion pipe with removal of the extension's capture code)
gets a spec brief (CE-S3). Stage 4 (Firefox) waits on a decision on what a Timestamp Token attests
for a Capture without MHTML (ADR-0035), and is not briefed. Every code brief below except CE-4 is
blocking tier.

**CE-1. Background renders deny permission prompts (#1693).** Wave 0, queued 2026-10-10.
Evidence-affecting.
- A one-line permission check handler in `backgroundRenderer.ts`, with a test that notification
  and location read as denied.

**CE-2. Refuse a redirect to a loopback or private address (#1726).** Wave 0, queued 2026-10-10,
alongside CE-1. Evidence-affecting.
- Starts in `recapture.ts` (`validateUrl`, and the final-URL check in `runJob` that calls
  `matchCaseExclusion` on `rendered.finalUrl`),
  `src/renderer/components/captures/guestLink.ts` (its address classification moves to a module
  both sides import), `backgroundRenderer.ts` (a new per-hop redirect check before anything
  renders, because it has no redirect hook today), `tests/main/services/recapture.test.ts`, and
  the test-only loopback allowance below.
- Done per the 2026-10-04 ruling on the issue, and when the two recapture e2e specs still pass
  through a test-only allowance for loopback fixtures that a packaged build cannot turn on, and a
  test asserts that production refuses `127.0.0.1`. CE-3 and CE-P step 9 run their fixture tests
  through the same allowance.
- Adds the shared address-classification module to the evidence-affecting paths assessment as a
  blocking row.

**CE-3. Egress setting (#1695).** Wave 1, after CE-1 and CE-2 merge; merges only after
1.0.1-beta.23 (#1799), the release carrying #1747's schema-5 verifier (`a7cd33a1`), is tagged.
Evidence-affecting.
- #1694 closed on 2026-10-10 with its verifier half merged, and its display moved to #1816
  (ruling 23). beta.23 ships as is (ruling 19).
- Update checks follow the Egress (ruling 20): `electron-updater` traffic goes through the proxy
  and fails closed, so with the proxy stopped a check fails and no request leaves directly.
  #1695's scope and acceptance criteria carry this, so CE-3 also starts in
  `src/main/services/updater.ts`, Birdbrain's wrapper around `electron-updater`.
- Edits the partition setup in `backgroundRenderer.ts` and the TLS re-fetch in
  `captureLifecycle.ts`, so it lands before CE-P's writer steps. Per #1695's scope it also starts
  in `timestamp.ts`, `consentBlocker.ts`, `waybackMachine.ts`, `webviewPolicy.ts`
  (`WAYBACK_PARTITION`), `settings.ts` (advisory) and `OperatorConfig.tsx` (blocking tier).
- If it mirrors the Egress fields onto the `captures` row, it takes the migration lane and the
  Case Archive lane.
- Its fixture tests use CE-2's loopback allowance. The agent writes the SOCKS5 fixture server by
  hand in the test, or takes a test-only server dependency to the maintainer for approval. The PR
  describes one Recapture through Tor Browser's port for a human to run before merge.

**CE-4. Warn when no VPN is seen and the Egress is direct (#1696).** Wave 2, after CE-3. Not
evidence-affecting.
- Stores the network hash in `settings.ts` (advisory) and only opens the Egress setting. If its
  diff touches `OperatorConfig.tsx` (blocking tier), the PR carries `evidence-affecting` by the
  backstop.

**CE-D1. Egress docs (to file).** Wave 2, or inside CE-3's PR in wave 1. Docs only.
- Scope: `SECURITY.md` Network egress, `features.mdx` Network use and Capture, the two ADR-0032
  statements (a background Recapture names Birdbrain; time zone and language still reveal the
  region through a proxy), that update checks and downloads follow the Egress (ruling 20), and a
  network-attribution section in `threat-model.mdx` with its limits, or a note on #546 saying
  where it went.
- Verify with `.claude/hooks/vale-prose.sh --base origin/main` and `pnpm dlx mint broken-links`.

**CE-P. First-slice implementation plan (draft PR #1803).** Wave 0, delivered. Docs only.
- `docs/plans/2026-10-10-capture-engine-first-slice.md` splits the first-slice spec into a
  renderer spike (step 0) and ten steps, each one PR and one issue. It answers the spec's five
  open questions, settles the `warcio` licence and the test readers, and reran the probe on
  Electron 44.5.1 with no change. `launched` stays out of step 1 (plan D13); the stage-2 verifier
  step carries it. `companion` is stage 3 (ADR-0034, order of work) and waits for CE-S3 to define
  its entry.
- The maintainer ruled on its questions on 2026-10-10 (rulings 25 to 35) and approves it with the
  spec after reading #1803 (rulings 36, 71). The rulings that shape the steps below: the
  Transaction Record is a `.warc.gz` with one `gzip` member per record (27); decoded bodies keep
  their original `Content-Encoding`, `Transfer-Encoding` and `Content-Length` under `x-orig-`
  names, with `Content-Length` rewritten to the stored body (28); a failed or timed-out
  `Network.enable`, body fetch, writer or print keeps the Capture with the record or PDF absent
  as `failed` (29); steps 2 to 5, 7 and 8 may merge before the release carrying step 1's
  verifier, and only the writer steps 6, 9 and 10 wait for it (30); the orphan scan reports only
  stray files, and a missing record or PDF surfaces as `missing` in `verifySidecars` (31); step 3
  makes the slice's one Case Archive bump and merges before any writer, so CE-6 does not bump
  (33); step 9 no longer waits for SC-2, and whichever of SC-2 and steps 9 and 10 merges second
  adds the two-peer test (34); and D1 to D7 are the shape step 1 freezes, including
  `certificateTransparencyCompliance`, `serverSignatureAlgorithm`, `encryptedClientHello`, `mac`
  and a top-level `boundTlsAbsent` (35).
- The steps replace the earlier briefs: CE-5 is step 1, CE-6 step 2, CE-7 steps 7 to 9, CE-8
  steps 6 and 10, CE-9 steps 3 and 5, and the Evidence Package halves of CE-7 and CE-8 are
  step 4. Every code step ends with `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` and `pnpm preflight`
  at head; each step's own commands are in the plan.

**CE-P step 0. Renderer spike (to file).** Wave 0; waits for nothing. Docs only.
- On a scratch branch, `renderPageInHiddenWindow` loads `about:blank`, enables `Network`, loads
  the target, and records every `Network` event. The spike answers the plan's seven questions:
  whether the recapture e2e specs still pass with the domain on, which requests `wc.savePage`
  makes, how a consent-filter cancel arrives, whether cross-site iframe requests and cross-origin
  redirect hops appear, whether a fresh partition produces a cache event, whether
  `securityDetails` arrives under a test certificate, and what the target reads as
  `history.length`.
- Deliverable: `docs/specs/2026-10-NN-capture-engine-renderer-spike.md`, with the recorded event
  streams committed beside it as JSON, which step 7 copies into its fixtures.
- If iframe requests are missing, step 1 stops for a child-target design; if no `securityDetails`
  arrives, step 1 leaves Bound TLS Details out. Both go to the maintainer.
- Verify with `.claude/hooks/vale-prose.sh --base origin/main`.

**CE-P step 1 (CE-5). Verifier and schema (to file).** Wave 2, after the plan's approval and
step 0. Holds the manifest schema lane after CE-3, sharing one number with the other steps left
out of beta.23. Evidence-affecting, blocking tier.
- Adds optional `capture` fields for the inventory, Scroll-to-load, Bound TLS Details and its
  absence reason, and the Transaction Record and PDF hashes. An absent hash claims nothing; a
  present hash with a missing or different file fails, as `screenshotHash` does today.
  `MANIFEST_SCHEMA_VERSION` takes the next number, settled when the step starts against the
  releases that have shipped (the slice-2 plan's rule).
- Adds the Transaction Record and PDF hash fields to the shared list of anchored hash fields. If
  step 1 merges before SC-2, it creates that list with `contentHash`, `screenshotHash` and
  `textHash`, and SC-2 builds its blob list from it.
- Starts in `src/shared/schemas.ts`, `manifest.ts`, `src/shared/verify/` (including the package
  checker `verifyEvidencePackage` in `evidencePackage.ts`, beside its `screenshotHash` check),
  `src/verifier/`, `src/shared/constants.ts`, `src/packages/evidence-package-layout/`.
- Done when old entries still verify, tamper tests fail on each new hash, a reader at the
  previous schema number reports itself too old instead of a broken chain, and the PR adds
  `src/packages/evidence-package-layout/**` to the assessment's blocking tier. A tagged release
  ships it before steps 6, 9 and 10 merge.

**CE-P step 2 (CE-6). Mirror the new capture facts on the `captures` row (to file).** Wave 3,
after step 1; takes the migration lane when it is free. No Case Archive bump (ruling 33).
Evidence-affecting (`db/**`).
- Starts in `migrations.ts` and `captureRepo.ts`.
- Done when the migration test shows the new columns, the `CAPTURE_COLUMNS` drift test passes, and
  a Capture row with every new column set survives a Case Archive round trip.

**CE-P step 3 (CE-9, Case half). The Case handles the two files (to file).** Wave 4, after steps 1
and 2. Takes the Case Archive lane for the slice's one bump, and merges before steps 6, 9 and 10
(ruling 33). Evidence-affecting.
- Store, Case Archive export and import, Duplicate, deletion, the orphan scan and
  `verifySidecars` for the `.warc.gz` and `.pdf`. Starts in `captureStore.ts`
  (`CAPTURE_ARTIFACT_TYPES`, `parseArtifactFilename`), `caseArchive.ts`, `captureLifecycle.ts`
  and `src/main/services/db/dbAdmin.ts` (`findOrphans`).
- Done when the store writes, reads, copies, stages, restores and deletes both files, with a test
  each; a Case Archive round trip carries them and `CASE_ARCHIVE_SCHEMA_VERSION` takes the next
  number, because an older importer drops the files and the step 2 columns; the orphan scan
  reports a stray `.warc.gz` or `.pdf` and never reports a Capture because its record or PDF is
  missing, which `verifySidecars` reports as `missing` (ruling 31); and `verifySidecars` reports
  a changed file as `tampered` (the #1661 pattern).

**CE-P step 4 (CE-7 and CE-8, Evidence Package halves). Evidence Packages carry the two files (to
file).** Wave 5, after steps 1 and 3. Evidence-affecting.
- Starts in `export.ts`, `verifyScript.ts`, `verifyRunbook.ts` and
  `src/packages/evidence-package-layout/`.
- Done when a package exported from a hand-made Capture carrying both hashes ships both files at
  the plan's D3 paths and passes Package Verification in the app and under the standalone
  verifier, a changed or missing file fails it and fails `verify.sh` under `runVerifyScript`, and
  `VERIFY.md` says the Transaction Record holds the four credential headers with their values
  replaced (ADR-0036).

**CE-P step 5 (CE-9, report half). The report states the new fields (to file).** Wave 4, after
step 2. Evidence-affecting (`reportHtml.ts`).
- `report.html` states each file present or absent with its reason, the Transaction Record
  counts, the Scroll-to-load outcome, the screenshot record, and Bound TLS Details in their own
  block, apart from the TLS Cert Chain's "Corroboration only" note. Display in the app is #1816.

**CE-P step 6 (CE-8, first part). Scroll-to-load and the screenshot record (to file).** Wave 5,
after the release carrying step 1 and steps 2, 3 and 5. Evidence-affecting; a writer.
- `scrollToLoadLazyContent` returns its outcome (nothing to scroll, height cap, stopped growing,
  or time budget), and the screenshot records scaled, truncated and trimmed with dimensions.
  Ingest writes `scrollToLoad` and an inventory with the Transaction Record and PDF absent as
  `not-taken`. The step starts the validation record (plan D16).
- Records #1667's background half, and its PR closes #1667 (ruling 24).
- Starts in `backgroundRenderer.ts`, `recapture.ts` and `captureLifecycle.ts`; updates the
  `CONTEXT.md` clauses it makes true (keeping _Planned_ where the plan says) and the Capture
  section of `features.mdx`.

**CE-P step 7 (CE-7, first part). Exchange collector and Bound TLS conversion (to file).** Wave 2,
after the plan's approval and step 0. Evidence-affecting: it creates
`src/packages/transaction-record/` and adds it to the assessment as a blocking row.
- Pure code over step 0's recorded event streams. Each `requestWillBeSent` becomes its own
  exchange, each redirect hop included, and the counts cover the cached, cancelled, failed,
  in-flight and over-budget requests and incomplete request bodies. Nothing calls it before
  step 9.

**CE-P step 8 (CE-7, second part). WARC writer (to file).** Wave 3, after step 7.
Evidence-affecting.
- Adds the writer, `warcio` taken under both licence texts (an `overrides.json` append entry with
  the Apache-2.0 text; the 2026-10-02 approval covers its eight runtime dependencies and the
  lockfile's transitive set, ruling 25), and a hand-written test WARC reader; a manual Python
  `warcio check` goes in the validation record (ruling 26).
- Done when the test reader parses the output, every block and payload digest holds for a body
  served with `gzip` and one served plain, no byte of the inflated output holds a `Cookie`,
  `Set-Cookie`, `Authorization` or `Proxy-Authorization` value while `replacedHeaders` names each
  (ADR-0036), no `WARC-IP-Address` appears when the input says the Egress is not Direct, and
  `pnpm build:notices` passes.

**CE-P step 9 (CE-7, wiring). Record the Transaction Record and Bound TLS Details (to file).**
Wave 6, after the release carrying step 1, steps 3 to 8, CE-2 and CE-3. Evidence-affecting; a
writer.
- In `renderPageInHiddenWindow`: CE-3's proxy on the partition, then attach, load `about:blank`,
  enable `Network` with buffer limits, and load the target. Ingest writes the file, its hash,
  `boundTls` or `boundTlsAbsent`, and the Transaction Record part of the inventory. Bound TLS
  Details come from the main document's `securityDetails`, in a field beside `tls`.
- Commits the probe script (plan D15). The maintainer then opens the PR that adds its CI job on
  each Electron change (ruling 32; ADR-0048 holds workflow changes for sign-off).
- Starts in `backgroundRenderer.ts`, `recapture.ts`, `captureLifecycle.ts`, and the step 7 and 8
  package.
- Done when the spec's known answers pass against a local fixture server through CE-2's loopback
  allowance (`gzip` and plain digests, redirects, failed, cancelled, in-flight and over-budget
  requests, and a TLS fixture with a known certificate); a cookie the fixture sets appears nowhere
  in the inflated record; with CE-3's SOCKS5 fixture and the Egress set to a proxy, neither the
  record nor the inventory holds the proxy's host or port (ADR-0032 rule 5); and a packaged build
  installs no test certificate allowance. If SC-2 merged first, a two-peer `MemoryTransport` test
  shows the receiver hash-checks the record before showing it; otherwise SC-2 adds that test
  (ruling 34).
- In the same PR: updates the `CONTEXT.md` clauses it makes true and the Capture section of
  `features.mdx`, stating beside the capability that Birdbrain replaces credential header values
  (ADR-0036).

**CE-P step 10 (CE-8, last part). PDF (to file).** Wave 7, after step 9. Evidence-affecting; a
writer.
- `printToPDF` runs after the screenshot, the MHTML and the end of collection, under its own
  timeout. A print that fails, throws or times out stores the Capture with the PDF absent as
  `failed`. The step completes the validation record for the maintainer's acceptance.
- Adds `pdfjs-dist` 5.6.205 as an exact-pinned devDependency, with a Dependabot ignore for 5.7
  and later (ruling 26).
- Done when the stored file parses as the fixture's page, a package exported from the Capture
  verifies and a changed PDF byte fails, and, if SC-2 has merged, the two-peer test passes for the
  PDF.

**CE-10. Extraction stops blocking the main process (#598).** Wave 3, after CI-4 merges; before
any stage-2 code brief. Ready-for-agent since 2026-10-10. Evidence-affecting, blocking tier
(`captureLifecycle.ts`).
- Ruling 21: data extraction runs in an Electron utility process, built as a further main-side
  entry in `electron.vite.config.ts`. The CI-4 field build may share the process, and the PR says
  whether it did. The stage-2 CDP client stays in the main process, and moves to the utility
  process only if measurements show stalls (ruling 40).
- Starts in `captureLifecycle.ts` (`runPostCaptureWork`, `runDataExtraction`, `reprocessCase`),
  `src/main/services/extraction/extractionSource.ts`, `dataExtractor.ts` and
  `src/main/services/db/extractedDataRepo.ts`.
- Done when extraction runs in the process during ingest and `reprocessCase`, existing fixtures
  produce the same rows, a failed or timed-out process leaves the Capture stored and logged, and
  an e2e burst of at least 20 Captures records no main-process stall.

**CE-S2. Spec for stage 2, launched Chromium (draft PR #1804).** Wave 0, delivered. Docs only.
- `docs/specs/2026-10-10-capture-engine-launched-browser-design.md` covers what ADR-0034 leaves
  open: browser discovery and launch, the per-Persona browser profile layout, cookie seeding from
  the Persona import, proxy and WebRTC flags for the Egress, the CDP client, the Operator's
  capture trigger, cutting a session-long recording into per-Capture Transaction Records,
  multi-tab ownership, Selector matching, the `launched` and `launched-passive` values, and the
  Persona wording. It folds in #599 and #600, and states that #598 has to land first (CE-10).
  #1505 closed on 2026-10-10 as superseded by it (ruling 22).
- The maintainer ruled on its decisions D1 to D23, except D18, on 2026-10-10 (rulings 37 to 56)
  and approves the spec after reading #1804 (ruling 71). The rulings that add work or order here:
  - D1: the debugging pipe is the design, and ADR-0034's wording becomes "remote-debugging
    connection". A fallback port mode is built only if the pipe proves problematic; the stage-2
    probe tests the pipe on Windows and macOS before the first capture step, and the app counts
    bot-challenge refusals in launched browsers, by a detection method not yet designed.
  - D3: launched-browser Transaction Records carry no request bodies. An ADR amending ADR-0035,
    ADR-0036 and the `CONTEXT.md` Transaction Record entry merges before the clicked-Capture step.
  - D5: the verifier learns `launched-passive` in a release before #600's writer merges, and the
    glossary and reporting surfaces change with #600. #599, which says the value lands with #600
    and "not before", needs clarifying to match.
  - D7: one Persona import seeds both the Electron partition and the launched browser's profile.
    Ruling 43 adds a requirement, detecting installed browsers and importing their cookies, which
    CE-A and CE-AR take up.
  - D13: a timed-out exclusion pattern counts as a match for passive Captures only, and
    `safeRegexTest` reports a timeout apart from no match. The ruling amends ADR-0037's
    exclusion-policy sentence and the same constraint in #600, and the passive capture step waits
    for the ADR-0037 amendment that records it.
  - D19 and D22: the Capture Session panel and telling the launched browser apart go to CE-U.
  - D20: a launched browser runs only inside a Capture Session. The ruling narrows the Capture
    Method entry of `CONTEXT.md` and ADR-0034's recording scope to match.
  - D21: the Persona is chosen at launch and holds for the browser's life; #546's threat-model
    delta updates the wrong-persona mitigation.
  - D23: a small in-repo download script fetches a pinned Chrome for Testing build and checks its
    hash for CI, with no new dependency.
- The spec's proposed split becomes the stage-2 code briefs, filed after approval: a probe (docs),
  a verifier release step, the launcher and browser profiles with no Capture, clicked `launched`
  Captures, Persona browser profiles and seeding, and passive capture (#600 with #599). None
  starts before CE-10 merges. The clicked-Capture step also waits for CE-P steps 9 and 10, the
  release carrying the stage-2 verifier step, the D3 ADR and the feasibility pass on CE-U's mock.

**CE-S3. Spec for stage 3, the Companion pipe and removing extension capture (to file).** Wave 2,
after CE-S2 merges. Docs only.
- Covers the pipe's transport and authentication, what remains of the Capture Server, the
  `companion` Capture Method's entry and wording, the legacy `extension` value, the `debugger`
  permission and its Chrome Web Store review exposure, and the deletion list (the screenshot
  stitcher, the `HOTFIX:` blocks, the `webRequest` header code, and #635's work, folded in on
  2026-10-10). #1667's extension half closes in favor of this stage (ruling 24).

**CE-U. Designer UI brief for the launched browser and the investigation view (to file).** Wave 0.
Docs only.
- Rulings 55 and 70: an agent writes one UI brief covering the Capture Session panel (stage-2 D19,
  including the D14 warning when an extension target appears while the Egress is not Direct);
  telling the launched browser apart from the everyday one at a glance (D22: the launched Chrome
  has the everyday Chrome's icon); the Withheld from analysis mark on Case search results and in
  the unreviewed view (ADR-0044); and the investigation header's "not read" count, shown beside
  the "read" and "withheld" counts, with the gap list naming the unread kinds (CI-P open
  question 15, ruling 68).
- The designer designs from it in the Birdbrain UI design project, and a feasibility pass on the
  mock runs before the stage-2 clicked-Capture step (ruling 55).
- Deliverable: `docs/specs/2026-10-NN-launched-browser-and-investigation-ui-brief.md`. Verify with
  `.claude/hooks/vale-prose.sh --base origin/main`.
- Blocks the stage-2 clicked-Capture step (through the feasibility pass), CI-14, CI-V1's header
  count and CI-V4's gap-list entry.

**CE-AR. Check whether Persona partition cookies are encrypted at rest (to file).** Wave 0. Docs
and one code comment.
- Ruling 73: on a running build, read a Persona partition's cookie store and record whether its
  values are encrypted at rest. The research behind ruling 72 found that Electron's
  `cookieEncryption` fuse defaults to Disabled and that Birdbrain does not set it; nobody has
  checked a running build.
- If the values are not encrypted, the PR corrects the sentence in ADR-0030's "No secrets beyond
  the browser session" paragraph, the persona plan's decision 8, and the comment above
  `partitionForPersona` in `src/main/services/persona/personaSessions.ts`, so each states what is
  true. Turning the fuse on stays its own change (#88).
- No browser cookie import ships before this wording is true.
- Deliverable: the result, with the build, platform and commands, in
  `docs/specs/2026-10-NN-persona-cookies-at-rest-assessment.md`, and any corrections in the same
  PR. Verify with `.claude/hooks/vale-prose.sh --base origin/main`.

**CE-A. ADR for browser cookie import (to file).** Wave 1, after CE-AR and after #1804 merges.
Docs only.
- Records ruling 72. Birdbrain detects installed browsers and imports their cookies into a
  Persona: Firefox first, with no new dependency, then Chromium on macOS and Linux. The Operator
  picks sites one by one, with none ticked by default, and the reader filters in SQL so it never
  decrypts a cookie the Operator did not pick. A whole-profile import happens only when the
  Operator states that the source profile serves this Persona alone. Cookie files stay as the
  fallback. Birdbrain never works around App-Bound Encryption, so Chrome and Edge on Windows stay
  file-only, and it tells macOS users to pick Allow, not Always Allow.
- Amends ADR-0030 (the "Three mechanisms, one attribute" and "No secrets beyond the browser
  session" paragraphs of its Decision), the persona plan (the Firefox, Chrome `Cookies` and
  whole-browser-profile rows of its Supported cookie formats table, its out-of-scope list, and
  the extension-seeding item among its pinned items), ADR-0034 (the paragraph on Background
  Captures staying in Electron's hidden window), and the stage-2 spec's S3 and its section on
  cookie seeding from the Persona import.
- Its starting point is the 2026-10-10 cookie-import research memo behind ruling 72; the issue
  links it when filed.
- The maintainer approves the ADR (gates table). The build is a new ticket under #541, grilled
  with the maintainer before it is ready-for-agent, and #546 (import threats), #543 (whether to
  disclose the seed source) and #1498 (whether a seed field ships in its release) take the
  questions the ADR raises.
- Deliverable: `docs/adr/NNNN-<slug>.md` at the next free number. Verify with
  `.claude/hooks/vale-prose.sh --base origin/main`.

**#1816. Show the capture engine's facts on a Capture.** Wave 8, after CE-P step 10 and CE-3.
Evidence-affecting.
- Ruling 23 closed #1694 and filed this: for one Capture, the app shows the Egress kind and label,
  the artifact inventory, the Scroll-to-load outcome and Bound TLS Details, with Bound TLS Details
  kept apart from the TLS Cert Chain view.
- Triage moves it to ready-for-agent once CE-P step 10 has merged and the maintainer decides
  where it shows (gates table), with every field name re-derived from the merged schema.
- Starts in `ForensicsTab.tsx`, `CaptureDetailsPanel.tsx`, `HeadersTlsTab.tsx` and
  `DataExplorer.tsx`; its wording matches CE-P step 5's `report.html`.

## Case investigation briefs

`docs/plans/2026-10-09-case-retrieval-first-slice.md` (PR #1795, merged) plans the retrieval
first slice. CI-P (#1805) plans the engine; the view and the AI layer have designs and ADRs.

Retrieval steps 2, 3, 4 and 6 (CI-3, CI-4, CI-5, CI-7) share one evidence call: no (retrieval
plan, Evidence impact). Each touches `db/**` (CI-4 also `captureLifecycle.ts` and
`caseArchive.ts`), so its PR carries `evidence-affecting` by the backstop, explains in Evidence
impact why nothing stored changes, and never auto-merges. The filed issue states the call. A
brief that updates `features.mdx` also runs `pnpm dlx mint broken-links` and
`.claude/hooks/vale-prose.sh --base origin/main`.

**CI-1. Find domains, emails and URLs in search (#1590, retrieval step 0).** Wave 0, queued
2026-10-10. The triage call on #1590 is no (2026-10-05 brief). The diff touches
`src/main/services/db/**` (blocking tier), so the PR carries `evidence-affecting`, gets human
review, and says in Evidence impact why nothing changes.
- Quotes terms that contain punctuation in all three search paths.

**CI-2. Synthetic Case baseline (PR #1796, retrieval step 1).** Wave 1; #1795 has merged. Not
evidence-affecting.
- Fixes PR #1796's two blocking review findings (the ranking counts only planted pages, so the
  top-5 and top-20 counts both equal the found count; three queries name the mail page's
  `Reply-To`, which D10 says no query names), then finishes the generator and runner.
- The baseline runs on `main` at 1,000 Captures (ruling 2:
  `pnpm eval:retrieval --eval-captures=1000`) before CI-5 merges. The change that records it
  updates the retrieval assessment's status line and Baseline section, which still say the run
  waits for the size.

**CI-3. Search field tables and extractor (to file, retrieval step 2).** Wave 0. Holds the
migration lane first. Evidence call: no, with the backstop (see above).
- Migration for `exhibit_search_builds`, `exhibit_search_fields` and a trigram FTS5 table with
  triggers; `fieldExtractor.ts`; link helpers moved out of `captureLinks.ts`.

**CI-4. Field build service (to file, retrieval step 3).** Wave 2, after CI-3. Evidence call: no,
with the backstop (see above).
- Field repository and build service, the ingest hook in `captureLifecycle.ts`,
  `ensureCaseFields`, rebuild, and the rebuild on Case Archive import in `caseArchive.ts`.
- The field build runs in `runPostCaptureWork` as today. CE-10 (the #598 fix) merges after CI-4
  and may move the field build into the extraction utility process (ruling 21).

**CI-5. Fielded search in the app (to file, retrieval step 4).** Wave 3, after CI-4 and the CI-2
baseline. Evidence call: no, with the backstop (see above).
- The `search:fields` channel, the search bar group, and opening a hit in the Text or Links tab.
- Done when an e2e spec seeds a Capture holding a header block through `e2e/fixtures/seed.ts`,
  searches its From address, and the Text tab opens with the span highlighted, and the PR updates
  `features.mdx` for the feature. Verify with `pnpm test:e2e`, then `pnpm preflight`.

**CI-6. `checkFieldHit` (to file, retrieval step 5).** Wave 4, after CI-5. Evidence-affecting,
and the plan's Ruling 4 needs the maintainer's sign-off before merge.
- Shows the check beside the hit CI-5 adds (D7), and updates `features.mdx` in the same PR.

**CI-7. Unreviewed view and second evaluation (to file, retrieval step 6).** Wave 5, after CI-5
and CI-6 (and so after the Ruling 4 sign-off). Evidence call: no, with the backstop (see above).
- A Data screen tab listing captures nobody annotated, the second run on the synthetic Case, and
  the finished assessment.
- Updates `features.mdx` for the unreviewed view in the same PR.

**CI-P. Engine implementation plan (draft PR #1805).** Wave 0, delivered. Docs only.
- `docs/plans/2026-10-10-case-investigation-engine.md` gives the DDL for ADR-0042's records with
  the working-layer columns on every synced table, the Case revision and the consistency
  approach a run uses, the engine's typed contract and IPC, the identifiers beyond the retrieval
  plan's, the evaluation and how its thresholds get set, retrieval step 7 (E22), the Shared Case
  amendment (E23), and a PR split. PDF, `mbox` and Transaction Record headers stay out of the
  first engine slice (E12, E13), with CI-15 to CI-17 proposed for later.
- The maintainer ruled on its gates and open questions on 2026-10-10 (rulings 57 to 69) and
  approves it after reading #1805 (ruling 71). E23 is approved as proposed (ruling 59), and #1805
  applies it to the collaborative cases design. The four brief splits are taken (ruling 63):
  CI-9b, CI-10a, CI-D1 with CI-D2, and CI-B. The briefs below follow the plan's Order of work
  except in their waves. That table puts CI-9b in wave 4 beside CI-9, the brief it depends on.
  This plan places each brief one wave after the briefs it depends on, so CI-9b, CI-10, CI-11,
  CI-12, CI-13, CI-D1, CI-D2, CI-R, CI-S and CI-B each sit one wave later here than there.
  #1805's table takes its waves from this plan, so it needs the same shift.

**CI-8. Engine contract and fake engine (to file).** Wave 2, after CI-P is approved. Not
evidence-affecting.
- The typed contract in `src/shared/` and a fixture-backed fake that the view briefs build
  against. The fake registers only when `app.isPackaged` is false, and CI-V5 removes it
  (ruling 63).

**CI-9. Investigation records storage (to file).** Wave 4, after CI-2, CI-3 and CI-P approval;
takes the migration lane when it is free. Evidence-affecting (`db/**`).
- One migration for the ADR-0042 tables, the Case revision triggers on every input table, the
  eligibility view, and the generation id replaced on snapshot restore and import. `exhibits`
  writes and `exhibit_search_builds` writes join the revision triggers, and the PR amends
  ADR-0042's input list to name them (ruling 61). The PR confirms from SQLite's documentation
  that `randomblob(16)` is a sound generation value, or writes generations with
  `crypto.randomUUID()` (ruling 69).
- The Case revision read (generation, counter, and the Manifest head read from `manifest.jsonl`)
  in the app and in the MCP server under `src/mcp/` (`get_case_revision`), with a test on each
  path.
- Done when a successful `db:restore` (Restore from File) and a successful `db:restoreSnapshot`
  each replace every Case's generation, with one test per path showing that a run recorded before
  the restore reads as out of date after it.
- Also done when, on the 1,000-Capture synthetic Case, a whole-Case reprocess and a Case Archive
  import are timed with and without the triggers, and the change-log rows they write are counted,
  with both recorded in the engine assessment.

**CI-9b. Investigation records in repositories and Case Archives (to file).** Wave 5, after CI-9;
takes the Case Archive lane, and merges before CI-D1, CI-D2 and CI-R. Evidence-affecting
(`db/**`, `caseArchive.ts`).
- The repositories, the archive collectors and importers, `ID_PROBE_TABLES` in
  `src/main/services/db/core.ts`, the `replaces` remap, and `CASE_ARCHIVE_SCHEMA_VERSION` at the
  next number at merge (CI-P plan E5).
- The change log does not travel in a Case Archive, and an import starts a fresh log; the PR
  amends ADR-0042 to say so (ruling 61). An imported decision with no author is stamped with the
  archive's source installation (ruling 62).
- Done when a round trip carries every table, an archive imported twice remaps every id (those in
  `replaces` included), `persona_id` arrives NULL, an older build refuses the archive, and an
  archive whose source Case has change-log rows imports with a log holding only what the import's
  own triggers wrote.

**CI-10a. Field extractor, second version (to file).** Wave 4, after CI-4 and CI-5. Triage makes
the evidence call when it is filed; the build service sits under `db/**`, so its PR carries
`evidence-affecting` by the backstop.
- Extends CI-3's extractor and CI-4's build service with the identifiers CI-P's E11 adds, reusing
  the existing patterns without editing `dataExtractor.ts`.
- Done when each new field slices back to its value, `extractData()` output is unchanged on its
  fixtures, and the retrieval runner's index bytes and build time before and after are recorded in
  the retrieval assessment.

**CI-10 to CI-13, CI-D1 and CI-D2. Engine.** Waves 6 to 8, one wave later than CI-P's Order of
work table puts them (see CI-P).
- CI-10, the base layer (wave 6, after CI-9b, CI-10a and CI-E's answer key): the base-layer
  package, the batch reader, identifier normalization, the four proposal rules, document
  Subjects, two-Joint expansion, holder counts, and the threshold sweeps. The rulings it carries:
  Selectors are not search keys in the first slice, and the run basis records the enabled
  Selectors (63); a same-field Joint is about one Subject, shown as a tab under it (65);
  determinism means the same identity hashes citing the same spans, with byte-equality reported
  as a diagnostic (64); thresholds are run parameters under their own parameter-set version,
  recorded in each run, and the rule version changes only with the matching logic, so decisions
  carry across threshold changes (66); and runs store every candidate locator, with CI-10
  reporting bytes per run and falling back to cited candidates plus counts if the size is too
  high (68). The PR adds `src/main/services/investigation/**` to the blocking tier and
  `src/packages/investigation-base-layer/` to the assessment's Notable exclusions with the
  reason (67). Done when CI-E's runner, run against CI-10 on variant A, shows the base-layer
  bar's first three conditions and records the chosen thresholds in the engine assessment.
- CI-11, claim checks (wave 7, after CI-6 and CI-10): `checkFieldHit`, the `textHash` comparison
  against the signed Manifest, and the `capture-url` check. Evidence-affecting: it reports
  whether a span is present in stored bytes, the class Ruling 4 rules evidence-affecting, and its
  module sits under `src/main/services/investigation/**`.
- CI-12, paths, strength summary, weak mark and gap list (wave 7, after CI-10's threshold run and
  CI-R), and the local-only source trail (investigation engine spec step 6): matches pinned
  Wayback Refs (`waybackRefRepo`) by URL and date, finds a marked copy's original inside the Case,
  and feeds the gap list's missing-originals group. The gap list's "searches not yet run" group
  names the kinds a run did not read (ruling 68). It makes no network request, and a test asserts
  that.
- CI-13, exporting Joints with their lineage from `export.ts` (wave 8, after CI-11 and CI-12).
  Evidence-affecting.
- CI-D1, Exhibit-level marks (wave 6, after CI-9b): Withheld from analysis, Source Class, copy
  marks and Own Identifiers, with their services and IPC. Own Identifiers are stored per Case,
  and Settings lists them grouped by Persona and Case and writes to the Cases the Operator picks
  (ruling 60). The importing Operator may clear an imported flag as a recorded action (ruling 62).
  CI-D1 is the first brief that lets an Operator set the flag, so, as CI-P's CI-D1 done-when has
  it, `website/content/docs/mcp.mdx` states that MCP tools still return withheld Exhibits until
  the brief that implements ruling 58 merges (see "MCP tools and Withheld from analysis").
- CI-D2, Joint, span and Subject decisions (wave 6, after CI-9b): accept, reject, add and dismiss
  with the acceptance context and undo; Subjects added and kept by hand; and the same-name choice,
  moved from CI-R.
- CI-10, CI-12, CI-D1 and CI-D2: triage makes the call when each is filed; each touches
  `db/**`, so its PR carries `evidence-affecting` by the backstop.

**CI-R. Run lifecycle (to file).** Wave 6, after CI-8 and CI-9b. The issue carries an explicit
evidence call; the diff touches `db/**` and `src/main/services/investigation/**`, so the PR carries
`evidence-affecting`.
- Starts in the engine service and IPC CI-P names, plus the Notes editor action for a selected
  passage. Holds the run record's single revision-checked write, moved from CI-D. A run snapshots
  only the selected Note passage (ruling 63) and records its threshold parameter-set version
  (ruling 66).
- Done when a run starts from an inquiry, from a Note passage (recording an Operator-started Joint
  whose Note never counts as support), or from Find more material; progress events and cancel
  work, and a cancel discards partial results; a revision change or a flag set mid-run stops it
  as invalidated; the out-of-date check applies ADR-0042's two exceptions and lists what changed
  from the change log; and a run left `running` by a quit reads as `failed` on the next start.
- Whichever of CI-10 and CI-R merges second wires the base-layer package into the run lifecycle.

**CI-14. Withheld mark (to file, retrieval step 7).** Wave 6, after CI-9b, CI-5, CI-7 and the
mark's design from CE-U (ruling 70); its paths come from CI-P (E22). Triage makes the evidence
call when it is filed; it touches `db/**` (`searchCaptures`), so its PR carries
`evidence-affecting` by the backstop.
- Done when withheld-before-indexing and withheld-after-indexing pages are added to
  `scripts/retrieval-eval/`; a third evaluation run shows the withheld Exhibit in Case search with
  its mark, and in no analysis query once the engine exists; and the results are appended to the
  retrieval first-slice assessment.

**MCP tools and Withheld from analysis (to file).** Not in the waves yet. Depends on CI-9b, whose
repository its tests seed the flag through, as CI-14's do. Triage makes the evidence call when it
is filed.
- Carries ruling 58, which names no brief: MCP tools list a withheld Exhibit with its mark and
  never return its content or values drawn from it. The PR audits every registered MCP tool, not
  only the seven CI-P names, and replaces CI-D1's sentence in `website/content/docs/mcp.mdx` with
  the rule.

**CI-S. Sync investigation records (to file).** Wave 7, after SC-2, CI-9b, CI-D1, CI-D2, CI-R
and the merge of #1805, which applies the approved E23 amendment (ruling 59). The issue carries an
explicit evidence call; the diff touches `db/**`, so the PR carries `evidence-affecting`.
- Starts in the `rows` step under `src/main/services/sharing/` and the investigation
  repositories.
- Done when a two-peer `MemoryTransport` test shows that an accept syncs attributed to its member;
  a reject of a proposal that has not synced stays local; a Withheld flag received by sync
  invalidates a running run; a decision received by sync does not put a run out of date (ruling 68); Own
  Identifiers sync with the marking member's Member Code and without the Persona label or notes
  (ruling 59); and two conflicting Source Class values show attributed until a member chooses.

**CI-E. Engine evaluation Case and runner (to file).** Wave 4, after CI-P is approved, CI-2 and
CI-8. Not evidence-affecting (scripts and docs only).
- Reuses the #1796 generator at 1,000 Captures (ruling 2), and confirms the reuse of #1796's
  `build.ts` once CI-2 merges (ruling 69). Starts in `scripts/retrieval-eval/` (or a sibling
  `scripts/engine-eval/`), with the invented pages and answer key for the fixture list in the
  engine spec's "Evaluation and first slice" section. Its answer key merges before CI-10 starts.
- Ruling 64: evaluation pages tie no pseudonym to a handle on a real platform, so the runner adds
  a profile-URL rule for an invented platform on a reserved example host; CI-E builds variant B,
  on which the bar is confirmed after thresholds are set on variant A; a Joint the base layer
  proposes from a header-shaped block counts as a wrong Joint; and the safety gate fails any
  proposal citing the misleading passage's instruction text. CI-E also chooses the interface its
  network guard uses and proves that it fires (ruling 69).
- Done when the runner records every measure that section lists except time to review, which
  moves to CI-B, and runs the safety gate against a key-backed fake of its own, with results in a
  dated assessment under `docs/specs/`. The section's first end-to-end question is its
  end-to-end case.

**CI-B. Base-layer bar confirmation run (to file).** Wave 8, after CI-10, CI-11, CI-12, CI-D1,
CI-D2 and CI-R. Not evidence-affecting (no blocking-tier path).
- Runs every measure on variants A and B with the real engine on stored runs, classifies each
  proposal the answer key lacks into the key in its own reviewed commit, and records one person's
  time to review.
- Its results are what the maintainer reads to confirm the base-layer bar (gates table).

**CI-15 to CI-17. Later field sources (proposed, outside the waves).** CI-15: PDF page text and
metadata field records. CI-16: `mbox` message and header field records. Each adds its fixtures
to the answer key before its code. CI-17, filed after CE-P step 9 merges: a field-extractor
version that adds `txn.header.*` records from the Transaction Record and writes a build-row
outcome for a Capture without one, so its absence is recorded and never read as the page having
sent no such header.

**CI-V1 to CI-V5. View surfaces.** Triage makes the evidence call per brief: CI-V1 and CI-V2 no;
CI-V3 shows claim-check outcomes, which Ruling 4 treats as evidence-affecting; CI-V4 shows
cannot-check and Integrity Status, and any edit to `ProvenanceBadge.tsx` or
`getProvenanceColor.ts` trips the blocking backstop. Sizes are the feasibility assessment's.
- CI-V1 (wave 3, after CI-8 and, for the header count, CE-U's design): the Investigate route,
  header S2 with the "not read" count from CE-U's design (ruling 68), run setup S1, narrow
  window S7, and the token fixes. It registers the route and components only; the `Sidebar.tsx`
  and command palette entries land in CI-V5 (ruling 57, option (a)). It lands first because it
  owns the route tree.
- CI-V2, CI-V3 and CI-V4 run in parallel in wave 4, after CI-V1.
  - CI-V2: map and list S3, with a pure layout module like `backlinkMapModel.ts` and the map
    accessibility fix.
  - CI-V3: Joint detail S4 and source inspector S5. If the inspector reuses the span highlighting
    CI-5 adds to the Text and Links tabs (retrieval plan Ruling 2), it rebases after CI-5.
  - CI-V4: gap list S6 with the not-read entry (ruling 68), own identifiers S9, same-name Subjects
    S10, and states 1 to 8 (8 with S10), 10, 11, 12 and 15. State 12's real-engine form needs
    synced decisions (CI-S), so CI-V4 builds it against the fake engine.
- CI-V5 (wave 9, after CI-10 to CI-12, CI-D1, CI-D2, CI-R and CI-B): swap the fake engine for the
  real one and remove the fake (ruling 63), add the `Sidebar.tsx` and command palette entries
  (ruling 57), and add the Investigate section to `features.mdx` with the base layer's limit (it
  finds only shared identifiers and exact text). Merges only once the base-layer bar gate clears.

Run history (G3), lookup consent (G7, state 9) and the AI layer (S8, states 13, 14, 16, 17) wait
on the AI-layer ADR in the gates table. The provider benchmark harness (the engine spec's
"Provider benchmark" paragraph) is not briefed: it depends on CI-E and on CI-9's MCP revision
read, not on the local-model ADR.
