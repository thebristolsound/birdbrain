# Exploratory charter 1 — findings

**Charter:** "OSINT investigator using Birdbrain for the first time. Create a case, add a URL
capture, explore every sidebar tab, notes, dark mode, Settings. Report anything confusing,
broken, or visually wrong."

**Run:** 2026-08-15, harness `scripts/exploratory-harness.mjs` under `xvfb-run` (1440x900
screen; app window came up 1200x773), commit `28879db`, built app `1.0.1-beta.17`.
Screenshots copied to `/tmp/charter-1/` (32 PNGs; not tracked). No issues filed — spike
run to judge signal quality (spec rollout step 1).

## Findings

| # | Sev | Title | Screenshot |
|---|-----|-------|------------|
| 1 | med | Unsaved note draft silently lost on tab navigation | 021, 022 |
| 2 | med | MHTML "Page" tab content overflows pane, clipped right, no h-scroll | 012, 013 |
| 3 | low | Capture viewer toolbar overflows at 1200px: Download/prev/next clipped | 010 |
| 4 | low | Onboarding card taller than 773px viewport; logo clipped, buttons below fold | 003 |
| 5 | low | Empty-captures guide says "Toggle Auto-Capture in the header bar" — no such control visible | 006 |
| 6 | low | Onboarding step 3 mock shows "Extension installed · Active" while status says "Waiting for extension…" | 003 |
| 7 | low | Overview "Recent captures" thumbnail cropped mid-page (shows body text slice, not page top) | 015 |
| 8 | low | Command palette: "1 captures" pluralization | 031 |
| 9 | low | Tags page: 8 colour-swatch buttons have no accessible name | 018 (aria) |
| 10 | low | Settings → Capture: native (unthemed) checkbox/radio/slider in dark mode | 030 |
| 11 | low | Empty-state illustration on captures pane clipped at top | 006 |

### 1. Unsaved note draft lost on navigation (med)
- Notes tab → New note → typed title "Kit observation" + body "Land" → clicked Overview in
  sidebar → clicked Notes.
- Expected: prompt to keep/discard, or draft preserved.
- Observed: editor gone, "No notes yet". No confirm, no toast. Charter said "try to lose
  data" — first attempt succeeded.

### 2. MHTML Page tab clipped (med)
- Captured `https://example.com` via Capture → Paste URLs. Opened capture → Page tab.
- Expected: archived page fits pane or scrolls horizontally.
- Observed: heading "Example D…" cut off by details rail; with rail collapsed body text
  still clipped ("without ne…"). Content rendered wider than pane, overflow hidden.

### 3. Viewer toolbar overflow at 1200px (low)
- Same capture, Screenshot tab, details rail open.
- Observed: "Downloa" truncated; prev/next + "1 / 1" present in a11y tree but off-screen.
  Fine once rail collapsed (013).

### 4. Onboarding card doesn't fit 773px height (low)
- Fresh profile, step 1 → Next → Next (sub-step 3).
- Observed: page scrolled so Birdbrain logo is cut off under top bar; Back/Continue
  buttons pushed below fold (visible only via a11y). Card ~800px tall.

### 5. Guide references non-existent "Auto-Capture toggle in header bar" (low)
- Empty captures pane, step 2 text. Header shows health/Export/Settings/theme only. Likely
  appears once extension connects — but a first-time user reading this without extension
  can't find it.

### 6. Onboarding mock reads as real state (low)
- Sub-step 3 illustration shows green "Extension installed · Active" card directly above
  the real "Waiting for extension…" status. Confusing at a glance.

### 7–11
- 7: Overview recent-capture tile shows a horizontal slice of body text with a stray
  green dot — looks broken rather than like a thumbnail.
- 8: Palette row "1 captures".
- 9: `role=button` ×8 with empty names on Tags page (colour picker). Selected swatch also
  not visually distinct in screenshot.
- 10: Dark Settings → Capture uses browser-default blue checkbox/radio and white slider
  track; every other control is token-themed.
- 11: Camera illustration in captures empty state cut at top edge (006).

## Explored and fine
- Onboarding step 1→2 flow (Next / Continue / Skip all reach Create Investigation).
- Case creation from onboarding lands on `/cases/:id/captures`.
- Paste-URLs background capture: example.com captured in ~8s, list updates, MHTML +
  screenshot + text tabs populated, chain-of-custody panel populated, Re-verify → Verified.
- Sidebar tabs Overview/Selectors/Notes/Tags/Data all render, empty states sensible;
  Data tab shows "1 indicator extracted" from the capture.
- Note create/save round-trips (title + body shown, edit/delete present).
- Dark mode: no contrast/theme defects seen across 6 tabs, viewer, dashboard, palette.
- Ctrl+K palette opens, lists case + create + report-a-problem.
- Console: zero messages/pageerrors for the entire session.

## Harness notes (feed into step 2)
- Need `--skip-onboarding` seed (or a `keys` tool) — every charter starts by clicking
  through the wizard.
- Add `typetext` (page.keyboard.type) alongside `type` (fill) for contenteditable/rich
  editors; `press` per char is clumsy.
- Window opens at 1200x773 under Xvfb; consider `--window-size` arg so charters can test
  small vs large layouts deliberately (findings 2–4 are all width/height-driven).
- Cleanup gap: killing the `xvfb-run` wrapper (or the shell) orphans the temp userData
  dir. Two stale `birdbrain-explore-*` dirs found after this run. Consider a `--tmp-parent`
  + sweep-on-start, or trap in a wrapper script.
- Signal quality: 2 medium + 9 low findings from ~35 tool calls / 32 screenshots, zero
  false positives on re-inspection. Enough to proceed to charter set.
