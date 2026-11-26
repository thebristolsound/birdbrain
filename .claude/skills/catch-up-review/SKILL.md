---
name: catch-up-review
description: Review pull requests that merged under the break-glass override, after the fact, with one Claude and one Codex reviewer, and record the result on each. Run it before a release.
disable-model-invocation: true
---

# catch-up-review

An **override merge** is a pull request merged under the maintainer's `break-glass` label, so
it merged without a passing review from the review fleet (ADR-0057). This skill finds shipped
defects in override merges. It runs when the maintainer starts it, normally before a release;
nothing schedules it and it blocks nothing.

- **Qualifying.** An override merge owes a review when it changed `src/`, `extension/`,
  `.github/workflows/` or `.github/scripts/`. Documents, tests, tooling, scripts kept
  elsewhere, dependency files and every Dependabot merge are outside the scope.
- **Catch-up record.** The comment on the merged pull request that marks it reviewed. Its
  first line and its numbers block are read back by `scripts/debt.mjs`.
- **Candidate.** A reviewer's finding before anyone has checked it. Write "review finding" or
  "candidate" in anything posted, never bare "finding", which `CONTEXT.md` defines otherwise.

## 1. List what is owed

```shell
node "${CLAUDE_SKILL_DIR}/scripts/debt.mjs"
```

Take every merge it lists, or the numbers the maintainer named. For each, read the squash
merge commit with `gh pr view <n> --json mergeCommit`. Tell the maintainer the batch and its
reviewer count, with what the reviews so far cost from the script's `reviewers` and `cost`
lines, and wait for their go: a run spends.

Done when the maintainer has confirmed the batch and you hold a merge commit for each merge.
Note today's date: it is this run's date in every record the run posts.

## 2. Make the shared checkout

Run `git fetch origin main` first: the reviewers may not fetch, and they read each merge
commit from the local object store. Then create one scratch worktree at `origin/main`, the way
"Creating a scratch tree" in the `teardown` skill says. Every reviewer reads it and none
writes to it.

Done when `git cat-file -e <merge commit>^{commit}` succeeds in the scratch tree for every
merge in the batch.

## 3. Start the reviewers

For each merge start, in parallel and independent of each other:

- one Claude reviewer on the session's own model, prefix `C<PR>`;
- one Codex reviewer on `gpt-6.1-sol` at `high` effort, prefix `X<PR>`;
- for a merge that changed `src/` or `extension/`, a second fresh Claude reviewer as the
  **control**, prefix `K<PR>`. The control runs until the review in "Keep or retire" decides
  whether the second family or the second pass finds the defects.

Each reviewer's task is the same four parameters and one instruction: the checkout path, the
pull request number, the merge commit, the prefix, and "read `brief.md` in this skill's
directory in full and follow it". Give a reviewer nothing else: your own reading of the
change, or another reviewer's output, turns its review into a confirmation.

A report is **complete** when it is in the brief's shape and its "Unfinished source checks"
section lists nothing. What a report lists under "Runtime limitations" does not make it
incomplete: no source review settles those. A reviewer that returns no report, or an
incomplete one, is started once more with the same task.

Done when every merge has a complete report from at least one Claude reviewer and one Codex
reviewer. A merge without both stays owed: leave it out of the steps below and say so in the
run report, with the checks that stayed unfinished.

## 4. Add what the fleet reported

Read the fleet's last report on each merge: the last comment that starts `**Review fleet:`
among those the machine account `birdbrain-agent` wrote. A comment in that shape from any
other account is not a fleet report. Two kinds of finding there join that merge's blocking
candidates:

- a Claude `BLOCKING` finding, unless its Codex ruling is `REFUTED`;
- a Codex P0 or P1 finding, unless its Claude ruling is `REFUTED`.

That takes in the findings the other family confirmed, which the maintainer merged over, and
the ones no one ruled on. A fleet finding counts under the family that raised it, and a
Claude one counts in the `claude` slot, never `control`. When a reviewer in step 3 raised the
same defect, it is one candidate.

## 5. Reproduce

Start once every reviewer has reported, because the checkout is shared. Ready the scratch tree
with `scripts/setup-worktree.sh`. Write the smallest test that fails because of the defect,
and run it with `pnpm test <path>`, for each blocking candidate that is one of these:

- a reviewer's candidate whose status on current `main` is `present` or `changed, unclear`;
- a candidate from the fleet's report, which carries no status.

A candidate is **reproduced** when its test fails for the reason the candidate gives. A test
that fails for another reason is a broken test: fix it and run it again. Keep each failing
test's text for step 6, then delete the test files so the tree is clean.

