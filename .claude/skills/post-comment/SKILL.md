---
name: post-comment
description: The shapes for every comment an agent posts to a GitHub issue or PR (cycle claim and release, pre-pass verdict, review reply, give-up and defect filing, anything else), and the linter that checks a comment file before it is posted. Referenced by the dispatch skill and the reviewer.
---

# post-comment

Every comment an agent posts has a shape, a line cap, and no content it does not own.
`template.md` in this directory holds one example per kind. The kind is read from the first
line, so the first line is the contract.

## The kinds

| kind | first line | cap | rule |
|---|---|---|---|
| cycle claim | `Cycle claim: PR #<n>` | 3 lines | which action is claimed |
| cycle release | `Cycle release: PR #<n>` | 2 lines | none |
| pre-pass verdict | `**Reviewer pre-pass (<sha>): <verdict>**` | 20 lines | at most 5 table rows, one sentence each, and a `Full report: <link>` line |
| review reply | `applied <sha>` or `not applied: <one sentence>` | 1 line | one reply per thread, nothing else |
| give-up or defect | `Give-up: <one clause>` or `Defect: <one clause>` | 20 lines | `**What:**`, `**Where:**` as `file:line`, `**Reproduce:**` |
| anything else | free | 20 lines | none |

`<verdict>` is `approve for human review` or `request changes`. The full pre-pass report never
goes on the PR: it is written to a file or gist and the verdict links it.

Rules for every kind:

- No `Co-authored-by`, no platform footer, no CodeRabbit text. You author the comment; the
  platform may append its own footer afterwards, which is tolerated.
- Fenced blocks only in a give-up or defect comment, for the reproduction command. Test
  output and coverage figures belong in the PR body's Verification block.
- Name only actions you took and states you observed after taking them. A label another
  actor applies or a check CI will run is a handoff, never an assertion.

## How to post

1. Write the comment to a file. For a `gh api ... -X POST --input <file>` write, the file is
   JSON with a `body` field; the linter reads that field.
2. Run `${CLAUDE_SKILL_DIR}/scripts/check.sh <file>` and fix the file until it exits 0.
3. Post with `--body-file <file>` (or `--input <file>`). Never `--body`.

## The hook

`scripts/check.sh` runs as a `PreToolUse` hook on `Bash`, registered in `.claude/settings.json`
beside the commit and PR body hooks. It acts only when the hook payload's `agent_type` is in
the `bound=` list at the top of the script (`birdbrain-implementer` today); the dispatcher and
reviewer invoke it by instruction in step 2 above. It acts on `gh issue comment`,
`gh pr comment`, their `agh` forms, and `gh api` POSTs to a `/comments` or `/replies` endpoint,
linting the `--body-file` or `--input` file and blocking `--body`.

`scripts/test-check.sh` runs the fixtures under `scripts/fixtures/` through both paths.
