# Changes that reach release credentials need the maintainer's sign-off

**Status:** Accepted

**Date:** 2026-10-10

Amends [ADR-0041](0041-merges-are-requested-by-label.md) Decision 1: `merge-gate` gains a third
condition. Follows from [ADR-0047](0047-releases-publish-from-the-source-repository.md), which
gave the release workflow the maintainer's token.

## Context

ADR-0047 stores `RELEASE_TAG_TOKEN`, the maintainer's token, in the `paid-runs` environment.
`release.yml` passes it to `.github/scripts/release/publish.sh`, and any workflow job that names
`paid-runs` can read it. A security review on #1794 found that nothing makes a change to those
files wait for the maintainer, and the gate confirms it:

- **The `main` ruleset requires no approval.** It requires 0 approving reviews and no code-owner
  review. `merge-gate` replaced both under ADR-0041.
- **`merge-gate` asks for sign-off only on an Evidence-Affecting Change.** A change to a workflow
  or a release script is not one.
- **The dispatcher merges finished agent PRs that are not evidence-affecting.** It does so under
  ADR-0014, with no human decision.

An agent PR that edits `publish.sh`, or adds a workflow job that names `paid-runs`, could
therefore merge unattended. The next release, or the next run of that job, would hand it the
maintainer's token, which can create release tags and publish a release the betas install.

## Decision

`merge-gate` blocks a pull request that changes a path under `.github/workflows/` or
`.github/scripts/release/` until the maintainer signs off at head, in the same ways an
Evidence-Affecting Change takes: an approving review on the head commit, or the `approved` label
with its `merge/approved` status on the head. A renamed file counts under its old path too.

A pull request opened under the maintainer's account is exempt, as it is from the pre-pass: it
comes from a session the maintainer watched.

## Consequences

- **The dispatcher cannot merge such a PR.** Its required checks include `merge-gate`, so an
  agent PR touching a workflow waits for the maintainer.
- **Dependabot's action bumps wait for the maintainer.** They edit `.github/workflows/`, so each
  one needs an approving review before the `merge` label merges it. On 2026-10-10 the gate
  blocked #1743, a bump to `claude.yml`, with the new reason.
- **The job definition still comes from the PR's branch.** ADR-0041 records that a
  same-repository branch could replace the `merge-gate` job, and this decision does not change
  that. The rule script is read from the default branch.
- **Workflows already hold other secrets.** The same rule covers changes that would reach
  `BIRDBRAIN_AGENT_GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `TYPESAFE_API_KEY` and
  `RELEASES_REPO_TOKEN`, which any `paid-runs` job could already read.

## Alternatives rejected

- **Gate only `release.yml` and `publish.sh`.** Any new workflow job that names `paid-runs` can
  read the token, so the narrower list misses the easiest route.
- **Require a code-owner review in the ruleset.** `CODEOWNERS` names the maintainer for every
  path, so it would block every pull request the maintainer opens, which ADR-0041 replaced for
  that reason. A path-scoped required reviewer needs a team, which a personal repository does
  not have.
- **Accept the risk with a short-lived, narrowly scoped token.** The token still creates tags
  and publishes releases for as long as it lives.
