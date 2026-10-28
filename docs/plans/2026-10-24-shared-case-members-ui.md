# Plan: Shared Case members UI (#1514)

**Status:** done, finished by [#1972](https://github.com/thebristolsound/birdbrain/pull/1972)

The build plan for issue #1514, "feat(sharing): Members UI from the revised mock", and the
handoff file for the run that builds it. The design source is the designer's revision of
`docs/design-handoff/2026-09-19-shared-case-members/` (README and `Shared Case.dc.html`, revised
2026-10-23), read against the issue's Scope list, the maintainer's rulings of 2026-10-10 recorded
on the issue, the feasibility assessment
(`docs/specs/2026-09-19-shared-case-members-feasibility-assessment.md`, items 19 to 25) and the
brief (`docs/specs/2026-09-19-shared-case-members-ui-brief.md`). Copy comes from the mock
verbatim.

Two corrections the maintainer gave on 2026-10-23 are recorded here and in the PR body, and
nowhere else in tracked text:

- **The issue is evidence-affecting.** `src/renderer/components/data/**` and
  `src/renderer/components/dashboard/cases/DataExplorer.tsx` are blocking tier in
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, so the ledger work (item 24)
  gets human review and the PR carries the `evidence-affecting` label (ADR-0041). The issue body
  still reads "Evidence-affecting: No".
- **The entry points are deferred.** Two sync defects, #1951 and #1955, must merge before a
  Shared Case is reachable from the UI. This PR registers the Case settings route the way the
  Investigate route is registered (declared, reachable by URL, no sidebar, top-bar or palette
  entry), opens the join flow only from a validated search parameter on `/cases/new`, builds the
  sync pill as a component with its tests but does not mount it in `TopBar.tsx`, and adds no
  command-palette action. A later PR on this issue adds the entry points; S7 below records it.

## Slices

Each slice is one or more commits on `feat/1514-members-ui`. A slice is done when its tests pass
with `pnpm test <file>` and `pnpm typecheck`, `pnpm lint` and `pnpm lint:boundaries` are green.

| Slice | Scope | State |
| --- | --- | --- |
| S1 | Member hue tokens; `SyncState` widened; `lib/api/sharing.ts`; `memberModel.ts`; `MemberCodeChip`; seed extension; this plan | shipped |
| S2 | `/cases/$caseId/settings` route and the Members tab with every row and whole-tab state | shipped |
| S3 | Invite dialog with the QR code and the join request step; `qrcode-generator` 2.0.4 | shipped |
| S4 | Join branch in the wizard, the sync pill component (unmounted), the shared Case card line | shipped |
| S5 | Attribution and exclusion on capture rows and the details panel | shipped |
| S6 | Ledger Actor column, chain selector and Timeline (blocking tier, small); screenshots; two-instance e2e; `pnpm preflight` | shipped |
| S7 | Entry points: the sync pill in the top bar, Members on the Case card's menu, the wizard's start step and the palette's join action | in review |

### S1, shipped

- `--color-member-1..4` in `src/renderer/styles/globals.css`, light inside `@theme` and dark under
  `html.dark`, with the README's values. The local installation is always `--color-accent`.
- `SyncState` (`src/shared/types.ts`) gains `peers[]`, `lastSuccessAt` and
  `lastError.installationId` / `lastError.index`; `getSyncState` in
  `src/main/services/sharing/syncState.ts` reads session facts from `sync-state.json`. Version
  pauses use the failing chain metadata and the derived `sync-pauses.json` cache. See
  "The widened sync state payload" below.
- `src/renderer/lib/api/sharing.ts`: `membersQueryOptions`, `syncStateQueryOptions` (polled every
  5 s while mounted, because `onSharingChanged` fires at the end of a round and `syncing` is
  visible only between), `sharingAvailableQueryOptions`, `invitePreviewQueryOptions`,
  `sharingMutationOptions` / `useSharingMutations` and `sharingErrorCode`. Keys in
  `lib/api/keys.ts`; `useServerStatus` refetches the roster and the sync state on
  `onSharingChanged`.
- `src/renderer/components/sharing/memberModel.ts`: every pure derivation and every copy string
  the later slices render (hue rank, member rows, pill model, Member Code validation and
  alternatives, clock words, exclusions and merges read off the snapshot, join failures).
- `src/renderer/components/sharing/MemberCodeChip.tsx`: the chip at 14, 16, 18, 20 and 24 px.
- `scripts/dev-seed/seed.ts`: the Shared Case gains a revoked third member (`PN`, Priya
  Natarajan, roster row with `revokedAtIndex`, no chain file) and an `exclude` of the member's
  Exhibit `MR-1` with reason "duplicate of DS-1". The Owner chain is now `member-add` x3,
  `exhibit`, `merge`, `exclude`, `member-revoke`, and still verifies with no findings.

### S2, shipped

- `/cases/$caseId/settings` is declared in `src/renderer/routes/__root.tsx` under `caseRoute`
  as `investigateRoute` is, with `CaseSettingsRoute` in `src/renderer/routes/cases/$caseId/
  settings.tsx`. `CaseWorkspace` gives it the `overflow-hidden` outlet, so the page owns its
  scroll. Nothing links to it: `tests/components/CaseSettingsEntryPoints.test.tsx` pins that
  the Sidebar, the top bar and the command palette carry no entry, and
  `tests/components/CaseSettingsRoute.test.tsx` pins the route ids and the outlet.
- `src/renderer/components/sharing/CaseSettingsView.tsx` is the radix Tabs shell from
  `SettingsView.tsx` with General and Export as disabled triggers and the nav footnote.
- `MembersTab.tsx` switches between the three whole-tab states (`UnavailableCard`,
  `NotSharedCard`, the relay-unreachable banner over the roster) and the shared view:
  `NetworkNotice`, `IdentityCard`, `SyncCard`, `MembersList` with every row state and the
  `NewerVersionStrip`, `RelayCard`, `RecoveryCard`, `RevokeDialog`. `memberModel.ts` gained
  the tone class tables for the Connection cell and `refusalMessage`, the one-sentence inline
  copy for the refusal codes the mock never draws.
- The relay-unreachable banner is fed by `syncNow` only in this slice. `createInvite` and
  `approveJoin` can also refuse `relay-unreachable`; S3 routes those through the same
  `onRefusal` when it wires the Invite and Review actions, which render and open nothing yet.
- The row clock is `useTimeTick(30_000)`, the repo's pattern for a render-time `Date.now()`.

### S3, shipped

- `qrcode-generator` 2.0.4 is the one new dependency, pinned exactly (ruling 3 of 2026-10-10).
  `src/renderer/components/sharing/InviteQr.tsx` is its only import: the encoder's modules become
  `<rect>`s in a 100 px SVG on a white pad, so no library markup reaches the DOM. White pad and
  `#111` modules are raw values on purpose, for scanner contrast in both themes.
- `InviteDialog.tsx` carries the four steps of the mock's 1c. It opens where the parent says
  (`InviteStart`: the invite just created, an invite still open, or a row's join request) and
  moves on its own: created to waiting on Copy, waiting to request when a pending join arrives,
  request to done on Approve. The done row reads "Syncing" with no count (see "Transfer totals"
  below) and the `member-add #NNNN` caption from the approved member's `addedAtIndex`.
- `MemberCodeField.tsx` draws `memberCodeCheck`'s result: "Unique in this Case", or the holder of
  a taken code with the model's two alternatives. An invalid code (empty, four characters, a
  symbol) marks the input and disables Approve without a second copy of the rule, which the
  helper under the field already states.
- `MembersTab.tsx` owns the dialog above its state switch, because the first invite shares the
  Case and flips the tab from the not-shared card to the roster while the dialog is open. Invite
  on the roster reopens an invite still open on its waiting step; the string is held in the tab's
  memory only (main keeps no copy to read back), so "Copy again" shows while this tab still has
  it and is hidden after a reload. Refusal codes: `member-code-rejected` under the input;
  `already-member`, `join-request-unknown` and `invite-not-found` refetch the roster and close;
  `relay-unreachable` and `sharing-unavailable` raise the tab's relay banner through the same
  `onRefusal` as `syncNow`; anything else is one inline sentence from `refusalMessage`, beside
  the Invite button or in the dialog.
- The Case name in the title comes from `caseQueryOptions`; `MembersTab` reads it once for the
  dialog.

### S4, shipped

The wizard's validated `join=true` search opens `JoinCaseCard`; the default wizard has no Join
entry. The card previews the sender and expiry offline, follows join progress, shows the five
refusal states, and opens the Case only after adoption succeeds. `SyncPill` remains unmounted;
its network notice opens on hover or focus. Shared Case cards show the local code, Owner and
active member count. Join's local fingerprint is omitted because no pre-join read returns it.

Focused component checks: 21 tests passed. The existing wizard tests now stub `useSearch`,
because the wizard reads the validated branch choice.

### S5, shipped

Capture rows use roster hue rails and code chips with the author on hover. The details panel
shows the author and the merge that first received the Capture's chain entry. The Owner can
confirm exclusion of another member's Exhibit with a recorded reason. The neutral exclusion
banner prints the integrity sentence only when the Capture's recorded result is verified and
the snapshot's chain verdict is valid. The list reads roster and snapshot once for all rows.

Focused capture checks: 40 tests passed. Tags and notes remain the documented IPC omissions.

### S6, implementation committed

The ledger gains an Actor column from each entry's writer, highlights the four sharing events,
and defaults to chain order. Timeline sorts by asserted time and prefixes the sequence with the
writer's code. Neither view changes the snapshot's integrity verdict. Both ledger surfaces say
that only this installation's chain is available. The new Electron screen check captures
Members, capture attribution, the ledger and Join in both themes.

S6 verification completed before PR #1965 opened. External review corrections are tracked
below. Entry points remain deferred until both sync fixes merge. The real two-network sync
remains a maintainer action.

### S7, entry points

Both sync defects have merged (#1951 in PR #1966, #1955 in PR #1967), so this slice makes the
screens reachable. Each placement follows the mock or the feasibility assessment.

- **Sync pill.** `TopBar.tsx` mounts `SyncPill` left of the extension pill on a Case whose
  `sharedAt` is set; clicking it opens `/cases/$caseId/settings`. An unshared Case mounts no
  pill, so it never polls `sharing:getSyncState`. The pill still hides itself until a member
  joins (mock 1e).
- **Case card menu.** The card's actions menu gains Members between Rename and Delete. Item 19
  of the assessment left the second entry to engineering because the renderer had no case-level
  menu; the Case card's menu is the one that exists. It is the way into Members for a Case that
  is not shared yet, since the pill is hidden there. The dashboard lists the three most recent
  Cases, the same reach Rename and Delete have.
- **Start step.** `/cases/new` opens on the mock's start step (`CaseStartStep.tsx`): Blank Case
  sets the `blank` search flag and shows the existing form, Import a Case Archive runs the
  dashboard's archive inspection and dialog, and Join a shared Case sets `join`. The maintainer
  chose this over a dashboard button on 2026-10-25. End-to-end specs that create a Case open
  `/cases/new?blank=true`.
- **Palette.** "Join a shared Case…" sits under "Create new case" and opens the join card.

`tests/components/CaseSettingsEntryPoints.test.tsx` now pins the pill, the palette action and
the sidebar's absence; `CaseCardMenu.test.tsx` the menu item; `NewCaseWizard.test.tsx` the start
step. `e2e/shared-case-members.spec.ts` walks the card menu, the pill, the palette and the start
step in the built app.

## The widened sync state payload

Item 21 of the feasibility assessment gives `sharing:getSyncState` a case-level shape. The
Members tab's Connection and Last synced columns and the newer-version strip (ruling 2 of
2026-10-10, "shown on the Members row as the mock draws it") need per-member facts, and
`SharingMember` carries none. This PR widens the payload instead of adding a channel. No evidence schema, database table
or verifier changes.

- `lastSuccessAt`: already in the file, dropped from the payload until now.
- `peers[]`, one per roster member other than self and the revoked: `reachable` from the set the
  function already counts, `lastSessionAt` and `ok` from the file's `peers` record, `heldHead`
  the index of that member's own chain this replica held after the session.
- `peers[].pausedAtIndex` names the first unreadable entry in that author's chain, including a
  chain another peer forwarded. A separate derived cache, `sync-pauses.json`, retains it until
  the chain advances past that entry. The existing sync-state file and its row-version counters
  keep their format, so older builds still read them.
- For a version pause, `lastError.installationId`, `index` and `waitingIndex` come from the
  session's actual failing chain, its held head and its first unreadable entry. An older error
  with no chain metadata names no member. Other error kinds retain the existing session lookup.

`tests/main/services/sharing/syncState.test.ts` checks forwarded authorship, persistence across
other peers' successes, recovery and older cache files. The renderer checks each member's pause
independently of the Case's current transfer phase.

### Review corrections

The first independent reviews found four behavior gaps. QR joins now interrupt the initial
invite screen without a Copy click, and the Owner can exclude their own Captures. The ledger
footer now describes this screen's local-chain check and makes no claim about remote chains.

Version pauses now retain the failing chain's author and first unreadable index from the
session, rather than guessing them from its transport peer. The separate derived
`sync-pauses.json` cache keeps each pause across other members' successful sessions;
only receiving the previously unreadable entry clears it. The session forwards its existing
error metadata to that cache. No evidence entry, database table or protocol message changes.
Old cache files still read, including their version high-water marks. Older builds ignore the
new sidecar and can still read the unchanged sync-state file.

The regression for a forwarded chain failed before this correction. The corrected flow and
the focused renderer checks pass 120 tests. Full verification also found two required import
aliases and the missing sharing query-log domain; the code now supplies them. Ledger tests
now include Actor and the required citation-rule fixture field.

The second reviews found two further gaps. The capture sharing read now checks the Case's
shared flag as well as the citation, so the Owner can exclude a Capture before another member
joins and while the prefix is hidden. The relay warning reports the last reached and unreached
members without claiming it knows a connection's path or that a member needs the relay. These
changes pass 141 focused checks. At the previous head, all 7,684 unit tests and coverage
thresholds passed with 96.82% changed-line coverage; only one test file's formatting failed.
The file is formatted for the final verification run.

The final checks passed at `33b89779`: 7,685 unit tests, build, lint and typecheck, with 96.83%
changed-line coverage. The fresh Electron run passed all ten checks, including two-instance
sharing. Both independent reviews at that head found no remaining findings. PR #1965 opened
as a draft and the maintainer later marked it ready for review. The pause cache filename also
received the blob receiver's reserved-name protection, after its regression reproduced the gap.
Subsequent verification and external review corrections are recorded below.

## Deviations from the mock

Each is a string or a control the IPC cannot back truthfully. The screens ship narrower rather
than invent a value.

- **Relay "Test" button**: no channel tests a relay. Omitted.
- **Recovery "Create new Case…"**: no channel makes a Case from a copy. Drawn disabled.
- **Transfer totals**: "41 of 63", "Sending 0 of 63 Exhibits", "24 of 63 Exhibits received" and
  the progress bars have no denominator anywhere in the IPC. The pill reads "Syncing · N entries"
  from the last session's count, or the peer count when there is none; the Sync card's bar is
  indeterminate.
- **"Connected · direct"**: the transport path is not reported. Rows read "Connected".
- **Newer-version strip**: the error carries a chain index, not an Exhibit Number, so "SI-3" and
  "SI-4" read as `SI·0003` and `SI·0004`.
- **Join preview's Case row**: `readInvite` returns the Case id, never its name. The row is
  dropped; the Case name arrives with the welcome.
- **Revoked date**: read off the `member-revoke` entry in the local chain, so it shows on the
  Owner's replica and is omitted on a member's.
- **Tag "Applied by" and the note byline**: `Tag` and `Note` carry no author field and the read
  path is in `src/main/services/db/**`. Not built; the inline hue chip in note bodies conflicts
  with `NoteBody`'s prose masking. Two Scope bullets ship partially.
- **Member chains in the ledger**: `manifest:snapshot` carries the local chain only and widening
  it means editing `exhibits.ts` or `manifest.ts` (blocking). The chain selector offers the local
  chain and Timeline; on a joiner's replica the Owner's `member-add`, `member-revoke` and
  `exclude` rows never appear.
- **"Sync failed · local"**: the mock names no label for the `local` kind; the hyphen-to-space
  rule produces this one.
- **"Egress is set to Unavailable."**: an unreadable Egress fails closed as not Direct, and the
  mock's capitalised-kind formula produces this label.
- **Relay unreachable**: no field reports relay status. The banner is driven by the last
  `relay-unreachable` refusal held in renderer memory.
- **Owner's hue on a member's replica**: the mock draws the Owner's view only. On a member's
  machine the Owner's chip takes the hue slot after the last member; self is always the accent.
- **Pill while syncing with a peer offline**: the 1e state table (warning dot, no spinner) wins
  over the 1a header pill and README, which disagree.

## Verification

Per slice: `pnpm typecheck`, `pnpm lint`, `pnpm lint:boundaries`, `pnpm test <changed files>`.
At head: `pnpm preflight` with exit codes captured. The Electron screen check writes light and
dark screenshots under `test-results/shared-case-members/` unless an output directory is set.
Run `.claude/hooks/vale-prose.sh --base origin/main` on this plan.

## CI notice correction

PR #1965's build stopped because qrcode-generator 2.0.4 ships no licence file.
The same `pnpm build:notices` command reproduced the failure locally. The existing
notice override now includes the upstream MIT licence, with its copyright line,
from the commit recorded in that package's npm metadata. The generator then exits 0.
The source URL is recorded in `scripts/third-party-notices/overrides.json`.

1. [x] Reproduce the missing-licence failure.
2. [x] Add the upstream licence through the existing notice override.
3. [x] Generate the third-party notice successfully.
4. [x] Run the existing third-party notice tests.
5. [x] Run clean-head full verification.
6. [x] Refresh the PR description from the new verification output.
7. [x] Push the correction for CI.

The dependency advisories were corrected separately in PR #1968, which the maintainer merged.
Matt's approval at the reviewed head remains necessary for the evidence merge gate. No merge or
release is authorized by this handoff.

## Merged dependency baseline

The maintainer merged PR #1968 as `eed80c8f`. This branch now includes that main
commit. The merge preserves the feature source and tests, including the QR package
and its licence override. Dependency auditing and notice generation exit 0.

1. [x] Merge the updated main branch without rewriting existing commits.
2. [x] Install the frozen dependency lockfile.
3. [x] Run the dependency audit.
4. [x] Generate the third-party notice.
5. [x] Run clean-head full verification.
6. [x] Refresh the PR's verification details.
7. [x] Push the updated branch for CI.

## PR review corrections

The external reviews left fourteen distinct findings across sixteen inline comments.

1. [x] Use held citations for revocation summaries, including deletion gaps.
2. [x] Keep failed or incomplete Sync now outcomes visible.
3. [x] Show this installation's revoked membership.
4. [x] Show Join's direct-connection disclosure for Tor, proxy and unknown settings.
5. [x] Avoid effective exclusion claims from an invalid chain.
6. [x] Resolve Capture authorship from persisted identity rather than reused codes.
7. [x] Derive exclusion lookups once per snapshot for the Capture list.
8. [x] Load the sole Owner for a cold ledger with hidden citation prefixes.
9. [x] Keep older pending requests from replacing a new invite.
10. [x] Explain that relay address changes require a restart.
11. [x] Date the persisted integrity result instead of claiming current verification.
12. [x] Remove contradictory plan status and machine-specific paths.
13. [x] Wait for a visible details control in the Electron screen check.
14. [x] Wait for the empty-peer query result before asserting a hidden sync pill.
15. [x] Run full verification at the initial review head.
16. [x] Push the initial review corrections.
17. [x] Reply to the initial review threads.

The initial review corrections were verified and published at `a6d92c9b`.
Next command:

```sh
BIRDBRAIN_TEST_SYSTEM_SHARP=1 PKG_CONFIG_PATH=/usr/lib/pkgconfig mise x -- pnpm preflight
```

Revocation and ledger regressions reproduced four failures before correction. The three focused
files now pass all 38 tests. Existing singleton copy assertions now name the one held citation.
The next slice handles Sync now outcomes.

Sync attempts now inspect every outcome. Empty, unreachable, no-address, failed and error-
bearing results stay visible; only a nonempty all-success result clears the relay warning. The
focused Sync and Members tests pass all 31 cases. Typechecking also caught a missing explicit
undefined snapshot in the new revoked-self test, now corrected. Next slice: Join disclosure,
pending invite requests and relay restart guidance.

Join disclosure, request isolation and relay guidance reproduced five failing cases. The
corrected four component files pass all 71 tests. The invite baseline is captured before
creation, so an arriving request can still interrupt the QR screen. Existing requests remain
available through Review. Next slice: persisted Capture authorship and exclusion lookups.

Capture regressions reproduced misattribution through a reused code, an effective exclusion from
a broken chain, and repeated full-chain scans. The list now shares a memoized lookup, invalid
snapshots supply no effective exclusions, and attribution requires the persisted operator
installation plus a matching citation. Unknown attribution does not remove the Owner exclusion
action. A later review also reproduced the undated integrity claim; the banner now dates the
last verification when its timestamp is available. Next slice: review-test waits and plan
corrections.

The capture corrections pass 59 focused tests and all six typechecks. Review-test corrections
replace a fixed sleep with a successful-query wait and wait for the details panel or its
opening control before branching. Historical handoff commands and machine-specific paths
have been removed. The initial ten review issues and the four later issues now have source
corrections. Full verification and the focused Electron checks passed at `a6d92c9b`.


## Second external review corrections

1. [x] Require a loaded Exhibit summary before confirming revocation.
2. [x] Give a current sync error precedence over an older attempt summary.
3. [x] Show an attempt result when sync-state data is unavailable.
4. [x] Check the remote Owner-exclusion finding against the disclosed IPC limitation.
5. [ ] Run clean-head full verification.
6. [ ] Push the corrections.
7. [ ] Reply to the review threads.

Remote Owner exclusions on a joiner remain the documented omission in the PR's Changes
section and the member-chain limitation above. Supporting them requires verified shared-case
data through an expanded renderer contract. This review round preserves that deferred scope.

Next command:
`BIRDBRAIN_TEST_SYSTEM_SHARP=1 mise x -- pnpm test tests/components/RevokeDialog.test.tsx tests/components/SyncCard.test.tsx`.


The new loading, unavailable-summary and sync-status regressions reproduced five failures.
The corrected Revoke, Sync and Members component tests pass all 48 cases. Existing revocation
command tests now wait for the required summary before attempting confirmation. Revocation
confirmation remains disabled during refresh and after a failed inventory read.


Both UI corrections are committed as separate changes. Current errors and newer-version
pauses take precedence over a retained attempt message. If sync-state data is unavailable,
the card still reports the known attempt result. Full verification is the next action:
`BIRDBRAIN_TEST_SYSTEM_SHARP=1 PKG_CONFIG_PATH=/usr/lib/pkgconfig mise x -- pnpm preflight`.
