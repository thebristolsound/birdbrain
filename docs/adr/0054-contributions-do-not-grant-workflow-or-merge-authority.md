# Contributions do not grant workflow or merge authority

**Status:** Accepted

**Date:** 2026-10-24

Amends the contributor-access policy in [ADR-0008](0008-public-release-decisions.md) and the
manual-merge consequence in [ADR-0041](0041-merges-are-requested-by-label.md). The maintainer
requested these restrictions after reviewing access for new contributors. Existing collaborator
write access stays in place.

## Context

GitHub's contributor designation grants no repository write access. However, the repository's
`first_time_contributors` Actions policy stops requiring workflow approval after a contributor
gets a commit or pull request merged. A previous contribution should not authorize later code
to run on the repository's runners.

The `main` ruleset requires checks, including `merge-gate`, but no approving review. ADR-0041
allows accounts with write access to merge manually when those checks pass. Its label workflow
checks who requests an automated merge, but that check does not govern a manual merge.

## Decision

- Require approval for fork pull request workflows from **all external contributors**, including
  repeat contributors. Set the Actions `approval_policy` to `all_external_contributors`.
- Add a separate branch ruleset, `main-merge-authority`, targeting `~DEFAULT_BRANCH`. Its only
  rule is **Restrict updates**. Only repository administrators and the specific `birdbrain-agent`
  user account may bypass it, and only through pull requests. Do not grant the write role a
  bypass.
- Keep the existing `main` ruleset separate. The machine account receives no bypass of its
  required checks, pull request requirement, deletion restriction, or force-push restriction.

The maintainer authorizes a collaborator's merge through the existing `merge` label, or performs
the merge directly. The machine account remains trusted to perform those merges and the
scheduled agent merges that existing decisions permit. A new collaborator does not gain that
authority by receiving write access.

## Consequences

- Collaborators can still push working branches. They cannot merge to `main` themselves, even
  after its required checks pass. An approving review alone does not grant them merge authority;
  the maintainer must request or perform the merge.
- The maintainer's own pull requests keep the label-based merge flow. Requiring a code-owner
  review on every pull request would block that flow because GitHub forbids self-approval.
- The machine account remains a trusted identity. This restriction does not constrain someone
  who controls its credentials or the maintainer's account. Keep the credential restrictions
  and sign-off checks from [ADR-0048](0048-changes-that-reach-release-credentials-need-sign-off.md).
- Fork workflow approval permits execution on GitHub-hosted runners. It does not give a fork
  workflow stored secrets or a write token. The approval policy does not cover
  `pull_request_target`; those workflows must keep treating pull request content as untrusted.
- These are live GitHub settings. Committing this record does not apply or restore them.

## References

- [GitHub: fork workflow approval policies](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Repository: main merge authority ruleset](https://github.com/thebristolsound/birdbrain/rules/25810977)
- [GitHub: ruleset restrictions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [GitHub: ruleset bypass actors](https://docs.github.com/en/rest/repos/rules#update-a-repository-ruleset)
