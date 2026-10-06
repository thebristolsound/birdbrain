# Background jobs

Rules for unattended agent jobs working a `ready-for-agent` issue, moved here from `CLAUDE.md`.
The implementer definition (`.claude/agents/birdbrain-implementer.md`) and the `dispatch` skill
apply them; interactive sessions read this page when they open or label an agent PR.

## The carve-out

Unattended/background agent jobs working a `ready-for-agent` issue in this repo are opted out
of the global wait-for-confirmation rules: do not pause for mid-task approval and do not wait
for the user to confirm completion. Instead, commit and verify the work with `pnpm preflight`
(it refuses a dirty tree and a non-20.x Node, runs lint, typecheck, unit tests, build, the
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

Scheduled Dispatch works the PR that holds the slot every four hours, so an interactive session
that runs a reviewer pre-pass or a fix round on an `agent-pr` PR takes the same cycle claim a
dispatcher does. Follow section 2 of `.claude/skills/dispatch/SKILL.md`: read the linked issue for
a live claim, post `Cycle claim: PR #<pr>` on it through `agh`, settle, and post
`Cycle release: PR #<pr>` when the round ends. Without the claim, a dispatcher fire can start a
second reviewer on the same head. On 2026-10-05 only the timing of the session's pending status
kept run 37235446754 off #1721.

## Jev shadow lenses

Two Jev shadow lenses run event-driven from `.github/workflows/jev-lens.yml` (ADR-0031): `lens:*`
issue labels and the `jev/evidence-hunks` commit status are advisory, never gate, and are never read by
dispatch. `scripts/jev-lens/score.mjs` measures them.
