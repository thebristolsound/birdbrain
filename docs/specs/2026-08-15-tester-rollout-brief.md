# Tester rollout — round 1 brief

**Date:** 2026-08-15
**Status:** Approved
**Owner:** Matt Donovan
**Supersedes:** `docs/archive/2026-07-03-tester-rollout-brief.md`
**Written as:** [#416](https://github.com/thebristolsound/birdbrain/issues/416), under map [#284](https://github.com/thebristolsound/birdbrain/issues/284)

## Why this replaces the July brief

The 3 July brief was written before map #284 was grilled on 2026-08-12. That round never
ran, and six betas shipped in the meantime (`1.0.1-beta.17`, tagged 2026-07-24). Five
decisions from the grilling change what round 1 is: the tester count and platforms (#285),
the durability contract (#286), the support commitment (#290), the pre-ship gate (#291),
and the archive-confidentiality posture (#292). A sixth change — the feedback ask — is
decided here.

The July brief also assumed things that are no longer true: no auto-update (packaged builds
now check and install, per `src/main/services/updater.ts`), no persistent logging (there is
a diagnostic log and a bug-report bundle, #261), and a tester guide at
`docs/reference/tester-guide.md` (it is now `website/content/docs/tester-guide.mdx`,
published).

## Destination

The first outside investigator can safely run Birdbrain on a real case, and the maintainer
can support them through it. The floor is one class of failure — **Birdbrain must not
silently lose, corrupt, or mis-attest evidence.** Everything else ships rough, on purpose.

## Parameters

### Testers

**2–3, personally invited** (#285). Smaller than the July brief's 3–10, sized to what one
maintainer can support.

The investigator who asked to test early is **inside** this cohort, not an exception to it
(#416, 2026-08-15). The support commitment below applies to them in full, and round 1 has
no separate lower-commitment tier for one-off testers.

### Platforms

| Platform | Format | Status |
| --- | --- | --- |
| Windows | NSIS `.exe` | Supported; must pass the pre-ship gate |
| Ubuntu | AppImage | Supported, **primary Linux format** — auto-update works here; must pass the gate |
| Ubuntu | `.deb` | Best-effort; release notifications are manual (see the note below) |
| macOS | `.dmg` / `.zip` | **Built on request**, not per tag (#605); untested, unsigned |

**macOS is built on request rather than per tag (#605).** Building it on every tag published
six of seventeen release assets — about 850 MB — on a runner billed at ten times the Linux
rate, for a platform nobody was pointed at. Building it *never* stopped being right the
moment a round-1 tester turned out to be on a Mac. So it moved to
`.github/workflows/release-macos.yml`, dispatched per tag that needs it:

```sh
gh workflow run release-macos.yml -f tag=v1.0.1-beta.20
```

It attaches the macOS assets to the existing Release and fails if that Release does not
exist, rather than creating a macOS-only one.

What the macOS tester gets, stated plainly because it is worse than the other two platforms:

- **Unsigned and un-notarized.** Gatekeeper refuses the app until the quarantine attribute
  is cleared by hand. The tester guide carries the command. Signing and notarization are
  #274 and #92 and are not in this round.
- **Outside the pre-ship gate.** The gate covers Windows NSIS and the Ubuntu AppImage. No
  macOS build passes a checklist before it ships, so the tester is the first person to run it.
- **Auto-update only between two macOS-built releases.** `latest-mac.yml` is published only
  when a macOS build is made, so the feed skips tags that had none. It will not offer an
  update across a gap; a manual install is the fallback.

Builds are unsigned. Windows testers get a SmartScreen "More info → Run anyway"
click-through; that is accepted for an invited round (#284 out-of-scope list).

**Delivery (#567, 2026-08-18).** Builds are published to the public repository
`thebristolsound/birdbrain-releases`, which holds artifacts only; the source repository stays
private until the #262–#274 effort completes. This is what makes "testers never need GitHub
accounts" true rather than aspirational, and it is what electron-updater needs: its
unauthenticated GitHub provider reads the releases Atom feed, so a private feed fails every
update check. Making the feed private instead would mean shipping a repo-read token to each
tester.

One limit worth stating plainly: the first build published this way can only demonstrate that
the feed is reachable. A real in-app upgrade cannot be shown until a second build ships,
because every installed `1.0.1-beta.17` has the private repository baked into its
`app-update.yml`. The gate's §5 upgrade check is a manual install-over-the-top this round.

**A correction to the #290 wording, worth carrying forward.** That decision recorded "no
auto-update on deb" as the reason `.deb` testers are notified manually. That is no longer
true of the code: `src/main/services/updater.ts` treats a `.deb` install as
auto-install-capable and updates it through electron-updater's `DebUpdater`, with the
install deliberately restricted to the explicit "Restart to update" action because dpkg
needs a system password prompt. The manual in-channel notification stands as a support
commitment — it is belt-and-braces, not a workaround for a missing capability. AppImage
remains the primary Linux format on the grounds that it replaces itself in place with no
password prompt.

### Data

**Real project data is tolerated, not endorsed** (#285). The guide recommends synthetic or
low-stakes material; real data goes in at the tester's own risk.

What backs that risk is the durability contract from #286, implemented in #413: before any
pending migration runs, Birdbrain snapshots the database with better-sqlite3's native
`db.backup()`, keeps a bounded number of snapshots in `db-snapshots` next to the database,
and **fails closed** — if the snapshot cannot be taken, the migration does not run. Restore
is surfaced in **Settings → Database → Utilities → Pre-Migration Snapshots**.

State the limits alongside it, per ADR-0004. A snapshot covers the database, not capture
files on disk; restoring overwrites the current database with no undo; and a failed restore
proves nothing about the state of what was there before. "Export before you update" is
still good advice, but it is advice, not the mechanism.

### Archives and confidentiality

No archive encryption ships in round 1 (#292). With 2–3 trusted testers and a single
private channel, the channel is the control. The posture, stated plainly in the guide:

- Testers send `.birdbrain` case archives **only via the private tester channel**.
- The live store's confidentiality relies on the operating system's full-disk encryption
  (BitLocker, LUKS). Birdbrain does not encrypt the database or capture files at rest.
- Diagnostic bug-report bundles need no extra handling — `logSafe.ts` already keeps raw
  URLs, case names, and paths out of them, and the bundle excludes captures and the
  database.

Passphrase encryption for case archives is filed as a post-round enhancement.

### Support commitment (#290)

This wording goes into the tester guide, not just this brief.

- **Ordinary bugs:** acknowledged best-effort, target ~2 business days. **No SLA.** Reports
  are swept into GitHub issues roughly weekly.
- **Channel:** one shared private chat. Testers never need GitHub accounts. The bug-report
  format is pinned there.
- **Escalation:** any report implying that **captures already taken** are unreliable →
  every tester is notified in-channel and advised to pause capturing until it is resolved.
  This is the one path that interrupts everyone.
- **Releases:** NSIS and AppImage update in place. `.deb` testers are told about new
  releases manually in-channel, and install via the explicit restart-to-update action.
- **Absence:** maintainer unavailability is announced in-channel. No coverage promise.

### Pre-ship gate (#291)

No build reaches a tester until the gate passes:
[`docs/plans/2026-08-15-pre-ship-validation-gate.md`](../plans/2026-08-15-pre-ship-validation-gate.md).
CI green, CI-built artifacts only, smoke checklist on Windows NSIS and Ubuntu AppImage,
known-answer timestamp fixture plus a live capture → verify → export → re-verify, and an
upgrade-path test confirming the pre-migration snapshot. Human-run, ~45 minutes.

`1.0.1-beta.17` predates the gate and predates #413, so round 1 needs a fresh tag — the
gate requires artifacts built by CI from the tagged commit.

## The feedback ask

**This is the part that changed.** The July brief asked for loose all-purpose feedback:
install friction, capture reliability, real-workflow fit, crashes. That default is now
wrong, because a redesign program is queued behind round 1 (#382, 20 tickets, ADR-0009 and
ADR-0010 ratified). Layout, spacing and wording decisions are already closed; collecting
opinions on them costs the tester's attention and buys nothing.

Tester feedback is an **input** to that redesign, not a reaction to it. The ask is scoped
accordingly.

### Tell the tester: do not report

- Layout, spacing, and visual design.
- Wording and labels.
- General "this looks dated / this feels clunky" impressions.

Say why, plainly: the UI is changing substantially over the coming months, and those
decisions are already made. Nits against the current UI are work for both of you with a
known expiry date.

### Tell the tester: do report

1. **Evidence lost, mangled, or mis-described.** Anything that disappeared, came back
   different, or is described by the app as something other than what it is. This is the
   floor of #284, and it is the highest-value thing a tester can find.
2. **Sites that fail to capture.** Pages that will not capture at all, capture
   incompletely, or render wrong in the viewer — with the URL where you can share it.
3. **Workflow dead-ends.** "I wanted to do X and there was no path." Not "X is awkward" —
   *X was not possible*. These are the reports that change the redesign's model rather than
   its pixels.
4. **Whether the Certification and verify output read as true.** Read `certification.html`
   and the in-app verify results as someone who would have to defend them to a hostile
   reader. Does any of it claim more than you would be willing to stand behind?

Point 4 is deliberate. #412 audits every evidence claim across the threat model, the in-app
verify language, the standalone verifier, and export/certification output — but that is an
internal audit. A working investigator reading the same output is a check no internal audit
produces.

### Prototype walkthrough

Cheap, and worth one session: show the tester the design-handoff prototype
(branch `prototype/design-handoff-2026-08`, entry point `Birdbrain.dc.html`, which runs
standalone in a browser) beside the shipped app and ask which one matches how they work.
It needs no build. Do this in the same session as the round-1 hand-off, and treat the
answer as input to #382 rather than as feedback on the shipped build.

## Tester guide changes this brief requires

The guide (`website/content/docs/tester-guide.mdx`) is not rewritten by this brief — map
#284 holds that rewrite as unspecified until the tickets under it land. What this brief
fixes is the list of what the rewrite must say:

- The scoped feedback ask above, replacing the guide's current "What we're looking for"
  section, which still asks for install friction and general workflow impressions.
- The support commitment (#290) verbatim: ~2 business days best-effort, no SLA, weekly
  sweep, escalation path, absence announcements.
- The archive posture (#292): `.birdbrain` archives travel only via the private channel;
  live-store confidentiality relies on OS full-disk encryption.
- Corrections the guide currently gets wrong: it names `v1.0.1-beta.11` as the current
  build, says there is no auto-update, and presents the `.deb` as the preferred Ubuntu path
  rather than the AppImage.
- The data posture: synthetic or low-stakes material recommended, real data at the tester's
  own risk, with the snapshot contract and its limits stated next to it.

## Running the round

1. Pass the pre-ship gate against a freshly tagged build.
2. Update the tester guide per the list above.
3. Personal invitation per tester, with the guide link and the scoped feedback ask in the
   message itself — not only in the guide.
4. Open the shared private chat; pin the guide link, the current release link, and the
   bug-report format (version, OS, what you did, what you expected, what happened,
   screenshot, diagnostic bundle where relevant).
5. Prototype walkthrough in the hand-off session.
6. Sweep the channel into GitHub issues weekly.

## Out of scope this round

Deliberately deferred; these become gates for a public beta, not for round 1:

- Code signing and macOS notarization (#274, #92).
- Chrome Web Store listing.
- Archive encryption (#292 — filed as a post-round enhancement).
- Encrypting the live case store (ruled out of map #284 entirely, with reasons).
- Making the repository public (#262–#274, its own effort).

## Accepted risks

- Unsigned builds require a SmartScreen click-through on Windows and carry no macOS
  notarization.
- `.deb` testers can sit on stale builds: their update installs only on an explicit
  restart-to-update, so a tester who ignores the prompt stays where they are.
- Real investigation data may go in. The pre-migration snapshot is the mechanism behind
  that risk; export remains the only user-driven backup.
- Archives leaving a tester's machine are protected by the channel they travel over,
  nothing else.

## Changes from the 3 July brief

| Topic | 3 July 2026 | This brief |
| --- | --- | --- |
| Testers | ~3–10 invited | 2–3 invited (#285) |
| Linux format | `.deb` preferred, AppImage alternative | AppImage primary, `.deb` best-effort (#285) |
| Pre-ship checks | `pnpm lint`, `pnpm test`, `pnpm build` locally, then a smoke pass | The #291 gate, CI-built artifacts only, with verification and upgrade-path sections |
| Durability | "Export anything you can't lose" | Fail-closed pre-migration snapshot with restore (#286, #413), plus that advice |
| Support | Owner triages into issues | Named commitment: ~2 business days best-effort, no SLA, escalation path (#290) |
| Archives | Not addressed | No encryption; private channel only; OS full-disk encryption stated as the live-store control (#292) |
| Feedback | Loose all-purpose | Scoped: evidence, capture failures, workflow dead-ends, Certification and verify language. No UI nits |
| Updates | No auto-update | NSIS and AppImage update in place; `.deb` installs on explicit restart, with manual notification |
