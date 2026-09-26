# Review quality benchmark

A repeatable measurement of how well a model reviews code and plans inside this repository's
agent setup, so a model change is a measured decision rather than an argued one. It scores one
model against a fixed corpus under a fixed configuration and reports the result beside the
current dispatch model's baseline.

Status: proposed 2026-09-25, awaiting the open questions at the end.

Constraint set 2026-09-25: no API keys. Every model call goes through a subscription
command-line tool, `claude -p` on Claude Max and `codex exec` on Codex Pro. Anything the
Messages API alone would have offered is out.

## What is measured

Two review tasks, both ones the pipeline already performs:

1. **Code review.** The `birdbrain-reviewer` pre-pass over a PR at one commit: a verdict
   (`approve for human review` or `request changes`) and up to five findings, the shape
   `.claude/skills/post-comment/` enforces.
2. **Plan review.** A judgement on a plan, spec, or issue: does it clear the ready-for-agent
   bar, which route does it take, and which acceptance criteria are unverifiable. This half has
   weaker ground truth and is advisory in the first version.

The system under test is the model plus the repository's agent configuration, not the model
alone. Every result row names both.

## Determinism

Sampling parameters (`temperature`, `top_p`, `top_k`) are removed on every current model
(Fable 5.1, Opus 5, Opus 5.5, Sonnet 5, Opus 4.7 and 4.8), so a zero-temperature run is not
available. Determinism therefore comes from three places and nowhere else.

**Freeze every input byte.** A run manifest, hashed, stamps every result:

| Field | Source |
| --- | --- |
| Prompt | the prompt file's content hash |
| Agent definition | `.claude/agents/birdbrain-reviewer.md` content hash |
| Instruction file | `CLAUDE.md` content hash (the reviewer reads it first) |
| Repository state | the pinned commit id, checked out into a fresh detached worktree |
| Tool tier | the exact `--tools` list (see below), MCP config empty and strict |
| Model and effort | model id and an explicit effort: `--model` plus the effort setting for `claude`, `-m` plus `-c model_reasoning_effort=…` for `codex` (Opus 5.5 defaults to `medium`, the others to `high`) |
| Harness | `claude --version` or `codex --version`, Node version from `.nvmrc` |
| Turn cap | the maximum turns, when the tier allows tools |

Two runs are comparable only when their manifest hashes match. A CLI upgrade changes the
harness system prompt, so it changes the manifest; cross-model comparisons run on one CLI
version per vendor. With no API path there is no harness-free tier: a Claude result is always
model plus Claude Code, a Codex result model plus Codex, and a cross-vendor row compares those
bundles, which is the question the pipeline actually asks. Tier L0 keeps the harness but
removes every tool, so it is the closest available thing to a bare-model comparison.

**Freeze the environment.** Fresh worktree per case, `pnpm install --frozen-lockfile` once
per repository commit, no network beyond the model API (tier L1 gets read-only git and no
`gh`), timestamps stripped from output before hashing. Tool results are recorded and replayed:
a tool call whose input bytes match a recorded call gets the recorded output. That is a cache
and a cost control, not a guarantee, because the model may choose different calls each run.

**Measure what remains.** Every case runs R times (three by default). The report carries the
mean, the spread, and cross-rep agreement (verdict agreement rate, overlap of finding sets).
A difference smaller than the paired-difference confidence interval is reported as no
difference. The noise floor for a pass rate is roughly `1/sqrt(n·R)`: forty cases at three
reps is about ±9 points, which is the resolution the first version can claim.

