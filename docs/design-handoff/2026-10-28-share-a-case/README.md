# Handoff: Share a Case (sharing entry points)

## Overview
Makes sharing reachable and visible for a Birdbrain Case. Today the only way an Owner starts sharing is the dashboard card's "…" → Members, the dashboard shows three Cases, and nothing inside an open Case mentions sharing until a teammate has joined. This package adds: a permanent Share pill in the top bar that becomes the shipped sync pill once shared; a ⌘K action beside "Join a shared Case…"; a "Shared" badge and role line on the dashboard card; the user's own Member Code on the breadcrumb of a shared Case; a one-time coachmark; and a list of older Cases under the three recent cards. Nothing here changes the Members screen (`design_handoff_shared_case/`), and nothing here shares a Case: every entry opens Case settings → Members, where Invite and Approve remain the only state-changing actions.

Options considered and tradeoffs: `Sharing Entry Points.dc.html` (low-fi, 21 frames). Chosen bundle: 1a, 1e, 2b, 3b, 3c, 3e, 4a, 5b. The 1f + 2c alternative is drawn as frame F for comparison only.

## About the design files
`Share a Case.dc.html` is a design reference written in HTML. It shows intended look and behavior; it is not production code. Recreate it in the Electron renderer (`src/renderer/`, React, Tailwind v4 tokens) with the components already there: `TopBar.tsx`, `status/SyncPill.tsx`, `layout/CommandPalette.tsx`, `dashboard/CaseCard.tsx`, `dashboard/RecentCases.tsx`, `sharing/SharedCaseLine.tsx`, and the `data-tour` coachmark mechanism in `onboarding/`. Open the file in a browser with `support.js` beside it and the `_ds/` folder present; every style is inline, so values can be read straight off the element.

## Fidelity
High-fidelity. Colors, type, spacing, and copy are final. Every color is a token from the shipped Birdbrain UI stylesheet except the member hues `--m1…--m4` and status colors `--bb-ok/--bb-warn/--bb-alert`, which are the tokens proposed in the Shared Case handoff. Copy follows `docs/agents/writing-guide.md`; keep it verbatim. Frames are drawn at 1180px (and 1000px for G).

## Fixed rules every surface obeys
- Only the Owner (the installation that first shared) sees "Share…"; members who joined see "Members".
- No entry point shares a Case. All of them navigate to `/cases/$caseId/settings` (Members). The approval step is untouched.
- Intel Macs: the control stays visible in an unavailable state and opens Members, which already carries the unavailable copy. Never hide the control.

## Screens

### A · Case Overview, not shared, first open after update
- Top bar unchanged except the right cluster gains the **Share pill** as its first item (left of Connected, after REC when a session is running). The pill occupies the exact slot `SyncPill` takes today, so the two are one component with four states (frame B).
- **Share pill, not shared**: `h-7` (28px), `rounded-full`, `border border-border-strong`, transparent, `text-text-secondary`, `px-2.5`, 11px/500 body font, users icon 12px, label "Share". Hover: `bg-elevated text-text-primary`. Title: "Share this Case with teammates. Opens Members." `data-tour="share"`.
- **Coachmark** (once per installation, stored with the tour flags): anchored under the pill, right-aligned to it, 272px wide, `bg-elevated`, 1px `border-border-strong`, radius 6, `--shadow-overlay`, 14px 16px padding, 10px rotated caret at `right:36px`. Title 12px/600 "New: share a Case with teammates". Body 11px/1.55 secondary: "Up to four other people who run Birdbrain, each with a full copy that stays in sync. You approve every join." Buttons: "Show me" primary 26px (`bg-accent`, white, radius 4, 11px/500) navigates to Members; "Got it" text button muted. While shown, the pill carries a 3px ring at accent 30%. Clicking the pill, Show me, or Got it dismisses permanently. Shown on the first Case opened after this version installs; not on the dashboard; not on Intel Macs.
- Subhead and Overview content are the shipped ones; nothing added there.

### B · The pill, four states
| State | Visual | Label | Tooltip | Click |
|---|---|---|---|---|
| Not shared (Owner, local Case) | outline `border-border-strong`, users icon | Share | Share this Case with teammates. Opens Members. | Members |
| Invite waiting (unused, unexpired invite) | outline, 6px `--bb-warn` dot pulsing 2s | Share · invite waiting | Invite expires today 14:07 | Members |
| Join request waiting | same, dot static | Share · 1 to approve | 1 join request to approve | Members |
| Shared (from first approved join) | shipped `SyncPill`, unchanged | Synced · 2 peers / Syncing · 2 of 3 peers | existing | Members |
| Unavailable (Intel Mac) | `border-dashed border-border`, `text-text-faint` | Share | Sharing is not available on this Mac. | Members |

Separator between label parts is "·" at 60% opacity, as in the sync pill. Owner and members see the same Shared pill.

### C · Captures, shared, Owner's view
- Right cluster: the sync pill in the Share slot (shipped).
- **Breadcrumb chip**: the user's own Member Code chip (18px tall, `px-1.5`, radius 4, hue 14% fill + 30% border, 6px hue dot, 10px/600 letter-spacing .02em) leads the Case name inside the existing switcher button, 6px gap. Local installation is always `--color-accent`; a member who joined sees their own code and hue, not the Owner's. A local Case has no chip. Switcher tooltip becomes "Switch case (⌘K) · You are AR in this Case". Hit target unchanged. Appears in every section because it is in the top bar.
- Capture rows and detail header show Exhibit Numbers in the member's hue chip (from the Shared Case handoff); "received from NK" in the row meta for captures that arrived by sync.

