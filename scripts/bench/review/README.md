# Review quality benchmark

Scores a model plus this repository's reviewer configuration against review cases with known
answers. The plan is `docs/plans/2026-09-25-review-quality-benchmark.md`. This directory holds
the case corpus and builder (stage 1), the programmatic grader (stage 1) and the runner
(stage 2). Nothing here is a CI check or a scheduled job; every model call is started by hand.

## Run

```
node build-cases.mjs            # fixtures/<id>/: case.json, truth.json, diff.patch, files/, pr.md
node build-cases.mjs --no-gh    # the same without the PR title and body
node grade.mjs --self-check     # oracle scores 1, null scores 0, an error row is counted not scored

node run.mjs --harness claude --model claude-opus-5 --tier L1 --effort high --cases m01,m02
node run.mjs --harness codex --model gpt-5.6-sol --tier L1 --effort low,medium,high --tag wave2
node run.mjs --harness claude --model claude-opus-5-5 --mode dispatch --effort low --tag approve
node grade.mjs --results results/<manifest>/rows.jsonl
node report.mjs --tier L1            # every model across its effort levels, paired comparisons
bash pilot.sh claude                 # the stage 3 sweep for one vendor (PILOT_MODE=dispatch for the dispatch mode)
```

`run.mjs` takes `--harness claude|codex`, `--model <id>`, `--tier L0|L1|L2`, `--mode
direct|dispatch` (default `direct`), and `--effort` as a comma list; effort is never inherited
from a config file. `--reps` (default 3), `--cases` (ids
or id prefixes), `--tag`, `--exclude-tag` (`--exclude-tag wave2` keeps the August cases out of a
dispatch run), `--timeout <ms>` (default 30 minutes per call), `--pause <ms>` between
calls, `--dry-run`, `--allow-l2`, `--claude-config-dir` and `--codex-home` are optional.

Each effort level gets its own `results/<manifest>/` holding `manifest.json`,
`environment.json`, `rows.jsonl` and one `rows/<case>-r<rep>/` directory with the prompt, the
raw `stdout` and `stderr`, `tools.jsonl` (every tool call the model made) and `result.json`. Cases
run serially; the first `rate_limited` row stops the run with exit 3, and the same command run
again picks up from that row. Rows that finished `ok`, `error` or `unsupported` are never
re-run under the same manifest. `build-cases.mjs` fetches `refs/pull/<n>/head` when a pinned
commit is not local. `fixtures/`, `results/` and `.cache/` are ignored.

## What one run fixes

The manifest hashes the prompt template (`prompts/code-review.md`), the reviewer definition
(`.claude/agents/birdbrain-reviewer.md`), `CLAUDE.md`, the corpus (every case id, head and
truth file), the tool tier, the model, the effort, the harness version, the Node version, the
timeout and a hash of the active login. The id names a run; two runs compare when their
manifests agree on everything but the axes under comparison (model, effort, and across
vendors the harness), which is the key the report joins on.

The harness is pinned as far as its flags allow:

