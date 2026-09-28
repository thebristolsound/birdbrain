# Pre-cutover evidence summary

Counts from the pre-cutover evidence for #263 (the disclosure inventory) and #264 (the
sensitive-content and credential audit). The raw inventory, scan output, and credential list stay
in the maintainer's custody, outside the repository, as the 2026-09-28 amendment to ADR-0008
rules ("Pre-cutover evidence"). This page holds no credential value or fingerprint, no personal
address, no username taken from a path, and no workspace name. The runbook that uses it is
`docs/plans/2026-09-28-public-cutover-runbook.md`.

## Scope and tools

- **Date.** The evidence was gathered on 2026-09-28. Each figure below was re-read on
  2026-09-28, either from the custody files or live from GitHub.
- **Reviewed commit.** `main` at `3e009609`, the squash merge of #1633. The custody mirror's
  `refs/heads/main` resolves to it, and the most recent `Security` run on `main`, read live on
  2026-09-28, ran at that commit and concluded `success`, with each of its four jobs `success`:
  `Secret scan (full history)`, `Registry publish guard`, `Dependency audit`, and
  `Font licence check`.
- **Tools.** Gitleaks 8.30.1, git 2.43.0, `gh` 2.96.0, `jq` 1.7, GNU grep 3.11, and
  ShellCheck 0.11.0, as installed on the machine that holds the custody directory. The scan
  record in custody names Gitleaks 8.30.1 and GNU grep for the scans.

## Refs and bundles

The custody mirror of `origin`, counted with
`git -C mirror.git for-each-ref --format='%(refname)'` grouped by namespace:

| Namespace | Refs |
| --- | --- |
| `refs/heads` | 134 |
| `refs/pull` | 636 (635 `head`, 1 `merge`) |
| `refs/tags` | 22 |
| Total | 792 |

The `git ls-remote` capture beside it has 799 lines: the same 792 refs, `HEAD`, and 6 peeled tag
entries.

The read-only dry run (`scripts/cutover/dry-run.sh`) built a fresh bundle at 20:55 UTC and
counted 793 refs: 134 heads, 637 pull-request refs, and 22 tags. The remote gained one
pull-request ref between the two reads.

Two bundles are in custody. Both pass `git bundle verify`, and both match the SHA-256 checksums
recorded beside them (`sha256sum -c`).

| Bundle | Bytes | Refs | Restore check on 2026-09-28 |
| --- | --- | --- | --- |
| Every `origin` ref | 40,774,880 | 792, plus `HEAD` | `clone --mirror` gives refs identical to the custody mirror; `fsck` clean |
| Local branches and stashes never pushed | 33,959,497 | 40 branches, 16 stashes as `refs/local-stash/<n>`, 21 tags | `clone --mirror` gives the same 77 refs; `fsck` clean |

## History scan

`gitleaks git mirror.git --log-opts=--all --redact` with the ignore file from `main` and the
default rules (the repository ships no Gitleaks config). `--all` covers every ref in the mirror,
`refs/pull` included.

- **Commits.** `git rev-list --all --count` gives 3457 reachable commits, 590 of them merges.
  Gitleaks reports 2804 commits scanned. It scans commit patches, and the 590 merges carry none;
  the other 63 unscanned commits were not itemized.
- **With the ignore file: 1 finding.**

  | Rule | Count | Triage |
  | --- | --- | --- |
  | `private-key` | 1 | A self-signed localhost test key in a test helper, reachable only from three pull-request refs. Trusted by nothing; no revocation needed. |

- **Without the ignore file: 32 findings.** 31 `generic-api-key` and the same `private-key`. The
  ignore file on `main` holds 35 entries, and with it those 31 are suppressed.

## Collaboration text scan

Every issue, pull request, comment and review body was exported and written one body per file,
then scanned with `gitleaks dir <dir> --redact` and the default rules. An earlier run passed an
empty file as the config, loaded no rules, and was discarded.

| Item | Files |
| --- | --- |
| Issue and pull-request bodies (1003 issues, 635 pull requests) | 1638 |
| Issue and pull-request comments | 4233 |
| Review comments | 2695 |
| Review bodies (618 of 1531 reviews carry text) | 618 |
| Release notes on the releases repository | 4 |
| Total | 9188 |

