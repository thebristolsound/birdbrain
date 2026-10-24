# Handoff: Shared Case members

## Overview
UI for sharing a Birdbrain Case with up to four peers over iroh. Covers the Case settings → Members screen, the Owner's invite flow, the peer's join flow inside the New Case wizard, a top-bar sync indicator, member attribution in captures, tags, and notes, the revoke and exclude confirmations, and the four new Manifest entry kinds in the Data ledger. Contract: `docs/specs/2026-09-19-collaborative-cases-design.md`. Brief: `docs/specs/2026-09-19-shared-case-members-ui-brief.md`. Verdicts on the design calls: `docs/specs/2026-09-19-shared-case-members-feasibility-assessment.md` (items 19–25, all applied here). Revised 2026-10-23 with the two additions decided on 10 Oct: the network notice (Egress not Direct) and the paused-on-a-newer-version sync error.

## About the design files
`Shared Case.dc.html` is a design reference written in HTML. It shows the intended look and behavior; it is not production code. Recreate it in the Electron renderer (`src/renderer/`, React + the existing token stylesheet) using the patterns already there: `SettingsView.tsx` for the settings shell, the existing capture list rows, the Data screen's Manifest Ledger grid, the New Case wizard, and the extension pill in the top bar. Open the file in a browser with `support.js` beside it and the `_ds/` folder present; every style is inline, so values can be read straight off the element.

## Fidelity
High-fidelity. Colors, type, spacing, and copy are final. Every color is a token from the shipped Birdbrain UI stylesheet except the four member hues, which are new tokens (see Design tokens). Copy follows `docs/agents/writing-guide.md`; keep it verbatim.

## Screens
The file is a canvas; sections are labelled 1a–1h.

### 1a · Case settings → Members (shared, Owner's view)
New case-scoped settings screen. First slice ships **Members only** (assessment item 19); General and Export appear in the nav as disabled placeholders so the screen reads as settings.
- Shell: 48px top bar (existing), then `display:flex`, 18px padding. Left nav 176px, `border-right:1px solid --color-border`, 8px padding, items 12px/500, active item `--color-accent` on `--color-accent-subtle`, radius 4. Section label 10px/600 uppercase, letter-spacing .06em, `--color-text-faint`, `--font-display`.
- **Network notice** (first item in the content column, present whenever `settings.egress !== 'direct'`): banner 1px `--bb-warn` 40% border, `--bb-warn` 8% fill, triangle-alert icon, title 12px/500 "Teammates and the relay can see this computer’s network addresses", body 11px/1.55 secondary verbatim from the mock. It names the current Egress value. Do not soften it: during connection setup a member’s installation receives every interface address on this machine, a system VPN’s own addresses included; the relay sees the address this machine reaches it from. No dismiss and no setting hides it; it leaves only when Egress returns to Direct.
- Content column: `flex:1`, 18px left padding, vertical stack, 12px gap. Cards: `--color-card`, 1px `--color-border`, radius 6, 16px padding, 10px uppercase heading as above.
- Row 1, grid `1.2fr 1fr`:
  - **This installation**: Member Code chip (below) + name 14px/600 + "Owner · Member Code AR" 11px muted. Fingerprint row: label 11px muted, value `--font-mono` 11px `--color-text-secondary`, truncated to first two groups + "…", chevron toggles full 8-group fingerprint. Explainer 11px/1.55 muted.
  - **Sync**: spinner (14px `--color-accent`, 1.4s linear rotate) + "Syncing with M. Brandt" 12px/500 + "41 of 63 Exhibits received · 2 peers connected" 11px muted tabular. "Sync now" secondary button, disabled while syncing. 2px progress bar, `--color-elevated` track, `--color-accent` fill. Footer pinned bottom: last completed sync, entries received, merge entry ref.
