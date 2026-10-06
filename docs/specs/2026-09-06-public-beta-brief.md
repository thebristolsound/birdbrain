# Public beta - round 1 brief

**Date:** 2026-09-06
**Status:** Approved - grilled in two chat rounds on 2026-09-06, every recommendation taken
**Owner:** Matt Donovan
**Supersedes:** `docs/archive/2026-08-15-tester-rollout-brief.md`
**Map:** [#284](https://github.com/thebristolsound/birdbrain/issues/284); sessions ticket [#1237](https://github.com/thebristolsound/birdbrain/issues/1237)

## Why this replaces the August brief

The August brief designed an invited round: six codenamed testers, three invitation waves,
day-7 and day-14 lapse triggers, backfill by perspective, and a private channel with a
two-business-day support target. That round did not run. The testers have jobs, the ask
was open-ended, and unpaid open-ended testing cannot be demanded of anyone.

Two things the round was meant to buy are covered without it. Every supported platform
installs and launches, proven by the pre-ship gate and now by machine on the CI artifact
(`scripts/package-smoke.mjs` in `release.yml`). Evidence integrity is proven by the
verifier, the known-answer fixtures, and the evidence gate, none of which a tester
exercises by clicking. What only a person can show is where a working investigator
hesitates and what they believe the tool has proved, and two watched half hours give that.

So the round-1 handoff is a **labelled public beta on the releases repository**, the invited
component shrinks to **two observed, scripted sessions**
(`docs/plans/2026-09-05-observed-tester-sessions.md`), and the public is the beta pool.
People who want an open-source Hunchly alternative test it because they want it.

## Destination

Unchanged from map #284: the first outside investigator can safely run Birdbrain on a
real case. The floor is one class of failure. **Birdbrain must not silently lose, corrupt,
or mis-attest evidence.** Everything else ships rough, on purpose.

The destination's second half, that the maintainer can support them through it, now
reads two ways. The two observed testers keep the August support commitment in full.
The public gets the issue tracker on the releases repository and no response target.

## Parameters

### Testers

**Two observed testers** from the invited cohort, still referred to by **codename only** in
this repository, in issues, in commit messages, and in the private channel. The mapping
stays private with the maintainer. Never write a role, employer, or location beside a
codename. Pick one tester who has used an evidence tool before and one who has not.

The public beta has no waves, lapse triggers, or backfills. Those existed to tell silence from
satisfaction across six unobserved testers; an observed session has no silence to read.

**The public** is anyone who downloads the beta. They are not tracked, not codenamed, and
not owed a reply.

### Platforms

| Platform | Format | Status |
| --- | --- | --- |
| Windows | NSIS `.exe` | Supported; must pass the gate; unsigned, SmartScreen click-through documented |
| Ubuntu | AppImage | Supported, primary Linux format; auto-updates in place; must pass the gate |
| Ubuntu | `.deb` | Best-effort; updates only on the explicit restart-to-update action, so the download page tells `.deb` users to watch the releases page for updates and advisories |
| macOS | none | Not published and listed as unsupported. Notarization is the blocker; revisit at the signing trigger below. No builds on request, since there is no channel to ask in |

### Data

Unchanged. Real project data is tolerated, not endorsed. The download page recommends
synthetic or low-stakes material and states the pre-migration snapshot contract (#413) and
its limits beside that advice: a snapshot covers the database, not capture files; restore
overwrites with no undo; export remains the only user-driven backup.

The map's standing rule applies with more force at public scale: assume real evidence goes
in, and treat a caveat as advice rather than a control.

### Archives and confidentiality

Unchanged posture. No archive encryption ships in the beta; live-store confidentiality
relies on the operating system's full-disk encryption. The August rule that `.birdbrain`
archives travel only over the private channel now applies to the two observed testers. The
public is told plainly that there is no channel for sending an archive to the maintainer,
and that a bug report never needs one: the diagnostic bundle excludes captures and the
database by construction.

### Support

- **The two observed testers:** the August commitment, verbatim. Ordinary bugs acknowledged
  best-effort with a target of about two business days, no SLA, one private channel,
  absence announced there.
- **The public:** issues on `thebristolsound/birdbrain-releases`, which is public and has
  issues enabled. No response target is stated. Reports are swept into the private tracker
  about weekly, as before.
- **Escalation for an evidence-integrity failure.** If a report implies that captures
  already taken are not what Birdbrain claimed, the disclosure is a pinned issue on the
  releases repository plus a patched release through the updater, which reaches every NSIS
  and AppImage install. The download page says that is where advisories appear, and that
  `.deb` users have to look. This replaces the August rule to notify every tester in-channel, which
  has no public equivalent.

### Pre-ship gate

Gate v1 is unchanged for the public build:
[`docs/plans/2026-08-15-pre-ship-validation-gate.md`](../plans/2026-08-15-pre-ship-validation-gate.md).
CI green, CI-built artifacts only, the smoke checklist on Windows NSIS and Ubuntu AppImage
(its first step now also run by machine before upload), the verifier against the
timestamp fixture plus a live capture, verify, export, re-verify pass, and the upgrade-path
test. #417's known-answer corpus stays non-blocking. The floor does not move because the
audience grew, and adding steps now is the perfectionism the map warns against.

### Naming

The label stays **beta**. The product already says so at `1.0.1-beta.21`, and renaming to
alpha touches `releaseChannel` sniffing and the prerelease rule in `release.yml` to change
one word. The release notes define the word instead: the floor holds, and everything else
is rough and changing. An alpha label on a tool that asks people to put evidence in it reads
as a warning to stay away.

### Triggers, not dates

The beta cuts when, in order:

1. The exhibit chain lands. #284 already waits on it, and a session or a beta on the old
   capture and export flow spends its one first impression on screens that will not ship.
2. A CI-built candidate passes the gate.
3. Both observed sessions run on that candidate with no finding that touches the floor.
   **A floor finding cancels the cut.**
4. The download page and the public release-notes preamble are in place.

No target date. The date is the part of this plan that has been superseded twice; the chain
has not.

Three later triggers, recorded on the map so they stop being fog:

- **Signing and notarization (#274):** at the first non-beta tag.
- **Chrome Web Store listing (#1248):** the same trigger. The beta loads the extension unpacked in
  developer mode; the people who will try a beta of an evidence tool can load an unpacked
  extension, and the ones who cannot are not the beta audience.
- **Source opens** when the public-readiness effort (#262 to #274) closes. The beta does
  not wait for it, and the release page says "source opens when that effort closes" rather
  than leaving the claim "open source" unexplained beside a private repository.

## The feedback ask

Unchanged from August, and now printed on the download page and in the release notes
rather than sent in an invitation.

**Do not report:** layout, spacing, visual design, wording, labels, or a general sense that it feels dated.
The UI is changing substantially and those decisions are made.

**Do report:**

1. Evidence lost, mangled, or mis-described. Anything that disappeared, came back
   different, or is described by the app as something other than what it is. This is the
   floor, and the highest-value report there is.
2. Sites that fail to capture, capture incompletely, or render wrong in the viewer, with the
   URL where it can be shared.
3. Workflow dead-ends, where the tester wanted to do something and there was no path. Awkward is not a dead-end.
4. Whether the certification and verify output read as true to someone who would have to
   defend them to a hostile reader.

## Docs site changes this brief requires

The docs site (`website/`, published on GitHub Pages) is the landing page for the beta, not
just the instructions behind it. It is already public, and one URL for everything is worth
more than a second one.

- **A download page** under Get started (#1246): the platform table above, a link to the latest
  release page on the releases repository rather than to individual files (asset names
  carry the version, so per-file "latest" links do not exist), the SmartScreen and FUSE
  notes, the extension load steps, where advisories appear, the `.deb` caveat, the feedback
  ask, and the source-opening line.
- **The tester guide rewritten as install-and-first-capture** (#1246). Remove the private channel,
  the lapse dates, the instruction to ask in the tester chat, and every other invited-round instruction. Keep
  the install steps, the extension load, the first capture, updating, known limitations,
  and reporting a problem, pointed at the releases repository.
- **The release notes** composed by `release.yml` (#1247) keep their generated platform table and
  gain a preamble: what beta means here, that installers are unsigned and how to get past
  the click-through, where advisories appear, and that source opens when the readiness
  effort closes. The macOS line becomes not published and unsupported.

## Out of scope this beta

Deferred to the triggers above or ruled out on the map:

- Code signing and macOS notarization (#274, #92): first non-beta tag.
- Chrome Web Store listing (#1248): first non-beta tag.
- Making the repository public (#262 to #274): its own effort; the beta does not wait.
- Archive encryption (#292, filed as a post-round enhancement).
- Encrypting the live case store (ruled out of map #284 entirely, with reasons).
- macOS as a supported platform.

## Accepted risks

- Unsigned installers at public scale. The SmartScreen click-through is documented, and
  the people it turns away were not going to run a beta.
- Strangers will put real evidence in. The floor, the gate, and the snapshot contract are
  the controls; the download page's advice is not one.
- The only disclosure path to the public is a pinned issue and a patched release. A user
  who never updates and never reads the releases page is not reached.
- "Open-source Hunchly alternative" with a private repository during the beta. Mitigated by
  saying so on the page with the trigger, not by hiding it.
- `.deb` users can sit on stale builds.

## Changes from the 15 August brief

| Topic | August 15, 2026 | This brief |
| --- | --- | --- |
| The round | Six invited testers in waves | Public beta on the releases repository; two observed sessions are the invited component |
| Tracking | Lapse triggers, backfill by perspective, build provenance per codename | None; sessions are observed |
| Support | Private channel, about two business days, for all testers | The same for the two observed testers; public issues on the releases repository with no target |
| Escalation | Notify every tester in-channel | Pinned issue on the releases repository plus a patched release via the updater |
| Naming | Undecided fog item | Beta, defined in the release notes |
| Signing | Deferred, trigger "public release" | Deferred, trigger "first non-beta tag" |
| Web Store | Out of scope | Same trigger as signing |
| Source | Separate effort | Separate effort; "source opens when it closes" stated on the page |
| macOS | Builds on request via the tester chat | Not published, unsupported |
| Tester guide | Rewrite unspecified until tickets land | Specified: install-and-first-capture plus a download page on the docs site |
| Schedule | Steps | Triggers only, sessions gate the cut |
