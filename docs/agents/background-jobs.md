# Background jobs

Rules for unattended agent jobs working a `ready-for-agent` issue, moved here from `CLAUDE.md`.
The implementer definition (`.claude/agents/birdbrain-implementer.md`) and the `dispatch` skill
apply them; interactive sessions read this page when they open or label an agent PR.

## The carve-out

Unattended/background agent jobs working a `ready-for-agent` issue in this repo are opted out
of the global wait-for-confirmation rules: do not pause for mid-task approval and do not wait
for the user to confirm completion. Instead, commit and verify the work with `pnpm preflight`
(it refuses a dirty tree and a non-24.x Node, runs lint, typecheck, unit tests, build, the
extension build when `extension/` changed, coverage thresholds and diff coverage, and writes a
sha-stamped block to `.preflight/verification.md`), then finish by opening a **draft PR** with
the standard attribution line. Exception: if a dispatcher
spawned you, push the branch and hand off instead. PR opening stays with the dispatcher so
one identity authors every PR entering the slot (ADR-0027).

Interactive sessions are not covered by this carve-out, and it must not be copied to the global
CLAUDE.md or other repos.

## Labels

**Label it, or the gates cannot see it.** `agent-authored` always, `agent-pr` as well only if
the PR takes a dispatch slot, `evidence-affecting` when the gate fired at the **blocking** tier
(the path list is tiered since ADR-0014; an advisory-tier hit is not a label).
`pre-pass-gate.yml` and `ci.yml`'s draft exemption both key on those labels, so an unlabelled
agent PR reports `agent/pre-pass success — "Not an agent PR"` and no reviewer is ever waiting
on it. Wave 1 batch 1 shipped five such PRs, four evidence-affecting, and a hand-run pre-pass
found twelve blocking defects behind the green badges. `gh pr create --label` is not atomic,
so verify with `gh api repos/{owner}/{repo}/issues/<n>/labels` rather than asserting it.

## Coverage

