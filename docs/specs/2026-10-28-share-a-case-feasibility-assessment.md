# Share a Case handoff feasibility assessment

Date: 2026-10-28
Reviews: [`docs/design-handoff/2026-10-28-share-a-case/`](../design-handoff/2026-10-28-share-a-case/),
the chosen bundle its README names (1a, 1e, 2b, 3b, 3c, 3e, 4a, 5b) and frame G.
Contract: the [sharing discoverability brief](2026-10-27-sharing-discoverability-ui-brief.md),
the [Shared Cases design](2026-09-19-collaborative-cases-design.md) and the
[members feasibility assessment](2026-09-19-shared-case-members-feasibility-assessment.md), whose
item 19 left the entry points to engineering.
This bundle carries no `ENGINEERING_REVIEW.md`, so the format follows the round-trip protocol
in the [members bundle's](../design-handoff/2026-09-19-shared-case-members/ENGINEERING_REVIEW.md):
a verdict, a size, and the constraint behind any Modify. No redesigns; the designer revises the
mock.

## Summary

| #   | Surface                            | Verdict                                                    | Size |
| --- | ---------------------------------- | ---------------------------------------------------------- | ---- |
| A   | Share pill, four states (1a, 2b)   | Accept; shipped tokens, no new reads                       | S    |
| B   | The pill at 1,000px (G)            | Modify: a width breakpoint, not a measurement              | M    |
| C   | Member Code on the breadcrumb (3e) | Accept                                                     | S    |
| D   | Command palette row (1e)           | Accept                                                     | S    |
| E1  | "Shared" badge on the card (3b)    | Accept                                                     | XS   |
| E2  | Role line on the card (3c)         | Modify: the operator name as entered, the clock as shipped | S    |
| E3  | Card menu label (2b)               | Accept                                                     | XS   |
| E4  | Older Cases list (5b)              | Accept; one menu shared with the card                      | M    |
| F   | Coachmark (4a)                     | Modify: shows on upgrades, by ruling                       | M    |
| G   | Case name menu (frame F)           | Not built, as the bundle says                              | -    |
| -   | Copy and tokens                    | Four constraints, listed under the items                   | XS   |

Nothing here touches an evidence path. Every surface navigates to the existing Members screen;
invite, approve and revoke stay where they are. The pill, the palette row, the card and the
list read the roster (`sharing:getMembers`), the sync state (`sharing:getSyncState`) and the
platform check (`sharing:isAvailable`) the Members slice already exposes. No main-process
change, no settings schema change and no new token.

## Items

### A. Share pill, four states (1a, 2b): Accept (S)

Slot, component and reads all exist. `SyncPill` already sits in the slot the mock
names and opens Members; today `TopBar` mounts it only for a Case with `sharedAt`, and it hides
itself until another Member is on the roster. For any Case, shared or not, the roster read
returns `invites[]`, `pendingJoins[]` and `isOwner`, and the platform read is cached for the
process. In the renderer, Unavailable overrides the four states when the platform read is
false. Otherwise the four states derive as follows, first match wins:

1. Shared: the sync pill model counts another Member (the shipped pill, unchanged).
2. To approve: a pending join exists.
3. Invite waiting: an open invite exists.
4. Share: otherwise.

Two departures from the bundle README. Shared keys on another Member in the sync model, not on
`sharedAt`, because the first invite already sets `sharedAt`. A pending join outranks an open
invite, because it is the one state that needs the Owner.

The roster query is already refetched on `event:sharingChanged`, which fires on any invite,
join or roster change, so the pill moves without a second poll. The invite expiry in the
tooltip is `expiryPhrase`, which the invite dialog uses.

Constraints, none of which change the drawing:

- `--bb-warn`, `--bb-ok` and `--bb-alert` are the shipped `warning-fg`, `success-fg` and
  `danger-fg` tokens, and `--m1` to `--m4` are `member-1` to `member-4`; the Members slice added
  them. No new tokens.
- "Share · 1 to approve" pluralises: "2 to approve".
- On a Case nobody has shared, the local installation is the Owner by definition, so "Share"
  shows to whoever opens a local Case. A member who joined always holds a Case with `sharedAt`
  set and another Member on the roster, so the "Share" label never shows to a member.

### B. The pill at 1,000px (G): Modify (M)

Two constraints.

- **The rule is a measurement; the bar has none.** The mock drops the label "when the right
  group would push the search under its 128px minimum". The top bar is a flex layout: the
  search at `flex-[0_1_400px] min-w-32` and the side groups `flex-1 basis-0`, with no script
  measuring them, and `e2e/topbar-layout.spec.ts` checks overlap, not labels. A container
  query on the right cluster cannot stand in: the cluster takes its width from its content,
  so a label that hid would shrink the cluster that hid it. Engineering implements the rule
  the way the top bar's labels already fold, at a viewport breakpoint: the Share label hides
  below `lg` (1,024px), as the Connected label does (Export folds at `xl`, 1,280px), which
  keeps frame A's label at 1,180px and frame G's icon at 1,000px with or without REC. The
  behaviour the mock asks for stands; only the trigger changes.
- **The sync pill's compact form is new.** `SyncPill` always prints both halves of its label.
  Frame G draws the compact form as the dot alone with the tooltip carrying the label; that is
  enough to build from, and it is new work, which is why this is M rather than S.

### C. Member Code on the breadcrumb (3e): Accept (S)

`MemberCodeChip` at 18px in the `accent` hue is the chip the mock draws, and `SharedCaseLine`
already reads the local installation's code from the roster the same way. The chip goes inside
the existing switcher button, so the `caseswitcher` tour anchor and the `topbar-case-name` test
id keep their element and the hit target is unchanged. Its tooltip gains "· You are AR in this
Case". Capture rows and the detail header in the mock already carry the hue chips the
Members slice shipped; nothing in this bundle changes them.

### D. Command palette row (1e): Accept (S)

The row goes above "Join a shared Case…" with the same geometry as its siblings. Because the palette
reads the open Case from the route, which is absent on the dashboard and on the New Case wizard,
the row hides on both. Its label follows `sharedAt`, as the card menu does (E3): "Share this
Case…" until the first invite, "Members…" after it. Until the first approved join, the row can
read "Members…" while the pill still reads "Share · invite waiting". The row hides when the
platform read is false. Arrow keys in the palette walk the Case list only; the action rows
are reached with Tab, where Enter is the button's own, as for the rows beside it today.

### E1. "Shared" badge on the card (3b): Accept (XS)

The status slot exists on `CaseCard`, with Recording and Active drawn there. `RecentCases`
passes both as false constants today, so the precedence rule costs nothing but is written in.
The count is `memberCount`, which excludes revoked members and includes you; a shared card
already reads its roster for the line below.

### E2. Role line on the card (3c): Modify (S)

The four states replace `SharedCaseLine`, which is the line the mock extends. Two copy
constraints:

- **The operator name as entered.** The mock prints "Shared by A. Renner". The app stores one
  operator name with no first and last parts, and the Members screen prints it whole. The line
  prints the name as entered and truncates at the card's width.
- **The clock as shipped.** The invite-waiting state prints the expiry through `formatClock`,
  which reads "today 14:07" or "tomorrow 09:12" in UTC like every time in the renderer. "Invite
  waiting · expires 14:07" becomes "Invite waiting · expires today 14:07", on the card and in
  the pill's tooltip.

### E3. Card menu label (2b): Accept (XS)

"Share this Case…" until the Case is shared, which the first invite does, then "Members", same
destination. The item stays on an
Intel Mac, as the bundle's fixed rules require. `e2e/shared-case-members.spec.ts` selects the
menu item by its name on a Case not yet shared, so the spec moves with the label.

### E4. Older Cases list (5b): Accept (M)

The Case list query already orders by `updated_at` descending, so the list is everything after
the first three of what the dashboard holds, omitted at three Cases or fewer. One constraint on
how it is built, not on how it looks: the list's kebab opens the card's menu, which carries a
delete confirmation, focus management and arrow-key rules of its own. Engineering lifts that
menu out of `CaseCard` into one component both surfaces mount, rather than drawing it twice.
The card's kebab keeps its hover reveal; the list's stays visible, as drawn.

### F. Coachmark (4a): Modify (M)

The mark is shown "on the first Case opened after this version installs". Two constraints, the
first of which is a ruling, not an engineering fact.

- **The tour never fires on an upgrade.** `shouldAutoFire` requires `isFreshInstall`, which is
  latched when an installation first writes its settings, and the rule is recorded in
  `tourSteps.ts` (#404): an update must not ambush an operator mid-case. Every current tester is
  an upgrade, so under that rule nobody the brief is about would see the mark. The mark is one
  dismissible card pointed at a new control, not a chapter, which is a smaller interruption
  than the rule was written for. The maintainer ruled on 2026-10-28 that it may; the ruling
  is recorded below.
- **A feature mark, not a chapter.** It does not go through the chapter engine:
  `CoachMark` carries a step counter, a skip link and a Next button the mock does not draw.
  The mark is its own component that reuses the tour's placement (`tourGeometry.markLayout`),
  its card chrome and its `data-tour` anchor, and records its dismissal as a `share` key in the
  settings' `onboardingChapters` record, which is string-keyed already. It defers while a
  chapter is running, so a fresh install's case chapter is not interrupted, and it stays off
  when the platform read is false or any Case on this installation already has `sharedAt`.

The 3px accent ring on the pill while the mark shows is a class on the pill, not the tour's
spotlight overlay; the rest of the screen stays usable. Accepted as drawn.

### G. Case name menu (frame F): not built

As the bundle says. Item 19 of the members assessment noted that the open Case has no action
menu of its own; the one menu the card and the Older Cases list now share is where such a menu
would come from if it is ever wanted.

### Copy and tokens (XS)

Four constraints. Three are stated above: the shipped token names, the operator name as
entered, and the clock format. The fourth is the coachmark's body: it drops "Up to four other
people who run Birdbrain" for "Other people who run Birdbrain", by the maintainer's ruling of
2026-10-28, because no code in the app limits a Case's roster to five. Every other string in
the bundle's README is taken verbatim into `memberModel.ts`'s `COPY`, where the Members slice
keeps its strings, so one test reads them all.

## Ruling

**May the coachmark show on an upgrade?** The design shows the one-time "New: share a Case
with teammates" card to every installation the first time it opens a Case after this version
lands, which is the audience the brief is about. The tour's standing rule is that an update
never starts a walkthrough on its own. Recommended: yes, as a one-card exception for this mark
only, recorded here and in `tourSteps.ts` beside the rule it excepts. The alternative was
fresh installs only, with the pill doing the announcing on its own.

**Ruled yes on 2026-10-28.** The mark shows once to every eligible installation, upgrades
included, as the one exception to the rule; the constraints under F still keep it off where
they apply. The coachmark pull request adds `shouldShowShareMark` to `tourSteps.ts`, beside the
rule it excepts.

## Build order

Three code PRs after this one, each inside the plan-approval limits, each renderer-only and
not evidence-affecting:

1. **Top bar and palette (A, B, C, D).** `TopBar.tsx`, `SyncPill.tsx` (renamed `SharePill.tsx`
   as it grows into the four-state pill), `memberModel.ts`, `CommandPalette.tsx`, their tests,
   `e2e/topbar-layout.spec.ts` with a 1,000px case, and the tester guide's "where to start"
   sentence.
2. **Dashboard (E1 to E4).** `CaseCard.tsx`, the lifted menu component, `RecentCases.tsx`, the
   new Older Cases component, the role line that replaces `SharedCaseLine.tsx`, `Dashboard.tsx`,
   their tests and `e2e/shared-case-members.spec.ts`.
3. **Coachmark (F)**, as ruled.
