# Shared Case members mock feasibility assessment

Date: 2026-09-19
Reviews: [`docs/design-handoff/2026-09-19-shared-case-members/`](../design-handoff/2026-09-19-shared-case-members/),
items 19–25 of its `ENGINEERING_REVIEW.md`.
Contract: [Shared Cases design](2026-09-19-collaborative-cases-design.md) and the
[members UI brief](2026-09-19-shared-case-members-ui-brief.md).
Format follows the bundle's round-trip protocol: a verdict, a size, and the constraint behind
any Modify. No redesigns; the designer revises the mock.

## Summary

| #   | Item                              | Verdict                                              | Size |
| --- | --------------------------------- | ---------------------------------------------------- | ---- |
| 19  | Case settings screen              | Modify: Members tab ships alone; route accepted      | M    |
| 20  | Member identity tokens            | Accept, with the hue-index rule below                | S    |
| 21  | Sync pill                         | Accept; error state widens to any sync failure       | S    |
| 22  | Exhibit Number prefix in lists    | Accept; Member Code capped at three characters       | S    |
| 23  | Join inside the New Case wizard   | Accept                                               | M    |
| 24  | Ledger Actor column, interleaved  | Modify: per-chain is the default view                | M    |
| 25  | Exclusion treatment               | Modify: neutral, because `exclude` only annotates    | XS   |
| —   | Copy                              | One label change                                     | XS   |

## Items

### 19. Case settings screen: Modify (M)

The route is accepted: a case-scoped settings screen has no upstream precedent (the app has
only `src/renderer/components/settings/SettingsView.tsx`), and a Members tab needs a home, so
`/cases/$caseId/settings` is the right shape. Two constraints:

- **Members ships alone.** The General and Export tabs draw functions that exist elsewhere
  today (case rename on the dashboard, export as a dialog). Keep the tab bar in the mock so the
  screen reads as a settings screen, but engineering builds Members first and moves nothing
  into General or Export in this slice.
- **Entry points.** The sync pill entry is accepted. The renderer has no case-level "⋯" menu
  component to hang the second entry on; where case actions live today decides whether that
  item is a new menu or an item in an existing one. Engineering resolves this at build time.

### 20. Member identity tokens: Accept (S)

Four tokens `--color-member-1..4` in light and dark, local installation on `--color-accent`,
hue never persisted in the chain. Four is exact: five members is the local installation plus
four. One rule so a hue never moves: the hue index is the member's position in the Owner's
`member-add` sequence, and a revoked member keeps its index. Roster order in the UI can still
sort by name; the hue does not follow the sort.

### 21. Sync pill: Accept (S)

Pill grammar, placement, and hidden-on-single-member are accepted. The spec's
`sharing:getSyncState` gains a payload shape to feed it:

```ts
{
  phase: 'idle' | 'syncing' | 'error'
  peersReachable: number
  peersTotal: number
  transfer: { entries: number; blobs: number; bytes: number } | null
  lastError: { kind: 'relay' | 'peer' | 'rejected-entry' | 'hash-mismatch'; at: string } | null
}
```

One widening: the tinted fill is drawn only for relay error. A rejected forged entry or a blob
hash mismatch is a sync failure the member should see, so the error state covers every
`lastError.kind`; the pill's detail line names which.

### 22. Exhibit Number prefix in lists: Accept (S)

The 16px chip before the title at 316px is the read-time rule the spec describes. To keep the
chip's width bounded, the Member Code is capped at three characters from `[A-Z0-9]`, uppercase,
validated at approval. Initials fit; the mock's `NK`, `MB`, and `SI` fit. The spec is updated
to say so.

### 23. Join inside the New Case wizard: Accept (M)

`NewCaseWizard.tsx` is a single card and takes a third start card without a new route. The
command palette exists (`src/renderer/components/layout/CommandPalette.tsx`) and takes the
action. The five failure states map one-to-one onto the brief. Sizing is M because the wizard
gains a multi-step branch (paste, confirm sender, waiting, progress) with IPC events behind
each step.

### 24. Ledger Actor column, interleaved: Modify (M)

The Actor column and the highlighted rows for `member-add`, `member-revoke`, `merge`, and
`exclude` are accepted. The interleaved-by-time default is not, for two reasons:

- `ManifestLedger.tsx` keys rows by chain index and renders **Seq** as that index. Interleaving
  makes Seq non-monotonic and the key non-unique across chains.
- An entry's `timestamp` is asserted by its writer. Ordering two members' chains by it presents
  as verified order what verification does not establish; the verifier walks each chain on its
  own and checks `merge` heads, never cross-chain time.

Constraint for the revision: the default view is one chain at a time (member selector or tabs),
Seq stays the chain index. An interleaved timeline may exist as a secondary view whose Seq
cell reads `<Member Code>·<index>` and whose header states that cross-chain order is by
asserted time.

### 25. Exclusion treatment: Modify (XS)

Drop to neutral. The spec's open question 2 is answered here: an `exclude` entry annotates and
does not change the verifier's pass outcome, because the excluded Exhibit's entry, bytes, and
hash are all still verified; exclusion is an Owner's statement about the export, not about
integrity. Warning tint would read as an integrity problem. The spec is updated to record the
answer.

### Copy: one label change (XS)

Section 1f shows **Chain verified** on an Exhibit. The app's Integrity Status label is
**Verified** (with **Tampered**, **Missing**, **Chain broken**, and **Legacy HTML** as the
others); use the existing label. Every other string checked against the brief's copy
constraints passes: the fingerprint, relay, revoke, exclusion, and Intel Mac copy each say what
the mechanism does and does not prove.

## What the mock left to the designer, now answered

The brief's four designer questions are closed by the mock: member identity is Member Code
chip plus hue dot; the sync indicator is the top-bar pill; the copyable string is primary with
QR secondary; join lives in the New Case wizard. No further design question is open.
