# Jev benchmark spike

Does a System One model (TypeSafe's Jev) have a place in this repository's pipeline? This spike
scores Jev against labels humans already applied here, so the answer is measured rather than
argued. It is a spike: no dependency, no CI hook, nothing outside this directory.

## Run

```
export TYPESAFE_API_KEY=…       # console.typesafe.ai
node build-fixtures.mjs         # pulls PRs, issues, commits and diffs through gh and git
node run.mjs                    # every benchmark; or: node run.mjs claim-diff ready-bar
```

Responses cache under `.cache/` keyed on the request body, so a rerun costs nothing until a
question or fixture changes. A full first run is about 1,100 requests and 1.5M input tokens
(≈ $0.06 at the September 2026 price). `fixtures/`, `.cache/` and `results/` are ignored.

## Benchmarks

| Bench | Question Jev answers | Ground truth | Pipeline use if it scores well |
| --- | --- | --- | --- |
| `evidence-pr` | Could this merged PR alter an evidentiary result? Per-file: do these changed lines? | The `evidence-affecting` triage label; the four incidental brushes ADR-0014 names (#786, #455, #357, #478) must score low | Second opinion beside the path-list backstop, which fires wrong 42% of the time |
| `claim-diff` | Does the diff support, contradict, or not cover this Evidence impact bullet? | Real bullets from merged PRs = supported; rule-negated copies = contradicted; the #1569 docblock claim = contradicted | Pre-pass lens on the section that has cost the most review rounds |
| `ready-bar` | The four ready-for-agent bar points as Nouls, plus a routing choice, plus "is this process work" | `ready-for-agent` / `ready-for-human` / `needs-info` / `process` labels | Advisory label suggestion at triage |
| `commit-type` | Which conventional-commit type fits subject + files? | The type the author wrote (259 commits) | Honesty check the shape-only commit linter cannot do |
| `start-module` | With paths redacted, which module does this issue's work start in? | The first path the issue named | Select-not-generate: proves the model reads the issue, not the path |
| `explore` | Ranked lists, no ground truth: needs-triage backlog by severity and evidence risk; agent PR top layers by outsider readability; feat/fix subjects that oversell their file list | none | Reading material for the maintainer, and a source of labelled cases for the next round |

## Reading the output

Each bench prints a summary and writes `results/<bench>.json` with every row. For binary
questions the summary carries precision/recall/F1 at 0.5, the best threshold, AUC and a
reliability table (does p≈0.8 mean 80% yes?). For choices it carries a confusion matrix and
accuracy at confidence ≥ 0.8.

Known label noise to keep in mind: the evidence label was applied by a path-list backstop for
much of the repository's history, and ADR-0014 measured 16 of 38 labelled merges as touching no
evidence path. A Jev score that disagrees with the label is not automatically wrong there.

## Constraints from the model docs (2026-09-17)

Jev reads literally, cannot count or compare dates, weakens on large irrelevant state, and can be
steered by adversarial text in the state. Every question here is a single semantic judgment over
filtered state; counting and thresholds stay in code. The claim check sends the diff with the
files a claim names first, capped at 70k characters.