Commit comments: none.

| Rule | Count | Triage |
| --- | --- | --- |
| `sourcegraph-access-token` | 117 | False positive: upstream commit and blob URLs in one issue, where the rule matches 40 hex characters. |
| `generic-api-key` | 5 | False positive: 3 are the fake session token from the design mock's fixtures, 2 are the words "token" and "tokens" in one review summary. |

## Complementary pattern counts

Pattern counts by category, with no values, over the tracked files at the reviewed commit ("tip")
and over the collaboration text. They are counts, not a review: a hit is a line to read, not a
finding.

| Category | Tip files | Tip lines | Collaboration files |
| --- | --- | --- | --- |
| Apple private-relay addresses | 0 | 0 | 0 |
| `atlassian.net` and Bitbucket hosts | 0 | 0 | 0 |
| An employer name | 0 | 0 | 0 |
| Consumer webmail addresses | 6 | 30 | 4 |
| Linux home-directory paths | 11 | 18 | 46 |
| macOS home-directory paths | 1 | 1 | 6 |
| Windows home-directory paths | 5 | 30 | 5 |
| Linear workspace links | 1 | 1 | 873 |
| `ngrok` tunnel hosts | 0 | 0 | 0 |
| Proton addresses, `.com` domain | 3 | 12 | 11 |
| Proton addresses, `.me` domain | 29 | 90 | 36 |
| Private-range IPv4 addresses | 6 | 24 | 3 |
| Tailscale IP addresses | 3 | 5 | 0 |
| Tailscale host names | 0 | 0 | 0 |
| WSL mount paths | 0 | 0 | 0 |

Two findings behind these counts feed a decision in the runbook. The export holds 872 comments
by the Linear integration's bot, linking into two distinct workspaces. The body of pull request
#94 has one line with a consumer webmail address.

## Credential inventory

Names and locations are in custody. Counts, read live on 2026-09-28:

| Where | Count |
| --- | --- |
| Repository Actions secrets | 0 |
| Environment secrets, all in the `paid-runs` environment (branch `main`, tag `v*`) | 4 |
| Secrets in the `copilot` and `github-pages` environments | 0 |
| Dependabot and `Codespaces` secrets | 0 |
| Actions variables, whose values are public after the flip | 4 |
| Variables referenced by a workflow and not set | 1 |
| Deploy keys, webhooks, pending invitations | 0 |
| Runtime credentials the app creates or stores on a user's machine, as the custody inventory lists them | 4 |

Neither release workflow references a `CSC_`, `APPLE_` or notarization variable: the installers
ship unsigned. The audit found no live credential that needs revoking before the flip.

## Settings export coverage

The session 4 settings export holds 51 files. Seven of its endpoints refused. Two more refusals
come from the wiki check and a read taken for the runbook. Each refusal is expected:

| Endpoint | Answer | Why |
| --- | --- | --- |
| `branches/main/protection` | 404 "Branch not protected" | `main` is protected by rulesets, not classic protection |
| `actions/permissions/fork-pr-contributor-approval` | 422 | Not available on a private repository |
| `interaction-limits` | 405 | Not available on a private repository |
| `private-vulnerability-reporting` | 404 | Not available on a private repository |
| `environments/copilot/deployment-branch-policies` | 404 | That environment's `deployment_branch_policy` is null |
| `user/installations` | 403 | Listing app installations needs a GitHub App token |
| `user/packages` | 403 | The token lacks `read:packages` |
| `subscription` (read 2026-09-28 for the runbook) | 404 | The token lacks `notifications` |
| The wiki's git remote | "Repository not found" | The Wiki tab is on and no wiki was ever created |

## Limitations

- **Workflow run logs and artifacts were not scanned.** 6682 runs and 174 artifacts, under a
  90-day retention, read live on 2026-09-28.
- **Installed apps were not listed.** The API refuses the list to a user token. Ten distinct
  bot and app accounts appear as comment authors in the export.
- **Default Gitleaks rules only.** The complementary patterns cover names, paths and hosts, not
  every secret format.
- **Point in time.** The collaboration export ends at its read time on 2026-09-28. The runbook's
  final scan covers what changed after it.
- **Discussions** are off, so there was nothing to export.
