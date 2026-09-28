# 0008. Public-release decisions

Date: 2026-08-10
Status: accepted; amended 2026-09-09, 2026-09-11 and 2026-09-28
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

A head that is not an ancestor of `main` is out of reach of any rewrite of
`main`, and GitHub's commits endpoint still serves its author and committer
metadata. Checked on a sample head at f1ab45ae, both fields carried a personal
domain. Every one of the 494 head refs that is not an ancestor of `main` stays
readable through that endpoint after any rewrite of the branch.

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

## Amendment 2026-09-11: Decision 5's artifact residue, and the filter scope

The 2026-09-09 amendment earlier in this record reopened Decisions 1 and 2 and
recorded the ruling on them. It left two things undone that its own text calls
for. This amendment records the Decision 5 ruling that was taken and executed on
2026-09-09 but never written into this record, and re-derives every figure
against the current tip, because `origin/main` has advanced from f1ab45ae to
064a80c5. It then records the one decision the 2026-09-09 amendment
deliberately left open, the filter scope for commit bodies and tracked files,
ruled by the maintainer on 2026-09-11.

### Decision 5: the artifact residue, and what was done about it

Decision 5 orders `docs/specs/2026-07-27-public-repository-readiness-assessment.md`
absent from the published history entirely, and folds the removal into
Decision 2's rewrite so tip-removal alone is not relied on. #1362 established
that the file is also inside published installer bytes, which no rewrite of a
git history reaches. The stated aim was therefore unachievable by the rewrite
alone, for reasons that have nothing to do with git.

**What was decided and executed on 2026-09-09**, recorded on #1362 at the time
and re-verified here:

- **The 16 legacy releases on `thebristolsound/birdbrain` were deleted.**
  `v0.1.0-alpha.2` through `v1.0.1-beta.17`, dated 2026-04-03 to 2026-07-24, all
  flagged pre-release, carrying 120 assets, and 35 downloads between them. They
  would have become a second public download surface at the visibility change.
- **Their tags were preserved.** `gh release delete` was run without
  `--cleanup-tag`, deliberately, because Decision 2's rewrite scope counts tags
  and deleting them would have changed that scope silently.
- **The four pre-releases on `thebristolsound/birdbrain-releases` were left in
  place.** `v1.0.1-beta.18` through `v1.0.1-beta.21` still contain the readiness
  assessment, `CLAUDE.md` and `CONTEXT.md`. The rationale recorded on #1362 is
  that testers are running `beta.21` now, and yanking it costs more than it
  buys. The replacement is a re-cut on the next beta rather than a withdrawal.

**Read back on 2026-09-11**, at `origin/main` 064a80c5:

```
$ gh api repos/thebristolsound/birdbrain/releases --jq 'length'
0
$ gh release list --repo thebristolsound/birdbrain-releases --limit 30 | wc -l
4
$ git ls-remote --tags origin | grep -v '\^{}' | wc -l
22
```

**The packaging cause is fixed.** PR #1384 merged 2026-09-10 and replaced the
exclusion-only `build.files` key with an allowlist, so a build from the current
tip no longer packs the project tree.

```
$ git show origin/main:package.json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).build.files))'
[ 'out/**/*', 'resources/**/*', 'package.json', 'node_modules/**/*' ]
```

**What this means for Decision 5.** The decision stands for the tip and for the
history. Its stated outcome does not extend to artifact bytes already
downloaded, and this record should not be read as claiming otherwise. The
residue is bounded to four pre-releases on one repository, with a re-cut as the
retirement path, and the mechanism that produced it is closed.

### Figures re-derived at 064a80c5

The 2026-09-09 amendment states that its figures were re-derived at f1ab45ae.
That statement stays true as written and its numbers are not edited here. These
are the same measurements taken again on 2026-09-11, so that whoever writes the
#269 tooling works from the current tip rather than from a two-day-old count.
Local parts are withheld throughout; only domains are reported.

```
$ git log --format='%ae%n%ce' origin/main \
    | grep -oE '@[A-Za-z0-9.-]+$' | sort | uniq -c | sort -rn
   1703 @protonmail.com
    671 @github.com
    567 @proton.me
    216 @anthropic.com
    202 @users.noreply.github.com
      7 @gmail.com

$ git log -40 --format='%ae' origin/main \
    | grep -oE '@[A-Za-z0-9.-]+$' | sort | uniq -c | sort -rn
     16 @protonmail.com
     13 @users.noreply.github.com
     11 @proton.me

$ git log --format='%B' origin/main \
    | grep -cE '[A-Za-z0-9._%+-]+@(proton\.me|protonmail\.com|gmail\.com)'
266

$ git grep -lE '@(proton\.me|protonmail\.com|gmail\.com)' origin/main -- . | wc -l
14

$ git ls-remote origin 'refs/pull/*/head' | wc -l
510
$ git ls-remote --heads origin | wc -l
130
```

