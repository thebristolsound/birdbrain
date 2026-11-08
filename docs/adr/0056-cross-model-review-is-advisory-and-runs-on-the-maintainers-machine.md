# Cross-model review is advisory and runs on the maintainer's machine

**Status:** Accepted

**Date:** 2026-11-08

Extends [ADR-0029](0029-measure-before-expanding-agent-automation.md), which asks for the
maintainer's explicit authorization and a spending limit before new automation. The maintainer
authorized this job on 2026-11-08 and chose its shape and host.

## Context

The Claude pre-pass is the only model review an agent PR gets before a person reads it. On
2026-11-08 the review benchmark scored both model families on ten defects that shipped
(`scripts/bench/review/baselines/shipped-2026-11-07.md` on the benchmark branch). Of their 19
blocking defects, Claude Opus 5.5 caught 6 and `gpt-6.1-sol` 8, only 3 of them the same, so the two
together caught 11. The maintainer has a ChatGPT plan for the month and asked for an OpenAI model to
review alongside, as the carson-agents repository does: a separate read by another model family,
asked for with a label, posted as an advisory comment and status.

That repository runs its review in GitHub Actions. This one cannot do the same on the plan:
OpenAI's guide to ChatGPT sign-in in CI says not to use it for public repositories, and an API
key would bill per token outside the plan.

## Decision

`scripts/cross-model-review/cross-model-review.mjs` reads a pull request when the maintainer adds
the `cross-model-review` label, and runs on his machine from a `systemd` user timer every five
minutes.

- **Independent.** The model gets the diff, the PR description and commits, the linked issue,
  and `CLAUDE.md` from `main`, never the Claude verdict. It runs three passes (correctness,
  claims against the code, the contract) under `prompt.md`, read-only and without network, at
  `gpt-6.1-sol` and `high`.
- **Advisory.** The machine account posts one comment and a `cross-model-review` status that is
  always `success`, with the verdict in its description; the script, not the model, decides the
  verdict from the findings. Dispatch counts a failing status from the machine account as a
  failing check, so a red status would gate merges. The status is never a required check.
- **Bounded.** Only the maintainer's add of the label counts. Each head is read once per add, a
  new push is read again while the label stays, and removing and re-adding the label asks for a
  fresh read. One read runs at a time, at most twenty a day, for at most thirty minutes each. A
  fork's head is not read on this machine.
- **No credential leaves the machine.** The model can read files on the machine, so a review
  that quotes anything shaped like a token or key is not posted.

## Consequences

The review runs only while the machine is on and the plan and the machine account's token are
current; when either lapses the job reports the failure and posts nothing. On a PR whose
pre-pass passed, the pre-gate leaves the machine account's own comments out, so the review wakes
no dispatch cycle by itself; an implementer working a fix round reads every comment on the PR,
this one included. Retire the job, or move it to an API key in Actions, by
amending this record.