**Deterministic grading.** The primary grader is programmatic. An LLM judge is used only for
one dimension (plain-language readability of the verdict's top layer), is never the model
under test, runs through whichever command-line tool is not under test with no tools and a
JSON schema (`codex exec --output-schema`, or a schema the grader validates for `claude`),
and is run twice on the same text with its disagreement rate reported.

## Tool tiers

The tier is a configuration axis, not a fixed choice.

Tiers are defined by capability, not by tool name, because the two harnesses expose tools
differently: Claude Code takes a tool allowlist, Codex takes a sandbox mode.

| Tier | Capability | Claude Max | Codex Pro | Use |
| --- | --- | --- | --- | --- |
| L0 diff-only | no tools; the prompt carries the diff, the issue, and the instruction excerpt | `claude -p --tools ""` | `codex exec --sandbox read-only --ephemeral` in an empty directory | cheapest, most repeatable |
| L1 read-only repo | read files, search, read-only git; no writes, no network | `--tools Read,Grep,Glob,Bash` with a read-only git allowlist, `--agents` carrying the reviewer definition, `--strict-mcp-config`, `--output-format json`, as `.github/scripts/dispatch/run.sh` does | `--sandbox read-only -C <worktree>`, the reviewer definition in the prompt (Codex reads `AGENTS.md`, which the repo keeps equal to `CLAUDE.md`) | the pre-pass as it reads code |
| L2 full pre-pass | L1 plus the verify loop (`pnpm lint`, `typecheck`, `test:coverage`) | same, workspace writes allowed for build output, longer turn cap | `--sandbox workspace-write` | the pre-pass as production runs it; five-case subset only |

Flags above were read from `claude --help` (2.1.282) and `codex exec --help` (0.154.0) on
2026-09-25; the turn cap flag for each tool is confirmed the same way at implementation time,
not assumed. Both tools return machine-readable output (`--output-format json` with
`num_turns`, `duration_ms`, `usage`; `codex exec --json` and `--output-last-message`).

## Ground truth

Code review cases come from two sources, so the set is not hostage to label noise.

- **Adjudicated real PRs.** Sixty-seven PRs carry a `Review verdict:` comment. For each, the
  case is the PR at the commit the pre-pass reviewed, and the truth is what happened next:
  findings later fixed on the same PR or confirmed by a human review count as true defects,
  findings the wave-2 skeptic pass refuted (`docs/plans/2026-08-22-wave2-review-verdict.md`,
  fifteen refuted) count as known false positives, and merges over a `request changes`
  verdict carry the override record's disposition (ADR-0007). The 2026-09-19 defect review
  supplies file-and-line evidence for the disputed buckets.
- **Mutation-injected PRs.** A merged PR with a known-good diff, plus one applied mutation: a
  removed guard, a swapped comparison, an error path that now swallows, or a PR body sentence
  that overclaims what the code does. The last class is the one the reviewer file names as its
  highest-yield rule and the one PR #423 hit in all five rounds. Truth is exact and free.

Plan review cases are issues that carry a human route label (the TypeSafe spike used 123 of them),
plus plans in `docs/plans/` whose later amendment records what the first review missed.

Every case is a directory holding the inputs, the truth file, and a `tags` field; the truth
file is never reachable from the worktree the model reads.

## Metrics

| Metric | How it is computed |
| --- | --- |
| Verdict accuracy | verdict versus adjudicated truth; also confusion by evidence tier |
| Blocker recall | fraction of true blocking defects that appear in the five findings |
| False-positive rate | findings matching a refuted set, plus findings no adjudicator accepted |
| Claim discipline | does each cited file and line exist at the reviewed commit, and does quoted text match; fully programmatic |
| Consistency | cross-rep verdict agreement and finding-set overlap |
| Usage | input and output tokens, cache reads, turns, tool calls, wall time; the `total_cost_usd` the Claude CLI reports is recorded as an API-equivalent figure, not a charge |

Findings match a truth entry on file, a line window, and a category; the matcher is unit
tested against hand-written pairs before any model run. The oracle and null checks from the
evaluation health checklist in the Claude API skill run first: the truth file pushed through the grader scores near 100%,
an empty verdict near 0%, and an induced API error lands as `status: error`, never as a zero.

## Layout

`scripts/bench/review/`, on the pattern of the TypeSafe benchmark spike in
`scripts/spikes/jev-bench/` (draft PR #1594), whose `lib/metrics.mjs` (`binary`, `auc`,
`confusion`, `calibration`) is reused rather than rewritten.

```
scripts/bench/review/
  build-cases.mjs      # pulls PRs, verdict comments, adjudications; applies mutations
  run.mjs              # --model --tier --reps --effort --cases; writes results/<manifest>/
  grade.mjs            # programmatic graders, matcher, optional judge
  report.mjs           # paired comparison against baselines/, CI, cost
  lib/manifest.mjs     # hashes the inputs above
  lib/replay.mjs       # tool-result record and replay cache
  lib/claude.mjs       # claude -p driver: flags, JSON result parsing
  lib/codex.mjs        # codex exec driver: flags, JSON result parsing
  cases/               # committed: inputs and truth for mutation cases; real cases fetched
  baselines/           # committed: one summary JSON per model and manifest
  results/, .cache/    # ignored
```

Run by hand only. Nothing here is a CI check or a scheduled job (ADR-0029, ADR-0031).

## Stages

1. **Corpus and graders.** Case schema, `build-cases.mjs`, twenty mutation cases, the
   matcher with its unit tests, oracle and null checks. No model calls.
2. **Runner.** Tier L0 and L1, manifest hashing, replay cache, per-row output with
   `status`. Tier L2 behind a flag.
3. **Pilot.** Five cases, two models, three reps, effort `high`. Measures cost per case,
   cross-rep variance and the noise floor. Go or no-go on the full set size.
4. **Baseline.** Full set on the current dispatch model (`claude-opus-5`, from
   `.github/workflows/dispatch.yml`). Commit the summary to `baselines/`.
5. **New-model protocol.** One page: run the pilot at effort `low` and `high`, then the full
   set at the chosen effort, compare paired against the baseline, and change
   `DISPATCH_MODEL` only when verdict accuracy and blocker recall are within noise or better
   and claim discipline is not worse. Recorded as an ADR, on the ADR-0031 pattern.

## Accounts and usage windows

There is no dollar cost and no cap the runner can enforce. Both subscriptions meter usage in
rolling windows shared with interactive work, so a full run competes with the maintainer's own
sessions. The runner therefore:

- runs cases serially per vendor, with a configurable pause, and stops cleanly on a rate-limit
  response, marking the row `status: rate_limited` (never a zero score) and resuming from
  the last completed case on the next invocation;
- records tokens and turns per case so stage 3 can state how much of a window one case costs
  and how many cases fit in one;
- takes the Claude account from the environment: `CLAUDE_CODE_OAUTH_TOKEN` overrides the
  stored login with no fallback, so the manifest records which login was active, and a run
  meant for the second account must set that variable rather than assume.

Codex Pro's login state is recorded the same way.

## Open questions

1. Which models form the first comparison beside the current dispatch model, Opus 5, and
   which Codex model is the first Codex entry?
2. Is a per-output LLM judge acceptable for the one readability dimension, or programmatic
   grading only?
3. Adjudicated real PR cases need a maintainer pass over roughly twenty truth files. Is that
   available for the first version, or does it ship on mutation cases alone?
4. Which Claude login runs the benchmark, the 20x account or the 5x one, and in which hours,
   given that it shares those accounts' usage windows?
5. Does plan review ship in the first version, or wait until code review has a baseline?
