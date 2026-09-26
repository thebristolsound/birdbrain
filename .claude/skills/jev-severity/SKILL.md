---
name: jev-severity
description: Bucket an issue's findings into blocking, should-fix and polish with Jev (TypeSafe System One), flag where it disagrees with the author, and score each finding's evidence relevance. Run it during triage of a review pass or any issue that needs a severity call.
disable-model-invocation: true
---

# jev-severity

A review pass lands as one issue with twenty or more findings, each carrying the author's own
severity. Triage needs a second opinion on every row before the blocking ones are pulled out,
and reading them one at a time is where the call drifts. This skill asks Jev three questions
per finding and prints the buckets, so the triage session argues with a table instead of
re-deriving each row.

## Run

```shell
TYPESAFE_API_KEY=<key> node .claude/skills/jev-severity/scripts/classify.mjs <issue>
node .claude/skills/jev-severity/scripts/classify.mjs <issue> --dry-run   # parsed rows, no API call
node .claude/skills/jev-severity/scripts/classify.mjs --file <notes.md>    # a local findings list
```

The key is not on disk: it lives only as the repository secret `TYPESAFE_API_KEY` (set
2026-09-26) and in the maintainer's hands. Without it, `--dry-run` still shows what would be
sent. A full run over 27 findings is 27 requests and about 26k input tokens; responses are
cached under the output directory, so a re-run with unchanged questions is free.

## What it reads

Every Markdown table in the issue whose header has a `Sev` (or `Severity`) column and a
`Finding` (or `Title`) column. It maps `#`, `Ev`, `Where`, `Repro` and `Seen` when present,
keeps the first row for each id, and drops the cross-reference rows a screen-by-screen review
repeats (`| 2 | B | yes | "Tampered" label, see the imported-cases block |`). Author
severities `B`, `S`, `P` read as blocking, should-fix, polish. An issue with no such table is
sent whole, as one finding.

## What it asks

For each finding, with the product described as an evidence tool in beta:

- **severity**, a Choice over blocking, should-fix, polish, judged by harm to the user.
- **evidence**, a Noul: does it affect what the tool stores, verifies, signs, exports, or says
  about integrity and timestamps.
- **false claim**, a Noul: does the tool assert something untrue (intact evidence called
  tampered, missing, or verified).

The report is `report.md` under `/tmp/jev-severity/<issue>/`, with `results.json` beside it,
and the same text on stdout: one table per bucket sorted by confidence, then the rows where
Jev and the author differ, then the rows under 0.50 confidence.

## Reading the report

- A disagreement at 0.80 or higher is a real second opinion. Bring it to the maintainer with
  Jev's reasoning restated in the finding's own words. Under 0.50 it is a coin flip; say so.
- **Evidence near 1.00 on a row the author marked `no`** is the row to re-read first. The
  `evidence-affecting` label is still the human's call (`docs/agents/triage-labels.md`); the
  score says where to look, not what to apply.
- **False claim over 0.60** is the tool lying to a user about their evidence. On this
  product that is the worst copy class, whatever bucket it lands in.

`scripts/test-parse.sh` runs the parser over `scripts/fixtures/issue-1592.md`, the review
pass that shaped the questions.
