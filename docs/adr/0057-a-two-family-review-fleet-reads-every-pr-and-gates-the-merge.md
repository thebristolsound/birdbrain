# A two-family review fleet reads every PR and gates the merge

**Status:** Accepted

**Date:** 2026-11-10

Amends [ADR-0046](0046-scheduled-review-of-maintainer-prs.md), whose hourly schedule this
replaces, and [ADR-0041](0041-merges-are-requested-by-label.md), whose merge rule gains a
requirement. Supersedes
[ADR-0056](0056-cross-model-review-is-advisory-and-runs-on-the-maintainers-machine.md). New
automation under [ADR-0029](0029-measure-before-expanding-agent-automation.md): the maintainer
authorized it on 2026-11-09, chose its shape, and set its spend limit (decision 6).

## Context

On 2026-11-09 the scheduled PR review had been holding at its cap of 4 reviews a day for hours,
and the maintainer asked for every PR to get adversarial reviews from two model families that
check each other's work, as the carson-agents repository does, without running anything on his
machine. The review benchmark behind ADR-0056 had already shown the two families catch
different defects: of 19 blocking defects that shipped, Claude Opus 5.5 caught 6 and
`gpt-6.1-sol` 8, only 3 of them the same.

Three facts shaped the design:

- **The GPT side cannot run in Actions on the ChatGPT plan.** OpenAI's guide to ChatGPT sign-in
  in CI says not to use it for public repositories, and it needs a persistent self-hosted runner.
  An API key bills per token outside the plan.
- **Codex's GitHub reviewer already runs on the plan, in OpenAI's cloud.** It reviews this
  repository's PRs, follows the "Code Review Rules" in `AGENTS.md`, and answers `@codex review`.
  It takes no structured input and sets no status a gate can read.
- **Codex answers only an account connected to Codex.** A spike on 2026-11-10 posted
  `@codex review` from the machine account on #2145. Codex replied within seconds with "To use
  Codex here, create a Codex account and connect to github", and reviewed nothing.

## Decision

`.github/workflows/review-fleet.yml` and `.github/scripts/review-fleet/fleet.mjs`.

1. **Scope.** Every open, non-draft PR the maintainer or the machine account opens from this
   repository, on open, ready-for-review and every push. A fork's head never runs next to the
   paid credentials, and Dependabot's events carry none.
2. **Claude finds.** Four passes run in parallel at `claude-opus-5-5` and `high` effort, each
   returning JSON checked against a schema: correctness, claims against code, contract and
   repository rules, and tests that cannot fail. Each runs in the PR's checkout with only user
   settings loaded, so a PR's own `.claude/` settings and hooks never load next to the
   credential, and may read, grep and glob files, nothing else. It gets no shell, because even
   `git diff --no-index` can print the job's credentials; the diff, commits and linked issue
   come in as files.
3. **Codex finds, and checks Claude.** A relay comment asks `@codex review` at the head and
   lists Claude's blocking findings, asking for one `F<n>: CONFIRMED` or `F<n>: REFUTED` line
   each. Codex's inline findings at the head, with their P0 to P3 badges, are its findings.
4. **Claude checks Codex.** When Codex answers, a fifth Claude pass rules on each Codex finding:
   confirmed, refuted or unclear. The plan job writes the pass's start time and attempt count
   into the state comment before the pass runs. A pass that records no result within 180
   minutes fails the status and is not started again, and the check starts at most 3 times at
   one head.
