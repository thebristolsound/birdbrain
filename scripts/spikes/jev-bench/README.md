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

## Results, 2026-09-25 (`jev-1.13`, 1,340 requests, 5.2M input tokens, $0.22)

| Bench | Result | Verdict |
| --- | --- | --- |
| `evidence-pr`, whole PR | On PRs merged after the label existed (n=190): AUC 0.82, precision 0.87 / recall 0.51 at 0.5. Path-list backstop on the same set: precision 0.87 / recall 0.74. Twelve labelled PRs scored under 0.1; they include #677, #532 and #357, which ADR-0014 itself names as label noise, and #1586, whose own body says "none intended". | Path list still wins on recall. Jev's low scores agree with the assessment doc's noise list, so it earns a place as a demoter, not a replacement |
| `evidence-pr`, per-file hunks | The four incidental brushes (#786, #455, #357, #478) all scored 0.02–0.08. True evidence hunks ranked above them (AUC 0.85) but sat low: median 0.18, only 2 of 21 over 0.5. | Usable as "this backstop hit is probably incidental" at a threshold near 0.1, never as a detector |
| `claim-diff` | Real bullets: 89% read as supported. Negated bullets: 10% caught; 96 of 116 still read as supported. The #1569 claim: supports at 0.56. AUC 0.59. | Fails. A 70k-character diff is the "large state full of irrelevant detail" case the model docs warn about. Retry with one file's hunks per claim before writing it off |
| `ready-bar` | Route choice 83% against the human label (53/60 agent, 49/60 human, 0/3 needs-info). `process` label AUC 0.92, recall 94%. Min-of-four bar Nouls AUC 0.76, weaker than the direct choice. | Strongest result. Advisory triage label at issue open is worth a shadow run |
| `commit-type` | 74% agreement overall; 85% on the 163 commits at confidence ≥ 0.8. Disagreements are mostly arguable (dependabot bump typed `ci`, workflow cadence change typed `chore`). | Marginal. A lint that argues with the author on a third of commits is noise |
| `start-module` | 56% top-1, 71% top-3 over 18 modules with paths redacted. Renderer components 38/39; services and docs confused. | Not a pipeline use. Kept as a reading-comprehension control |
| `explore` | 61 open needs-triage issues ranked; 15 score over 0.5 on evidence risk, 6 on process. 22 of 40 agent PR top layers score under 0.5 on outsider readability though every one passed the linter. Commit oversell lens never exceeded 0.51. | The triage ranking and the top-layer score are the two lists worth a maintainer's read; drop the oversell lens |

Fair-comparison note: 11 of the 16 "false positives" against the label were PRs merged before
2026-08-02, when the label first appears, and every one is evidence work (verify canonicalization,
extraction pipeline, trusted-time axis). Five post-label PRs Jev scored ≥ 0.88 carry no label
though the path backstop fired too: #602, #610, #615, #1224, #1507. Those read as label misses.
