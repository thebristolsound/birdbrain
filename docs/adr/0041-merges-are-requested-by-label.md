# Merges are requested by label

**Status:** Proposed

**Date:** 2026-10-06

Decided by the maintainer on 2026-10-06 in a triage session. Amends
[ADR-0005](0005-unattended-agents-on-the-evidence-path.md) and
[ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md) on what "never
auto-merge" means for an Evidence-Affecting Change. The squash message rule of
[ADR-0022](0022-one-shape-per-posting-surface.md) and the machine account of
[ADR-0027](0027-agent-prs-are-opened-by-a-machine-account.md) are unchanged. Nothing is built; the
plan is `docs/plans/2026-10-06-label-to-merge.md`.

## Context

The `main` ruleset requires one approving review from a code owner, and `CODEOWNERS` names only
the maintainer. Most pull requests are opened under the maintainer's account, by the maintainer
or by an interactive agent session, and GitHub does not let an author approve their own pull
request. The rule therefore cannot be met for most pull requests. Of the 20 most recent merges
on 2026-10-06, 18 landed with no approving review, through the ruleset bypass.

Two paths exist today, and the maintainer finds neither workable: run
`.claude/skills/merge-pr/scripts/merge.sh`, which composes the squash message and merges with
`--admin`, or click the bypass on the pull request page, which merges with an empty commit body
because `squash_merge_commit_message` is `BLANK`.

The review rule does real work in one case: a pull request the machine account opened, where
the maintainer's approval is a real second identity. The sign-off that matters for an
Evidence-Affecting Change is the maintainer's, whoever opened the pull request.

## Decision

1. **A workflow replaces the review rule.** The ruleset stops requiring an approving review and
   instead requires a check named `merge-gate`, the conclusion of a workflow job. The job is
   green when:
   - the pull request carries no agent label, or its `agent/pre-pass` status at head is
     success; and
   - it is not an Evidence-Affecting Change, or the maintainer has signed off at head, either
     by an approving review or, on a pull request the maintainer opened, by applying the
     `approved` label after the latest push.
2. **A push withdraws the sign-off.** On every push the workflow removes `approved` and `merge`
   and turns off auto-merge, so a sign-off always names the commit that lands.
3. **The maintainer requests a merge with the `merge` label.** A second workflow checks that a
   code owner applied it, composes the squash subject and body exactly as `merge-pr` does, and
   enables GitHub auto-merge as the machine account against the head commit. GitHub merges when
   every required check is green.
4. **For an Evidence-Affecting Change, the maintainer's labels are the human merge.** ADR-0005's
   "never auto-merge" means no merge without a human decision at the head commit. The `approved`
   and `merge` labels are that decision; the machine account only performs it. The machine
   account still never decides to merge one: the dispatcher does not apply either label.
5. **The bypass is for emergencies.** `merge.sh` stays as the manual fallback and no longer
   reaches for `--admin` on its own.

## Consequences

- Merging is one label on the pull request page, for the maintainer's pull requests, the
  machine account's, and Dependabot's.
- The merge runs as the machine account, so the `push` workflows on `main` (CI, docs, security)
  run as they do today. A merge made with the workflow's own `GITHUB_TOKEN` would not trigger
  them.
- `merge-gate` is a job conclusion, not a posted status, so it reports on Dependabot pull
  requests, where a status write fails on the read-only token. That is the blocker that has kept
  `agent/pre-pass` from being a required check.
- The merge workflow runs on `pull_request_target` with the machine account's token. It must
  never check out or run the pull request's code.
- `merge-gate` runs on `pull_request`, so its job definition comes from the pull request's
  branch and a same-repository branch could replace it; only the rule script is read from the
  default branch. The trusted controls are the `merge-on-label.yml` jobs, which run from the
  default branch: auto-merge is armed only on the maintainer's `merge` label, and disarmed on a
  push, on the label's removal, and when a closed issue becomes evidence-affecting. A manual
  merge by an account with write access remains possible once the checks are green, as it was
  for any account allowed the bypass before.
- A pre-pass verdict is a commit status, which starts no workflow on the pull request, so
  `merge-gate` can be stale after one. The `merge` label and every push run it again, and
  `merge.sh` starts a re-run when the gate is its red check.

## Alternatives rejected

- **Drop the review rule and use GitHub's merge button.** Loses the composed message (ADR-0022)
  and leaves Evidence-Affecting Changes with no enforced sign-off.
- **Move every agent pull request to the machine account.** The maintainer's own pull requests
  would still need the bypass, and the composed message would still need a script.
- **Set the squash message to the pull request body.** The body carries the verification block
  and collapsed detail, which ADR-0022 deliberately kept off `main`.