- **Members list** card, header row with count and primary "Invite" button (28px, `--color-accent`, white, radius 4, 12px/500, plus icon 12px). Column header 10px/500 uppercase .05em faint. Grid `56px minmax(160px,1fr) 88px 200px 150px 72px`, rows min-height 40, 0 16px padding, 1px `--color-border` bottom, 12px text, hover `--color-elevated`.
  - Code · Operator (name 500 + fingerprint prefix mono 10px faint, ellipsis) · Role (muted) · Connection (6px dot + text, colored by state) · Last synced (muted tabular) · action.
  - Row states: this machine (dot accent, "This machine"); connected direct (`--bb-ok` dot and text); syncing (accent dot pulsing 1.4s, text `--color-text-secondary`, "Syncing · 41 of 63 via relay"); offline (dot `--color-border-strong`, muted, "Offline · last seen …"; drawn in 1b); **paused, member on a newer version** (dot and text `--bb-alert`, "Paused · newer Birdbrain", Last synced "today 13:52 · up to SI-3", plus a strip under the row: 1px `--bb-alert` 35% border, 8% fill, 8px 10px padding, left margin 72px to the Operator column, 11px body naming the member, the last entry received, the first entry waiting, that sync resumes after this machine updates, and that other members are unaffected; "Check for updates" 24px outline button); pending approval (`--bb-warn` dot pulsing 2s, code shown as `JO?`, "Review" primary 24px button always visible); revoked (row opacity .55, transparent dot, faint text "Revoked <date> · keeps their copy", no action).
  - "Revoke" (24px, outline, `--bb-alert` text) appears on hover for connected/syncing/offline members. Owner row has no action.
  - Footnote 11px faint: one person on two machines appears twice; Staging Pool, Selectors, to-dos, timestamp settings are not synced.
- Row 3, grid `1.2fr 1fr`:
  - **Relay**: label 12px/500, mono input (`--color-canvas`, 1px `--color-border-strong`, 6px 10px, 12px) + "Test" secondary button. Explainer paragraph (what the relay can and cannot see) verbatim from the mock.
  - **Recovery** card: border and heading in `--bb-alert` at 35% mix. "Create a new Case from my copy" 12px/500 + explainer; outline button in `--bb-alert`.

### 1b · Members tab, whole-tab states
Three replacements for the content column, each a 376px-wide card in the mock:
- **Not shared**: h2 14px/700 "This Case is on this machine only", 12px/1.6 body, 3-item 11px/1.7 list, "Invite" primary + "Your Member Code will be AR".
- **Relay unreachable**: banner 1px `--bb-warn` 40% border, `--bb-warn` 8% fill, wifi-off icon, "Relay unreachable since 13:48" 12px/500, body, "Retry" (24px outline) and "Change relay" (text). Below: member rows with "Connected · direct" or "Needs relay · last seen …".
- **Unavailable (Intel Mac)**: h2 "Sharing is not available on this Mac", two paragraphs, "Export Case Archive…" secondary button. Do not show Invite.

### 1c · Invite flow (Owner)
Dialog 420px wide, `--color-card`, 1px `--color-border`, radius 8, `--shadow-overlay`. Title 14px/700 `--font-display`, close × 14px top-right, 14px 16px padding.
1. **Invite created**: explainer; invite string in a mono box (`--color-canvas`, 1px `--color-border-strong`, radius 4, 10px 12px, 11px/1.5, `word-break:break-all`). Prefix `bbinvite1`. Buttons: "Copy invite" primary with clipboard icon; "Show QR / Hide QR" secondary toggle; right-aligned "Expires tomorrow 14:07" 11px faint. QR disclosure: 100px QR on white 4px pad inside a bordered row with the explainer.
2. **Waiting**: `--color-elevated` box, 8px accent dot pulsing 2s, "Waiting for someone to use this invite" 12px/500 + body. Footer: "Copy again" secondary, "Cancel invite" text in `--bb-alert`, "Done" primary right.
3. **Join request**: "An installation used your invite from 14:07." 2-col grid `110px 1fr`, 8px 12px gap: Operator name (500), Key fingerprint (mono 11px), Member Code input (64px wide, mono 12px/600, uppercase) with live validation: ok = `--bb-ok` check + "Unique in this Case"; error = input border `--bb-alert` + message "MB is M. Brandt's code. Try MBR or MB2." Helper: "Their Exhibits will read JO-1, JO-2… Up to three characters, A–Z and 0–9. Cannot be changed after approval." Trust note in a bordered box. Footer: "Decline" secondary, "Approve" primary.
4. **Result**: new member row highlighted `--color-accent-subtle`, status "Sending 0 of 63 Exhibits" with spinner; caption "Manifest entry member-add #0032 written to your chain."

### 1d · Join flow (peer)
Inside the New Case wizard, 480px content, no new route. Also a ⌘K action "Join a shared Case…".
1. **Start step**: h2 18px/800 -0.02em "Start a Case", 12px muted subtitle, three option cards (1px `--color-border`, `--color-card`, radius 6, 12px 14px, icon 16 + title 12px/600 + subtitle 11px muted + chevron). Third card "Join a shared Case" / "Paste an invite from the Case's Owner. Stays in sync." Selected card: accent border and `--color-accent-subtle` fill.
2. **Paste**: textarea 76px mono 11px, accent border once recognised; summary box grid `96px 1fr` From / Case / Valid until; caution 11px faint; "Back" secondary, "Join" primary.
3. **Waiting**: elevated box with spinner, "Waiting for A. Renner to approve", body; footer shows own fingerprint prefix.
4. **Success**: Case card in the list: name 13px/700, own Member Code chip (accent), "Shared by A. Renner · 5 members · you joined just now", 2px progress + "24 of 63 Exhibits received".
5. **Failures**, one row each, icon + title 12px/500 + body 11px muted + one 24px action: expired (Paste another), already used (Paste another), Owner offline (Try again), cannot reach Owner or relay (Retry, `--bb-alert` icon), declined (Close).

