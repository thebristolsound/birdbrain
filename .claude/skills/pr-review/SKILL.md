---
name: pr-review
description: Review one maintainer-authored PR for the scheduled PR review job (ADR-0046) - spawn the reviewer agent at a pinned commit and leave a verdict comment file for the workflow to post. Started by `.github/workflows/pr-review.yml` as `/pr-review <pr> <sha>`; not for interactive use.
disable-model-invocation: true
---

# Review one PR

You review one PR the maintainer opened, at the commit the pre-gate pinned, and leave the
verdict in a file. You write nothing to GitHub: the workflow gives this session a read-only
token, and its post step posts your verdict as the machine account and sets the PR's
`review:` state label (ADR-0046). The arguments are the PR number and the full head sha.

Dispatch's pre-pass is the model for everything here, with two differences. The PR is the
maintainer's, not an agent's, so nothing here pushes, fixes, merges, or marks it ready. And the
verdict is a comment and a label only: no `agent/pre-pass` status, which the merge gate reads.

## 1. Pin the commit

Read the head: `gh api repos/thebristolsound/birdbrain/pulls/<pr> --jq .head.sha`. If it is
not the sha you were given, write no verdict and end with the report (section 5) saying the
head moved. The post step labels the PR `review:failed`, and the next fire picks it up again.

## 2. Read CI

Run `bash .github/scripts/dispatch/checks.sh --wait 540 <pr>`, and repeat it while it exits 124.
When its `failing` list is not empty, do not spawn the reviewer: CI is authoritative over any
review (the reviewer's own rule), and the diff is about to change. Write a `request changes`
verdict whose one finding names each failing check in plain words, and go to section 4. A
check that is failing on `main`'s own most recent run of the same workflow is not this PR's
red; leave it out and say so inside the report block.

## 3. Spawn the reviewer

Spawn `birdbrain-reviewer` in the foreground (`run_in_background: false`) with this brief:

- The PR number, the pinned sha, and the head branch.
- The maintainer opened the PR. It may have no linked issue: when line 1 of the body is
  `No issue: <clause>`, judge scope against the body's Summary instead of acceptance criteria.
- The attribution line is optional on this PR. A human-written body omits it, and the merge
  linter accepts both forms (`check.sh --any-author`); a mid-body or altered one is still a
  finding.
- Auto-merge enabled by the maintainer's `merge` label is his merge request, not a finding.
- Draft state is not a control, as on agent PRs.
- Every other pass, the evidence gate and the verify loop run as the agent file states.
- Post nothing and label nothing. Return the full report.

## 4. Write the verdict

Copy the reviewer's full report to the path the prompt names. Then write
`.dispatch/verdict.md` in the pre-pass verdict shape of the `post-comment` skill (its
`template.md` holds the example):

- Line 1 is `**Review verdict: request changes**` when any finding is blocking, and
  `**Review verdict: approve for human review**` otherwise.
- At most five numbered findings on the top layer, one plain sentence each.
- One `<details>` block with `<summary>Full report</summary>`. Its first line, after the blank
  line, is exactly `Reviewed commit: <full 40-character sha>`; the post step refuses a verdict
  without it. Then the findings table and the report. When the whole comment would pass 60,000
  characters, keep the table and replace the prose with the `Full report: <link>` line the
  prompt gives.
- No disclosure note: the machine account posts it.

Run `bash .claude/skills/post-comment/scripts/check.sh .dispatch/verdict.md` and fix the file
until it exits 0.

## 5. Report

End your turn with a heading line containing `PR review report`, then the PR number, the
reviewed sha, the verdict line, and one line per finding. If you wrote no verdict, say why.
