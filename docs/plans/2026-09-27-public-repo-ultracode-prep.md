# Public repository cutover: `ultracode` session prep

Prepared 2026-09-27 against `origin/main` at `36a375e3` (Security green at that sha). Governing
record: `docs/adr/0008-public-release-decisions.md` on `main`, plus its three unmerged amendment
commits on branch `adr-0008-amendment` (`191d3d5f`, `122c9ed3`, `dbb7e431`, which merge cleanly
into `main` today). Tickets: the original batch #263-#274 and the 2026-09-09 audit wave
#1355-#1372, plus #1310 and #1449. Prep shape and fleet rules: `docs/plans/2026-09-19-beta-release-path-ultracode-prep.md`.
Ruling comments on the issues outrank this document where they conflict.

**The completion test is #271's acceptance criteria met and #272's report clean.** The
repository is public, protections and private vulnerability reporting are on and tested, and a
logged-out audit finds nothing the rulings did not intend to publish. Four `ultracode` sessions
get there, plus one maintainer-run cutover window between the third and fourth. The visibility flip,
the history rewrite and every deletion of remote state stay with the maintainer.

## Program state

Every figure is read today; the audit wave's figures date from 2026-09-09 and several have moved.

| Measure | 2026-09-09 | 2026-09-27 | Source |
| --- | --- | --- | --- |
| `refs/pull/*` on origin | 500 | 622 | `git ls-remote origin 'refs/pull/*'` |
| Branch heads on origin | 132 | 137 | `git ls-remote --heads origin` |
| Tags on origin | 22 | 22 | `git ls-remote --tags origin` |
| Unexpired `dispatch-run` artifacts | 41 | 173 | `gh api .../actions/artifacts` |
| Registered workflows | 16 | 20, two disabled | `gh workflow list --all` |
| Personal-domain authors in last 40 on `main` | 17 | 28 (25 `@proton.me`, 3 `@protonmail.com`) | `git log -40 --format=%ae` |

**Already done since the audit.** The legacy releases on this repository are deleted (16, tags
kept, #1362 comment of 2026-09-09). The packaging allowlist merged as PR #1384, so `build.files`
is now `out/**/*`, `resources/**/*`, `package.json`, `node_modules/**/*`, and the next beta's
installers no longer carry the tree. The Dependency audit blocker #1324 is closed. The shared
repository config's email is the no-reply address (#1449's first half). #262, #266 and #267 are
closed. #268's work merged as PR #375 and waits only on the maintainer's close.

**Nothing in the mechanical half of the audit wave has landed.** Each was re-checked at
`36a375e3`: the pre-pass gate still has no fork guard; `release.yml:122` still derives
`prerelease` from the tag string; `SECURITY.md:5` still links this repository's empty release
page; `redact()` still matches only `sk-ant-`; the extension font still ships without its licence;
`.macroscope`, `.specify` and `.sandcastle` are still not ignored; the SonarQube instruction file is
still present; `.issuetracker:7` still has the placeholder; `blank_issues_enabled` is still true;
`serverToken.ts` still has no `safeStorage`.

### Findings from this prep

Three are new and one widens a ticket. None is filed: each folds into an existing ticket's ruling.

1. **Squash merges of machine-account PRs land under a personal address.** All three
   `@protonmail.com` authors in the last 40 commits (`36a375e3`, `04aef1a3`, `8505b381`) have
   author name `birdbrain-agent` and committer `GitHub`. GitHub authors a squash merge with the
   PR author's account email, so the `birdbrain-agent` account's commit-email setting is in scope
   for #1449. The repository-local identity fix does not reach it. Folds into #1449's
   acceptance criterion 2.
2. **`jev-lens.yml`'s triage job runs a paid model call on any issue an outsider opens or edits.**
   It guards only `github.actor != 'birdbrain-agent'`, and `issues` events run in the base
   repository with its secrets, so the header's "Forks and Dependabot get no secrets" covers the
   PR job only. After the flip, any GitHub account can trigger `TYPESAFE_API_KEY` spend and send
   issue text to a third-party model. Same class as #1310; folds into its ruling.
3. **`claude.yml` rests its trust boundary on an action default.** The header says only users
   with write access trigger it ("the action's default"), and the job holds the machine PAT with
   push rights. Session 1 verifies that default against the action's documentation (Context7)
   before it is relied on; if it holds, #1310's ruling records it, and if not, the guard is
   added in session 3.
4. **#1366 misses a second copy of the environment id.** `docs/plans/2026-09-19-defect-review.md:187`
   quotes it while describing #1366, so the ticket's own `git grep ... -- docs/` gate fails
   after the listed fix. Intake correction: the redaction covers that line too.

### Rules that carry forward