- `claude -p` runs with `--setting-sources ""`, which drops user and project settings, so no
  hook fires and no plugin loads (verified 2026-09-26 with `--debug-file`: zero hooks with the
  flag, the repository's session-start and Serena hooks without it). `--strict-mcp-config` with
  an empty server list, `--no-session-persistence`, an explicit `--model` and `--effort`, the
  reviewer definition through `--agents` plus `--agent`, and `--json-schema` for the output.
  The schema answers through the `StructuredOutput` tool, so that tool stays on every tier's
  `--tools` list; with `--tools ""` the model answers in prose, which the driver recovers and
  marks `outputSource: text`.
- `codex exec` runs with `--ignore-user-config` (no MCP servers, no config defaults),
  `--ephemeral`, an explicit `-m` and `-c model_reasoning_effort=<level>`, and
  `--output-schema` in the strict form the API requires. The effort levels a model accepts
  are read from `models_cache.json` under the Codex home; a level the model does not list is
  written as `status: unsupported` without a call.
- The working directory is under the OS temporary directory, never inside this checkout, so
  no `CLAUDE.md`, `AGENTS.md`, settings or auto-memory of the checkout is discovered. Tier L0
  runs in an empty directory; L1 and L2 run in a detached worktree at the case's head with the
  mutated files written over it, removed after the row.
- Neither CLI has a turn cap flag (`claude --help` 2.1.282, `codex exec --help` 0.154.0), so
  the cap is a wall-clock timeout, recorded in the manifest; a killed run is an `error` row
  with `timeout` as its reason.

Tool results are not replayed. Neither CLI offers a hook that substitutes a tool's output, so
the cache the plan described is not available; what the runner has instead is the frozen
worktree, which makes every read-only tool result a function of the pinned head, and the
per-row tool log, which shows what each run read.

## Accounts

The runner refuses to start for `claude` when `CLAUDE_CODE_OAUTH_TOKEN` is set, because that
variable overrides the stored login with no fallback. It sets `CLAUDE_CONFIG_DIR` (default
`~/.claude`) and `CODEX_HOME` (default `~/.codex`) explicitly on every call, since the
maintainer's `claude` and `codex` wrappers otherwise route by repository, and the `codex`
routing lands this checkout on the work account, which rejects the benchmark models. Each
row records the subscription windows Claude Code reports (`rateLimit`, utilisation per
window), which is how a pilot measures what one case costs.

## Tiers

| Tier | `claude` | `codex` |
| --- | --- | --- |
| L0 | `--tools StructuredOutput`; the diff and PR body are in the prompt | `-c features.shell_tool=false --sandbox read-only` in an empty directory (the sandbox governs how a command runs; the flag removes the shell tool, verified 2026-09-28); diff and PR body in the prompt |
| L1 | `--tools Read,Grep,Glob,Bash,StructuredOutput` with `--allowedTools` limited to read-only git; writes, network and package scripts are denied (verified: `touch`, `git fetch`, `curl` and `pnpm` all land in `permission_denials`, while `grep` is allowed by the harness's own read-only command class) | `--sandbox read-only -C <worktree>`; the reviewer definition travels in the prompt |
| L2 | L1 plus `pnpm lint`, `pnpm typecheck` and `pnpm test` on the allowlist; `node_modules` is a symlink to this checkout's | `--sandbox workspace-write`; behind `--allow-l2` |

The prompt tells the reviewer which passes are out of reach (GitHub state, the network, checks
it cannot run) and not to report their absence. L2 is a reduced verify loop, not the production
pre-pass: the build, the extension build and changed-line coverage are not on its allowlist.
Dispatch mode is where the production loop runs.

The truth file is outside the workspace but not unreachable from it: L1 and L2 can read any
path and the worktree is cut from this checkout. `node audit.mjs [--results <dir>]` scans every
row's `tools.jsonl` for a reach beyond the workspace (the truth file, the fixture or case
directories, the `BENCH_*` environment, `git worktree list`) and exits 1 on a hit; run it after
every sweep. In dispatch mode the `gh` stand-in reads from a copy of the fixture under the row
directory that holds no truth file.

## Dispatch mode

`--mode dispatch` runs the model through the repository's own dispatch flow instead of the
benchmark prompt: the model is the dispatcher, invoked with `/dispatch` and told to run only
section 4 (the reviewer pre-pass) on the case's PR, so it spawns `birdbrain-reviewer` from the
checkout's own agent file, the reviewer runs its verify loop, and the graded product is the
verdict comment the dispatcher writes in the post-comment shape. It is Claude Code only: the
skill, the subagent and the hooks are Claude Code's, so a Codex row in this mode is written as
`unsupported`. The mode is tier L2 by definition.

What the mode builds per row:

- **A local PR.** A shared clone where `origin/main` is the case's base, the checked-out branch
  and `origin/<branch>` (the PR's real branch name) are the case's head with the mutation
  committed on top, and the remote URL points nowhere, so `git diff origin/main...origin/<branch>`
  and `git log origin/main..HEAD` read as they do in production and no push or fetch can reach
  the real repository. Both synthetic commits carry today's `.claude/`, `CLAUDE.md` and
  `AGENTS.md` from the branch under test, so an old PR is reviewed by the current
  configuration and the overlay never shows in the diff. Commit ids are deterministic (fixed
  author and date).
- **A `gh` stand-in.** `gh` and `agh` on `PATH` resolve to `lib/gh-shim.mjs`, which answers the
  reads the skill and the reviewer make (`pr view`, `pr checks`, `pr diff`, the pull, labels,
  issue, status and check-run endpoints) from the fixture's `pr.json` and `diff.patch`, reports
  every check green, refuses every write and every other PR, and logs each call to
  `gh-calls.jsonl` in the row directory. It reports the clone's own commits as the PR's head
  and base and rewrites every mention of the real ones in the PR body to match, so the
  Verification block's stamped sha agrees with the tree under review; without that the
  reviewer reads a stale block and requests changes on every case. `GH_TOKEN` is set to an invalid value as a second
  guard.
- **The harness as production runs it.** `claude -p` with every built-in tool,
  `--dangerously-skip-permissions`, `--setting-sources project` (the checkout's settings and
  hooks; the session-start hook's fetch fails against the dead remote and warns, as it does
  offline), no `--json-schema` and no `--agents`.

Use recent cases in this mode. The overlay applies today's gates to the PR's real labels, so a
PR from before the tiered evidence path list (the wave-2 `r` cases, August 2026) trips the
missing-label gate and is marked `request changes` for a control that did not exist when it
was adjudicated. The `ra`, `m` and `b` cases are all September 2026 PRs with their real labels.
On the first Opus 5.5 run (eight cases, low effort) the review comments cited a file and function
without a line for a third of their findings, which the reviewer definition requires; the
grader reports that per row as `line-missing`.

The row's `output` is parsed from `comment.md`: the verdict from the bold first line, findings
from the collapsed report's table (`file:line` and severity, where `blocking` and `gate` count
as blocking), or from the numbered top layer when the report has no table. The manifest hashes
the dispatch skill as well as the reviewer definition and `CLAUDE.md`.

## Cases

`cases/mutation/<id>.json` pins a merged PR (`base`, `head`) and one or more mutations: exact
`find` and `replace` text on a file at `head`, a category, whether it blocks, and the defect in
words. The builder applies each mutation, refuses one whose `find` is absent or ambiguous, and
derives the truth file with the line range the mutation landed on. The verdict is `request
changes` when any defect blocks. A mutation marked `benign: true` is not a defect: it lands in
the truth file's refuted list, so the case's verdict is approve and a finding on the edit counts
as over-flagging. The `b` cases reword one comment each without changing its claim. A spec may
also carry `baseDefects`: defects the base PR already had, ruled after it merged, which join the
truth of every case built on that head. The five cases on #1587 carry one (the orphan sweep
deletes a restored persona's sign-in, ruled 2026-09-28 after the first dispatch-mode run
reported it), so its benign case is a `request changes` case now.

