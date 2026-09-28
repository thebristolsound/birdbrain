# Beta switch sequence

**Date:** 2026-09-25
**Status:** Proposed. Nothing below has started
**Owner:** Matt Donovan
**Gate:** the four triggers in [the public-beta brief](../specs/2026-09-06-public-beta-brief.md)
**Map:** [#284](https://github.com/thebristolsound/birdbrain/issues/284); sessions ticket [#1237](https://github.com/thebristolsound/birdbrain/issues/1237)

## What flipping the switch means

The releases repository is already public and so is the docs site. The switch is not a
visibility change. It is a new tag published as a labelled public beta with the download
page in front of it, and the last published build is `v1.0.1-beta.21`, dated 2026-08-19.

The brief cuts the beta when, in order: the exhibit chain lands, a CI-built candidate
passes gate v1, both observed sessions run on that candidate with no finding that touches
the floor, and the download page and release-notes preamble are in place.

The floor is one class of failure: Birdbrain must not silently lose, corrupt, or
mis-attest evidence. Everything else ships rough, on purpose.

## Where each trigger stands

Read on 2026-09-25 against `origin/main` at `6849b833`.

| Trigger | State | What that rests on |
| --- | --- | --- |
| 1. Exhibit chain lands | Met | [#1156](https://github.com/thebristolsound/birdbrain/issues/1156), the chain's remainder, is closed |
| 2. CI-built candidate passes gate v1 | Not started | No tag since `v1.0.1-beta.21`; `package.json` still reads `1.0.1-beta.21` |
| 3. Two observed sessions, no floor finding | Not started | [#1237](https://github.com/thebristolsound/birdbrain/issues/1237) is open; the plan says to run it on a gated candidate |
| 4. Download page and release-notes preamble | Met in code, unverified in the world | [#1246](https://github.com/thebristolsound/birdbrain/issues/1246) and [#1247](https://github.com/thebristolsound/birdbrain/issues/1247) are closed, `website/content/docs/download.mdx` exists and `meta.json` lists it under Get started |

Triggers 2 and 3 are sequential and both need trigger 1's code to be final, so everything
that must change in the app has to land before the candidate is tagged. That is stage 0.

## Stage 0: clear the floor before any tag

Six items. The first three are already ruled or labelled as blockers; the last three come
out of the 2026-09-24 review sweep and are not filed yet.

| Order | Item | What it is | State on 2026-09-25 | Action |
| --- | --- | --- | --- | --- |
| 0.1 | [#1313](https://github.com/thebristolsound/birdbrain/issues/1313) | Deleting the active case leaves recording pointed at the deleted case, so every capture insert fails | Open, `queued`, `ready-for-agent`; ruled `block` in [the floor handoff](2026-09-20-beta-floor-handoff.md) | Dispatch, then human review |
| 0.2 | [#1276](https://github.com/thebristolsound/birdbrain/issues/1276) | The getting-started panel promises that browsing saves pages, which a hotfix turned off, so a first-run tester captures nothing | Open, `queued`, `ready-for-agent`; ruled `block` | Dispatch, then human review |
| 0.3 | [#1169](https://github.com/thebristolsound/birdbrain/issues/1169) | Timestamping has no opt-out, so every capture discloses its digest to the authority | Open, labelled `blocker`; the fix is draft PR [#1593](https://github.com/thebristolsound/birdbrain/pull/1593) | Review the draft; evidence-affecting, so human review and no auto-merge |
| 0.4 | Not filed | The export panel opens with the keyboard on the checked evidence preset, and one arrow key switches the export to a working copy with no manifest and no certification | Live on main: native radios sharing one name at `ExportDialog.tsx:293-310`, focus placed by `dialog.tsx:125` | File, fix, human review. An export silently becoming non-evidentiary is the floor |
| 0.5 | Not filed | A capture named inside a note's own text is a link the selection rule never checks, so the note ships and prints a left-out page's name | Live on main: `noteTravelsWithSelection` at `export.ts:339-348` checks the note's capture and its anchor only | File, fix, human review. Disclosure of an excluded exhibit is the floor |
| 0.6 | Not filed | Notes now carry embedded pictures but the archive compatibility number was not raised, so an archive from this build fails on an older copy and abandons the whole import | Live on main: `CASE_ARCHIVE_SCHEMA_VERSION = 6` at `caseArchive.ts:95` | File and fix. Gate v1 section 5 is the upgrade path, and this breaks it in the other direction |

Items 0.4 to 0.6 come from three different pull requests, so filing one each stays inside
the two-per-pull-request cap. The fourth sweep finding is off the floor: settings carries two Vacuum buttons and two
rebuild buttons that report freed space in different units. Record it and leave it for after
the cut.

Stage 0 ends when all six are on `main` and `pnpm preflight` is green there.

## Stage 1: confirm the beta's own claims are true

Cheap, and it has to happen before a tester reads any of it.

1. Load the published download page and check every claim it makes still holds: the
   platform table, the link to the releases repository rather than to individual files, the
   SmartScreen and FUSE notes, the extension load steps, the `.deb` caveat, the feedback
   ask, and the source-opening line.
2. Read the tester guide for leftovers from the invited round: the private channel, the
   lapse dates, and the instruction to ask in the tester chat.
3. Check the preamble `release.yml` composes: what beta means here, unsigned installers and
   how to get past the click-through, where advisories appear, source opening when the
   readiness effort closes, and macOS as not published and unsupported.

## Stage 2: tag a candidate and run gate v1

1. Bump `package.json` from `1.0.1-beta.21`, commit, and push the `v*` tag. `release.yml`
   fires on the tag; there is no version script.
2. Wait for `release.yml` to finish green and confirm the release carries the Windows
   `.exe`, the Linux AppImage and `.deb`, the `latest*.yml` manifests, and the extension zip.
3. Run [gate v1](2026-08-15-pre-ship-validation-gate.md) against that tag, all five
   must-pass sections: CI and Security green on the tagged commit, CI-built artifacts only,
   the smoke checklist on Windows NSIS and Ubuntu AppImage, verification, and the upgrade
   path from `v1.0.1-beta.21`.
4. Record the go or no-go block and keep it with the release.

Gate v1 needs two machines: a clean Windows VM and an Ubuntu box, with the previous beta
installed for the upgrade section. Target is 45 minutes. Any must-pass failure means fix,
re-tag, and start at section 1 again.

## Stage 3: two observed sessions

[#1237](https://github.com/thebristolsound/birdbrain/issues/1237), on the gated candidate,
never on a local build. Two testers from the invited cohort by codename only, one who has
used an evidence tool before and one who has not. Thirty minutes each, scripted, hard stop,
screen shared, with the tester installed beforehand from the tester guide.

A finding that touches the floor cancels the cut: fix it, re-tag, and run gate v1 again.
Everything else is input to the redesign and does not hold the cut.

## Stage 4: cut

Publish the release on the releases repository as a pre-release, point the download page at
it, and stop. No signing, no store listing, and no announcement channel is part of this.

## Deliberately not blockers

Naming these so they stop competing for the same attention.

- **The 27 design directions and their seven batches.** The brief rules layout, spacing, visual design, and
  wording out of scope for a tester report, because those decisions are made and the UI is
  changing. The design work is the redesign, not the cut.
- **Signing and notarization ([#274](https://github.com/thebristolsound/birdbrain/issues/274))
  and the Chrome Web Store listing ([#1248](https://github.com/thebristolsound/birdbrain/issues/1248)).**
  Both trigger at the first non-beta tag. The beta loads the extension unpacked.
- **The known-answer corpus ([#417](https://github.com/thebristolsound/birdbrain/issues/417)).**
  The brief keeps it non-blocking.
- **The dispatch token scope ([#1374](https://github.com/thebristolsound/birdbrain/issues/1374)).**
  Labelled `blocker`, but it blocks the agent pipeline, not the release.
- **Every row the floor handoff ruled `later`**, including the counsel placeholder in the
  certification, the two Linux single-instance reports, and the timestamp-entry selection
  findings whose repro needs a manifest the writer refuses to produce.
- **Opening the source.** The brief says the beta does not wait for it, and the release page
  says source opens when the readiness effort closes.

## What the maintainer has to decide

1. Whether to file the three stage 0 defects that are not yet filed now, and whether to fix all
   three before the tag or only the two that affect an export.
2. Which two testers, and when they can sit for thirty minutes each.
3. When a clean Windows VM and an Ubuntu box are both available for the 45-minute gate run.