### 1e · Sync indicator (top bar)
Pill in the right cluster, left of the extension pill. Height 28, radius 9999, 0 10px padding, 11px/500, contents `a · b`. Hidden on single-member Cases. Click opens Case settings → Members. Never toasts.
- Idle, all peers: 1px `--color-border`, transparent, text muted, `--bb-ok` 6px dot, "Synced · 3 peers".
- Syncing: border `--color-border-strong`, text secondary, spinner replaces dot, "Syncing · 41 of 63".
- Syncing, peer offline: as above with `--bb-warn` dot, "Syncing · 2 of 3 peers".
- Idle, peer offline: idle style, `--bb-warn` dot, "Synced · 2 of 3 peers".
- Error (any `lastError.kind`): border `--bb-alert` 35%, fill `--bb-alert` 8%, text `--bb-alert`, "Sync failed · <kind>" where kind ∈ relay, peer, rejected entry, hash mismatch. Tinted fill marks every error state.
- Error, member on a newer version (`lastError.kind = newer-version`): same error chrome, "Sync paused · newer version". Sync with that member stops at the first entry this version cannot read and resumes after this machine updates; other members keep syncing. Members tab shows the paused row and strip above.
- Network notice (any state, `settings.egress !== 'direct'`): a 12px `--bb-warn` triangle-alert glyph leads the pill, before the dot or spinner; it never replaces them. Hover or focus on the glyph opens a 300px popover (same chrome as the tag author popover: `--color-elevated`, 1px `--color-border-strong`, `--shadow-overlay`, radius 4, 10px 12px) with the short form of the notice and "Details in Members". Click still opens Members.

### 1f · Attribution
- **Capture list, detailed view** (316px): 2px hue bar at row left edge (top/bottom 6px inset, radius 0 2px 2px 0). Exhibit Number chip precedes the title: 16px tall, 0 5px, radius 3, hue at 14% fill / 30% border, 10px/600 tabular, `title` attr "Captured by <name> (<code>)". Own captures use accent. Prefix hidden on single-member Cases. Excluded rows show a 10px neutral outline pill "Excluded from export" (1px `--color-border-strong`, `--color-text-muted`, file-off icon).
- **List view**: same chip before the title.
- **Detail header**: 20px chip variant (11px text, 6px dot) + title 14px/700 + "Verified" pill (was "Chain verified"). Byline: "Captured by N. Kowalski (NK, their machine) · <ts> · received by you <ts> in merge #0027". Exclusion banner is neutral: 1px `--color-border`, `--color-elevated`, muted icon; text names who, when, reason, and "Integrity is unaffected: the entry, bytes, and hash still verify." + entry ref.
- **Tags**: one chip per name; color from the earliest author. When >1 member applied it, append "·2" (10px faint) and show a hover popover (`--color-elevated`, 1px `--color-border-strong`, `--shadow-overlay`, radius 4, 8px 10px) listing "Applied by" rows: hue dot + code 600 + name + date.
- **Notes**: byline row 10px faint: 14px code chip (hue 14% fill, no border) + name + date + "read-only on your machine" for others' notes. Inline Exhibit citations render as the 16px chip, `vertical-align:-3px`.

### 1g · Confirmations
Dialog 400px, same chrome as 1c.
- **Revoke S. Idris?** body names what they keep and what stays attributed; note "Recorded in your Manifest as member-revoke. Cannot be undone; they would need a new invite." Buttons: Cancel secondary, "Revoke" filled `--bb-alert`.
- **Exclude NK-12 from export?** body; "Reason (optional, recorded)" text input; Cancel, "Exclude from export" primary accent.

