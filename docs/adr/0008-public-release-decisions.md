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
rewrite is the only reliable opportunity to prevent public disclosure — after
cutover, removal depends on GitHub's sensitive-data removal process and cannot
reach clones, forks, or caches already made.

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
activists, and researchers. Birdbrain remains beta software; users either build
from source or knowingly accept OS trust warnings. Warning posture: the
limitation stays stated in `SECURITY.md`, the README, and every release note,
and every release is marked **pre-release** on GitHub so the releases page
itself signals non-production status. No release is promoted to a full release
while artifacts are unsigned.

**Revisit trigger.** A release process that signs every artifact and notarizes
macOS builds, with both verified on the release's actual output — acquiring a
certificate or notarization capability alone does not qualify. Only after that
verification may releases be promoted to full releases and this restriction be
lifted.

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

Closing #262 on this record unblocks #268 (contributor intake, Decision 4)
immediately, and gives #269 (history findings) and #270 (cutover runbook) the
decision inputs they were waiting on. The cutover itself (#271) still requires
issues #263, #264, #265, #269, and #270 to close first.

## Amendment 2026-09-09: the mechanism is reopened

A re-check of this record against the repository on 2026-09-09 found four
statements it makes that the repository contradicts. They are filed as #1357,
#1359, #1360 and #1362. This amendment records the corrected evidence, states
which decisions that evidence reopens, sets out the mechanism options, and
leaves the choice to the maintainer. Every figure below was re-derived at
`origin/main` f1ab45ae. Local parts are withheld throughout, and only domains
are reported.

### Corrected evidence

**Decision 1 counts two personal domains, and there are three.** Lines 21 to 24
say "two personal-domain addresses; all other historical addresses are GitHub
no-reply or bot identities." A per-domain count over the author and committer
fields of `origin/main` returns three personal domains.

```
$ git log --format='%ae%n%ce' origin/main \
    | grep -oE '@[A-Za-z0-9.-]+$' | sort | uniq -c | sort -rn
   1688 @protonmail.com
    648 @github.com
    563 @proton.me
    216 @anthropic.com
    198 @users.noreply.github.com
      7 @gmail.com
```

That is 3,320 identity fields, of which 2,258 carry one of the three personal
domains. Each of those three domains resolves to a single distinct address.

**Decision 1 says current commits already use the no-reply address, and they do
not.** Lines 34 to 37 make that claim. Over the last 40 commits on
`origin/main`, 16 of the 40 author addresses carry a personal domain.

```
$ git log -40 --format='%ae' origin/main \
    | grep -oE '@[A-Za-z0-9.-]+$' | sort | uniq -c | sort -rn
     24 @users.noreply.github.com
      9 @proton.me
      7 @protonmail.com
```

#1359 recorded 17 when it was filed and the tip has advanced since, which is why
the figure is re-derived here rather than copied.

**Decision 2's filter scope misses two surfaces.** A `mailmap` pass rewrites
identity fields only. It does not reach commit message bodies or blob content,
and both carry the same domains.

```
$ git log --format='%B' origin/main \
    | grep -cE '[A-Za-z0-9._%+-]+@(proton\.me|protonmail\.com|gmail\.com)'
265
$ git grep -lE '@(proton\.me|protonmail\.com|gmail\.com)' origin/main -- . | wc -l
14
```

**Decision 2's mechanism cannot reach the metadata it targets.** GitHub keeps a
pull-request ref for every pull request ever opened against the repository.
Those refs are maintained by the server: a client cannot push them, and a
force-push of `main` leaves them exactly as they were.

```
$ git ls-remote origin 'refs/pull/*' | wc -l
500
$ git ls-remote origin 'refs/pull/*/head' | wc -l
494
```

One head demonstrates the consequence. `refs/pull/786/head` is
`10de0a1693dc84a3567c035e004974c9aa48b75e`.

```
$ git merge-base --is-ancestor 10de0a1693dc84a3567c035e004974c9aa48b75e origin/main
$ echo $?
1
```

The exit status of 1 says that commit is not reachable from `main`, so no
rewrite of `main` reaches it. GitHub serves its metadata anyway.

```
$ gh api repos/thebristolsound/birdbrain/commits/10de0a1693dc84a3567c035e004974c9aa48b75e \
    --jq '.commit.author.email + " | " + .commit.committer.email'
<local part withheld>@protonmail.com | <local part withheld>@protonmail.com
```

There are 494 such head refs, each still readable through that endpoint after
any rewrite of the branch.

**SECURITY.md publishes the domain the rewrite targets (#1360).** Line 12 of
`SECURITY.md` on `origin/main` gives an address on the `@proton.me` domain as
the security contact fallback. That is the same domain with 563 occurrences in
the identity fields counted earlier. The repository advertises on its tip the
domain Decision 1 orders removed from its history.

**Decision 5's document is already published (#1362).** The document Decision 5
purges is present in the tagged tree of the most recent pre-release.

```
$ git cat-file -e \
    v1.0.1-beta.21:docs/specs/2026-07-27-public-repository-readiness-assessment.md
$ echo $?
0
```

#1362 verified the same file inside `app.asar` in
`birdbrain_1.0.1-beta.21_amd64.deb`, a pre-release already published on
`thebristolsound/birdbrain-releases`, among 13,090 packed entries. A history
rewrite does not reach a downloaded installer, so Decision 5's stated aim of the
document being "absent from the published history entirely" no longer describes
an end state that any rewrite can produce.

### What is reopened and what stands

- **Decision 1 is reopened.** Its factual premise is wrong on both counts, and
  #1360 puts its outcome in direct conflict with what `SECURITY.md` publishes.
- **Decision 2 is reopened on mechanism only.** The choice to rewrite rather
  than preserve is not what fails. The one-pass-plus-force-push mechanism is
  what fails, because it cannot reach `refs/pull`.
- **Decision 3 stands, and nothing here touches it.** This amendment concerns
  neither release signing, nor notarization, nor the pre-release label.
- **Decision 4 stands, and nothing here touches it.** This amendment concerns
  neither inbound licensing nor contributor intake, so inbound equals outbound
  under MIT is unaffected.
- **Decision 5 stands for the tip and the history, and is incomplete for
  artifacts.** Removing the document is still the right call. #1362 tracks the
  separate question of the pre-releases that already carry it.

Decisions 3 and 4 are named explicitly here so that a reader does not treat the
whole record as in doubt. Only the personal-address mechanism is in question.

### Mechanism options for Decisions 1 and 2

**Option A: publish rewritten history as a new repository, and leave this one
private.** The cost is a new repository with issues, pull requests, labels,
milestones, releases, branch protection, workflows, and the GitHub Pages docs
deployment either migrated or abandoned. Every external link to the current
repository breaks. The 16 legacy releases on this repository and the separate
`thebristolsound/birdbrain-releases` repository each need their own decision.
The weakness is that `refs/pull` is what forces this option, and the price of
escaping `refs/pull` is the pull-request record itself, which is where most of
this project's design reasoning lives. The private repository still holds the
metadata, so the outcome depends on that repository staying private
permanently.

**Option B: force-push the rewrite, then engage GitHub Support's sensitive-data
removal for `refs/pull`.** The cost is the rewrite and every consequence
already listed at lines 78 to 83, plus a support request that has to enumerate
the affected pull requests. The weakness is that the removal is discretionary
and carries no service-level guarantee, so the schedule for cutover depends on
a third party. The request has to complete before visibility flips, or the
addresses are public while it is pending, and clones, forks, and caches stay
out of reach either way.

**Option C: narrow Decision 1 to exclude the domain `SECURITY.md` publishes.**
The cost is an edit to this record and a smaller filter scope. The `@proton.me`
domain stays in the history, and its 563 identity-field occurrences become
public at cutover. The weakness is that this accepts publication of one
personal domain, and it does not by itself fix the other two: a pass scoped to
`@protonmail.com` and `@gmail.com` still leaves both served from `refs/pull`.
The option makes the record honest without making the exposure go away.

**Option D: publish the history unchanged.** The cost is no engineering time at
all. The weakness is that it publishes all three domains and reverses Decision
1 outright. Decision 1's revisit trigger at lines 45 to 48 states that the
decision does not flip to accept under schedule pressure, so this option
requires overturning that trigger deliberately rather than arriving at it by
default.

### Recommendation

Narrow Decision 1, which is option C. Three reasons:

1. `SECURITY.md` line 12 already publishes an address on the `@proton.me`
   domain as the security contact on the tip, so removing that domain from the
   history hides nothing the repository does not already advertise.
2. `refs/pull` keeps serving all three domains whatever the filter pass does,
   so no option except A removes them from what GitHub serves.
3. Options A and B cost weeks. Option B additionally depends on GitHub Support,
   which offers no service-level guarantee for a sensitive-data removal across
   494 refs.

This is a recommendation and not a decision.

### The filter-scope surfaces #1359 found

Decision 2's own text at lines 74 to 76 states that nothing else is rewritten,
and that any additional purge candidate must be added to this record first,
with its own rationale, before it joins the filter scope. The 265 commit
message bodies and the 14 tracked files counted earlier are additional
candidates. Whoever writes the #269 tooling therefore cannot simply add them:
they need either a decision recorded here with a rationale, or an explicit
exclusion with a stated reason. This amendment records the two surfaces and
takes neither.

### Outcome

**Narrow Decision 1. Option C.** Decided by the maintainer on 2026-09-09, on
the evidence recorded in this amendment and in #1357, #1359, #1360 and #1362.

Decision 1's scope becomes the two personal domains that are not the published
security contact. The `@proton.me` domain is **excluded from the rewrite** and
its occurrences in author and committer metadata stay as they are. Rationale:
`SECURITY.md` line 12 publishes an address on that domain deliberately, as the
security-report fallback, so rewriting 563 identity fields to suppress a string
the repository advertises on its tip buys nothing. The other two domains are
not published anywhere on the tip and stay in scope.

Decision 2's mechanism is unchanged in kind - one `git-filter-repo` pass before
the cutover - but its stated outcome is now explicitly partial. The pass removes
the two unpublished domains from `refs/heads` and `refs/tags`. It does **not**
remove them from `refs/pull`, which GitHub maintains server-side and no push can
alter. Anyone reading this record must not infer that the rewrite makes the
addresses unreachable: it reduces the surface, and #1357 records what remains.

**Consequences for #269 and #270.** The rewrite is still worth doing and still
happens inside the freeze, but it is no longer a precondition for the cutover in
the way Decision 1's original revisit trigger implied. That trigger said the
fallback was to postpone the cutover rather than publish history that had not
been rewritten. It is superseded: postponing the cutover cannot achieve what it
was written to protect, because `refs/pull` defeats it either way.

**What is still not decided here.** The filter scope for the 265 commit message
bodies and the 14 tracked files remains open, per the section below. And whether
to pursue GitHub Support's sensitive-data removal for `refs/pull` after the
cutover is a separate question, deliberately left to #1357.

**Revisit trigger.** A concrete harm arising from either the `@proton.me`
exclusion or the `refs/pull` residue - unsolicited contact traced to the
history, or a request from a third party whose address appears in it.
