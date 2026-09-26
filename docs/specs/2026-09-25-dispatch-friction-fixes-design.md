# Dispatch friction fixes

Status: Draft, 2026-09-25

This spec fixes the four most expensive friction patterns found in the dispatch cycle reports of
2026-09-07 to 2026-09-25: 252 runs, 122 completed reports, about $570 of reported cost. Each fix
is one branch cut from `main`, so the fixes can land independently.

## Evidence

| Pattern | Cost | Examples |
|---|---|---|
| Cycle ends mid-flight | 20 cycles, about $147, plus rounds redone | #1412, #1495, #1589 |
| One parked PR holds the only slot | days per stall | #1460 (2 days), #1593 |
| `main` red stalls every slot | 3 episodes, about 20 idle full cycles | #1324, #1381, #1486 |
| Pre-gate runs a full cycle on a parked PR | 41 no-op cycles, about $57 | #1460, #1593 |

## Fix 1: a headless cycle runs to its report

**Cause.** `claude -p` exits when the model ends a turn. A cycle that ends its turn to wait on a
background agent, a `Monitor`, or a background shell loses that work when the process exits.
The cleanup step then releases the claim, and the next cycle finds the round still owed.
`run.sh` treats any non-empty result text as a report, so a "Waiting on CI" message passes.

**Change, all in `.github/scripts/dispatch/run.sh`.**

1. Export `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for the `claude -p` call, and pass
   `--disallowedTools Monitor`. The variable is present in the installed binary; its effect is
   confirmed on the first supervised fire.
2. Add to the headless context: every subagent call runs in the foreground, and CI is polled
   with foreground commands of under nine minutes each, repeated until checks conclude.
3. After the call, require the section 5 report heading (`Dispatch cycle report`) in the
   result. If it is missing, resume the same session once with `--resume <session_id>`, stating
   that background work is gone and the cycle must re-read state and finish. If the resumed
   result still lacks the heading, exit non-zero so cleanup marks the state.

**Tests.** A stub `claude` on `PATH` returns a truncated result, then a full one; the script
resumes once and succeeds. A stub that stays truncated makes the script exit non-zero.

## Fix 2: a parked PR is visible to the maintainer

**Cause.** When the routine stops on a PR (the one-fix-round cap, or the convergence check), the
only signal is a comment. The design questions behind the stops waited hours to days, and one
root question on #985, asked on 2026-08-31, was still unanswered after the PR had absorbed
three rounds.

**Change.**

1. `.claude/skills/dispatch/SKILL.md`: when a cycle stops a PR for human attention, apply the
   `awaiting-maintainer` label and request the maintainer's review through the REST
   `requested_reviewers` endpoint. A cycle that resumes work on the PR removes the label.
2. `.claude/skills/dispatch/SKILL.md`, section 3 eligibility: an issue with a maintainer question
   that no later maintainer comment answers is not eligible. The give-up path applies.
3. `.claude/agents/birdbrain-implementer.md`: every sentence the diff adds to evidence-facing
   text, operator copy, or the PR body's Evidence impact section is either pinned by a test or a
   command, or cut. A behaviour is stated once, and other sites point at it.

**Out of scope, for the maintainer.** Whether a PR labelled `awaiting-maintainer` still holds
the single slot is an amendment to ADR-0028. This fix keeps it holding the slot.

## Fix 3: a red `main` stops the queue once

**Cause.** Dependabot majors merged red on `main` (vitest 5, jsdom 30, dependency-cruiser 18).
`merge.sh` gates on every check run instead of the ruleset's required set (#1331, closed
unfixed), so any non-required red blocked every auto-merge. Each red produced about a day of
full cycles re-reporting it.

**Change.**

1. `.claude/skills/merge-pr/scripts/merge.sh`: gate on the required status checks of the rules
   that apply to `main`, read from the API, instead of every check run.
2. `.github/scripts/dispatch/pregate.sh`: if a required check is failing on `main`'s head,
   decide `run=false` with the reason and the failing check names, before any per-PR work.
3. `.github/dependabot.yml`: ignore semver-major updates for `vitest`, `@vitest/*` and `jsdom`,
   beside the existing `dependency-cruiser` entry, with the same kind of reason comment.

**Out of scope, for the maintainer.** Refusing a merge whose own CI is red is a ruleset change
on GitHub, not a repository change.

## Fix 4: the pre-gate skips a parked PR

**Cause.** On a `failure` verdict, `pregate.sh` counts the pipeline's own verdict comment as new
activity, so every fire runs a full cycle against a PR that only a human can move.

**Change, in `.github/scripts/dispatch/pregate.sh`.** Skip a PR labelled `awaiting-maintainer`
unless activity from someone other than the pipeline is newer than the label event. Keep the
existing rules for unlabelled PRs. The label name moves to `lib.sh` so the skill text and the
script cannot drift.

**Depends on** fix 2 for the label. Fix 2 and fix 4 ship on one branch.

## Rollout

1. The maintainer creates the `awaiting-maintainer` label.
2. Fixes land as three branches: fix 1, fixes 2 and 4, fix 3.
3. One supervised `workflow_dispatch` fire in cycle mode confirms fix 1 before the schedule is
   relied on.