The coverage steps are the ones that catch what the others cannot. CI's job named `test` runs
the suite *and then* `scripts/diff-coverage.mjs`, which fails the PR below 90% of changed lines
covered, a threshold `pnpm test` never evaluates, since it omits `--coverage`. Without them
the loop reports green on a PR CI rejects, and the red arrives after the agent has claimed
success. `coverage:diff` scores the **working tree** against the merge base, which is why
preflight insists on a clean tree: there the score equals the committed diff CI measures
(#508).

## PR bodies

**PR bodies are computed at head (ADR-0018).** The `## Verification` block is the
`.preflight/verification.md` that `pnpm preflight` wrote at the head sha under review, pasted
verbatim and never committed; any push makes it stale and it gets regenerated before
requesting review. Any body figure a command can compute (file lists, counts,
coverage rows) comes from running the command at head, never from memory of an earlier run. When
a review round's only blocking findings are body defects on an unchanged sha, fix and re-verify
the body in the same round with no new code pass.

## Gates

The gates in `docs/adr/0005-unattended-agents-on-the-evidence-path.md` still apply, as amended by
`docs/adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md`: WIP of one agent PR
(ADR-0028) with every branch cut from `main` and never from another cycle's branch,
`evidence-affecting` PRs never auto-merge and always get human review, non-evidence agent PRs may
merge on all required checks green plus an `agent/pre-pass` success verdict, and the give-up path
(comment findings on the issue, relabel `needs-info`/`ready-for-human`, vacate the slot) whenever
the issue fails the ready-for-agent bar at intake or mid-work.

## Interactive sessions on an agent PR

Scheduled Dispatch works the PRs that hold its two slots every hour, so an interactive session
that runs a reviewer pre-pass or a fix round on an `agent-pr` PR takes the same cycle claim a
dispatcher does. Follow section 2 of `.claude/skills/dispatch/SKILL.md`: read the linked issue for
a live claim, post `Cycle claim: PR #<pr>` on it through `agh`, settle, and post
`Cycle release: PR #<pr>` when the round ends. Without the claim, a dispatcher fire can start a
second reviewer on the same head: run 37235446754 (2026-10-04) found #1721 with a pending
pre-pass status posted 27 seconds before the run was created, and its pre-gate started the cycle
anyway, because a pending status is not a claim.

## The review fleet

`.github/workflows/review-fleet.yml` reads every non-draft PR the maintainer or the machine
account opens from this repository, on each push (ADR-0057). Four Claude passes (correctness,
claims, contract, tests) and Codex review the head, Codex rules on Claude's blocking findings,
and a fifth Claude pass rules on Codex's. `.github/scripts/review-fleet/fleet.mjs` decides the
`review/fleet` status from the rulings, and `merge-gate` requires it at head. The machine account
keeps one state comment per head with the findings and rulings.

- **Red** means a blocking finding the other family confirmed, a pass that did not finish, Codex
  not answering within the timeout, a finding Codex did not rule on, or a blocking Codex finding
  the Claude check ruled unclear. Push a fix, or apply `break-glass` to merge over it. The
  override also needs its dedicated workflow-token stamp on the exact head. The stamp lands a
  few seconds after the label, so a `merge-gate` run the same label event started can read the
  head first and go red. The fleet re-runs red `merge-gate` runs when it posts the override
  status; re-run the check by hand if it stays red.
- **Pending** means a pass is running, Codex has not answered yet, or the daily cap is holding
  the head. A sweep every 15 minutes times out what Codex never answered and restarts work whose
  event was dropped.
- **Source completion** requires every assigned source check and input under ADR-0057. New
  outputs use contract version 2, `source_review_complete`, and `not_checked` for unfinished
  source work. Missing issues or referenced review text fail before the paid call. Every
  `https://github.com/` issue or pull request link and every `comment <number>` pointer of
  eight or more digits in the description, and in each source fetched from it, counts as
  referenced review text. A pointer is read as an issue comment first, and as an inline review
  comment when that read is a 404. A comment link copied from the Files changed view
  (`/files#r<id>`) reads as that inline comment. A link to another repository fails, because
  the pass reads only this one, and so do a link whose fragment ADR-0057 defines as malformed
  and a linked issue, comment or review with an empty body. An
  unfinished caller, race, fixture or count trace still fails; do not call it a runtime limit.
- **History and stack inputs** come as files, because the passes have no git (ADR-0057,
  decision 5): `commits.json` with a patch per commit, `stack.json`, `base-tree/` with every
  file as it stood at the merge base with `main`, and, for a pull request whose base branch is
  not `main`, `diff-base.patch`, which is that pull request's review scope. A review of that
  narrower scope posts a success that begins `stacked change only:`, which `merge-gate` does
  not count. Once the base is `main`, the next plan run or sweep either confirms that `main`
  holds everything below the change and posts a plain success, or starts a review of the whole
  diff.
  A bare `#<n>` in the description is read as this repository's issue or pull request. Each
  issue or pull request among the sources brings the conversation comments the maintainer or
  the machine account wrote on it, so a ruling posted as a comment is read when the description
  names its issue. Past 60 sources, 200 such comments, 1 MiB of sources, 300 commits or 512 MiB
  in one tree, the pass fails before the paid call and names the limit.
- **Runtime limitations** appear separately in the saved record and public report. Tests,
  builds, CI reads and external/editor observations the reviewer did not perform remain
  unverified. Fleet success does not certify them or waive required CI checks. Never clear or
  reinterpret an older mixed unchecked list. Old records require a fresh source review.
- **Retry** a head by deleting its state comment. The next plan claims the head as new, counts
  it against the daily cap, runs the passes again and posts a new relay. The earlier relay and
  Codex's rulings on it no longer count.
- **Controls** are repository variables, changed with `gh variable set <name> --body <value>`:
  `REVIEW_FLEET_ENABLED=false` stops the fleet and lifts the `merge-gate` requirement,
  `REVIEW_FLEET_DAILY_CAP` sets the heads reviewed per 24 hours (default 40), and
  `REVIEW_FLEET_CODEX_TIMEOUT_MINUTES` sets how long Codex has (default 45).

The relay comment that asks Codex is posted with the maintainer's token, `CODEX_RELAY_TOKEN` in
the `codex-relay` environment, because Codex answers only an account connected to it. It carries
a `review-fleet:relay` marker, and dispatch does not count it, or the state comment, as activity.

## The on-request PR review

`.github/workflows/pr-review.yml` reviews a PR the maintainer opened when he applies
`review:requested` (ADR-0046); since ADR-0057 it has no schedule. The machine account posts the
verdict as a comment and sets one `review:` state label: `passed`, `changes`, `stale` after a
later push, `failed`, or `skipped`. It never pushes, merges, or writes a status the merge gate
reads. The post step removes the request label.

## Jev shadow lenses

Two Jev shadow lenses run event-driven from `.github/workflows/jev-lens.yml` (ADR-0031): `lens:*`
issue labels and the `jev/evidence-hunks` commit status are advisory, never gate, and are never read by
dispatch. `scripts/jev-lens/score.mjs` measures them.

## Reviewer pre-pass outcomes

`node scripts/review-outcomes.mjs [--since YYYY-MM-DD] [--by-month] [--json] [--repo owner/name]`
reads every agent PR's pre-pass verdicts, in the shapes the pre-pass has used most, and the
replies posted to them as PR comments. A verdict or reply in an older shape it does not read is
not counted. It prints rounds per PR, findings by severity, and one outcome per
finding: fixed (applied, and a later round reviewed it), applied (no later round), disputed,
deferred to an issue, overridden (merged while the last verdict requested changes), or no reply,
with each disputed or deferred reason. `--by-month` adds a row per month the PRs were opened, and
`--json` prints the same figures as JSON. Run it before changing `birdbrain-reviewer` or its model,
and again after, to see whether the change made review noisier or slower to converge. The script
joins a reply to its finding by the keyed shape the dispatch skill describes, or by a numbered
line; it counts a bare `Applied.` without joining it to any finding, and it never reads
replies in inline review threads, which answer other reviewers.
