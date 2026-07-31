# Tester Rollout — Round 1 Brief

**Date:** 2026-07-03
**Status:** Approved
**Owner:** Matt Donovan

## Context

First distribution of Birdbrain to external testers. Release infrastructure already
works: pushing a `v*` tag triggers `release.yml`, which builds Windows/macOS/Linux
installers plus the extension zip and attaches them to a GitHub pre-release (latest:
`v1.0.1-beta.10`). This round is about packaging the tester experience, not build
infrastructure.

## Parameters

- **Audience:** small trusted circle, ~3–10 testers, invited personally
- **Platforms:** Windows and Ubuntu (macOS builds ship as a byproduct, unsupported)
- **Goal:** loose all-purpose feedback — real-workflow validation, bug hunting, and
  onboarding friction
- **Feedback channel:** shared chat (Discord/Slack/Signal); owner triages into GitHub
  issues using the existing triage labels
- **Timeline:** ship ASAP, open-ended round

## Plan

### 1. Cut the release

- Bump `package.json` to `1.0.1-beta.11`
- Run the local gate: `pnpm lint`, `pnpm test`, `pnpm build`
- Tag `v1.0.1-beta.11` from master and push; CI produces all artifacts

Rationale for a fresh tag: `beta.10` predates the extension install guide page (#177),
the floating capture toolbar (#174), export progress fixes (#173), and Data page
search (#176) — several of which exist specifically to help new users.

### 2. Smoke-test the CI artifacts

Test the **CI-built** installers (what testers get), not local builds. Clean Windows
VM and Ubuntu (WSL build env or real box). Test the `.deb` before the AppImage —
it's the primary Ubuntu path.

Checklist per platform:

- [ ] Install → launch
- [ ] Create case
- [ ] Sideload extension
- [ ] First HTML capture
- [ ] First MHTML capture
- [ ] View capture in app
- [ ] Export
- [ ] Relaunch and confirm data persisted

### 3. Tester guide

One tracked doc: `docs/reference/tester-guide.md`, linked from the release notes and
pinned in chat. Contents:

- What Birdbrain is and what feedback is wanted
- Windows install, including the SmartScreen "More info → Run anyway" step
- Ubuntu install: `sudo apt install ./birdbrain_*.deb`, AppImage as alternative
- Extension sideload (chrome://extensions → Developer mode → Load unpacked); note the
  in-app install guide page walks through this too
- First-capture flow
- Known limitations: no auto-update (watch chat for new versions), unsigned builds,
  extension not on the Chrome Web Store
- Data-loss caveat: captures live only in local `userData`, no backup — "this is beta
  software; export anything you can't lose"

### 4. Feedback channel

- One chat channel/group
- Pinned message: guide link, current release link, and a 5-line bug report format —
  version, OS, what you did, what you expected, what happened, screenshot
- Testers never need GitHub accounts; owner files real issues with triage labels
- Note: the app has no persistent file logger, so reports lean on repro steps and
  screenshots, not log attachments

### 5. Invite and run

- Personal DM per tester with the guide link
- Ping the channel when a new beta ships (no auto-update)
- Sweep chat feedback into GitHub issues roughly weekly

## Out of scope this round

Deliberately deferred; these become gates for a future public beta:

- Code signing / macOS notarization
- Auto-update
- Chrome Web Store listing
- Crash reporting / persistent file logging
- Security-hardening clusters #88, #90, #92

## Accepted risks

- Unsigned builds require a SmartScreen click-through on Windows
- Testers on stale builds unless they watch chat
- Real-investigation data has no backup story beyond manual export
