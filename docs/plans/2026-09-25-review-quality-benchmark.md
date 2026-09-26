# Review quality benchmark

A repeatable measurement of how well a model reviews code and plans inside this repository's
agent setup, so a model change is a measured decision rather than an argued one. It scores one
model against a fixed corpus under a fixed configuration and reports the result beside the
current dispatch model's baseline.

Status: proposed 2026-09-25, awaiting the open questions at the end.

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
| Model and effort | model id, `output_config.effort` set explicitly (Opus 5.5 defaults to `medium`, the others to `high`) |
| Harness | `claude --version`, Node version from `.nvmrc` |
| Turn cap | the maximum turns, when the tier allows tools |

Two runs are comparable only when their manifest hashes match. A CLI upgrade changes the
harness system prompt, so it changes the manifest; cross-model comparisons run on one CLI
version, and tier L0 exists so a comparison across time can bypass the harness entirely.

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
under test, is called with structured output, and is run twice on the same text with its
disagreement rate reported.

## Tool tiers

The tier is a configuration axis, not a fixed choice.

| Tier | Tools | Invocation | Use |
| --- | --- | --- | --- |
| L0 diff-only | none; the prompt carries the diff, the issue, and the instruction excerpt | one Messages API call with structured output | cheapest, most repeatable, survives CLI upgrades |
| L1 read-only repo | `Read`, `Grep`, `Glob`, `Bash` with a read-only git allowlist | `claude -p` with `--model`, `--tools`, `--agents`, `--strict-mcp-config`, `--output-format json`, matching `.github/scripts/dispatch/run.sh` | the pre-pass as it reads code |
| L2 full pre-pass | L1 plus the verify loop (`pnpm lint`, `typecheck`, `test:coverage`) | same, longer turn cap | the pre-pass as production runs it; five-case subset only |

The exact flag for the turn cap is confirmed against `claude --help` at implementation time,
not assumed.

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
| Cost | input and output tokens, cache reads, turns, tool calls, wall time |

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

## Cost

Not quoted until stage 3 measures it. A single L1 pre-pass reads a diff, the instruction
file and several source files; the pilot exists to turn that into a number per case per model
before the full set is authorised. A spend cap for the pilot is one of the open questions.

## Open questions

1. Which models form the first comparison beside the current dispatch model, Opus 5?
2. Is a per-output LLM judge acceptable for the one readability dimension, or programmatic
   grading only?
3. Adjudicated real PR cases need a maintainer pass over roughly twenty truth files. Is that
   available for the first version, or does it ship on mutation cases alone?
4. What is the spend cap for the pilot?
5. Does plan review ship in the first version, or wait until code review has a baseline?
