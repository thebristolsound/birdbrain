# pr-sweep prompts

Fill the `<...>` slots. Both prompts share the session constraints block; keep it verbatim.

## Session constraints (append to every prompt)

```
Session constraints: the maintainer is present and will merge on approve, including
evidence-affecting PRs; still apply the evidence gate and claim discipline in full. The
machine has 4 cores and several agents run at once. Work in a fresh git worktree under /tmp
and remove it when done; never touch <other worktrees holding this branch>. Node 20 via
`mise exec --`. Post nothing to GitHub: return files and text, the coordinator posts them.
```

## Review

```
Pre-pass review of PR #<n> in thebristolsound/birdbrain (branch <branch>, head <sha>,
closes #<issue>, labels <labels>). <First review | Round <k>: previous reviewed sha <sha>;
your earlier verdict and the replies are on the PR; since then: <commits and what each does>.>

Enumerate the review surface yourself with --paginate (pulls/<n>/reviews,
pulls/<n>/comments, issues/<n>/comments) and judge every bot finding. <For a delta round:
verify each earlier blocker is fixed by mutating the fix yourself, and review
`git diff <old>..<new>` minus what the main merge brought in.> <Name any merge resolution to
check.>

Verification: CI is authoritative. Read `gh pr checks <n>`; if required checks are pending,
say so, waiting at most ~10 minutes. Run the touched test files only, not the full coverage
suite or the build, and say the full loop was left to CI at this sha. Trial-merge against the
latest origin/main and report whether it is clean.

Write the verdict (post-comment pre-pass verdict shape) to /tmp/pr<n>-verdict.md and run
.claude/skills/post-comment/scripts/check.sh on it. Return: the path, the verdict, a
≤140-char status description, every finding in ## Summary (the squash commit body) with the
exact sentence and corrected wording, CI state, and the head sha re-read at the end.
```

## Fix

```
<Feedback round | Unblock> on existing PR #<n> in thebristolsound/birdbrain (branch <branch>,
remote head <sha>, closes #<issue>, labels <labels>). Push to that branch; open no new PR.

<What is wrong, by pointer: "the latest pre-pass verdict on the PR has <k> blocking
findings", or the failing check and run id, or "conflicts with main".> Re-enumerate the
review surface with --paginate and apply or reject-with-reason every item, each real defect
with a test that fails without the fix. <Known main changes to expect, e.g. a toolchain
bump.>

Merge origin/main into the branch (no rebase) and list each conflict and how both sides were
kept. If a migration conflicts, renumber this PR's migration after main's and never edit
main's. Verify with `pnpm preflight`, capturing exit codes. Commit per the
post-commit-message skill (run its check.sh). Push only as a fast-forward of <sha>.

Return: the new head sha, what changed per finding, conflicts resolved, verification output
with exit codes, a corrected full body file that passes
.claude/skills/post-pr-body/scripts/check.sh (Verification block refreshed, Summary still
true), and reply text in the post-comment reply shape keyed to each comment id it answers.
```
