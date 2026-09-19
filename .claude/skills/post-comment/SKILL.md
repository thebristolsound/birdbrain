---
name: post-comment
description: The shapes for every comment an agent posts to a GitHub issue or PR (cycle claim and release, pre-pass verdict, review reply, give-up and defect filing, anything else), and the linter that checks a comment file before it is posted. Referenced by the dispatch skill and the reviewer.
---

# post-comment

Every comment an agent posts has a shape, a line cap, and no content it does not own.
`template.md` in this directory holds one example per kind. The kind is read from the first
line, so the first line is the contract.

## Two layers

A comment is a plain-language top layer plus collapsed detail, the way CodeRabbit nests its
review:

- **Top layer.** What a reader who has never seen this repository's tooling needs: the
  outcome, the ask, the finding in words. No code spans, file names or paths, commit ids,
  ADR numbers, tool names, or repository terms such as pre-pass, preflight, lint, typecheck,
  worktree, merge base, diff coverage or sha. The linter checks those as proxies for jargon.
- **Detail.** Everything else, inside one or more `<details>` blocks: a one-line `<summary>`
  in plain words, a blank line, then whatever the author finds most effective (tables with
  `file:line`, commit ids, commands, traces, fenced output). No line cap applies inside, and
  the block is where fenced blocks are allowed. Blocks do not nest and hold no `##` heading.

Line caps count the top layer only. The `<summary>` text is visible when collapsed, so it is
checked as top layer.

## The kinds

| kind | first line | top-layer cap | detail | rule |
|---|---|---|---|---|
| cycle claim | `Cycle claim: PR #<n>` | 3 lines | optional | which action is claimed |
| cycle release | `Cycle release: PR #<n>` | 2 lines | none | none |
| pre-pass verdict | `**Review verdict: <verdict>**` | 10 lines | required | at most 5 numbered findings, one plain sentence each; the block's summary starts `Full report` and names the reviewed commit id |
| review reply | `Applied.` or `Not applied: <one sentence>` | 1 line | commit for `Applied.` | one reply per thread, nothing else |
| give-up or defect | `Give-up: <one clause>` or `Defect: <one clause>` | 10 lines | required | `**What:**` on top; `**Where:**` as `file:line` and `**Reproduce:**` inside the block |
| anything else | free | 20 lines | optional | none |

`<verdict>` is `approve for human review` or `request changes`. The full pre-pass report goes
on the PR inside the verdict's `<details>` block, collapsed under `Full report`; when it
exceeds GitHub's comment limit, the block holds the findings table and a `Full report: <link>`
line instead. It never goes in the open and never as a second comment.

The two cycle first lines and the override record's first line are read back by scripts
(`cleanup.sh`, the override hygiene check), so they are exempt from the plain-language check.

Rules for every kind:

- No `Co-authored-by`, no platform footer, no CodeRabbit text. You author the comment; the
  platform may append its own footer afterwards, which is tolerated.
- Fenced blocks only inside a `<details>` block. Test output and coverage figures belong in
  the PR body's Verification block.
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

`scripts/lint-comment.mjs` imports the layer parser and plain-language check from
`../post-pr-body/scripts/layers.mjs`, so both surfaces read the same rule.
`scripts/test-check.sh` runs the fixtures under `scripts/fixtures/` through both paths.