Three of those moved in a direction worth naming. The `refs/pull` head count
rose from 494 to 510 in two days, so the residue Decision 2 cannot reach grows
with ordinary development. The commit-body count rose from 265 to 266. And in
the last 40 commits, 27 of 40 author addresses now carry a personal domain
against 16 of 40 at f1ab45ae, because the repository's configured commit
identity is itself an in-scope address. That last point is filed separately as
a defect rather than absorbed here: every commit made before it is fixed
enlarges the scope of the rewrite this record orders.

### Ruled: commit bodies and tracked files are excluded from the filter scope

Decision 2 states that nothing beyond identity metadata and the Decision 5 file
is rewritten, and that an additional purge candidate joins the scope only with
its own rationale recorded here. The 2026-09-09 amendment named the commit
message bodies and the tracked files as candidates and took no decision on
them. This records the decision. #1359 asked for it.

**Outcome. Both surfaces are excluded.** Decided by the maintainer on
2026-09-11. The `git-filter-repo` pass stays scoped to author and committer
metadata, plus the Decision 5 file purge. Commit message bodies and blob
content are not rewritten.

**Rationale for the 266 commit message bodies.** The `refs/pull` finding
applies to a message body exactly as it applies to an identity field. Rewriting
266 bodies on `refs/heads` leaves the pull-request copies of those same commits
serving the originals, so the work buys a partial result on the surface where a
partial result has already been accepted for identity metadata. Paying for the
rewrite twice does not make either half complete.

**Rationale for the tracked files.** The figure of 14 files counts three
different things, and separating them removes the case for rewriting any of
them. Every match was classified on 2026-09-11 by comparing it against the
maintainer's own addresses.

- **Three files carry the maintainer's own address, all on `@proton.me`:**
  `SECURITY.md`, `docs/plans/2026-04-09-settings-enforcement.md` and
  `docs/plans/2026-05-03-capture-detail-polish-r2-impl.md`, 8 occurrences
  between them. That domain left the rewrite scope under the 2026-09-09 ruling
  because `SECURITY.md` publishes it deliberately, so these are already out of
  scope and nothing here changes that.
- **Five files carry invented demo content**, the design-handoff mocks under
  `docs/design-handoff/`, 18 occurrences. The addresses sit beside
  `gh0stline@tuta.io`, `cracked-forum.example.net` and fabricated Bitcoin
  addresses in a fictional investigation scenario. They are not anyone's
  contact details.
- **Six files carry test fixtures**, two under `docs/plans/` and `docs/specs/`
  and four under `tests/` and `e2e/`, 27 occurrences. They are extraction
  fixtures and an email-validator assertion.

**No tracked file at the tip contains a maintainer address on a domain the
rewrite is scoped to remove.** The in-scope domains are `@protonmail.com` and
`@gmail.com`; every occurrence of either in tracked content was read in context
and found to be synthetic rather than a maintainer address. Rewriting blob content would therefore rewrite fixtures and demo
data, at the cost of changing every descendant object identity, and would
remediate nothing.

**What this does not decide.** Excluding the tracked files from the filter pass
says nothing about whether any of them should be edited at the tip. That is an
ordinary commit rather than a history rewrite, and it is available at any time
without a freeze window.

**Revisit trigger.** A maintainer address on an in-scope domain found in
tracked content. That would be a new fact rather
than a re-weighing of this one, and it reopens the blob half of this ruling
only.

## Amendment 2026-09-28: no rewrite, and the cutover rulings

