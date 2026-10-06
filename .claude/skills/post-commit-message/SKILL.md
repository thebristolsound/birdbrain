---
name: post-commit-message
description: The branch-commit message shape for agent sessions, and the commitlint check that gates `git commit`. Preloaded into the implementer; invoke it in any session that commits.
---

# post-commit-message

Branch commits vanish at squash: the repository setting is `BLANK`, and the merge commit gets
the PR title plus the PR body's Summary section. A branch commit message is therefore a short
note to the reviewer reading `git log -p`, not a record.

## The shape

`template.md` in this directory is the canonical example. The rules, enforced by
`commitlint.config.mjs` at the repository root:

- Header `<type>(<scope>): <subject>`, at most 72 columns. Types come from
  `@commitlint/config-conventional`; the scope is required.
- The subject starts with a lowercase letter. Reword when a proper noun, a number or an ADR
  id would come first.
- A merge commit takes a scope like any other, for example `chore(merge): ...`. Git's own
  `Merge branch ...` and `Revert "..."` messages are rejected; rewrite them in this shape. For a
  bound agent the hook blocks `git merge` and `git revert` unless they stop before the commit
  (`--no-commit`, or a `--ff-only` merge); finish with `git commit -F <file>`.
- An optional body: at most 6 lines, wrapped at 72 columns, saying why. No investigation
  narrative, no list of what the diff already shows.
- No `Closes #N` or any other closing keyword. That is line 1 of the PR body.
- No `Co-authored-by` trailer of any kind. The repository settings turn the default one off
  (`attribution.commit` in `.claude/settings.json`); the check catches one that slips through.

## How to commit

1. Write the message to a file, for example `.git/COMMIT_MSG` or a path under `/tmp`.
2. Run `${CLAUDE_SKILL_DIR}/scripts/check.sh <file>` and fix the file until it exits 0.
3. Commit with `git commit -F <file>`, in a separate Bash call from the one that wrote the
   file: the hook runs before the command does, so a heredoc in the same call has not written
   the file yet when the hook looks for it. Never `-m`: the hook blocks it, because a message on
   the command line cannot be linted before it lands.

Stage files explicitly (`git add <path>`), never `git add .` or `git add -A`, and review
`git diff --staged` first. One logical change per commit.

## The hook

`scripts/check.sh` runs as a `PreToolUse` hook on `Bash`, registered in `.claude/settings.json`
so it sees every session on every spawn path. It acts only when the hook payload's `agent_type`
is in the `bound=` list at the top of the script (`birdbrain-implementer` today), or when
`BIRDBRAIN_DISPATCH=1`, which `.github/scripts/dispatch/run.sh` sets for every session of a
scheduled cycle; an interactive session or an unbound agent passes through. Agent frontmatter
`hooks:` are not used: sessions that supply the agent roster through the SDK (t3code) drop
them, verified 2026-08-29.
It blocks `git merge` and `git revert` unless the command stops before the commit
(`--no-commit`, `--squash`, `--ff-only`, `--abort`, `--quit`; for a revert also `-n` and
`--skip`). Otherwise it acts only on a command that runs `git commit`:

- `-F <file>` or `--file <file>`: the file is linted with `pnpm exec commitlint --edit`; a
  failure blocks the command and returns the findings.
- `-m` or `--message`: blocked with an instruction to use a file.
- `-F -` (a heredoc): blocked for the same reason.
- `--amend`, `-C` or `-c` with no new message: allowed, since the message already passed.

`scripts/test-check.sh` runs the fixtures under `scripts/fixtures/` through both the direct
and the hook path.
