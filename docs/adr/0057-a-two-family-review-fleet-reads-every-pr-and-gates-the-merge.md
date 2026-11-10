# A two-family review fleet reads every PR and gates the merge

**Status:** Accepted

**Date:** 2026-11-09

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
   credential, and may read files and run read-only git commands, nothing else.
3. **Codex finds, and checks Claude.** A relay comment asks `@codex review` at the head and
   lists Claude's blocking findings, asking for one `F<n>: CONFIRMED` or `F<n>: REFUTED` line
   each. Codex's inline findings at the head, with their P0 to P3 badges, are its findings.
4. **Claude checks Codex.** When Codex answers, a fifth Claude pass rules on each Codex finding:
   confirmed, refuted or unclear.
5. **The script decides.** `review/fleet` is `failure` on a blocking finding the other family
   confirmed (Claude's `BLOCKING`, Codex's P0 and P1), and, because missing input fails, on a
   pass that did not finish, Codex not answering within the timeout, or a relayed finding Codex
   did not rule on. It is `success` otherwise. `merge-gate` requires it at head on every PR the
   fleet covers. The maintainer's `break-glass` label stands in for it, in the fleet and in
   `merge-gate`, and for nothing else.
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
- One push costs four Claude passes, a Codex review, and one more Claude pass when Codex finds
  anything. At the October rate of about 2.4 qualifying PRs a day plus agent PRs and their fix
  rounds, the default cap of 40 heads a day is not the limit on a normal day.
- Retire the fleet, move the GPT check to an API key, or restore a hard cap by amending this
  record.