The corpus after the 2026-09-27 pilot: twenty blocking mutations (`m`), eight benign
mutations (`b`), the seven wave-2 PRs (`r`, two approve) and ten merged agent PRs whose
final pre-pass approved them with no blocker and which the maintainer merged (`ra`, verdict
approve, no adjudicated defects). Twenty approve cases, twenty-five request-changes.

Added on 2026-11-07, following Anthropic's Claude Code team, whose reviewer eval is built from
past incidents (https://claude.dev/blog/solving-code-review-at-anthropic/): ten shipped-defect
cases (`rs`) and three more clean merges (`ra-1654`, `ra-1760`, `ra-1821`). Each `rs` case pins
the head a pre-pass or merge let through, with defects a later review, issue or fix commit
confirmed: #1846 (field extractor budgets, caught by an outside review), wave 1 batch 1's #666,
#673 and #674 (the twelve blockers of the hand-run pre-pass, less two that fall outside the
commit range), #1269, #1297 (issue #1301), #499 (issue #1107), #438, #2079 and #1844. Line ranges
come from the fix commit's diff against the case head. `rs-2079` is an approve case with one
non-blocking defect: the pre-pass rated it pre-existing and the PR merged with it as a follow-up.
Left out: #1587, whose orphan-sweep defect the five `m` and `b` cases on that head already carry,
and #1683, where the record does not settle whether the defect should block. Select them with
`--tag shipped`.

`cases/real/<id>.json` pins a PR at the commit a pre-pass reviewed and carries the truth file by
hand: adjudicated defects, and findings a skeptic pass refuted. The seven wave-2 PRs (#709 to
#715) come from `docs/plans/2026-08-22-wave2-review-verdict.md` and the pre-pass comments it
summarises; verdicts follow that document's per-PR table. A defect in the PR body itself cites
the pseudo-file `PR_BODY`, which the claim check reads from the fixture's `pr.md`.

## Grading

A finding matches a defect on the same file when its line is inside the defect's range widened
by five lines; a defect with no range matches on file alone, and a finding with no line matches
when the file holds exactly one defect (the missing line is counted per row as `line-missing`,
outside both recall and the claim rate). Only the first five findings count.
Per row: verdict correct, blocker and defect recall, unmatched findings, hits on refuted
findings, and a claim check per finding (the cited file exists at the reviewed tree, the line is
inside it, the quote is in it). Per config: those averaged over ok rows, plus cross-rep verdict
agreement and finding-set overlap. Rows whose status is not `ok` are counted and never scored.