5. **The script decides.** `review/fleet` is `failure` on a blocking finding the other family
   confirmed (Claude's `BLOCKING`, Codex's P0 and P1), and, because missing input fails, on a
   pass that did not finish or listed work it did not check, a relay never posted, Codex not
   answering within the timeout, a relayed finding Codex did not rule on, a Codex finding the
   Claude check left unruled, or a P0 or P1 Codex finding the Claude check ruled unclear: an
   undecided finding was not checked, so it is never counted as refuted. Rulings count only
   from Codex text tied to the head. It is `success` otherwise. `merge-gate` requires it at
   head on every PR the fleet covers, and the fleet re-runs red `merge-gate` runs when the
   status turns green. The maintainer's `break-glass` label stands in for it, in the fleet and
   in `merge-gate`, and for nothing else: the fleet's override status says so, and `merge-gate`
   accepts it only while the label stands.
   The override covers the commit it was applied on: `merge-on-label.yml` removes the label on
   every push, as it removes `merge` and `approved`, so a later commit needs its own review or
   its own override.
6. **Spend.** Claude runs on the existing `CLAUDE_CODE_OAUTH_TOKEN` and Codex on the
   maintainer's ChatGPT plan; nothing bills per token. The maintainer asked for no hard cap for
   now, controllable without a PR. The limits are repository variables: `REVIEW_FLEET_ENABLED`
   (`false` stops every job before a paid step, and `merge-gate` then stops requiring the
   status), `REVIEW_FLEET_DAILY_CAP` (heads reviewed in 24 hours, default 40, counted from the
   fleet's own state comments), and `REVIEW_FLEET_CODEX_TIMEOUT_MINUTES` (default 45).
7. **The relay token.** The relay is posted with a fine-grained token for the maintainer's
   account, `CODEX_RELAY_TOKEN`, the only credential Codex answers. It lives in its own
   environment, `codex-relay`, deployable from `main` only. The one job that reads it checks
   out `main`, runs no model and no PR code, and posts one comment the script composed and
   passed through the credential redactor.
8. **The hourly PR review stops.** `pr-review.yml` keeps its `review:requested` label path and
   loses its schedule. The local `cross-model-review` job of ADR-0056 is removed.

9. **The spend guard names more actors here.** The #1310 ruling admits a secret-reading job only
   when the maintainer starts its attempt, or on a schedule's first attempt. The fleet starts on
   events other accounts cause, so on 2026-11-10 the maintainer amended the ruling for
   `review-fleet.yml` only: each of its secret-reading jobs names, as its own condition, the
   maintainer, the machine account, Codex's app (`chatgpt-codex-connector[bot]`) and the
   workflow token that the sweep's manual runs come from (`github-actions[bot]`). The sweep
   keeps the schedule's first-attempt rule. A re-run by anyone else runs nothing paid.
   `tests/spendGuardWorkflows.test.ts` holds the named list, and holds the relay token to the
   relay job and its `codex-relay` environment.

## Consequences

- The relay token can do more than post comments. A fine-grained token that comments on PRs can
  also label them, and `merge`, `approved` and `break-glass` are all the maintainer's labels, so
  a leaked token defeats the ADR-0041 gate. The maintainer chose this over an OpenAI API key and
  over dropping the GPT check of Claude. Scope the token to this repository, give it the
  shortest expiry the maintainer will renew, and revoke it at any sign of misuse.
- Relay comments appear under the maintainer's name. They carry a `review-fleet:relay` marker,
  and dispatch leaves them, and the fleet's own state comments, out of the activity that wakes
  a cycle.
- A merge now waits on Codex. When Codex is slow or down, PRs stay red until it answers, the
  timeout fails the status, or the maintainer applies `break-glass`.
- Codex's reply format cannot be enforced. An answer that rules on nothing fails closed, so
  false reds are expected until the relay's wording settles.
- A head is reviewed once. To review it again the maintainer deletes its state comment, and the
  next sweep claims the head as new and counts it against the daily cap. A relay posted before
  the new claim, and Codex's rulings on it, no longer count, because finding IDs restart with
  each review.
- One push costs four Claude passes, a Codex review, and one more Claude pass when Codex finds
  anything. At the October rate of about 2.4 qualifying PRs a day plus agent PRs and their fix
  rounds, the default cap of 40 heads a day is not the limit on a normal day.
- Retire the fleet, move the GPT check to an API key, or restore a hard cap by amending this
  record.