Opus at `max` on every fleet agent, passed as `model: 'opus'`. `Closes #N` on line 1 of every
body. `pnpm preflight` at head, regenerated after any push. Labels in the create call, verified by
a direct read of `issues/<n>/labels`. Every branch cut from `main`. One `birdbrain-reviewer` at a
time, a pre-pass on every PR. Nothing auto-merges. At most two defects filed per PR. Every PR
linked to the thread with `link_pull_request`.

Session-specific: every PR here is off the dispatch slot (`agent-authored`, never `agent-pr`,
never `queued`), because six of them edit `.github/workflows/**` and the machine token cannot
push those (#1374); branches push over the maintainer's SSH login. Scheduled Dispatch and Doc
curator stay disabled throughout (ADR-0029), which is also what makes #1310 safe to land after
session 1 instead of before it. No report, inventory or PR body reproduces a credential or a personal
address's local part.

## Session map

| Session | Mode | Tickets | Waits on | Human reviews |
| --- | --- | --- | --- | --- |
| 1. Record and rulings | grilling in chat, one reground workflow | #1357, #1359, #1360 closed out; rulings on #1310, #1364, #1365, #1368, #1369, #1370, #1372, #1449, #265, #273, and R13-R14 below | nothing | 1 (the ADR PR) |
| 2. Mechanical fleet | seven implementers, runs beside session 1 | #1355, #1356, #1358, #1361, #1363, #1366, #1367 | nothing | 7, all S |
| 3. Ruled follow-through | implementers plus maintainer settings acts | #1310, #1364, #1365, #1368, #1369, #1372, #1449, the split halves of #265 and #273 | session 1 | 8-9, one blocking-tier |
| 4. Pre-cutover evidence and rehearsal | readers, a rehearsal agent, a runbook writer | #263, #264, #269, #270 | sessions 2 and 3 merged; beta cut | 1 (the runbook) |
| Cutover window | maintainer, by the runbook | #271 | session 4 and an explicit go | none |
| 5. Post-flip validation | one auditor, one implementer | #272, #273's code-scanning half, #1355's live check, #1357's open question | cutover | 1-2 |

Sessions 1 and 2 can start the same day. The long pole is the maintainer's rulings and review
queue, not agent time.

## Session 1: record and rulings

**Goal.** Land the amended ADR-0008 and take every ruling the later sessions need, in one sitting.

**Workflow before the sitting.** One `Workflow`, eight agents: four readers, one per ruling
cluster (history and identity: #1357, #1359, #1449, R14; exposure: #1310, #1369, the two new
workflow findings; licensing: #1363, #1364, #265; repository surface: #1365, #1370, #1372,
#1368, #273), three refuters paired with the first three readers, and one completeness critic
that diffs the readers' surface list against #263's acceptance criteria. Each reader re-derives
its tickets' figures at head and drafts the ruling question with a recommendation grounded in a
repository document. Output: a ruling pack, presented as chat rounds of at most two questions.

**PR.** Branch from `main`, cherry-pick the three `adr-0008-amendment` commits, re-derive the
figures they cite (the `refs/pull` count is now 622), and append the new rulings. One PR,
docs-only, no label. Its merge settles #1357 except the post-cutover GitHub Support question
(R12) and #1359, whose 2026-09-12 comment records all four criteria met on the branch. #1360
closes once its criteria are checked against the merged text.

**Exit.** Every ruling below is posted on its issue, labels are set to match (the `#265` and
`#273` splits filed as new issues if agreed), and the ADR PR is open.

### Rulings, each with a recommendation

- **R1, #1310 and findings 2 and 3: who may trigger a secret-bearing workflow.** Recommend:
  write or admin collaborators plus an explicit bot allowlist, applied to dispatch's pre-gate,
  `jev-lens.yml`'s triage job, and `claude.yml` if its default does not already hold.
- **R2, #1369: the 173 dispatch artifacts.** Recommend: delete all unexpired `dispatch-run`
  artifacts in the cutover freeze, set `retention-days: 7` on the upload, and drop the spend
  figure from the job summary. Deletion is irreversible, which is why it waits for the ruling.
- **R3, #1370: which branches survive.** Recommend: bundle every head into the #263 backup, then
  delete the 20 no-PR branches with disclosing prefixes, including all `stash-archive/*`. Keep
  the rest; a merged-PR-head prune is a separate, later choice.
- **R4, #1449: identity.** Recommend: set the `birdbrain-agent` account's commit email to its
  no-reply address with the block-pushes-that-expose-email setting on, and add the one-line CI
  check from acceptance criterion 3. Both are account settings only the maintainer can change.
- **R5, #1364: third-party notices.** Recommend: generated at package time from
  `pnpm licenses list --prod --json` (built into pnpm, no new dependency), shipped inside the
  app resources, not committed; a small committed overrides file supplies text for the six
  packages with none on disk; the 13 shadcn/ui files are recorded as MIT-licensed vendored
  source in the same notice.
- **R6, #1368: the pairing token at rest.** Recommend: leave it unwrapped and write the
  rationale beside the code, as the signing key does: any process that can read the token file
  can already read the database and captures beside it. The comment still touches a
  blocking-tier file, so the PR carries `evidence-affecting` and gets human review.
- **R7, #1372.** Recommend: a `CODEOWNERS` naming the maintainer on the blocking-tier paths
  only, blank issues off, and #271 gains the private-vulnerability-reporting API check.
- **R8, #1365.** Recommend: delete the SonarQube instruction file.
- **R9, #265 split.** Recommend: agree; acceptance criteria 2-4 become a `ready-for-agent`
  issue for session 3, and 1, 5, and 6 stay with the maintainer.
- **R10, #273 split.** Recommend: agree; the SBOM and release checksums for the public releases
  repository move to session 3, and code scanning stays post-flip.
- **R11, #268.** Close it; the work merged as PR #375.
- **R12, #1357's open question: GitHub Support removal of `refs/pull`.** Recommend: decide after
  session 5 measures what an anonymous client can actually fetch, not before.
- **R13, where the pre-cutover evidence lives.** Recommend: the full inventory and scan output
  stay in the maintainer's custody beside the backup bundle, outside git; the repository tracks
  only the runbook and a summary with counts. Decision 5 purges the readiness assessment for the
  same reason these reports would need purging.
- **R14, order against the beta.** Recommend: cut the beta first, then run the cutover in a
  later window. #271 forbids a release in the cutover window, and the rewrite re-points every
  tag, so a tag cut after it is the first one on the published history.

## Session 2: mechanical fleet

Seven `ready-for-agent` tickets that need no ruling. One `Workflow` with seven
`birdbrain-implementer` agents (`isolation: 'worktree'`), each told it has no dispatcher, opens
nothing and returns branch, sha, title, body path, and labels. The session opens each PR, reads
labels back, links it, then runs one reviewer pre-pass per PR in sequence. None is
`evidence-affecting`.

| Ticket | Files | Intake note |
| --- | --- | --- |
| #1355 | `pre-pass-gate.yml` | Line numbers have moved. #1346 closed not-planned; extend the header for the fork case and leave the Dependabot sentence as it stands. |
| #1356 | `release.yml`, `release-macos.yml` | The expression is at line 122 now. Take the explicit `prerelease: true` option for `release-macos.yml`, since it removes the open question the issue leaves (pattern-following). |
| #1358 | `SECURITY.md` line 5 only | Line 12 is settled by the #1360 ruling; untouched. |
| #1361 | `run.sh`, a new file with no side effects when sourced, a test | `run.sh` moved (`redact()` at 28, `scrub()` at 83). The test runs through vitest calling bash, so CI's test job carries it with no workflow edit. |
| #1363 | `extension/src/fonts/OFL.txt` | As written. |
| #1366 | `birdbrain-beta20-RUNBOOK.md`, two plan docs, `.issuetracker` | Widened by finding 4. |
| #1367 | `.gitignore`, a test | As written. |

**Conflict map.** `run.sh` belongs to #1361; #1369's code half in session 3 rebases onto it.
`SECURITY.md` belongs to #1358; nothing else in sessions 2 or 3 edits it. The two workflow files
belong to their tickets alone.

**Tooling.** `shellcheck` and `actionlint` are not installed here, and #1356 and #1361 name them
in acceptance criteria. See the questions for the maintainer at the end of this document.

## Session 3: ruled follow-through

Starts once session 1's rulings are posted. Shape as session 2, sized to the rulings.

- **#1310 (and R1).** `pregate.sh` by an implementer; `.claude/skills/dispatch/SKILL.md` by the
  session itself, because #1066, which records that the implementer sandbox cannot edit
  `.claude/skills/**`, closed not-planned. `jev-lens.yml` and, if needed, `claude.yml` in the same PR.
- **#1369 (R2).** `retention-days` and the summary change. The artifact deletion is a
  maintainer command listed in the runbook, not in the PR.
- **#1364 (R5).** A notices generator in the packaging step, the overrides file, and a check
  that the packaged app and extension zip contain the notice. Advisory tier (`package.json`
  build block).
- **#1368 (R6).** Comment and whitepaper line; `evidence-affecting`, human review.
- **#1372 (R7), #1365 (R8).** `CODEOWNERS`, `config.yml`, the file deletion. One PR each.
- **#1449 (R4).** The CI check. The account setting is the maintainer's.
- **#265 mechanical half (R9).** An inventory of committed assets, packaged contents, and shipped
  licences; its output joins the R13 custody set, with only counts tracked.
- **#273 release half (R10).** SBOM and checksums on `release.yml`. A CycloneDX or SPDX
  generator is a new dependency, so it is asked for before the implementer starts.

## Session 4: pre-cutover evidence and rehearsal

Starts when sessions 2 and 3 are merged and the beta is cut. Everything here is read-only
against origin except the runbook PR.

- **#263 inventory.** An agent enumerates refs, releases on both repositories, artifacts,
  secrets and variable names, environments, rulesets, hooks, deploy keys, and apps with the
  maintainer's administrator-scoped `gh`, and writes a mirror bundle whose restore it verifies into a
  scratch directory. Custody of the bundle is the maintainer's.
- **#264 scan.** Gitleaks over the bundle with `refs/pull` fetched, which the CI job does not
  reach; a second pass over a dump of issue and PR bodies and comments; the credential inventory
  including the pairing token. Revocation is the maintainer's.
- **Rehearsal (#269, #270).** `git-filter-repo` against a mirror clone with the ruled scope:
  two domains in identity fields, plus the Decision 5 file purge. It measures what the cutover
  will break: the 18 commit-keyed `.gitleaksignore` fingerprints, the Doc curator's marker in
  issue #795, commit ids cited in tracked docs, and every local worktree and never-pushed drafts
  branch. The `inflight` skill lists the last group; each is pushed or bundled before the freeze.
- **#270 runbook.** Written from the rehearsal: freeze by `gh workflow disable` over all 20
  workflows, no ruleset toggle (admins bypass it), final scans, bundle, rewrite and force-push,
  the R2 and R3 deletions, the flip, private vulnerability reporting, re-enable. It includes stop
  conditions, the incident path, and a dry run that changes no visibility.

Shape: one `Workflow` of five agents (inventory, scan, rehearsal, runbook writer, and one critic
that checks the runbook against #270 and #271's criteria), then the runbook PR.

## Cutover window

The maintainer runs the runbook. Ultracode has no part in it. #271's criteria are the checklist.

## Session 5: post-flip validation

- **#272.** One auditor, every read prefixed `env -u GH_TOKEN -u GITHUB_TOKEN` from a fresh
  clone, including whether an anonymous client can fetch `refs/pull` and what identities it serves.
  Any unexpected exposure stops the session and goes to the runbook's incident path.
- **R12.** The #272 result decides whether the maintainer files the GitHub Support request.
- **#273 code scanning.** One implementer.
- **#1355 live check.** The first fork PR's pre-pass gate must not report failure. This waits
  for an outside contributor and closes whenever one arrives.

## Questions for the maintainer

1. **Plan approval.** Six of the PRs edit workflow files and one touches a blocking-tier file,
   so under the plan-approval rule this needs your go before session 2 starts.
2. **Local tools.** May the session install `shellcheck`, `actionlint`, `gitleaks` and
   `git-filter-repo` on this machine? None is a repository dependency. The first two gate two
   session 2 acceptance criteria, the last two are session 4's instruments.
3. **Session 1 timing.** Rulings R1-R14 are one sitting of about seven two-question rounds.
   Session 2 can run while it happens.

## Outcome of sessions 1 and 2, 2026-09-28

**Session 1 ruled everything this plan left open, and changed its shape.** The rulings are in
ADR-0008's 2026-09-28 amendment and on each ticket. The one that reshapes the plan is the
history: there is no rewrite. The prep pass found that one pull-request ref carries the whole
history, so the rewrite hid nothing from a determined reader and would have cost every commit id,
the tags, 890 signatures, and the review record. What that removes from the plan:

- Session 4 has no rewrite rehearsal. It keeps the inventory, the scans, the backup bundle and
  the runbook.
- The cutover window has no force-push, no tag re-pointing, and no rule against pushing
  branches based on the old history.
- R12 is moot: nothing is filed with GitHub Support.

What it adds: the spend rule (only the maintainer starts anything that can cost money), a
hardened `main` ruleset with code-owner approval, a tag ruleset, the Actions baseline, one
collaborator removed, and the flip-window chores. Session 3 now carries #1310 under the
spend rule, #1364, #1365, #1368, #1369 (after #1619 merges, because both edit `run.sh`), #1372
with the `CODEOWNERS` file, and the two split tickets from #265 and #273.

**Session 2 delivered seven PRs, #1616 to #1622,** each approved on pre-pass (#1619 after one fix
round). They wait on one maintainer action: moving the `@protonmail.com` address off the
machine account, so their squash merges land under its no-reply address.
