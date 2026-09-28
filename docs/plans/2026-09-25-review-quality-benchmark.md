# Review quality benchmark

A repeatable measurement of how well a model reviews code and plans inside this repository's
agent setup, so a model change is a measured decision rather than an argued one. It scores one
model against a fixed corpus under a fixed configuration and reports the result beside the
current dispatch model's baseline.

Status: proposed 2026-09-25; the maintainer answered the open questions the same day, and the
decisions section at the end records them.

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
   weaker ground truth and is deferred until code review has a committed baseline.

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
| Model and effort | model id and an explicit effort on every run: `--model` and `--effort <low\|medium\|high\|xhigh\|max>` for `claude`, `-m` and `-c model_reasoning_effort=<level>` for `codex`. Never inherited: Opus 5.5 defaults to `medium` where the other Claude models default to `high`, and the maintainer's `~/.codex/config.toml` sets `low`, so an unset effort would silently differ by vendor and machine |
| Harness | `claude --version` or `codex --version`, Node version from `.nvmrc` |
| Turn cap | a wall-clock timeout per call: neither `claude` 2.1.282 nor `codex exec` 0.154.0 has a turn cap flag (checked 2026-09-26), so a killed run is an `error` row with `timeout` as its reason |

Two runs are comparable only when their manifest hashes match. A CLI upgrade changes the
harness system prompt, so it changes the manifest; cross-model comparisons run on one CLI
version per vendor. With no API path there is no harness-free tier: a Claude result is always
model plus Claude Code, a Codex result model plus Codex, and a cross-vendor row compares those
bundles, which is the question the pipeline actually asks. Tier L0 keeps the harness but
removes every tool, so it is the closest available thing to a bare-model comparison.

**Freeze the environment.** Fresh worktree per case under the OS temporary directory, no
network beyond the model API (tier L1 gets read-only git and no `gh`), no hooks and no
plugins (`claude -p --setting-sources ""`, `codex exec --ignore-user-config`), and the
working directory outside this checkout so none of its settings, memory or instruction files
are discovered. Tool results are recorded per row (`tools.jsonl`) and not replayed: neither
command-line tool offers a hook that substitutes a tool's output, so the replay cache the first
draft described is not available. The frozen worktree does the same work for read-only tools:
every result is a function of the pinned head. Tier L2 links `node_modules` from the
checkout rather than installing per worktree.

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

## Effort sweeps

Effort is a run axis beside model and tier, not a fixed setting. `run.mjs --effort` takes a
list; each level produces its own manifest and its own result set, so a sweep is a series of
ordinary runs the report joins.

- **Levels.** Claude accepts `low`, `medium`, `high`, `xhigh` and `max` (from
  `claude --help`). Codex levels are per model and the runner reads them from the Codex model
  cache (`~/.codex/models_cache.json`, field `supported_reasoning_levels`) rather than
  hardcoding them: on 2026-09-25 that file lists `low`, `medium`, `high`, `xhigh`, `max`, `ultra` for
  `gpt-6-astra` (default `medium`) and `low`, `medium`, `high`, `xhigh`, `max`, `ultra` for
  `gpt-5.6-sol` (default `low`). A level a model does not list is recorded as
  `status: unsupported`, never as a failure.
- **Report.** One table per model: quality metrics, cross-rep consistency and usage per case
  at each level, plus a paired comparison of adjacent levels with its confidence interval.
  Consistency is reported per level because effort changes run-to-run variance, not only the
  mean.
- **Selection rule.** The recommended level for a model is the lowest one whose blocker recall
  and verdict accuracy sit within the noise floor of that model's best level. Usage is the
  tie-breaker, never the criterion.
- **Windows.** A sweep multiplies usage by the number of levels, so sweeps run on the pilot
  subset (five to ten cases) and the full set runs only at the level or two the sweep
  selects. Effort also shifts wall time, which the runner records; Fable-class models at
  high effort can take many minutes per case.

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

Plan review cases, when that stage arrives, are issues that carry a human route label (the
TypeSafe spike used 123 of them), plus plans in `docs/plans/` whose later amendment records
what the first review missed.

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
  run.mjs              # --model --tier --reps --effort <list> --cases; one results/<manifest>/ per level
  grade.mjs            # programmatic graders, matcher, optional judge
  report.mjs           # paired comparison against baselines/, CI, cost
  lib/manifest.mjs     # hashes the inputs above
  lib/resume.mjs       # which rows a run still owes; rate-limited rows are owed again
  lib/fixture.mjs      # reads a built fixture back: spec, truth, diff, PR body, mutated files
  lib/prompt.mjs       # renders prompts/code-review.md for one case at one tier
  lib/claude.mjs       # claude -p driver: flags, stream-json parsing, rate-limit windows
  lib/codex.mjs        # codex exec driver: flags, JSONL parsing, effort levels from the cache
  prompts/             # committed: the prompt template, hashed into the manifest
  cases/               # committed: inputs and truth for mutation cases; real cases fetched
  baselines/           # committed: one summary JSON per model and manifest
  results/, .cache/    # ignored
