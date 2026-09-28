# Public cutover runbook

The timed checklist for making `thebristolsound/birdbrain` public (#270). The owner is the
maintainer (@thebristolsound), who runs every step, takes every decision below, and gives the
final go. Nothing in this runbook runs unattended.

This runbook records steps and expected values. It does not record decisions. Each decision it
depends on links to its durable record, and the decisions still open are listed as questions in
[Decide before the window](#decide-before-the-window).

## Decisions this runbook applies

| Decision | Durable record |
| --- | --- |
| No history rewrite, no force-push, no GitHub Support removal | ADR-0008, amendment 2026-09-28, "Decisions 1 and 2" |
| Main ruleset, tag ruleset, code owners | ADR-0008, amendment 2026-09-28, "Decision 4"; #1372 |
| Actions baseline, access, branches, dispatch artifacts, evidence custody, beta decoupling, flip-window chores | ADR-0008, amendment 2026-09-28, "Rulings the cutover checks against" |
| Spend: anything that can cost the maintainer money runs only when he starts it or on a schedule he set | ADR-0008, amendment 2026-09-28, the "Spend" item under "Rulings the cutover checks against" |
| Third-party review apps act only on the maintainer's or the agent's pull requests, or are listed for uninstall | #1310, ruling comment of 2026-09-28 (the money rule) |
| Runs are not deleted, so past run pages keep their summaries | #1369, ruling comment of 2026-09-28 |
| The four old pre-releases go once the next beta has updated testers, not necessarily in this window | #1362; #270, "Corrected 2026-09-28" |
| The 20 branch deletions and the Shared Case and persona exclusion | #1370, ruling comment of 2026-09-28 |
| The runbook's step list | #270, "Corrected 2026-09-28" |
| The checks the cutover runs | #271, "Corrected 2026-09-28" |
| Dispatch run bundles expire on their own | #1369 |
| Scheduled Dispatch and Doc curator stay paused | ADR-0029 |

The post-flip audit is #272. The counts behind this runbook are in
`docs/specs/2026-09-28-pre-cutover-evidence-summary.md`; the raw evidence stays in the
maintainer's custody, outside the repository.

## Decide before the window

The 2026-09-28 inventory found six things that change a step. None of them is decided here.
Record each answer on #270 before the window opens.

1. **The Wiki tab is on, and no wiki exists.** `has_wiki` reads `true`, and
   `git ls-remote https://github.com/thebristolsound/birdbrain.wiki.git` answers "Repository not
   found". The inventory did not read the wiki's edit-restriction setting, so who could create
   the first page after the flip is unknown. Turn the tab off
   (`gh repo edit thebristolsound/birdbrain --enable-wiki=false`), or keep it and confirm on the
   settings page that wiki editing is restricted to collaborators.
2. **GitHub Pages is already public.** `gh api repos/thebristolsound/birdbrain/pages` reads
   `"public": true` with `build_type` `workflow`. The documentation site is disclosed today, so
   the flip adds nothing there. Confirm the published site holds nothing you would not publish
   with the repository. The site carries two of the three "source is private" statements, and
   the `Docs` workflow deploys on a push to `main`, so step 17 merges the text change after the
   re-enable in step 16.
3. **Comments from the Linear integration name two Linear workspaces.** The 2026-09-28 export
   holds 872 comments by `linear-code[bot]`, linking into two distinct workspaces, and the newest
   is at 17:01 UTC that day, so the integration still posts. Accept the workspace names as
   public, disconnect the integration before the flip so new issues stop getting them, delete
   the existing comments, or a combination.
4. **`vars.CLAUDE_CODE_OAUTH_TOKEN_EXPIRES` is referenced and unset.**
   `.github/workflows/dispatch.yml:137` and `.github/workflows/health.yml:57` read it, and
   `gh api repos/thebristolsound/birdbrain/actions/variables` does not list it. The health probe
   prints a notice instead of warning ahead of expiry. Set it (its value becomes public at the
   flip, as every variable value does), or remove the references.
5. **Workflow run logs and artifacts become readable and were not scanned.**
   `gh api 'repos/thebristolsound/birdbrain/actions/runs?per_page=1' --jq .total_count` read 6682
   and the artifacts endpoint 174, under a 90-day retention
   (`actions/permissions/artifact-and-log-retention`). Scan them before the flip, delete run logs
   in the window, or accept them unscanned. The #1369 ruling says "Runs are not deleted either,
   so past run pages keep the summaries they show today", and keeps the `dispatch-run` artifacts
   until they expire. Deleting a run's logs leaves the run and its page, but check the answer
   against that line; deleting artifacts or runs would need a new ruling.
6. **A personal address sits in the body of pull request #94.** One line of that body matches a
   consumer webmail address. ADR-0008 accepts the personal addresses in commit identity fields;
   it says nothing about pull-request text. Edit the body before the flip, or accept it.

Three smaller questions have no ruling yet:

- **When to flip back.** No record says which failures after step 8 justify making the
  repository private again. Decide whether a failed settings step is one, or only unexpected
  exposure, and record it on #270. The incident path below leaves the call to you.
- **Fork pull-request approval.** `actions/permissions/fork-pr-contributor-approval` answers 422
  ("not allowed for private repositories") today. No ruling names a value. Pick one before the
  window; step 15 sets and reads it back.
- **Notifications.** `gh api repos/thebristolsound/birdbrain/subscription` answers 404 with the
  current token, which lacks the `notifications` scope. Step 6 checks the watch setting on the
  web instead.

## Before the window

Run these the day before, and again at the start of the window if anything changed.

1. **Run the dry run** from a checkout of `main`, passing the custody copy of the refs the
   session 4 bundle was built from, which pins each ruled branch's tip:

   ```bash
   PINNED=~/birdbrain-custody/2026-09-28-precutover/inventory/mirror-refs.txt
   bash scripts/cutover/dry-run.sh "$PINNED"
   ```

   It must end `Summary: <n> GO, 0 NO-GO.` It makes GET requests and read-only git calls only;
   see [What the dry run proves](#what-the-dry-run-proves).
2. **Open the text change as a draft pull request.** The three statements ruled for the flip
   window:
   - `website/content/docs/download.mdx`, lines 10 to 12 ("the source repository opens when the
     public-readiness effort closes").
   - `website/content/docs/tester-guide.mdx`, line 32 ("The source repository is private").
   - `.github/workflows/release.yml`, lines 53 to 54, the release-notes template ("Source opens
     when the public-readiness effort closes").

   Let its checks go green, then leave it unmerged. Step 17 merges it.
3. **Confirm no release shares the window.** No tag push and no `Release` run is planned for
   the day (#271, criterion 7).
4. **Confirm the reporter is available.** The collaborator who keeps write access files the
   vulnerability-report test at step 18.
5. **Confirm no review app can spend on a stranger's pull request.** Nothing that costs money
   may start without the maintainer: it runs only when he starts it or on a schedule he set
   (ADR-0008, amendment 2026-09-28, "Spend"). For third-party review apps, #1310's ruling asks
   that each acts only on the maintainer's or the agent's pull requests, or is listed for
   uninstall, and names that settings work as the maintainer's own. The flip is the first time
   an outside account can open a pull request. The API refuses the installed-app list to a user
   token (403 in the session 4 export), so check on the web:
   - <https://github.com/settings/installations>, the account's installed GitHub Apps, and the
     repository's **Settings** > **GitHub Apps** page. Each app's own pull-request filter lives
     in that app's configuration.
   - <https://github.com/settings/copilot> for Copilot code review, which appears in the freeze
     list as a dynamic workflow rather than as an installed app.

   The 2026-09-28 export has comments by these bot and app accounts, among others:
   `coderabbitai[bot]`, `chatgpt-codex-connector[bot]`, `Codex`, `macroscopeapp[bot]`,
   `Copilot`, and `claude[bot]`. For each review app found, record on #270 where it is limited
   to the maintainer's and the agent's pull requests, or that it is listed for uninstall. An
   app with neither is stop condition S9.
6. **Answer the questions** in [Decide before the window](#decide-before-the-window).

## The window

Set a log directory in the maintainer's custody and keep every output there. Write the time in
UTC at the start of each step.

```bash
LOG=~/birdbrain-custody/$(date -u +%F)-cutover
mkdir -p "$LOG"
R=thebristolsound/birdbrain
PINNED=~/birdbrain-custody/2026-09-28-precutover/inventory/mirror-refs.txt
```

### Step 1: freeze merges, tags, and workflows (10 minutes)

Record the workflow list with each workflow's state, then turn off the active ones by id. The
dry run of 2026-09-28 listed 20 registered workflows, with 18 active and `Dispatch` and
`Doc curator` already `disabled_manually`. 13 have a file on `main`; `Diag variable read` is
registered at `.github/workflows/diag-variable.yml`, a file that is not on `main`; and 6 are
dynamic. Name the list at run time, never from this document.

```bash
gh api "repos/$R/actions/workflows?per_page=100" --paginate \
  --jq '.workflows[] | "\(.id)\t\(.state)\t\(.name)\t\(.path)"' > "$LOG/workflows-before.tsv"
awk -F'\t' '$2 == "active" { print $1 }' "$LOG/workflows-before.tsv" > "$LOG/frozen-ids.txt"
while read -r id; do gh workflow disable "$id" -R "$R"; done < "$LOG/frozen-ids.txt"
gh api "repos/$R/actions/workflows?per_page=100" --paginate \
  --jq '[.workflows[] | select(.state == "active")] | length'
```

Expect `0`. Then wait for, or cancel, anything still running:

```bash
gh api "repos/$R/actions/runs?status=in_progress" --jq .total_count
gh api "repos/$R/actions/runs?status=queued" --jq .total_count
```

Until step 16, do not merge and do not push a tag. The tag ruleset already limits `v*` tags
to the administrator role; the freeze is that you create none. There is no ruleset toggle in
this step (#270, 2026-09-09 correction, mechanic 1). Disabling a dynamic workflow has not been
rehearsed: if any `gh workflow disable` call fails, that is stop condition S2.

### Step 2: run the final scans (30 minutes)

Scan what goes public with the method recorded in the session 4 evidence (#264): Gitleaks 8.30.1
over a fresh mirror with `--log-opts=--all` (which includes `refs/pull`), the ignore file from
`main`, and `--redact`; then the collaboration text updated since the 2026-09-28 export.

```bash
git clone --mirror --quiet "https://github.com/$R.git" "$LOG/mirror.git"
git -C "$LOG/mirror.git" show main:.gitleaksignore > "$LOG/gitleaksignore-main.txt"
gitleaks git "$LOG/mirror.git" --log-opts=--all --redact \
  --gitleaks-ignore-path "$LOG/gitleaksignore-main.txt" \
  --report-path "$LOG/gitleaks-history.json"
```

Compare the findings with the 2026-09-28 triage (one finding, a self-signed test key reachable
only from three pull-request refs). For issue and pull-request text, export what changed since
the session 4 export (`issues`, `issues/comments` and `pulls/comments` with `since=`, plus the
reviews on pull requests updated since), write each body to a file, and run
`gitleaks dir <dir> --redact`. Any finding not already triaged is stop
condition S3.

### Step 3: back up every ref (15 minutes)

Bundle the mirror from step 2, verify it, restore it, and compare. The bundle holds every
branch, tag and `refs/pull` ref.

```bash
git -C "$LOG/mirror.git" bundle create "$LOG/origin-all-refs.bundle" --all
git -C "$LOG/mirror.git" bundle verify "$LOG/origin-all-refs.bundle"
git clone --mirror --quiet "$LOG/origin-all-refs.bundle" "$LOG/restore.git"
diff <(git -C "$LOG/mirror.git" for-each-ref) <(git -C "$LOG/restore.git" for-each-ref)
git -C "$LOG/restore.git" fsck --no-progress --no-dangling
sha256sum "$LOG/origin-all-refs.bundle" > "$LOG/bundle-sha256.txt"
```

Expect no `diff` output and a clean `fsck`.

For the local branches and stashes that were never pushed, the session 4 bundle in custody
holds 40 branches and 16 stashes (as `refs/local-stash/<n>`), and it verified and restored clean
on 2026-09-28. Re-list the local branches absent from `origin` and the stash list, and compare
them with the session 4 lists. Rebuild the local bundle only if they differ. The rebuild method
(a local mirror clone, one `refs/local-stash/<n>` ref per stash, then `bundle create --all`) is
not rehearsed by the dry run.

### Step 4: capture the settings (10 minutes)

Export the settings the table in [Settings to verify](#settings-to-verify) names into
`$LOG/settings-before/`, one file per endpoint, the same set the session 4 inventory read. Keep
the error body of each endpoint that refuses, with its reason.

### Step 5: delete the 20 branches (10 minutes)

Re-run the dry run first (`bash scripts/cutover/dry-run.sh "$PINNED"`). Its `delete` lines
re-check each branch at deletion time. A line is GO only when all of these hold:

- The branch is still on `origin`.
- Its tip equals the tip pinned in `$PINNED`, so the custody bundle holds everything on it.
- No open pull request has it as its head branch or has its tip as its head commit.
- It holds no Shared Case (multi-user) or persona work. The test reads what the branch
  changes against its merge base with `main`: any changed path or commit subject matching
  `persona`, `shared case`, `case member`, `multi-user` or `iroh` (case-blind, with a hyphen,
  underscore, space or nothing between the words) marks it, and so does its name. On main
  those paths are the persona services, repository, settings section, and tests; the Shared
  Case verifier and its tests; the case-member repository; the plans and specs on either
  subject; the Shared Case design handoff; and ADR-0030.

It also confirms `t3code/review-pr-1518-1`, the branch kept under the exclusion, is still on
`origin` and not in the deletion list, and prints what the content test finds on it. On
2026-09-28 it found `src/shared/verify/sharedCase.ts`, which shows the test fires on real
Shared Case work. Last, it lists every head whose name matches those words; re-check those by
hand, with `gh pr list --state open`, for work the list could miss.

Then delete. Each deletion re-reads the tip just before it and skips a branch that moved since
the bundle, without any force option:

```bash
for B in \
  backup/local-merge-230-231 backup/pre-sync-diagnostic-logging backup/simplify-f8fb6f1 \
  coderabbitai/docstrings/9f4bb7c \
  stash-archive/1 stash-archive/2 stash-archive/4 stash-archive/5 stash-archive/6 \
  stash-archive/7 stash-archive/8 stash-archive/9 stash-archive/10 stash-archive/11 \
  stash-archive/12 stash-archive/14 stash-archive/15 \
  t3code/302982b9 worktree-agent-a712ebebe2fa7fc0b worktree-agent-ace974456560e04ec; do
  TIP=$(awk -v r="refs/heads/$B" '$2 == r { print $1 }' "$PINNED")
  NOW=$(git ls-remote origin "refs/heads/$B" | cut -f1)
  if [ -n "$TIP" ] && [ "$NOW" = "$TIP" ]; then
    git push origin --delete "$B"
  else
    echo "SKIPPED $B: pinned ${TIP:-none}, now ${NOW:-gone}"
  fi
done
git ls-remote --heads origin | wc -l
```

A `SKIPPED` line is stop condition S5 for that branch. The dry run at 21:18 UTC on 2026-09-28
read 135 heads, this pull request's branch among them, so expect 20 fewer unless branches were
added or removed since. Paste the count on #1370, as its ruling asks. The bundle from step 3
restores any deleted branch. The restored mirror's own `origin` is the bundle file, so name the
GitHub URL:

```bash
B='<branch>'
git -C "$LOG/restore.git" push "https://github.com/$R.git" "refs/heads/$B:refs/heads/$B"
```

### Step 6: verify the settings (10 minutes)

Read back every row of [Settings to verify](#settings-to-verify) whose **When** column includes
before. The dry run covers the rows marked **DR**: the rulesets, Actions permissions, fork
settings, secrets, and the variable names. Check the rest by hand, including the
notifications row on the web.

### Step 7: go or no-go (the maintainer)

Confirm every stop condition is clear and every question in
[Decide before the window](#decide-before-the-window) has an answer on #270. Then write the go,
with the UTC time, in `$LOG/go.txt` and as a comment on #271. This is the only approval that
releases the flip. Without it, take the back-out path.

### Step 8: flip (2 minutes)

```bash
gh repo edit "$R" --visibility public --accept-visibility-change-consequences
date -u +%FT%TZ > "$LOG/flip-time.txt"
gh api "repos/$R" --jq .visibility
```

Expect `public`. The recorded time is the cutover timestamp #271 asks for.

### Step 9: turn on secret scanning and push protection

```bash
gh api -X PATCH "repos/$R" \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
gh api "repos/$R" --jq .security_and_analysis
```

Expect both `enabled`.

### Step 10: turn on private vulnerability reporting

```bash
gh api -X PUT "repos/$R/private-vulnerability-reporting"
gh api "repos/$R/private-vulnerability-reporting"
```

Expect `{"enabled":true}`. The endpoint answers 404 while the repository is private, so this
step cannot be rehearsed.

### Steps 11 to 15: re-read the post-flip settings

11. Re-run the dry run. Some NO-GO lines are expected here by design: `visibility`, which now
    reads `public`; all 20 `delete` lines, which read "not on origin" after step 5; and any
    line for a setting that exists only on private repositories, which may fail to read. The
    ruleset, Actions, secret and variable lines should stay GO.
12. Read `actions/permissions` and `actions/permissions/workflow` again.
13. Read `actions/secrets` (expect `total_count` 0) and the variable names; every value listed
    is now public.
14. Read `collaborators`: one administrator (the maintainer) and two with write access (the
    collaborator who keeps it, and the machine account).
15. Set the fork pull-request approval policy to the value chosen before the window, and read
    back `actions/permissions/fork-pr-contributor-approval`.

### Step 16: re-enable the workflows

Re-enable only the workflows the freeze turned off, so `Dispatch` and `Doc curator` stay off:

```bash
while read -r id; do gh workflow enable "$id" -R "$R"; done < "$LOG/frozen-ids.txt"
gh api "repos/$R/actions/workflows?per_page=100" --paginate \
  --jq '.workflows[] | "\(.id)\t\(.state)\t\(.name)\t\(.path)"' > "$LOG/workflows-after.tsv"
diff "$LOG/workflows-before.tsv" "$LOG/workflows-after.tsv"
```

Expect no output.

### Step 17: change the "source is private" text

Merge the pull request from preparation step 2. Its author cannot give the code-owner approval,
so if you authored it, merge with the administrator bypass, which the main ruleset allows only
when merging a pull request (ADR-0008, amendment 2026-09-28, "Decision 4"). Then watch the
`Docs` run on `main` finish, and load the download page and the tester guide to confirm the new
text.

### Step 18: test private vulnerability reporting

The collaborator who keeps write access files a report with harmless content through
**Security** > **Report a vulnerability**. Read it back, then close it:

```bash
gh api "repos/$R/security-advisories?state=triage" --jq '.[] | "\(.ghsa_id) \(.summary)"'
```

Confirm the maintainer received the notification.

### Step 19: record the result

Export the settings again into `$LOG/settings-after/`. Comment on #271 with the flip time from
step 8, the settings read back in steps 9 to 16, and the test report's outcome. #272's audit
follows.

## Settings to verify

"Read back" is the value `gh api` returned on 2026-09-28. The dry run checks every row marked
**DR**.

| Area | Setting | Expected | Read back 2026-09-28 | When |
| --- | --- | --- | --- | --- |
| Rules | `main` ruleset 14967088 enforcement and target | active, default branch | same | before, after (DR) |
| Rules | `main` bypass | administrator role, pull requests only; no deploy key | same | before, after (DR) |
| Rules | `main` rules | creation, deletion, non-fast-forward, signed commits, status checks, pull request | same | before, after (DR) |
| Rules | `main` pull request rule | 1 approval, code owner, last-push approval, dismiss stale, threads not required, squash only | same | before, after (DR) |
| Required checks | `main` status checks | `lint`, `typecheck`, `test`, `build`, `e2e`, `Secret scan (full history)`, `Registry publish guard` | same | before, after (DR) |
| Rules | `release-tags` ruleset 24098840 | active on `refs/tags/v*`; creation, update, deletion, non-fast-forward blocked; administrator bypass | same | before, after (DR) |
| Rules | Classic protection on `main` | none (rulesets carry it) | 404 "Branch not protected" | before |
| Rules | Code owners file errors | none | `{"errors":[]}` | before |
| Merge policy | Repository merge methods | ruleset limits `main` to squash | squash, merge commit and rebase all allowed at repository level | before |
| Merge policy | Auto-merge, delete branch on merge | as read | both on | before |
| Merge policy | Squash commit title and message | `PR_TITLE`, `BLANK` | same | before |
| Actions | Actions enabled, allowed actions | on, all | same (`sha_pinning_required` false) | before, after (DR) |
| Actions | Default token, approve pull requests | read, false | same | before, after (DR) |
| Actions | Fork pull requests (private setting) | no write token, no secrets | same, approval required | before (DR) |
| Actions | Fork pull-request approval (public setting) | the value decided before the window | 422 while private | after |
| Actions | Log and artifact retention | as read | 90 days | before |
| Actions | Repository secrets | 0 | 0 | before, after (DR) |
| Actions | Environment secrets | four, only in `paid-runs` (branch `main`, tag `v*`) | same | before |
| Actions | Variable names at repository level and in every environment | exactly the four repository names `BIRDBRAIN_AGENT_GH_LOGIN`, `BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES`, `COPILOT_AGENT_FIREWALL_ALLOW_LIST_ADDITIONS`, `COPILOT_AGENT_FIREWALL_ENABLED`, none in any environment; any addition is NO-GO, because every value is public after the flip | same; `copilot`, `github-pages` and `paid-runs` hold none | before, after (DR) |
| Actions | Copilot firewall variable value | `true` | `true` | before, after (DR) |
| Access | Collaborators | 1 administrator, 2 write | same | before, after |
| Access | Deploy keys, webhooks, invitations | none | none | before |
| Security | Secret scanning, push protection | enabled | `security_and_analysis` null while private | after |
| Security | Private vulnerability reporting | enabled | 404 while private | after |
| Security | Dependabot alerts | on | 204 from `vulnerability-alerts` | before |
| Security | Dependabot security updates | on, not paused | `{"enabled":true,"paused":false}` | before |
| Notifications | Maintainer watches security alerts and reports | on | not read: the token lacks the `notifications` scope | before, on the web |
| Visibility | Repository | private, then public | private (DR) | before, after |

## Stop conditions

Any of these before step 8 stops the cutover. Take the back-out path.

- **S1.** The dry run ends with any NO-GO line.
- **S2.** A workflow cannot be turned off, or a run is still in progress after the freeze and
  cannot be cancelled.
- **S3.** A scan finding is not already triaged, or a credential found in what goes public is
  still live.
- **S4.** The bundle fails to verify, the restored refs differ, or `fsck` reports an error.
- **S5.** A ruled branch is missing, has moved from its pinned tip, heads an open pull request
  by name or tip, or holds Shared Case (multi-user) or persona work by a changed path, a commit
  subject or its name, as step 5 describes. This stops the deletions until the maintainer
  re-rules on #1370.
- **S6.** A setting read back differs from the expected column.
- **S7.** A release is planned or running in the window.
- **S8.** The maintainer has not written the go at step 7.
- **S9.** A review app neither acts only on the maintainer's and the agent's pull requests nor
  is listed for uninstall (preparation step 5).

**Back-out path.** Re-enable the ids in `$LOG/frozen-ids.txt` as step 16 does, restore any
deleted branch from the step 3 bundle, and record the stop condition on #271. Visibility has not
changed.

After step 8, whether a failed settings step is a reason to flip back is the question in
[Decide before the window](#decide-before-the-window); follow the answer recorded on #270.

## Incident path for unexpected exposure

Use this when something sensitive turns out to be readable after the flip.

1. **Rotate first if it is a credential.** Revoke or rotate it at its issuer before anything
   else, then replace the value in the `paid-runs` environment. A value already fetched stays
   usable until revoked, whatever happens to the repository.
2. **Decide whether to flip back.** `gh repo edit "$R" --visibility private
   --accept-visibility-change-consequences` stops further reads. It does not recall a clone, a
   fork or a cached page. Read GitHub's list of consequences first
   (<https://gh.io/setting-repository-visibility>).
3. **Remove it where it lives.**
   - Issue or pull-request text: edit it, then delete the earlier revision from the comment's
     edit history.
   - A run log: `gh api -X DELETE "repos/$R/actions/runs/<id>/logs"`.
   - An artifact: `gh api -X DELETE "repos/$R/actions/artifacts/<id>"`. For a `dispatch-run`
     bundle this departs from the #1369 ruling; record why.
   - A variable: delete or change it.
   - Git history: the history stays as it is (ADR-0008, amendment 2026-09-28). A credential is
     handled by rotation. Anything else is a new fact for the maintainer, recorded as a new
     ADR-0008 amendment.
4. **Record it** in the custody log, without the value. A public issue about it must not repeat
   the value either.

## Irreversible disclosure and restorable settings

Anything fetched once the repository is public can be copied. Removing it later limits new
reads only.

| Irreversible once public | Restorable afterwards |
| --- | --- |
| Git history on every remaining branch and tag, including the identity fields ADR-0008 accepts | Visibility (a flip back limits new reads only) |
| Every `refs/pull` ref (639 on 2026-09-28), which GitHub maintains and no push alters | Both rulesets and the required checks |
| Issue and pull-request text, reviews and comments, including the Linear integration's comments | Actions permissions, fork settings, retention |
| Actions run logs and run summaries still inside the 90-day retention | Which workflows are enabled |
| The 174 artifacts, until each expires | Secret scanning, push protection, private vulnerability reporting |
| Every Actions variable value | Wiki tab, collaborator access |
| The Pages site and the releases repository, which are public already | The 20 deleted branches, from the step 3 bundle |

Whether GitHub still serves the commits of a deleted branch by commit id was not tested.

## What the dry run proves

`scripts/cutover/dry-run.sh` makes every check this runbook can make without changing anything.
Its GitHub calls are all `gh api --method GET`. Its git calls read the remote (`ls-remote` and a
mirror clone) and write only into a temporary directory it removes on exit. It takes the
pinned-tips file as its one argument.
`tests/cutoverDryRun.test.ts` pins the GET-only calls, an unchanged remote after a run, and a
NO-GO for each of: a drifted or unreadable setting, an added variable at repository or
environment level, a ruled branch that is gone, moved from its pinned tip, or heads an open
pull request, a ruled branch whose changed paths or commit subjects mark Shared Case or persona
work, and a missing pinned-tips file.

It checks: visibility is still private; the workflow list the freeze would turn off; the 20
branches and the kept one, as step 5 describes; both rulesets; the Actions policy, token and
fork settings; zero repository secrets; the full set of variable names and the Copilot firewall
value; and a fresh bundle of every ref that verifies, restores to identical refs and passes
`fsck`.

It cannot rehearse: disabling a workflow, deleting a branch, the flip, secret scanning, private
vulnerability reporting, the fork approval policy, the review-app settings, the notification
settings, or the scans in step 2.

The run on 2026-09-28 at 21:18 UTC, with the session 4 pinned-tips file, ended
`Summary: 32 GO, 0 NO-GO.` All 20 ruled branches were at their pinned tips.
