# 0008. Public-release decisions

Date: 2026-08-10
Status: accepted
Owner: thebristolsound (maintainer)
Tracks: #262. Source: `docs/specs/2026-07-27-public-repository-readiness-assessment.md`.

The July 27 readiness assessment left five decisions to the maintainer before the
repository can go public. This record captures each one: the alternatives weighed,
the evidence, the outcome, and the concrete trigger that would reopen it. Decisions
were made explicitly by the maintainer on 2026-08-10; publication work proceeds one
decision at a time against this record, not against memory of it.

Per #262's own criteria, no personal addresses or sensitive values appear in this
document. Where a decision concerns specific strings in the history, the audit
inventory (private working notes for #263/#264) identifies them; this record refers
to them only by kind.

## Decision 1 — Historical personal-email exposure: remediate

**Question.** Commit author/committer metadata in the pre-publication history
contains personal email addresses of the maintainer (two personal-domain addresses;
all other historical addresses are GitHub no-reply or bot identities). Publishing
the repository publishes that metadata.

**Alternatives considered.**

- *Accept*: leave history untouched; addresses become public. Zero engineering
  cost, no SHA churn. The assessment notes GitHub's position that changing the
  configured email affects future commits only.
- *Remediate*: rewrite history before cutover so the personal addresses are
  replaced with the maintainer's no-reply identity.

**Evidence.** Unique-author inventory from the assessment (Data/Metrics section)
and a direct `git log --format='%ae%n%ce' | sort -u` re-check on 2026-08-10: two
personal-domain addresses appear in historical commits; current commits already use
the no-reply address.

**Outcome.** Remediate. The addresses are the maintainer's personal contact points
and publishing them permanently is a concrete, avoidable harm; a pre-publication
rewrite is the only moment this can ever be fixed, because after cutover the
history is irrevocably disclosed.

**Revisit trigger.** If the rewrite cannot be completed and verified inside the
pre-cutover freeze window (#270's runbook), the fallback is to *postpone cutover*,
not to publish unrewritten history. This decision does not flip to "accept" under
schedule pressure.

## Decision 2 — History preservation versus rewrite: rewrite, narrowly scoped

**Question.** Whether to preserve the exact commit history or rewrite it, given
that rewriting changes every descendant SHA.

**Alternatives considered.**

- *Preserve*: full provenance continuity; existing clones, tags, and PR references
  stay valid.
- *Rewrite (scoped)*: a single `git-filter-repo` pass whose mailmap/path rules
  touch only the concrete content named below.
- *Rewrite (broad)*: also squash or prune noisy history. Rejected outright — #262
  requires rewriting be selected only for concrete harmful content.

**Outcome.** One rewrite pass, executed once, before cutover, scoped to exactly
two things:

1. Replacing the personal email addresses in author/committer metadata
   (Decision 1).
2. Purging `docs/specs/2026-07-27-public-repository-readiness-assessment.md` from
   all history (Decision 5) — since a rewrite is happening anyway, tip-removal
   alone would leave the document readable in history, which would make Decision 5
   cosmetic.

Nothing else is rewritten. Any additional purge candidate surfaced by #264 or #269
must be added to this record first, with its own rationale, before it joins the
filter scope.

**Consequences the runbook must absorb (#269 executes, #270 sequences).** All
commit SHAs change: existing clones and forks diverge permanently, release tags
must be re-pointed or re-cut, open PR base SHAs become stale, and the `.gitleaksignore`
entries keyed to blob/commit hashes must be regenerated. The rewrite therefore
happens inside the merge/tag freeze, after backups, and before any visibility
change — never after.

**Revisit trigger.** A verified finding that the rewrite corrupted provenance the
project depends on (e.g. release tags that cannot be re-pointed) reopens this
decision before cutover. After cutover the question is moot; post-publication
removals follow GitHub's sensitive-data removal process instead.

## Decision 3 — Unsigned release artifacts: accept, pre-release only

**Question.** Installers are unsigned and macOS builds are not notarized.
`SECURITY.md` already discloses this. May releases be published from a public
repository in that state?

**Alternatives considered.**

- *Accept with warnings*: publish normal releases, rely on the documented
  limitation.
- *Accept, pre-release label only*: publish artifacts but mark every release
  pre-release until signing lands.
- *Source-only*: no artifacts until signing and notarization exist.

**Outcome.** Accept, pre-release label only. Intended audience: investigators,
researchers, and technically comfortable users who either build from source or
knowingly accept OS trust warnings. Warning posture: the limitation stays stated
in `SECURITY.md`, the README, and every release note, and every release is marked
**pre-release** on GitHub so the releases page itself signals non-production
status. No release is promoted to a full release while artifacts are unsigned.

**Revisit trigger.** Acquisition of a code-signing certificate and macOS
notarization capability; at that point signed releases may be promoted to full
releases and this restriction is lifted.

## Decision 4 — Contribution posture and inbound licensing: inbound = outbound MIT

**Question.** The project has an MIT license but no contribution model; the
assessment requires choosing one before the first external pull request.

**Alternatives considered.**

- *Inbound = outbound MIT, PRs welcome*: the GitHub-default model; contributions
  are licensed under the project's MIT terms, no CLA.
- *MIT + DCO sign-off*: adds a per-commit provenance attestation at the cost of
  contributor friction.
- *Issues only, PRs by invitation*: narrow intake for a solo-maintained project.

**Outcome.** Inbound = outbound under MIT, external pull requests welcome, no CLA
and no DCO. Rationale: proportionate to a solo-maintained project that wants
contributions; the friction of sign-offs is not yet justified by any provenance
dispute. #268 implements this as a proportionate `CONTRIBUTING.md`, a code of
conduct with an enforceable contact path, and issue/PR templates — that issue must
state this licensing model explicitly rather than inferring it.

**Revisit trigger.** A contributor-provenance dispute, an employer/contractor IP
question on an inbound change, or sustained multi-contributor activity — any of
these reopens the DCO question.

## Decision 5 — The readiness assessment itself: remove before cutover

**Question.** Whether `docs/specs/2026-07-27-public-repository-readiness-assessment.md`
should be public. It names no addresses, credentials, or hostnames, but it
describes the audit's method, inventory, and residual-risk reasoning in detail.

**Alternatives considered.**

- *Keep public*: transparency about the publication process.
- *Redact then keep*: strip the Data/Metrics inventory, keep the reasoning.
- *Remove from tip*: delete before cutover.

**Outcome.** Remove before cutover — and, because tip-removal alone leaves the
file readable in history, the removal is folded into Decision 2's rewrite scope so
the document is absent from the published history entirely. Rationale: the
document is an audit working paper; publishing a map of what was checked for, and
what residual risks were accepted, gives an unnecessary head start to anyone
probing the published repository. Its durable, publishable output is this ADR.

Derived artifacts that cite the assessment (the #262–#273 issue bodies, this ADR)
survive; they reference it by name without reproducing audit detail, which #262's
criteria permit.

**Revisit trigger.** Once the repository has been public for a full release cycle
with no publication-related incident, the maintainer may reconsider publishing a
redacted version as a reference for other projects.

## What this unblocks

#262 closes on this record. That unblocks #268 (contributor intake, Decision 4)
immediately, and gives #269 (history findings) and #270 (cutover runbook) the
decision inputs they were waiting on. The cutover itself (#271) still requires
#263, #264, #265, #269, and #270 to close first.