### 1h · Manifest ledger
Data screen grid gains an **Actor** column: `52px 148px 120px 72px minmax(200px,1fr) 128px 128px` = Seq · Time · Event · Actor · Target · Entry hash · Previous. Rows min-height 30, 11px, hover elevated.
- Chain selector row above the header: "Chain" label + one 24px toggle per member (hue dot, code 600, entry count faint) + "Timeline". Default = local chain. Selected: accent border + `--color-accent-subtle`. Right-aligned note: "Verified chain · Seq is the entry index" or "Cross-chain order is by asserted time, not verified".
- Per-chain view: Seq is the chain index. Timeline view: Seq reads `CODE·index`, rows interleaved by time.
- New event names `member-add`, `member-revoke`, `merge`, `exclude` render mono 600 primary on `--color-accent` 5% row tint; `capture.seal` etc. stay muted 400.
- Footer explainer verbatim from the mock.

## Interactions and behavior
- Fingerprint toggle: click swaps truncated/full, chevron rotates 180°.
- QR disclosure: toggles a row below the buttons; button label flips Show/Hide.
- Member Code input validates on change: uppercase, `[A-Z0-9]{1,3}`, unique among current + revoked members.
- Revoke button revealed on row hover (`opacity 0→1`, 150ms).
- Tag author popover on hover, 150ms fade.
- Chain selector re-filters and re-sorts the ledger client-side.
- Spinners: `rotate(360deg)` 1.4s linear infinite. Pulses: opacity 1→.45→1, 1.4s (syncing) or 2s (waiting/pending) ease-in-out.
- Active buttons `filter:brightness(.93)`; focus ring 2px `--color-accent` at 65%, 1px offset.

## State
- `sharing.state`: `local | shared | unavailable`, `relayStatus: ok | unreachable`.
- `members[]`: code, name, fingerprint, role, hueIndex (position in the Owner's `member-add` sequence; revoked members keep theirs), connection (`self | direct | relay | offline | pending | revoked`), lastSynced, transfer progress.
- `sync`: `idle | syncing | error`, peersReachable, peersTotal, received/total, `lastError.kind` (`relay | peer | rejected-entry | hash-mismatch | newer-version`); for `newer-version`, the member code, last entry received, and first entry waiting.
- `settings.egress`: `direct | proxy | tor` (existing setting). The network notice on Members and the pill glyph show whenever it is not `direct`.
- `invite`: string, expiresAt, `created | waiting | request | done | cancelled`; pending request carries name + fingerprint.
- `join`: `start | paste | recognised | connecting | waiting | joined | failed(kind)`.
- Ledger: `selectedChain` (member code or `ALL`).

## Design tokens
Existing (`_ds/…/styles.css`): `--color-canvas`, `--color-surface`, `--color-card`, `--color-elevated`, `--color-border`, `--color-border-strong`, `--color-text-primary/secondary/muted/faint`, `--color-accent`, `--color-accent-hover`, `--color-accent-subtle`, `--shadow-card`, `--shadow-overlay`, `--font-display`, `--font-body`, `--font-mono`.
Semantic (mock aliases; map to the app's existing success/warning/danger): `--bb-ok` #047857 / dark #34d399; `--bb-warn` #b45309 / #fbbf24; `--bb-alert` #dc2626 / #f87171. Green pills use `rgba(16,185,129,.1)` fill, `.2` border.
New member hues, propose as `--color-member-1..4` (light / dark): 1 #0284c7 / #38bdf8 · 2 #b45309 / #fbbf24 · 3 #047857 / #34d399 · 4 #be123c / #fb7185. Local installation always `--color-accent`. Chips: fill `color-mix(in srgb, hue 14%, transparent)`, border 30%.
Type: 18/800 wizard h2, 14/700 dialog and card titles, 12/500 body, 11 secondary, 10/600 uppercase .06em section labels, mono only for fingerprints, invite strings, relay URL, ledger event names and hashes.
Spacing: 16 card padding, 12 stack gap, 8 inline gap, 6 chip gap. Radii: 3 small chip, 4 controls, 6 cards, 8 dialogs, 9999 pills. Buttons 28px (24px inside rows).

## Assets
Icons are Lucide outlines inlined as `<symbol>`s (chevrons, search, refresh-cw, check, x, plus, folder, archive, users, settings, clipboard, qr-code, triangle-alert, key, camera, file, tag, file-x, link, more-vertical, star, wifi-off). Logo `src/renderer/assets/logo.png`. The QR in 1c is a placeholder pattern drawn behind the disclosure; the approved QR library draws the real one from the invite string in the app window.

## Files
- `Shared Case.dc.html` — the design reference (canvas, sections 1a–1h). Tweaks: `theme` (dark/light), `showRevoked`, `egress` (direct hides the network notice).
- `support.js`, `_ds/` — runtime and tokens needed to open it.
- `ENGINEERING_REVIEW.md` — items 19–25 and verdicts.
- `HANDOFF.md`, `github.md` — session and sync receipts.
