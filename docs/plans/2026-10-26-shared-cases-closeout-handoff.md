# Handoff: Shared Cases close-out

**Status:** active

The handoff file for the run that finishes the Shared Cases programme under the delivery
roadmap (`docs/plans/2026-10-23-delivery-roadmap.md`, whose "Shipped programmes" section records
it). The roadmap defines Done: an Operator can reach Shared Cases in a packaged build, the docs
are published, and the tracking issue (#1508) is closed. This file lands on `main` with the
housekeeping slice, on `chore/1508-shared-cases-closeout`; its first commits were made on
`drafts/2026-10-26-shared-cases-closeout-handoff`.

## State read at the start (2026-10-25)

- Main at `50966b79`. PR #1965 (the members screens, no entry points), PR #1966 (#1951) and
  PR #1967 (#1955) are merged. #1951, #1955 and #1697 are closed.
- #1514 open, `ready-for-human`. #1883 open, `ready-for-agent`, `evidence-affecting`. #1508
  open.
- #1515 merged as PR #1912, and #1809 and #1810 are closed, so the docs describe receipt
  stamps as shipped.

## Slices

| Slice | Branch | State |
| --- | --- | --- |
| 1. Members UI entry points (#1514) | `feat/1514-members-entry-points` | merged as PR #1972 on 2026-10-27; #1514 closed |
| 2. Docs (#1883) | `docs/1883-shared-cases-docs` | merged as PR #1973 on 2026-10-27; #1883 closed |
| Sharing follow-ups (#2007, #2009 to #2011, #2014) | one branch per PR | merged from 2026-10-28 to 2026-10-30 (UTC): #2007 dropped the placeholder tabs from Case settings; #2009 to #2011 added the top bar's Share pill and palette row, the card's role line, Shared badge and Older Cases list, and the one-time Share card; #2014 marked sharing as early access in the pill's hover text and with a badge on the Members panel. The sync steps and notes below name these controls |
| 3. Housekeeping (#1508 checklist, plan statuses, roadmap) | `chore/1508-shared-cases-closeout` | PR #1975, brought up to date with `main` on 2026-10-31; #1514 ticked on #1508; refers to #1508 without closing it, so the issue stays open for the sync |
| Version bump | `chore/release-1.0.1-beta.24` | merged as PR #2006 on 2026-10-30 |
| Close-out sync | maintainer | still owed; steps below, on the `v1.0.1-beta.24` build |
| Release | maintainer | `v1.0.1-beta.24` published on 2026-10-30, with the notes below |

### Slice 1: entry points

- The maintainer chose the mock's start step for the Join entry (2026-10-25), over a dashboard
  button or the palette alone.
- Placements: the sync pill left of the extension pill on a Case with `sharedAt`; Members on
  the Case card's menu (assessment item 19 left it to engineering); the start step; the
  palette's Join a shared Case action.
- Reviewer pre-pass: request changes, four findings fixed (the `.bbcase` subtitle, diff
  coverage under 90%, no successful-import test, the duplicated import handler); then two
  tests the reliability probe showed could not fail were tightened. Approved at `8d09ea22`.
  The reviewer found no path on the evidence list, so the PR answers Evidence-affecting: No.

### Slice 3: housekeeping

- Nine plans read `**Status:** done` with the PR that finished them: the members table (#1571),
  export (#1626), received entries (#1879), receipt stamps (#1912), invite and roster (#1913),
  the audit baseline (#1968), unreachable rows (#1966), imported row collisions (#1967) and the
  members UI (#1972). The Shared Cases section of the briefs plan says the programme shipped
  and is Done once #1508 closes.
- The roadmap's Current programme names the capture engine first slice, and a Shipped programmes
  section records Shared Cases. That record names the beta tag and says the close-out sync is
  still owed, and #1508 stays open until the maintainer records the sync there.
- Done after #1972 and #1973 merged: the branch was brought up to date with `main`, the members
  UI plan's S7 row reads shipped, #1514 is ticked in the #1508 checklist, and the roadmap record
  names the beta tag.

### Slice 2: docs

- Threat model Shared Cases section, features limit line, tester guide section, and the
  `CONTEXT.md` terms, each checked against the code at main.
- `pnpm dlx mint broken-links` passes and the pages render under `mint dev`.
- The first pre-pass found three overstatements, now corrected: receipt stamps cover only the
  newest unstamped `merge` (every five minutes), a revoked installation cannot rejoin on a new
  invite, and no code enforces the five-member size.
- Filed #1974: the note in the Revoke dialog says a new invite lets the member back; the join is
  refused.

## Next command

Maintainer: run the close-out sync on two networks, record it on #1508, then close #1508.
The version bump, the release and the tag are done; this check exited 0 on 2026-10-31:

```sh
git ls-remote --exit-code --tags origin refs/tags/v1.0.1-beta.24
```

Two decisions stay open for the maintainer and are listed under Open questions: the Revoke
note (#1974) and the member cap.

## Close-out sync: steps for the maintainer

Run once slices 1 and 2 are on `main`. Two machines on two different networks (for example
home broadband and a phone's mobile data), each Windows, Linux, or an Apple Silicon Mac.

1. Build or download the same packaged build from `main` on both machines (a beta tag, or
   `pnpm package` for the platform). Set **Settings → Operator → Operator name** on each.
2. Machine A (Owner): create a Case with **Start New Case → Blank Case** and capture one page.
3. Machine A: in the open Case, click **Share** in the top bar (or, on the dashboard, choose
   **Share this Case…** on the Case card's menu), click **Invite**, then **Copy invite**. Send
   the string to B over Signal or email.
4. Machine B: **Start New Case → Join a shared Case**, paste the invite, check the **From**
   name, click **Join**.
5. Machine A: compare B's key fingerprint with B over the phone, enter a Member Code, click
   **Approve**.
6. Expect on B: the Case opens and A's capture arrives with A's code chip. Expect on A: the
   top bar's **Share** pill reads `Synced · 1 peer`, and the Case card on the dashboard reads
   `You own · 2 members`.
7. Machine B: capture a page. Expect it on A within a minute or after **Sync now**.
8. Either machine: **Data → Manifest Ledger** shows `member-add` and `merge` rows with Actor
   chips.
9. Machine B: export an evidence package and run its `verify.sh`. Expect a pass, with a line
   for each member chain.
10. Machine A: **Revoke** B. Expect B's row to read revoked and sync with B to stop.

Report back: the build version, both platforms, whether steps 6 to 10 matched, any relay
banner, and the `verify.sh` summary line.

## Release notes

Published on 2026-10-30 as the Shared Cases section of the `v1.0.1-beta.24` release body:

```markdown
## Shared Cases (early access)

You can now share a Case with other people who run Birdbrain. Sharing is early access, and
the **Share** button and the Members panel both say so. Every member keeps a full copy, no
server holds the Case, and each member's captures stay signed by their own installation. Open
a Case and click **Share** in the top bar to invite someone; the command palette and the Case
card's menu on the dashboard open the same screen, and a one-time card under the button points
it out. A teammate joins from **Start New Case → Join a shared Case**. Sharing is not available
on Intel Macs.

On the dashboard, each Case card says whether the Case is on this machine only or shared, and
what you are to it. An Older Cases list below the three cards lists your other Cases that are
not archived, each with the same menu.

**Upgrade together.** Every member of a Shared Case should install this version, and later
ones, at the same time. When a teammate's copy writes something an older version cannot read,
sync with that teammate pauses until the older copy is updated.

Sync connects through n0's public relays by default, and does not follow the Egress setting:
the relay and your teammates can see your network addresses.
[Install and first capture](https://docs.birdbrain.cc/docs/tester-guide#share-a-case-with-teammates)
has the steps, and the [threat model](https://docs.birdbrain.cc/docs/threat-model#shared-cases)
says what checking a Shared Case proves and what it does not.
```

## Open questions

- The design sizes a Shared Case at two to five members, the screens say up to four peers,
  and no code refuses a sixth. Enforce it, or leave it as guidance? The docs now call it a
  design size.
- #1974: correct the Revoke note, or let a revoked installation rejoin?