The maintainer took the rulings below on 2026-09-28, in one sitting, on evidence
a prep pass re-derived at `origin/main` c2d730c8 on 2026-09-27 and 2026-09-28.
They replace the outcomes of Decisions 1, 2 and 5, amend Decision 4, leave
Decision 3 as it stands, and record the settings the cutover (#271) checks
against. The running plan is
`docs/plans/2026-09-27-public-repo-ultracode-prep.md`.

### The evidence that reopened the rewrite

The 2026-09-09 amendment accepted that `refs/pull` keeps serving pre-rewrite
commits and still judged the rewrite worth doing. The prep pass measured how much
that residue covers, and what the rewrite would cost.

- **One pull-request ref carries the whole history.** The head ref of one recent
  pull request reaches 1,821 of the 1,822 commits on `main`, including every
  commit whose identity fields carry an in-scope domain. After a rewrite, a single
  `git fetch` of that ref returns the original history.
- **The readiness assessment is in the same residue.** 433 of 623 pull-request
  head trees contain it, on top of the four published pre-releases #1362 found.
- **GitHub's remedy costs the review record.** GitHub Support's sensitive-data
  removal breaks the diff view of every closed pull request built on the affected
  history, which here is all of them, because the first commit carries an
  in-scope domain. The 2026-09-09 amendment calls that record "where most of this
  project's design reasoning lives."
- **The rewrite changes provenance the project relies on.** Every commit id
  changes, so every id cited in docs, issues, and pull requests stops resolving.
  The 22 tags move. The signatures on 890 commits (783 signed by GitHub for commits
  and merges made on the site, 107 SSH-signed) are dropped, because a rewritten commit cannot keep its
  signature. Decision 2's revisit trigger names corrupted provenance as grounds to
  reopen it.

### Decisions 1 and 2: accept, and preserve the history

**Outcome.** No history rewrite. The personal addresses in the history's
identity fields are accepted as public. There is no `git-filter-repo` pass, no
force-push, and no rewrite inside the freeze window. Commit ids, tags and
signatures stay as they are. No GitHub Support removal is requested. This
supersedes Decision 1's outcome to remediate, Decision 2's scoped rewrite, the 2026-09-09
narrowing to two domains, and the 2026-09-11 filter-scope ruling, all of which
described a rewrite that will not run.

**Rationale.** Everything the rewrite would remove stays one fetch away through
`refs/pull`, and the only remedy for that costs the pull-request record. What the
rewrite would buy is a clean default clone and web view of `main`; what it would
cost is the provenance of the whole history. For an evidence tool, a public and
verifiable development history (commits, reviews and decision records) is worth
more than a clean default clone.

**Attribution.** The maintainer moves the `@protonmail.com` address from the
machine account to his own account, so the commits that carry it are credited to
him, and turns on the machine account's private-email setting. Until then, squash
merges of the pull requests the machine account opens still carry
`@protonmail.com`, as they did on 2026-09-27; afterwards they land under its
no-reply address. The first such merge is read back to confirm it. The maintainer's own future commits stay on the
`@proton.me` address `SECURITY.md` publishes.

**Revisit trigger.** A concrete harm traced to the published addresses, such as
unsolicited contact traced to the history, or a request from a third party whose
address appears in it.

### Decision 5: removed from the tip by an ordinary commit

**Outcome.** The readiness assessment is deleted from the tip in the same pull
request as this amendment. It stays readable in the history, in `refs/pull`, and
in the four published pre-releases. Those four are deleted from
`thebristolsound/birdbrain-releases` once the next beta has updated testers.

### Decision 4: code owners and a main ruleset are selected

Decision 4 stands for inbound licensing: inbound equals outbound under MIT, with
no CLA and no DCO. Its contributor-intake posture is amended. #268's "no
CODEOWNERS unless explicitly selected" is the selection point, and this is the
selection.

- A `CODEOWNERS` file names the maintainer on every path.
- The `main` ruleset requires one approval, which must be the maintainer's as
  code owner, and a fresh approval after any later push. It allows squash merges
  only, requires signed commits, and adds the full-history secret scan and the
  registry publish guard to the required checks. The maintainer's bypass applies
  only when merging a pull request, so nobody pushes to `main` directly. The
  deploy-key bypass is removed.
- A tag ruleset lets only the maintainer create `v*` tags.
- Blank issues are turned off, so reports come through the bug and feature forms.

The dependency audit is not a required check, because it fails on every branch
whenever a new advisory is published. Review-thread resolution is not required,
because bot threads would block merges. While this ruleset holds, the dispatch
routine cannot merge its own pull requests.

### Rulings the cutover checks against

- **Spend.** Anything that can cost the maintainer money runs only when he
  invokes it or on a schedule he set. Other collaborators, outside accounts and
  bots cannot start a paid run. #1310 carries the workflow and dispatch changes.
- **Access.** One other collaborator keeps write access. The second was removed on
  2026-09-28, because GitHub offers no read-only collaborator level on a
  repository owned by a personal account.
- **Actions settings.** The default workflow token is read-only and cannot approve
  pull requests. Pull requests from forks get no write token and no secrets.
  Secret scanning and push protection are turned on at the flip. Allowed actions
  stays at all, because every action is pinned to a commit.
- **Branches.** Every branch, tag and pull-request ref is bundled, and the bundle's
  restore verified, before any deletion. Then the 20 branches with tooling-prefixed
  names and no pull request are deleted (#1370 lists them). Nothing belonging to
  Shared Case or persona work is deleted.
- **Dispatch artifacts.** The existing run bundles expire on their own. Future
  bundles are kept seven days, and the per-run spend is stripped from the bundle
  and the run page (#1369).
- **Pre-cutover evidence.** The full inventory and scan output stay in the
  maintainer's custody, outside the repository. The repository tracks the runbook
  and a summary with counts.
- **Beta and cutover.** Neither waits on the other, and they never share a window.
- **Flip window.** The public text saying the source is private changes in the
  same window as the flip. A collaborator without administrator rights files the harmless
  vulnerability-report test, because GitHub directs administrators to draft an
  advisory instead of filing a report. The unused
  doc-curator secret and variable are deleted, and the Copilot coding agent's
  firewall is turned back on.

### Figures at c2d730c8

```
$ git ls-remote origin 'refs/pull/*/head' | wc -l
623
$ git ls-remote --tags origin | grep -v '\^{}' | wc -l
22
$ git rev-list --count origin/main
1822
```
