# One shape per posting surface, checked before the write

**Status:** Accepted

**Date:** 2026-08-29

## Context

Agents write to three surfaces on GitHub: branch commit messages, PR bodies, and issue or PR
comments. On 2026-08-29 the state of each was:

- Commit bodies were unbounded narrative. The squash-merge setting
  `squash_merge_commit_message = COMMIT_MESSAGES` concatenated every branch commit into the
  merge commit, so #1068 landed on `main` with about 80 lines of message.
- PR bodies followed no shared shape. `.github/pull_request_template.md` had eleven sections
  written for human contributors; agent PRs ignored it and used a private five-section layout
  with sections that walked through acceptance criteria and pasted test output (#1117 ran
  to 133 lines). ADR-0018 governed only the Verification block.
- Comments had shapes for the cycle claim, release and pre-pass verdict, but the pre-pass full
  report was being posted as a second PR comment (#1125), and review replies, give-up findings
  and defect filings had no shape.
- 11 of the last 30 commits on `main` carried a `Co-authored-by` trailer: two `Claude`
  trailers from `claude[bot]` cloud sessions, nine `Matt Donovan` trailers GitHub appends at
  squash time.

Every rule that existed was prose in `CLAUDE.md`, the agent definitions, and the dispatch skill.
Nothing checked a message before it was written, and the pre-pass found the defects one review
round at a time.

A survey of existing tools found that `commitlint` (v21.2.2) lints a message file before any
commit exists, that no tool lints PR body section structure locally and GitHub has no
required-section feature, and that Claude Code has an `attribution` setting (since v2.0.62)
that turns the trailer off at the source. The full decision record is
`docs/plans/2026-08-29-agent-posting-controls.md`.

## Decision

### Each surface has one shape, held with its linter in a skill

`.claude/skills/post-commit-message/`, `post-pr-body/` and `post-comment/` each hold the
rule (`SKILL.md`), the canonical example (`template.md`) and a `scripts/check.sh` that lints a
file and also runs as a `PreToolUse` hook on `Bash`. The text is always written to a file and
passed by path (`git commit -F`, `--body-file`, `--input`); the hook blocks the inline forms
because they cannot be linted before they land.

The shapes: a commit is `<type>(<scope>): <subject>` at 72 columns with an optional 6-line body
and no closing keyword or trailer. A PR body is `Closes #N`, Summary (5 sentences), Changes
(bullets), Evidence-affecting (Yes or No, with the four impact fields when Yes), Verification
(the preflight block verbatim, ADR-0018), the attribution line last, and 40 lines before
Verification. A comment's first line names its kind, and each kind has a line cap; the pre-pass
full report never goes on the PR.

The PR body shape is the same for humans and agents: `.github/pull_request_template.md` is a
copy of the skill's template. The one difference is the attribution line: an agent ends with
it, a human omits it, and the `--any-author` mode of the linter (what `merge-pr` runs under
`gh`) accepts both.

### The squash-merge commit is composed, not concatenated

The repository settings move from `squash_merge_commit_title = COMMIT_OR_PR_TITLE` and
`squash_merge_commit_message = COMMIT_MESSAGES` to `PR_TITLE` and `BLANK`. The dispatcher's
merge call supplies the subject and a body copied from the PR body's Summary section. A human
merge does the same by hand. Branch commit messages therefore stop being a record and become a
note to the reviewer.

### Identity is settled in settings, and the check is the backstop

`.claude/settings.json` sets `attribution` to empty strings, `includeGitInstructions: false`
so the skills are the only commit and PR instructions an agent receives, and
`outputStyle: "Plain Technical"` with the style file at `.claude/output-styles/` so cloud
sessions and runners get the same register. CodeRabbit's `high_level_summary` is off. The
linters still reject a trailer or a platform footer, because claude-code issue #45137 reports
the attribution setting being ignored on one path.

### Enforcement starts on one agent

`birdbrain-implementer` loads `post-commit-message` and `post-pr-body` at start. Their hooks
are registered in `.claude/settings.json` and each `check.sh` acts only when the payload's
`agent_type` is in its `bound=` list, so binding a surface to another agent is a one-word
change in that script. The reviewer and dispatcher write comments against `post-comment` by
instruction and run its check by hand. Interactive sessions are bound by prose only. The
binding widens to the other roles once the implementer hooks have held for a few PRs.

The hooks were first placed in the agent's frontmatter. A probe on 2026-08-29 showed that a
subagent spawned from a t3code session (`entrypoint: sdk-ts`) runs without them, while the
same agent spawned from a plain `claude` session, or run with `--agent`, gets them. A
`settings.json` hook reached the subagent on both paths, and its payload carries `agent_type`
(Claude Code 2.1.69), which is what the gate reads.

## Consequences

- A body or commit defect is caught in the turn that writes it, at the cost of a linter run,
  rather than in a pre-pass round.
- The pre-pass still reviews body accuracy (ADR-0018). What it no longer has to review is
  shape.
- The merged history on `main` loses the branch-level narrative. The PR keeps it.
- `includeGitInstructions: false` and the project-scoped output style are experiment
  variables: a change in commit or PR behaviour after this ADR has them as named suspects.
- Whether `claude -p` (the doc-curator runner) applies `outputStyle`, and whether `BLANK`
  suppresses GitHub's squash-time co-author trailer, are unverified and get checked on the next
  run of each.
- Every session in the repository runs the two hooks on every `Bash` call. The cost is one
  `node` start per call for the gate; the linters run only for a bound agent's commit or PR
  write.

## Alternatives rejected

**Prose rules only.** That is the state this ADR replaces.

**A CI check on agent PR bodies.** It arrives after the push, which under ADR-0018 costs a
verify-loop run, and would duplicate the pre-pass checklist. It stays available as a backstop if
the hook is bypassed in practice.

**Keep `COMMIT_MESSAGES` and cap branch commit bodies.** That makes the merged message depend
on branch hygiene, which is the thing that failed.

**`PR_BODY` as the squash message.** It would put the Verification block and the attribution
line into git history.

## Related

- ADR-0018 - the Verification block is computed at head; this ADR shapes the rest of the body.
- ADR-0027 - the machine account authors every pipeline write; unchanged here.
- `docs/plans/2026-08-29-agent-posting-controls.md` - the fifteen decisions and their facts.
- #1068, #1117, #1125 - the merged message, PR body and comment this ADR is measured from.