```

Run by hand only. Nothing here is a CI check or a scheduled job (ADR-0029, ADR-0031).

## Stages

1. **Corpus and graders.** Case schema, `build-cases.mjs`, twenty mutation cases, the
   matcher with its unit tests, oracle and null checks. No model calls. Done 2026-09-25:
   `scripts/bench/review/`, twenty mutation cases and the seven wave-2 real cases, self-check
   passing on all 27.
2. **Runner.** Tier L0 and L1, manifest hashing, per-row output with `status`, resume after
   a rate limit. Tier L2 behind a flag. Done 2026-09-26: `run.mjs` with both drivers, smoke
   run on one mutation case at L0 and L1 through each harness (Haiku and Sol, low effort), L1
   permission denials verified, worktrees removed after each row. Findings recorded in the
   README: the structured-output tool must stay on the tool list, an empty setting-sources
   list is what turns hooks off, and the `codex` wrapper routes this checkout to the work
   account, so the runner sets `CODEX_HOME` itself.
3. **Pilot.** Five cases, Opus 5 plus the four candidates, three reps, the full effort
   sweep for each. Measures
   usage per case at each level, cross-rep variance and the noise floor. Go or no-go on the
   full set size, and the effort level each model carries into stage 4. Done 2026-09-27:
   405 rows, all ok, record in `scripts/bench/review/baselines/pilot-2026-09-27.md`;
   findings below.
4. **Baseline.** Full set on the current dispatch model (`claude-opus-5`, from
   `.github/workflows/dispatch.yml`). Commit the summary to `baselines/`.
5. **New-model protocol.** One page: run the effort sweep on the pilot subset, apply the
   selection rule, run the full set at the selected level, compare paired against the
   baseline at its own selected level, and change `DISPATCH_MODEL` (and the effort the
   dispatcher passes) only when verdict accuracy and blocker recall are within noise or better
   and claim discipline is not worse. Recorded as an ADR, on the ADR-0031 pattern.
6. **Plan review.** Cases, graders and a baseline for the second task, on the same runner.

## Dispatch mode

`run.mjs --mode dispatch` (added 2026-09-27, after the pilot) runs the model as the dispatcher
itself: `/dispatch` narrowed to section 4, the reviewer spawned from the checkout's own agent
file, the verify loop run, and the verdict comment graded instead of a JSON answer. The PR is a
shared clone whose `origin/main` and `origin/<branch>` are the case's base and head with the
mutation committed and today's agent configuration overlaid on both; `gh` is a stand-in that
answers reads from the fixture and refuses writes. Claude Code only, tier L2 by definition;
details in the README. The manifest gains `mode` and the dispatch skill's hash, so a dispatch
row never compares with a direct row.

**First dispatch-mode run (2026-09-28).** Opus 5.5 at `low`, eight cases, one rep, 14 minutes:
every planted defect caught, both recent approved PRs approved, and two disagreements with the
answer key that were the answer key's. The maintainer ruled the model's finding on the base PR
of the persona cases a real bug (the orphan sweep deletes a restored persona's sign-in), now
carried as a `baseDefects` entry on the five cases built on #1587 and filed as #1628. The wave-2 approve case
tripped today's missing-label gate, a control that did not exist when it was adjudicated; the
dispatch mode runs with `--exclude-tag wave2`. A third of the comment's findings named a file
and function without a line, reported per row as `line-missing`.

## Pilot findings (2026-09-27)

Five cases (m03, m04, m12, m17, r-709), three reps, tier L1, every effort level of Opus 5,
Opus 5.5, Fable 5.1, GPT-6-Astra and GPT-5.6-Sol: 405 rows, every one `ok`, no rate limit and no timeout.
The full record, per-case grid and sweep tables are in
`scripts/bench/review/baselines/pilot-2026-09-27.md`.

1. **Effort moves nothing the rule scores.** For every model, verdict accuracy and blocker
   recall at every level sit inside the ±0.26 noise floor of that model's best level, and
   every adjacent-level paired difference has an interval covering zero. The selection rule
   picks `low` for all five models. Higher effort only adds cost, tenfold from low to max
   (Opus 5: 45 to 511 seconds and 0.2M to 3M input tokens per case), and on the Claude
   models it adds over-flagging: Opus 5 at `max` and Opus 5.5 at `xhigh` and `max` flip the real
   approve case to `request changes` by reporting findings the wave-2 skeptic pass had
   refuted.
2. **Run-to-run variance is near zero.** Cross-rep verdict agreement is 1.00 in 25 of 27
   model-level pairs and 0.93 in the other two; finding-set overlap is 0.4 to 1.0. The
   `1/sqrt(n·R)` floor is conservative for verdicts here. The full set can run at two reps
   and keep a third only for cases where the two disagree.
3. **Blocking mutation cases are saturated.** m04, m12 and m17 were caught with the right
   verdict and the blocker matched in 242 of 243 rows (the miss: Opus 5 low, rep 1, m04).
   Every model at every level finds an injected blocker at L1; those cases separate a broken
   harness from a working one and nothing finer. The discrimination in this pilot came from
   the two approve cases: r-709 separates the Claude models (approve at low to high) from
   the Codex models (`request changes` at every level, 35 of 36 rows), and m03 separated
   nobody.
4. **m03's label is wrong, not the models.** All 81 rows called the `readdir` mutation
   blocking, and their reason is the reviewer definition's own highest-yield rule: the PR
   body promises a warning when the partition folder cannot be read, and after the mutation
   nothing is logged, so the body overclaims. The case was authored as non-blocking in
   stage 1. Relabelled 2026-09-27 together with m07 and m20, whose mutations also make a
   comment untrue and change behaviour (an anchor line printed for every note; a verify
   script helper returning non-zero without `-v`). With m03 relabelled, the pilot's verdict
   accuracy is 1.00 for the three Claude models from low to high and 0.80 for GPT-6-Astra and
   GPT-5.6-Sol; the committed pilot record keeps the numbers under the labels of the run.
5. **Window cost.** Claude Code reports five-hour window utilisation per row. Fifteen rows
   moved it by about 4 points at low (Opus 5, Fable) and under 1 point at low (Opus 5.5),
   by 16 points at high (Opus 5) and by 34 points at max (Fable). A full-set run at low is
   under a tenth of a window per model; a high-effort full set is most of one. Codex
   reports no window figure through its CLI.
6. **Go, with the corpus rebalanced.** The full set is a go at `low` for every model.
   Rebalanced 2026-09-27: ten merged agent PRs whose final pre-pass approved them with no
   blocker (`ra` cases, verdict approve, no adjudicated defects) and eight benign mutations
   (`b` cases, one comment reworded, the edit listed as refuted so a finding on it is
   over-flagging). The set is now 45 cases, twenty approve and twenty-five request-changes;
   at low-effort wall times two reps take between 18 minutes (Opus 5.5) and 70 minutes
   (Opus 5) per model. The headline metric stays verdict accuracy on approve cases plus
   refuted-finding hits, the only axis the five models differed on.
7. **Stage 4 baseline.** Opus 5 runs at `low` (the selected level) and also at `high`
   (the Claude Code default the dispatcher runs today), so the baseline names both what the
   rule selects and what production does. Candidates run at their selected level, `low`.

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

Codex Pro's login state is recorded the same way, and the runner sets `CODEX_HOME` explicitly
(default `~/.codex`): the maintainer's `codex` wrapper routes by repository and lands this
checkout on the work account, which rejects the benchmark models with a 400.

## Decisions (2026-09-25)

1. **Models.** Claude Fable 5.1 (`claude-fable-5-1`) and Claude Opus 5.5 (`claude-opus-5-5`)
   on Claude Max; GPT-6-Astra (`gpt-6-astra`) and GPT-5.6-Sol (`gpt-5.6-sol`) on Codex Pro,
   slugs from the Codex model cache. The current dispatch model, Opus 5, is the baseline
   they are compared against and runs first.
2. **Judge.** Fable 5.1 through `claude -p`, no tools, for the readability dimension only.
   Fable 5.1 is also a candidate, so its own rows carry a self-judged mark on that one
   dimension; the headline metrics are programmatic and untouched by it.
3. **Adjudication.** The first version takes no new maintainer labelling. Real PR cases are
   limited to those whose truth already exists in the record: the seven wave-2 PRs with a
   reviewer, skeptic and final adjudication, and any PR with an override record. Everything
   else comes from mutation-injected cases. Fresh adjudication of further real PRs is a later
   stage, added when the mutation set stops discriminating.
4. **Account.** The 20x Claude login, run by hand, never scheduled. The runner records the
   active login in the manifest and refuses to start if `CLAUDE_CODE_OAUTH_TOKEN` is set,
   since that variable would silently switch accounts.
5. **Plan review.** After the code-review baseline is committed, as its own stage.
