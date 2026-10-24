# Plan: Shared Case members UI (#1514)

**Status:** active

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
  command-palette action. A later PR on this issue adds the three entry points. A deferred entry
  point is not a review finding; a mounted one is.

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
| S6 | Ledger Actor column, chain selector and Timeline (blocking tier, small); screenshots; two-instance e2e; `pnpm preflight` | verification |

### S1, shipped

- `--color-member-1..4` in `src/renderer/styles/globals.css`, light inside `@theme` and dark under
  `html.dark`, with the README's values. The local installation is always `--color-accent`.
- `SyncState` (`src/shared/types.ts`) gains `peers[]`, `lastSuccessAt` and
  `lastError.installationId` / `lastError.index`; `getSyncState` in
  `src/main/services/sharing/syncState.ts` derives them from `sync-state.json` as written. See
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

Next command:

```
cd /home/matt/worktrees/birdbrain/feat-1514 && tail -40 /home/matt/.cache/birdbrain-1514/s6-e2e.log
```

Finish the screen audit and independent review, address confirmed findings, then commit and run
`mise x -- pnpm preflight` at a clean head. The work remains local and no PR is open. Resume
from this worktree, not the roadmap branch. After the screens PR, the serial programme order is
#1951, #1955, entry points, then #1883. The real two-network sync remains a maintainer action.

## The widened sync state payload

Item 21 of the feasibility assessment gives `sharing:getSyncState` a case-level shape. The
Members tab's Connection and Last synced columns and the newer-version strip (ruling 2 of
2026-10-10, "shown on the Members row as the mock draws it") need per-member facts, and
`SharingMember` carries none. This PR widens the payload instead of adding a channel. The change
is confined to two advisory-tier files (`src/shared/types.ts`, `syncState.ts`), changes no file
schema, no write site, no verifier and nothing under `src/main/index.ts` or `db/**`:

- `lastSuccessAt`: already in the file, dropped from the payload until now.
- `peers[]`, one per roster member other than self and the revoked: `reachable` from the set the
  function already counts, `lastSessionAt` and `ok` from the file's `peers` record, `heldHead`
  the index of that member's own chain this replica held after the session.
- `lastError.installationId` and `lastError.index`: the peer whose `lastSessionAt` equals the
  error's `at` with `ok: false` is the failed session's peer (`finishSession` writes both from
  one clock read), and its `heldHead` is the last entry received. Absent when the session failed
  before `hello` identified the peer.

`tests/main/services/sharing/syncState.test.ts` pins the derivation. The match is at millisecond
resolution, so the test fakes `Date` and moves it between sessions. Three tests that pinned the
whole payload with `toEqual` (`syncState.test.ts`, `tests/main/ipcHandlers.test.ts`,
`tests/main/services/sharing/syncPeers.test.ts`) gained the new fields; no other expectation
moved.

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
At head, in S6: `pnpm preflight` with exit codes captured; screenshots light and dark under
`/home/matt/.cache/birdbrain-1514/screens/`; `.claude/hooks/vale-prose.sh --base origin/main`
on this plan.
