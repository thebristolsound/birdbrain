# Deep Research Brief: Preparing a private software repository to become public

## Executive Summary

- Treat the visibility change as an irreversible disclosure event, not a settings toggle. GitHub states that all code, Actions history and logs, and commits from the private fork network can become public; anyone may immediately fork the result. The practical control point is therefore a go/no-go review *before* changing visibility, followed by a second verification from an unauthenticated browser. ([GitHub, n.d.](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility))
- Secret remediation has two distinct jobs: revoke or rotate every credential first, then decide whether history rewriting is justified. Deleting a file or adding a clean commit does not neutralize an exposed credential, and rewriting history is operationally disruptive and can be recontaminated by old clones. ([GitHub, n.d.](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret); [GitHub, n.d.](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository))
- “Publicly readable” and “open source” are different. Open source requires distribution under terms that permit redistribution, source access, modification, and derived works. Birdbrain already has a root MIT license and matching `package.json` metadata, but ownership and third-party-license review remain necessary because a license can grant only rights the licensor actually holds. ([Open Source Initiative, 2024](https://opensource.org/osd))
- Publication expands the trust boundary around CI. Fork-originated input is adversarial by default; privileged `pull_request_target` or `workflow_run` patterns must not execute untrusted code, token permissions should be least-privilege, and third-party Actions should be pinned to full commit SHAs. Birdbrain avoids the riskiest triggers in the inspected workflows, but currently references Actions by movable major-version tags. ([GitHub, n.d.](https://docs.github.com/en/actions/reference/security/secure-use))
- Birdbrain is unusually close to community-ready: it has an MIT license, README, `SECURITY.md`, threat model, three CI/release/security workflow files, and a full-history Gitleaks job. The most important remaining gates are a verified historical-content/identity review, immutable Action pinning, contributor/community files, enabling private vulnerability reporting after publication, and a release-artifact decision about unsigned installers.

## Key Questions

1. What becomes public, including history and GitHub-side metadata, when a private repository changes visibility?
2. How should secrets, personal data, confidential material, and Git history be audited and remediated?
3. What legal, licensing, provenance, and third-party obligations must be resolved?
4. How should CI/CD, dependency, release, and vulnerability-management controls change for untrusted public contributions?
5. What documentation, governance, and maintainer processes are needed before launch?
6. What does the evidence imply specifically for Birdbrain, and what should block its publication?

## Methodology And Sources Overview

This assessment used a July 2026 snapshot of a local checkout of the repository and
current authoritative web guidance, while retaining historically important definitions and
Git practices. The local review was read-only except for this report. It inspected tracked file
names, the current branch and recent history, unique commit-author email addresses, community
files, `.gitignore`, `package.json`, `LICENSE`, `SECURITY.md`, and GitHub Actions workflow
structure. A targeted working-tree scan looked for common private-key and token signatures; it
was not a substitute for a dedicated scanner. Read-only GitHub API checks confirmed the
repository's current visibility and selected repository/Actions settings, and recent workflow
status was checked through GitHub's CLI.

The retained evidence comprises 15 distinct sources: 11 official GitHub documentation pages,
two Open Source Initiative/Open Source Guides pages, one npm documentation page, and one SPDX
specification. No GitHub repository page is used as evidence, so the requested “no repositories
under 100 stars” rule is satisfied without relying on popularity as a proxy for quality. Sources
were included when they were primary or responsible-party guidance and directly affected the
decision; generic launch advice, vendor marketing, search snippets, and duplicate versions of
the same document were excluded.

Limitations: GitHub documentation is continuously updated and often provides no stable
publication date; those entries are marked `n.d.`. The review did not inspect organization audit
logs, deleted branches, GitHub caches, private forks, Actions artifacts/log contents, release
assets, issue/PR/discussion text, external package-registry accounts, employer agreements, or
every dependency license. It also did not expose or print the ignored local `.env` contents.
Legal conclusions require counsel where employment, contributor ownership, patents, trademarks,
privacy law, export controls, or contractual confidentiality are material.

## Core Findings By Subtopic

#### Visibility Is A Disclosure Boundary, Not A Reversible Experiment

GitHub's current visibility documentation says a private-to-public change makes the code
available to everyone, permits anyone to fork it, publishes repository activity, exposes Actions
history and logs, may affect repository rulesets, and erases stars and watchers. Reusable or required
workflow paths from other private organization repositories may also appear in logs. These
platform-specific consequences justify exporting a settings inventory and reviewing workflow
runs and artifacts before cutover—not merely auditing the Git tree. **Confidence: high**, because
this is the platform operator’s documentation. ([GitHub, n.d.](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility))

Fork behavior is particularly easy to misunderstand. GitHub says that all commits in the
repository, including commits previously pushed to private forks, migrate into the new public
network and become visible; existing private forks then detach as standalone private
repositories. Once public copies or clones exist, later making the upstream private cannot
recall them. ([GitHub, n.d.](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/what-happens-to-forks-when-a-repository-is-deleted-or-changes-visibility))

For Birdbrain, the safe operational pattern is a short publication freeze, a mirror or bundle
backup, a documented inventory of refs and GitHub-side objects, final approval, visibility
change, immediate reapplication/verification of branch rules, and an anonymous inspection of
files, commit patches, Actions logs, releases, and community/security surfaces. If uncertainty
remains about historical content, publishing a deliberately curated new repository is safer than
experimenting with the existing network, though it sacrifices history and issue/PR continuity.

#### Secrets, Confidential Material, And Personal Data Must Be Reviewed Across Every Surface

GitHub secret scanning examines full Git history across all branches, and on public repositories
it runs automatically at no charge. It also scans issue, pull-request and discussion text,
wikis, and other collaboration surfaces. This breadth is useful after publication but does not
remove the need for a pre-publication scan, because public detection happens after disclosure.
([GitHub, n.d.](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning))

When a secret is found, rotation or revocation is the first response. GitHub explicitly warns
that removing the line, making a later clean commit, or deleting and recreating a repository
does not make the credential unusable. History rewriting is a separate containment/privacy
decision. ([GitHub, n.d.](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret))

Rewriting has costs: commit hashes change, commit and tag signatures may be stripped, open pull
requests and forks can be affected, collaborator coordination is required, and an old clone can
reintroduce the removed material. GitHub recommends `git-filter-repo` for necessary purges and
notes that Support performs additional server-side cleanup only for sensitive data whose risk
cannot be mitigated by credential rotation. **Confidence: high** on the mechanics; **moderate**
on whether rewriting is proportionate in any individual case. ([GitHub, n.d.](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository))

The local Birdbrain snapshot has an ignored and untracked `.env`; that is good current-tree
hygiene, but does not prove the values never appeared in another ref or collaboration surface.
The project already runs Gitleaks against all commits and refs in `.github/workflows/security.yml`,
which is a strong control; the ten most recent runs inspected on July 27, 2026, including the
current local head, had succeeded. A targeted local pattern scan found certificates and test
strings but no obvious live private key or common provider token. This is only a preliminary
finding: run the project’s full scanner against `--all` immediately before publication, review
every finding manually, and inventory credentials referenced by workflows, releases, updater
configuration, timestamp services, OpenRouter, and extension testing.

Privacy is broader than secrets. Git commit objects permanently record author and committer names
and email addresses. GitHub states that changing local Git email affects future commits only;
historical commits keep the old address. ([GitHub, n.d.](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address))
Birdbrain history currently contains three personal-looking addresses across Gmail, ProtonMail,
and Proton domains, in addition to GitHub no-reply identities. Decide explicitly whether that is
acceptable. If not, identity rewriting is a history rewrite with the same coordination and
signature trade-offs described above. Also review screenshots, fixtures, test captures, ADRs,
plans, comments, issue links, user names, local paths, customer or target URLs, incident notes,
internal hostnames, and competitive/product planning. A “secret scanner passed” result does not
cover contractual, personal, or reputational disclosures.

#### Licensing Requires Ownership And Dependency Provenance, Not Just A LICENSE File

The Open Source Definition, derived historically from the Debian Free Software Guidelines,
distinguishes visible source from open source: distribution terms must allow free redistribution,
source availability, modifications and derived works, nondiscrimination, and technology-neutral
use. ([Open Source Initiative, 2024](https://opensource.org/osd)) Birdbrain’s root MIT license and
`package.json` license field are consistent with permissive open-source publication.

That does not complete diligence. Confirm that every contributor had authority to contribute and
that no code, assets, icons, fonts, screenshots, test fixtures, copied snippets, generated code,
or documentation is subject to an employer, client, NDA, commercial asset license, or incompatible
upstream term. The Open Source Guides’ pre-launch checklist expressly calls for a license,
README, contributing guide, code of conduct, clean revision history, name/trademark review, and
understanding employer IP policy. ([GitHub Open Source Guides, n.d.](https://opensource.guide/starting-a-project/))

For third-party material, preserve notices and produce a machine-readable license inventory for
runtime and shipped dependencies. SPDX 3.0.1 defines a software bill of materials as a collection
of SPDX elements describing a package; SPDX identifiers give engineers a consistent vocabulary
for license and component records. ([SPDX, 2024](https://spdx.dev/wp-content/uploads/sites/31/2024/12/SPDX-3.0.1-1.pdf))
For Birdbrain, the review must cover both Electron application contents and the separately built
Chrome extension, including packages copied into `asarUnpack` and `extraResources`. The existing
MIT declaration should not be interpreted as relicensing third-party components.

If public source is intended without accepting outside patches, say so. If patches are welcome,
choose a contribution model before the first external pull request: inbound=outbound under the
MIT license, a Developer Certificate of Origin-style attestation, or a CLA where ownership/patent
needs justify its overhead. This is a governance choice, not a prerequisite imposed by GitHub.

#### Public CI Must Assume Hostile Inputs

GitHub’s secure-use guidance treats workflow data and fork contributions as untrusted. It
recommends least-privilege `GITHUB_TOKEN` permissions, warns that privileged
`pull_request_target` and `workflow_run` workflows must not check out untrusted code, and says
full-length commit-SHA pinning is the only immutable way to consume an Action. It also recommends
OIDC instead of long-lived cloud credentials where supported. **Confidence: high** for GitHub
Actions on GitHub-hosted repositories. ([GitHub, n.d.](https://docs.github.com/en/actions/reference/security/secure-use))

Birdbrain’s inspected workflows use `push`, `pull_request`, `schedule`, and release events rather
than `pull_request_target`; this avoids the most common privileged-fork trap. The release workflow
declares `contents: write`, while ordinary CI does not visibly request broad write permissions.
The live repository setting gives workflows read-only permissions by default and does not let
`GITHUB_TOKEN` approve pull requests, which are sound defaults. However, the repository currently
allows all Actions and does not require SHA pinning.
All inspected third-party and GitHub-maintained Actions use movable tags such as
`actions/checkout@v6`, `pnpm/action-setup@v6`, and `softprops/action-gh-release@v3`. Pin each to a
reviewed full SHA, retain a comment with the human-readable release, and enable Dependabot version
updates to refresh the SHA. Note that while Dependabot version updates can update SHA-pinned
Actions, Dependabot vulnerability alerts do not cover SHA-pinned Actions; a separate, reviewed
monitoring and update process is needed for security advisories affecting pinned Actions. Review
shell interpolations, artifact paths, caches, and release uploads for attacker-controlled values.
Fork PRs should run only the minimal read-only test set until a maintainer authorizes anything
privileged.

The visibility change may affect repository rulesets, according to GitHub. Branch rules and
rulesets overlap but are not identical; rulesets can combine and make active constraints visible
to readers. Export the current settings and immediately verify that branch and tag rulesets remain
effective for the public repository, ensuring required reviews, required checks, force-push/deletion
restrictions, signed-commit policy if desired, tag protection, merge policy, and administrator
bypass settings are all properly configured after publication. ([GitHub, n.d.](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets))

For package/release boundaries, distinguish “repository public” from “package published.”
Birdbrain is an application (`package.json` has no `private: true`) and uses GitHub Releases, not
an npm package, but an accidental `npm publish` remains possible. npm advises controlling
published contents with ignore/files rules, requires 2FA or an appropriately scoped token for
public scoped-package publication, and supports provenance from GitHub Actions. Add
`"private": true` unless publishing Birdbrain to npm is intentional, and test packaged contents
for each OS before release. ([npm, n.d.](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/))

Birdbrain’s `SECURITY.md` openly states that installers are unsigned and macOS builds are not
notarized. That candor is valuable, but public distribution increases impersonation and
social-engineering exposure. Publication need not be blocked if this beta risk is consciously
accepted, yet release signing/notarization, reproducible provenance, protected release
environments, and a documented key-compromise procedure should be prioritized.

#### Community And Vulnerability Operations Need Explicit Capacity

GitHub’s community profile checks for README, license, contributing guide, code of conduct,
security policy, and issue/PR templates. These are not mere scorekeeping: they define how strangers
can participate without forcing maintainers to renegotiate expectations in every issue.
([GitHub, n.d.](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories))

Birdbrain has a strong README and `SECURITY.md`, but the inspected tracked files did not include
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue forms/templates, a pull-request template, or
`CODEOWNERS`. Before launch, document supported platforms, reproducible setup, test commands,
scope and non-goals, contribution/licensing terms, release authority, response expectations, and
how to propose security-sensitive changes. For a solo maintainer, it is better to promise a
realistic best-effort response than an SLA that cannot be met.

After the repository becomes public, enable GitHub private vulnerability reporting and verify
notifications. It provides a structured private channel distinct from `SECURITY.md`.
([GitHub, n.d.](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository))
Repository security advisories then support private discussion, temporary private forks, fixes,
and coordinated publication. ([GitHub, n.d.](https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/repository-security-advisories))

## Contradictions, Debates, And Uncertainties

- **Rewrite history or rotate only?** Security guidance correctly prioritizes revocation because
  it neutralizes a credential; privacy, contracts, proprietary code, or regulated data may still
  require removal. Rewriting is justified when the bytes themselves remain harmful, not merely
  because a now-dead token looks untidy.
- **Preserve history or publish a clean repository?** Preserving history retains authorship,
  provenance, bisectability, issue links, and signed commits. A clean repository reduces the
  disclosure surface but loses that evidence and can obscure prior licensing provenance. Choose
  based on concrete findings, not aesthetics.
- **License audit depth:** A lockfile-level license report is useful but cannot prove legal
  compatibility, especially for bundled assets, copied code, transitive native libraries, or
  dual-licensed packages. Automated inventories are evidence inputs, not legal conclusions.
- **How much governance is enough?** Community files reduce ambiguity, but a solo beta project
  should not imitate foundation-scale process. The minimum credible set is a contribution guide,
  conduct/enforcement contact, issue/PR templates, support boundary, and private security channel.
- **Unsigned release artifacts:** The repo can be responsibly public while installers remain
  unsigned if the limitation is explicit; whether it is acceptable for real investigators is a
  product-risk decision. Public distribution makes the gap more consequential but does not by
  itself prove compromise.
- **Local audit completeness:** The preliminary Birdbrain scan found no obvious provider token or
  private key, but inaccessible GitHub-side objects and pattern limits make this moderate-
  confidence evidence only. A clean result cannot establish absence of confidential business or
  personal information.

## Data, Metrics, And Concrete Evidence

- GitHub documents at least six immediate private-to-public effects relevant here: worldwide code
  visibility, unrestricted forking, public activity, public Actions logs/history, potential changes
  to repository rulesets, and erased stars/watchers. These must be checked as platform state, not
  inferred from Git contents. ([GitHub, n.d.](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility))
- The inspected Birdbrain repository contains 545 tracked files and three GitHub Actions workflow
  files (`ci.yml`, `release.yml`, and `security.yml`). No tracked `.env` was found; two tracked PEM
  files are certificate fixtures, not private keys.
- A live GitHub check on July 27, 2026 confirmed that the repository was private, MIT-licensed,
  issue-enabled, wiki-enabled, and discussion-disabled, with one star and no forks. GitHub's
  branch-protection endpoint returned that protection requires GitHub Pro while the repository
  remains private; public repositories receive protected branches on GitHub Free.
- Unique historical author emails include three personal-looking addresses plus GitHub no-reply
  and bot identities. GitHub confirms that changing configuration now does not alter earlier
  commit addresses. ([GitHub, n.d.](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address))
- Birdbrain’s current security workflow says it scans every commit on every ref with Gitleaks,
  materially stronger than scanning only the checkout tip. The targeted supplemental regex scan
  found no obvious live private-key block or common provider token.
- The repository already includes four central public-readiness artifacts: README, root MIT
  license, `SECURITY.md`, and a detailed threat model. Five common community artifacts were not
  found in the inspected tracked tree: CONTRIBUTING, CODE_OF_CONDUCT, CODEOWNERS, issue templates,
  and a pull-request template.
- All inspected Action `uses:` references are tag-based rather than full-SHA pinned. GitHub calls
  full-SHA pinning the only immutable Action reference. ([GitHub, n.d.](https://docs.github.com/en/actions/reference/security/secure-use))
- Live Actions settings showed default read-only workflow permissions, no permission for
  `GITHUB_TOKEN` to approve pull requests, all Actions allowed, and no required SHA pinning.
- The Open Source Definition’s ten criteria, last modified in 2024 on the current OSI page, trace
  back historically to the Debian Free Software Guidelines and remain the definitional baseline
  used here. ([Open Source Initiative, 2024](https://opensource.org/osd))

## Practical Implications

- **Block publication** until one named owner signs off on each category: all refs and GitHub-side
  metadata scanned; findings triaged; secrets revoked; personal/confidential content accepted or
  removed; contributor ownership confirmed; dependency/assets licenses reviewed; CI threat model
  approved; and publication rollback expectations understood.
- Create a durable cutover checklist in `docs/plans/` with evidence links and owners. Freeze merges
  during the final scan. Record the commit and ref set reviewed, export repository settings, and
  retain an offline mirror/bundle.
- Run at least two secret/content tools with complementary detection, plus manual searches for
  organization names, domains, emails, internal URLs, credentials, signing material, real
  investigation data, and local paths. Include branches, tags, stashes intended for push, LFS,
  submodules, releases, Actions logs/artifacts, issues, PRs, discussions, and wiki.
- Rotate credentials before any history surgery. If rewriting, coordinate a push freeze, rewrite
  all affected refs, invalidate old clones, address PRs/forks/caches with GitHub Support where
  applicable, and rerun the exact scans on the rewritten remote.
- Decide explicitly whether Birdbrain’s historical personal email addresses may be public. Set a
  repository-local GitHub no-reply address for future work regardless of the historical decision.
- Add `"private": true` to `package.json` unless npm publication is intentional. Generate a
  dependency/license inventory and SBOM for both application and extension deliverables; inspect
  the actual packaged archives, not only source manifests.
- Pin every Action to a full commit SHA; set default workflow token permissions read-only; grant
  job-scoped writes; separate untrusted PR tests from releases; protect release environments; and
  never execute fork code in a privileged trigger.
- Add CONTRIBUTING, a code of conduct with an enforceable contact path, issue forms, a PR template,
  and ownership/maintainer expectations. Keep promises proportionate to solo-maintainer capacity.
- At cutover, verify and re-apply branch and tag rulesets as needed for the public repository,
  turn on Dependabot and code scanning, enable private vulnerability reporting, verify security
  notifications, and test the full disclosure path with a harmless draft report.
- From a logged-out session, inspect the repository root, commit patches, branches/tags, Actions
  logs, releases, security tab, community profile, and downloadable artifacts. Treat any
  unexpected exposure as an incident, not a documentation cleanup.

## Gaps And Recommended Follow-Up

Evidence still needed before a real go/no-go decision:

- Complete secret-scan output across the remote’s full ref set and GitHub collaboration surfaces.
- License/SBOM output for the production Electron and extension bundles, including assets and
  native/transitive components.
- A contributor/IP provenance map for non-bot commits and any employer or contractor obligations.
- An organization/repository settings export covering rulesets, branch protection, environments,
  webhooks, deploy keys, apps, Actions secrets, Pages, and private forks.
- Inspection of existing Actions logs, artifacts, release assets, issues, PRs, discussions, and
  deleted/closed material for confidential content.

Concrete follow-up questions:

1. Which exact remote refs, private forks, releases, Actions artifacts, and collaboration objects
   will GitHub expose for this Birdbrain repository at cutover?
2. Are the three historical personal email addresses intentionally public, and would rewriting
   them invalidate signatures or provenance that Birdbrain relies on?
3. Do all committed code, screenshots, fonts, fixtures, icons, and documents have MIT-compatible
   redistribution rights and documented origin?
4. Does a clean-room build from a fresh public clone reproduce each packaged deliverable, and
   what files/licenses actually ship?
5. Which public-fork workflows can consume secrets, write tokens, caches, artifacts, or release
   permissions under every event type?
6. Is unsigned installer distribution acceptable for the intended investigator audience, or
   should code signing/notarization block the first public release?
7. What response capacity can the maintainer realistically commit to for issues, dependency
   alerts, vulnerability reports, and release emergencies?

## Sources And Citations

### Web and official guidance

- [Setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility) — GitHub, n.d., GitHub Docs. Primary platform documentation for visibility effects; continuously updated.
- [What happens to forks when a repository is deleted or changes visibility?](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/what-happens-to-forks-when-a-repository-is-deleted-or-changes-visibility) — GitHub, n.d., GitHub Docs. Primary description of fork-network behavior.
- [Secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) — GitHub, n.d., GitHub Docs. Primary description of scan coverage and public-repository availability.
- [Remediating a leaked secret in your repository](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret) — GitHub, n.d., GitHub Docs. Primary incident-response sequence; GitHub-specific.
- [Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) — GitHub, n.d., GitHub Docs. Detailed primary guidance on history rewriting and server cleanup.
- [Setting your commit email address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address) — GitHub, n.d., GitHub Docs. Primary documentation of prospective versus historical email behavior.
- [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) — GitHub, n.d., GitHub Docs. Primary CI security guidance for Actions, tokens, untrusted code, and immutable pinning.
- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) — GitHub, n.d., GitHub Docs. Primary explanation of repository ruleset behavior and scope.
- [About community profiles for public repositories](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories) — GitHub, n.d., GitHub Docs. Primary statement of GitHub community-health checks.
- [Configuring private vulnerability reporting for a repository](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) — GitHub, n.d., GitHub Docs. Primary configuration and notification guidance.
- [Repository security advisories](https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/repository-security-advisories) — GitHub, n.d., GitHub Docs. Primary workflow for private remediation and coordinated disclosure.
- [Starting an Open Source Project](https://opensource.guide/starting-a-project/) — GitHub Open Source Guides, n.d. Maintainer-oriented pre-launch checklist; practical rather than normative.
- [Creating and publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) — npm, n.d., npm Docs. Primary registry guidance; scoped-package specifics are only partly applicable to this application.

### Standards and reference

- [The Open Source Definition](https://opensource.org/osd) — Open Source Initiative, 2024, OSI. Normative historical definition of open-source distribution terms.
- [SPDX Specification 3.0.1](https://spdx.dev/wp-content/uploads/sites/31/2024/12/SPDX-3.0.1-1.pdf) — SPDX Project, 2024, Linux Foundation. Primary technical specification for software supply-chain metadata and SBOM representation.