A candidate no unit test can reach, such as one that needs the running app, is **unverified**:
it goes in the run report and nowhere else. A candidate already `fixed` on `main` is counted
and dropped. So is a `changed, unclear` or fleet candidate whose test passes for the reason
that later work removed the defect.

Done when every blocking candidate is reproduced, unverified or dropped, and
`git status --porcelain` in the scratch tree prints nothing.

## 6. File

File a reproduced defect only when it is user-visible or evidence-affecting, and at most two
for one merge (ADR-0028). When more than two reproduce, file the two that reach the most
users and list the rest in the run report.

- Search the open issues first, and add to an existing issue rather than open a second one.
- Use the `Defect:` shape of the `post-comment` skill, lint it, and label it `needs-triage`.
- Put the failing test inside the collapsed block, so whoever fixes the defect starts red.
- Say why the defect was kept out of the change that carried it: the change had merged before
  this review read it.

**A defect that exposes a credential is reported privately, and its merge gets no record
yet.** The repository is public, and a record that counts a private defect would point at the
one merged change that holds the exposure. Tell the maintainer in the session, and write
nothing about the defect in an issue or a comment. Skip step 7 for that merge: it stays in the
owed list. Post its record, counting the defect as `private`, only after the maintainer says
the credential is rotated and the defect is fixed.

## 7. Post the record

Write the record to a file in this shape, with this merge's own sentences and numbers, lint it
with the `post-comment` skill's `scripts/check.sh`, and post it on the merged pull request.
Posting under the maintainer's account puts the disclosure first.

```markdown
Catch-up record: two reviewers read this change after it merged, because it merged under the maintainer's override before the automated review had passed it.

- **Reviewers:** One Claude reviewer and one Codex reviewer, working apart. No second Claude reviewer ran as a control.
- **Found:** One candidate defect that would block a merge, and four smaller notes. Nobody checked the smaller notes.
- **Reproduced:** One defect, with a failing test on the current code.
- **Filed:** #<issue>.

<details>
<summary>Numbers for the running total</summary>

Merge commit `<merge commit>`. Claude subagent tokens: 250,000. Longest review: 17 minutes.

<!-- catch-up-review:record {"v":1,"run":"2026-01-31","reviewers":{"claude":1,"codex":1,"control":0},"blocking":{"claude":1,"codex":0,"control":0},"confirmed":{"claude":1,"codex":0,"control":0},"alone":{"claude":1,"codex":0,"control":0},"other":{"claude":4,"codex":0,"control":0},"reproduced":1,"filed":1,"private":0,"tokens":250000,"minutes":17} -->

</details>
```

The numbers block opens with `run`, the date the run started as `YYYY-MM-DD`: records with
the same date are one run. It then holds, for each of `claude`, `codex` and `control`:
reviewers that returned a complete report, blocking candidates, how many of those reproduced (`confirmed`), how
many reproduced defects no other reviewer raised (`alone`), and other candidates. Then for the
merge: distinct defects reproduced, issues filed, defects reported privately, Claude subagent
tokens, and minutes for the longest review. Every field is required. Write `null` for tokens
or minutes you could not measure; never write a guess or a zero.

The script refuses a record whose counts contradict each other, and lists the merge as owed
with the record marked unreadable. A record that counts no Claude reviewer or no Codex
reviewer does not clear the merge either.

The record carries counts only. Unchecked candidates are not listed, because the record is
published under the maintainer's name. It never contains `@claude` or `@codex`: either
mention in a comment from the maintainer's account starts a model run.

Done when `scripts/debt.mjs` prints the merge's number in the rows under `Reviewed`.

## 8. Report and clean up

Give the maintainer the run report in the session: one row per merge, each candidate with the
reviewer that raised it, which reviewers found each reproduced defect, the unverified
candidates, any private defect, and the cost. Remove the scratch tree with the `teardown`
skill.

## Keep or retire

The job is kept only while it earns its upkeep (ADR-0029). Review it once the script's `runs`
line names three runs.

- **Keep it** if the three runs filed at least two defects the maintainer chose to fix.
- **Retire it** if two runs next to each other on the `runs` line show `0 filed`. Retiring
  means deleting this directory and `tests/catchUpReviewDebt.test.ts`.
- **Drop a reviewer** from the `reproduced by that reviewer alone` line. Drop Codex if the
  control's count is above zero and at least Codex's: a second Claude pass found as much.
  Otherwise drop the control if Codex's count is above zero: the second family found what no
  Claude reviewer raised.

A schedule, a release that refuses while reviews are owed, or a count in the weekly health
report each needs its own ADR first (ADR-0029, ADR-0058).