### D · Command palette
- In the actions block under the Case list, insert a row directly **above** "Join a shared Case…": users icon 16px faint, "Share this Case…" 14px, trailing current Case name 12px faint. Same row geometry as the siblings (`px-4 py-2.5 gap-3`, hover `bg-elevated`).
- Shown only when a Case is open. Label: "Share this Case…" for the Owner of a local Case; "Members…" once shared or for a member who joined. Hidden on Intel Macs. Enter navigates to Members and closes the palette.

### E · Dashboard
- **Recent Cases** keeps three cards + New Investigation.
- **Status badge slot** (`CaseCard` top row, right): add "Shared · n" (n includes you): 20px tall, `rounded-full`, `border border-border-strong`, 9px/700 `text-text-secondary`, users icon 10px stroke 2.4. Precedence: Recording > Active > Shared; the role line still states sharing when the badge yields. Badge sits left of the hover "⋯" (20px right margin).
- **Role line** replaces `SharedCaseLine`, 11px, in the stats position above the capture count, 10px bottom margin:
  - Owner: own chip + "You own · 3 members"
  - Joined: own chip + "Shared by A. Renner"
  - Invite waiting (Owner): pulsing `--bb-warn` 6px dot + "Invite waiting · expires 14:07"
  - Local: "On this machine only" in `text-text-faint`, no chip
- **Card menu** item reads "Share this Case…" until shared, then "Members". Destination unchanged.
- **Older Cases** list under the grid (28px gap): `bg-card`, 1px `border-border`, radius 6. Header row 10px/500 uppercase .05em faint: "Older Cases · n" · Captures · Sharing · (actions). Grid `minmax(0,1fr) 90px 220px 36px`, rows min-height 40, `px-5`, 12px, 1px `border-border` bottom, hover `bg-elevated`, click opens the Case. Name cell: 8px type-colour dot + name 500 + age 10px faint. Sharing cell uses the role-line states; for an unshared Case it reads "Share this Case…" as muted text. Trailing "⋯" 24px button always visible at muted weight (no hover to discover), opening the same menu as the card: Rename · Share this Case… / Members · Delete (menu 160px, `bg-surface`, 1px `border-border-strong`, radius 8, `--shadow-overlay`, items 11px `px-3 py-1.5`). Contents: every Case after the three most recent, by `updatedAt`. Omit the list with three Cases or fewer.

### F · Alternative (not recommended): Case name opens a menu
Breadcrumb opens a 232px menu: Switch Case… (⌘K) · Rename · Share this Case… · Export… · Case settings. Export leaves the right cluster. Costs: an extra click to switch Cases, no permanent visible "Share", and the coachmark would point at a closed menu. Drawn for comparison only; do not build unless chosen.

### G · Top bar at 1,000px
- Rule: the side groups share what the search leaves (existing grid). When the right group would push the search under its 128px `min-w-32`, the Share pill drops to a 28px round icon-only button first; the sync pill follows with its compact form. At 1,000px with REC running the icon form is required; without REC the full label fits. Below 900px the Case name truncates as today.
- Icon-only states: not shared = outlined users icon; invite waiting = `--bb-warn` dot in the icon's top-right corner; shared = compact sync dot. Tooltips carry the full label. `aria-label="Share this Case"`.

## Interactions & behavior
- All entries → `navigate({ to: '/cases/$caseId/settings' })`.
- Pill state is derived from the Case: `sharedAt` set → Shared; else an active invite → Invite waiting; else a pending join request → to approve; else Not shared. Platform check → Unavailable.
- Coachmark: one flag in the onboarding store (`seenShareCoachmark`), set on any dismissal; not shown if the installation has already shared or joined a Case.
- Transition from Share → Synced happens on the first approved join; no animation beyond the existing pill's.
- Hover: pills and rows `bg-elevated`; menu items `bg-elevated text-text-primary`; focus-visible 2px accent ring at 65%.

## State management
- Case: `sharedAt`, `ownerInstallationId`, `myMemberCode`, `members[]`, `activeInvite { expiresAt }`, `pendingJoins[]`.
- Dashboard: `recent = cases.slice(0,3)`, `older = cases.slice(3)`.
- Onboarding: `seenShareCoachmark: boolean`.

## Design tokens
From the shipped stylesheet: `--color-canvas/surface/card/elevated`, `--color-border/border-strong`, `--color-text-primary/secondary/muted/faint`, `--color-accent/accent-subtle/accent-hover`, `--shadow-card`, `--shadow-overlay`, `--font-display/body/mono`.
Proposed (from the Shared Case handoff): `--bb-ok` #047857 / dark #34d399; `--bb-warn` #b45309 / #fbbf24; `--bb-alert` #dc2626 / #f87171; member hues `--m1` #0284c7 / #38bdf8, `--m2` #b45309 / #fbbf24, `--m3` #047857 / #34d399, `--m4` #be123c / #fb7185.
Type: 9px/700 badge, 10px/600 chip and section labels, 11px/500 pill and meta, 12px body, 14px palette rows, 18px/800 Case title. Radii: 4 (chips, buttons), 6 (cards, coachmark), 8 (menus), 12 (palette), full (pills).

## Assets
Icons are Lucide (users, chevrons-up-down, chevron-right, more-vertical, camera, arrow-up-right, search, plus, clock, compass, message-square-warning, settings, download, activity, sun). Logo: `src/renderer/assets/logo.png`.

## Screenshots
`screenshots/01…07` are captures of frames A–G in dark theme. The capture tool substitutes a fallback font, so text metrics in the PNGs are approximate; the HTML files are the reference for type and spacing.

## Files
- `Share a Case.dc.html` — the hi-fi frames A–G (canvas; `support.js` and `_ds/` required beside it).
- `Sharing Entry Points.dc.html` — the low-fi options with tradeoffs.
- `Shared Case.dc.html` — the Members screen this routes to (unchanged).
