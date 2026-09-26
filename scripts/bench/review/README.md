# Review quality benchmark

Scores a model plus this repository's reviewer configuration against review cases with known
answers. The plan is `docs/plans/2026-09-25-review-quality-benchmark.md`. This directory holds
stage 1: the case corpus, the builder and the programmatic grader. No model is called here.

## Run

```
node build-cases.mjs            # fixtures/<id>/: case.json, truth.json, diff.patch, files/, pr.md
node build-cases.mjs --no-gh    # the same without the PR title and body
node grade.mjs --self-check     # oracle scores 1, null scores 0, an error row is counted not scored
node grade.mjs --results <rows.jsonl>
```

`build-cases.mjs` fetches `refs/pull/<n>/head` when a pinned commit is not local. `fixtures/`,
`results/` and `.cache/` are ignored.

## Cases

`cases/mutation/<id>.json` pins a merged PR (`base`, `head`) and one or more mutations: exact
`find` and `replace` text on a file at `head`, a category, whether it blocks, and the defect in
words. The builder applies each mutation, refuses one whose `find` is absent or ambiguous, and
derives the truth file with the line range the mutation landed on. The verdict is `request
changes` when any defect blocks.

`cases/real/<id>.json` pins a PR at the commit a pre-pass reviewed and carries the truth file by
hand: adjudicated defects, and findings a skeptic pass refuted.

## Grading

A finding matches a defect on the same file when its line is inside the defect's range widened
by five lines; a defect with no range matches on file alone. Only the first five findings count.
Per row: verdict correct, blocker and defect recall, unmatched findings, hits on refuted
findings, and a claim check per finding (the cited file exists at the reviewed tree, the line is
inside it, the quote is in it). Per config: those averaged over ok rows, plus cross-rep verdict
agreement and finding-set overlap. Rows whose status is not `ok` are counted and never scored.
