# Handoff: Shared Cases close-out

**Status:** active

The handoff file for the run that finishes the Shared Cases programme under the delivery
roadmap (`docs/plans/2026-10-23-delivery-roadmap.md`, "Current programme: Shared Cases"). The
roadmap defines Done: an Operator can reach Shared Cases in a packaged build, the docs are
published, and the tracking issue (#1508) is closed. This file is committed on the
`drafts/2026-10-26-shared-cases-closeout-handoff` branch after each slice and lands on `main`
with the housekeeping slice.

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
| 1. Members UI entry points (#1514) | `feat/1514-members-entry-points` | PR #1972 at `8d09ea22`: ready, pre-pass approve, preflight and all CI green including the merge gate; waits for the maintainer's merge |
| 2. Docs (#1883) | `docs/1883-shared-cases-docs` | PR #1973 at `806a9024`: ready, pre-pass approve, preflight green; merge gate waits for the maintainer's approving review; merges after #1972 |
| 3. Housekeeping (#1508 checklist, plan statuses, roadmap) | not cut | waits for slices 1 and 2 to merge |
| Close-out sync | maintainer | steps below; waits for slices 1 and 2 |
| Release | maintainer | notes drafted below; waits for the sync |

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

Maintainer: merge #1972, then approve and merge #1973. Then the agent cuts the housekeeping
branch from the new `main`:

```sh
git -C /home/matt/worktrees/birdbrain/feat-1514-members-entry-points fetch origin && git -C /home/matt/worktrees/birdbrain/feat-1514-members-entry-points log --oneline -3 origin/main
```

## Close-out sync: steps for the maintainer

Run once slices 1 and 2 are on `main`. Two machines on two different networks (for example
home broadband and a phone's mobile data), each Windows, Linux, or an Apple silicon Mac.

1. Build or download the same packaged build from `main` on both machines (a beta tag, or
   `pnpm package` for the platform). Set **Settings → Operator → Operator name** on each.
2. Machine A (Owner): create a Case with **Start New Case → Blank Case** and capture one page.
3. Machine A: on the dashboard, open the Case card's menu, choose **Members**, click
   **Invite**, then **Copy invite**. Send the string to B over Signal or email.
4. Machine B: **Start New Case → Join a shared Case**, paste the invite, check the **From**
   name, click **Join**.
5. Machine A: compare B's key fingerprint with B over the phone, enter a Member Code, click
   **Approve**.
6. Expect on B: the Case opens and A's capture arrives with A's code chip. Expect on A: the
   top bar shows the sync pill reading `Synced · 1 peer`.
7. Machine B: capture a page. Expect it on A within a minute or after **Sync now**.
8. Either machine: **Data → Manifest Ledger** shows `member-add` and `merge` rows with Actor
   chips.
9. Machine B: export an evidence package and run its `verify.sh`. Expect a pass, with a line
   for each member chain.
10. Machine A: **Revoke** B. Expect B's row to read revoked and sync with B to stop.

Report back: the build version, both platforms, whether steps 6 to 10 matched, any relay
banner, and the `verify.sh` summary line.

## Release notes draft

To prepend to the beta release body (`gh release edit <tag> --notes-file`), before the mirror
job copies the body, or on both repositories afterwards.

```markdown
## Shared Cases

You can now share a Case with teammates; it is designed for teams of two to five. Every
member keeps a full copy, no server
holds the Case, and each member's captures stay signed by their own installation. Open a Case
card's menu on the dashboard and choose **Members** to invite someone; a teammate joins from
**Start New Case → Join a shared Case**. Sharing is not available on Intel Macs.

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
