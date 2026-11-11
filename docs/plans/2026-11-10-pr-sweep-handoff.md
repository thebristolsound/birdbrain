# Resume the November 10 pull request sweep

**Status:** active

## Completed survey

- Read every open pull request, its latest checks, and all issue comments on November 10, 2026. The survey found 38 open pull requests.
- Confirmed the machine account identity for comments and review statuses.
- Linked the queue to the coordinating session.
- For the [workflow action update](https://github.com/thebristolsound/birdbrain/pull/2134), confirmed the existing review names the current head, applied the authorized approval label, recorded the review status as the machine account, and refreshed the description from passing required checks. The body and comment checks passed.
- Merged the workflow action update as `00184202` after all required checks passed. The merged tree equals the simulated merge of its original head into the previous main commit; no change was dropped. The original branch commit is absent from main ancestry because the repository uses squash merges.

## Next assignments

- The fleet implementer owns fixes on pull request 2160, starting from `3f54cde37f9d`, including the maintainer-approved review policy. It has the shared preflight-lock requirement.
- Assign the four reproduced lock bypasses on pull request 2126 at `8ee37c8d436b` to one implementer. Only that worker may push its branch.
- Review pull request 2175 at `c945b741666c`, including its exact refusal text, Data-screen wording, and twelve screenshots. Prepare the concrete veto choice for Matt; no veto approval exists yet.
- The coordinator will make the small prose corrections from the pull request 2158 review directly in an isolated scratch tree. Use the exact D1/D2 corrections in comment 6778772932; do not implement new queue behavior or expand the existing unclassified technical detail.
- Pull request 2176 at `bb6f12815c3f` is now owned by the sweep. Keep its branch stable while the recovery thread builds its unopened children; notify that thread before merge or base changes.

## Queue at the survey

Each row records the current head at the survey. Refresh it before acting. A failed merge check requires its sign-off inputs; it is not itself a failed product test. The fleet result remains a merge requirement for pull requests it covers.

| Pull request                                                    | Head           | Base                                      | Lane   | Next requirement                                                                                                |
| --------------------------------------------------------------- | -------------- | ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| [#2120](https://github.com/thebristolsound/birdbrain/pull/2120) | `d5e80082003b` | `main`                                    | fix    | Resolve conflicts after earlier clean changes land; Address failed fleet review; Address current change request |
| [#2125](https://github.com/thebristolsound/birdbrain/pull/2125) | `6db0f1cf9cc4` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2126](https://github.com/thebristolsound/birdbrain/pull/2126) | `8ee37c8d436b` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2133](https://github.com/thebristolsound/birdbrain/pull/2133) | `5edd154ce905` | `main`                                    | review | Review current head                                                                                             |
| [#2134](https://github.com/thebristolsound/birdbrain/pull/2134) | `3467f7092049` | `main`                                    | merged | Landed as `00184202`                                                                                            |
| [#2135](https://github.com/thebristolsound/birdbrain/pull/2135) | `73ed4e668c2c` | `feat/background-jobs-instrumentation`    | review | Establish remaining merge-gate inputs; Land parent first                                                        |
| [#2136](https://github.com/thebristolsound/birdbrain/pull/2136) | `ef5c2a835888` | `main`                                    | fix    | Address current change request                                                                                  |
| [#2141](https://github.com/thebristolsound/birdbrain/pull/2141) | `0165b0b0f3c1` | `feat/background-jobs-ids`                | fix    | Address current change request; Land parent first                                                               |
| [#2142](https://github.com/thebristolsound/birdbrain/pull/2142) | `10e830f7b4f9` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2143](https://github.com/thebristolsound/birdbrain/pull/2143) | `af2e4615c554` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2144](https://github.com/thebristolsound/birdbrain/pull/2144) | `bf194069274b` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2145](https://github.com/thebristolsound/birdbrain/pull/2145) | `5efb7a23113d` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2146](https://github.com/thebristolsound/birdbrain/pull/2146) | `85d695ce7d37` | `feat/background-jobs-table`              | review | Review current head; Land parent first                                                                          |
| [#2147](https://github.com/thebristolsound/birdbrain/pull/2147) | `40066949be08` | `feat/background-jobs-controls`           | review | Review current head; Land parent first                                                                          |
| [#2148](https://github.com/thebristolsound/birdbrain/pull/2148) | `13bd83ecadda` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2149](https://github.com/thebristolsound/birdbrain/pull/2149) | `7410148b3959` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2150](https://github.com/thebristolsound/birdbrain/pull/2150) | `00f49fbb180d` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2152](https://github.com/thebristolsound/birdbrain/pull/2152) | `bbdbc9427fb1` | `feat/background-jobs-parallel-safe`      | review | Review current head; Land parent first                                                                          |
| [#2153](https://github.com/thebristolsound/birdbrain/pull/2153) | `a857c7a49af9` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2154](https://github.com/thebristolsound/birdbrain/pull/2154) | `3048ea9eefb5` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2155](https://github.com/thebristolsound/birdbrain/pull/2155) | `dfb624cbf09d` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2156](https://github.com/thebristolsound/birdbrain/pull/2156) | `ff8a0959a98e` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2157](https://github.com/thebristolsound/birdbrain/pull/2157) | `7f650afda85a` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2158](https://github.com/thebristolsound/birdbrain/pull/2158) | `19e4a5e89cd8` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2159](https://github.com/thebristolsound/birdbrain/pull/2159) | `bc627a264ed1` | `main`                                    | fix    | Address failed fleet review; Review current head                                                                |
| [#2160](https://github.com/thebristolsound/birdbrain/pull/2160) | `3f54cde37f9d` | `main`                                    | review | Review current head                                                                                             |
| [#2161](https://github.com/thebristolsound/birdbrain/pull/2161) | `ef4a9c4519d5` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2162](https://github.com/thebristolsound/birdbrain/pull/2162) | `afe390f23d15` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2163](https://github.com/thebristolsound/birdbrain/pull/2163) | `7af2ee9ace54` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2165](https://github.com/thebristolsound/birdbrain/pull/2165) | `484f716d0385` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2166](https://github.com/thebristolsound/birdbrain/pull/2166) | `dd209d6f71f8` | `feat/selector-match-audit-fields`        | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2167](https://github.com/thebristolsound/birdbrain/pull/2167) | `ae5d2d76ce83` | `fix/duplicate-runs-active-selectors`     | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2169](https://github.com/thebristolsound/birdbrain/pull/2169) | `1361540d3e35` | `main`                                    | fix    | Address failed fleet review; Establish remaining merge-gate inputs                                              |
| [#2170](https://github.com/thebristolsound/birdbrain/pull/2170) | `33e175693c06` | `fix/selection-action-navigation-watch`   | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2171](https://github.com/thebristolsound/birdbrain/pull/2171) | `74970e13b417` | `fix/quote-title-from-resolved-capture`   | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2172](https://github.com/thebristolsound/birdbrain/pull/2172) | `143edc351bb9` | `fix/quote-keeps-line-breaks`             | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2173](https://github.com/thebristolsound/birdbrain/pull/2173) | `976112f21262` | `fix/selection-highlight-out-of-captures` | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |
| [#2174](https://github.com/thebristolsound/birdbrain/pull/2174) | `956841b8dd13` | `fix/selection-attach-progress`           | fix    | Address failed fleet review; Establish remaining merge-gate inputs; Land parent first                           |

## Resume

Read the delegated results in the coordinating session, then refresh the remaining queue:

```shell
gh pr list --state open --limit 100 --json number,baseRefName,headRefName,headRefOid,mergeable,isDraft
```

After each merge, refresh the remaining heads, bases, and conflicts. Keep stacks in parent-first order. Read `.claude/skills/pr-sweep/SKILL.md` for the completion criteria.

## Open questions

The survey did not resolve the product questions inside existing reviews. Restate each actual question when handling that pull request. Do not infer authority to apply a fleet override from the sweep invocation.

## Release-note review checkpoint

- The [current-head review](https://github.com/thebristolsound/birdbrain/pull/2157#issuecomment-6777863590) found no new source blocker. Its merge trial against `00184202` was clean. The reviewer evaluated all prior findings and the fleet artifacts, including findings omitted from the fleet comment.
- Corrected the Summary to limit the editor exclusions to the listed folders, remove the outdated verification statement, and describe the release notes without claiming every retained sentence has a test. Updated the attribution. The body and both comment checks passed.
- Posted the [description correction](https://github.com/thebristolsound/birdbrain/pull/2157#issuecomment-6777879574). No branch files changed.
- Kept `agent/pre-pass` failed because the separate fleet check remains failed. Its passes report incomplete work even though the workflow jobs succeeded. The reviewer found the four blocking stale-count findings corrected in the current description; this does not satisfy the fleet gate.
- Next, review pull request 2160, the existing fleet-repair change. Determine whether its fixes address the incomplete-review results, and identify the supported retry path. Preserve the gate while investigating.

## Logging review checkpoint

- The [logging review](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6777939300) found only description blockers at `5edd154ce905`. The five touched test files passed all 406 tests; both logging-order regression tests reject the previous implementation. Its merge trial against `00184202` was clean.
- Narrowed the Changes and Evidence impact cleanup claims to failed-render logging, described the stored-job log test separately, and updated the attribution. Summary corrections: none. The body and both comment checks passed.
- Posted the [correction record](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6777960654) and set `agent/pre-pass` to success for the unchanged head. Marked the pull request ready for review and applied the authorized evidence approval label at that head. Its required fleet review must complete before merge.
- Read issue 2127 directly. Its first acceptance criterion asks for the job's URL host in logs, while this change expressly omits hosts under the existing redaction policy. If merging closes the issue, reopen it with this remaining requirement, as the sweep skill directs. Do not add host logging during this sweep.
- Next, review pull request 2136's corrected description and evidence gate. Its earlier change request concerned those surfaces, not a demonstrated code defect.

## Top bar verification checkpoint

- Posted [six matching screenshots](https://github.com/thebristolsound/birdbrain/pull/2159#issuecomment-6778026757) as the machine account, then read the comment back and replaced all local image paths in the description with GitHub attachment URLs. Three before-and-after pairs cover widths 900, 1400, and 1600 at height 800.
- Before capture: `00184202` on main. After capture: unchanged pull request head `bc627a264ed1`. Both used the same invented case, theme, empty Captures route, and seeded export-progress state in the running Electron app. The coordinator inspected the 1400-pixel pair.
- The existing top bar layout test passed: two tests, exit 0. One-time rendered checks passed at six widths. No product code or tests changed; missing regression assertions remain disclosed.
- Corrected the description's claim that progress text moved into the hover title: the text appears in both places. The screenshot comment and the description with uploaded URLs passed their format checks.
- The description records passing core CI and targeted checks, while expressly recording failed merge and fleet gates. Its blocked verification record is manual; regenerate the standard CI verification block with `verification-from-ci.sh 2159` once all required checks pass. Do not treat the manual record as a completed preflight.
- Next, obtain the full current-head review of pull request 2159. Its failed fleet status remains a separate merge blocker.

## Logging merge-gate notification

- Inspected [merge-gate run 42891827389](https://github.com/thebristolsound/birdbrain/actions/runs/42891827389/job/130094757225) after its failure notification. It refused the unchanged `5edd154ce905` head because the fleet was pending at the time.
- The [fleet workflow](https://github.com/thebristolsound/birdbrain/actions/runs/42891824721) has now completed successfully as a workflow, but the machine account posted a failed `review/fleet` status: all four Claude passes reported unchecked work. A successful workflow is not a successful review.
- Direct status reads confirm that `agent/pre-pass` and the maintainer approval stamp succeeded at the same head. The evidence approval label remains present. The failed fleet result still prevents merging; another merge-gate run cannot satisfy that missing result.
- The existing fleet-repair review is the next dependency for this failure. No gate override or paid rerun was attempted. The pull request remains watched for further changes.

## Fleet policy and dependency checkpoint

- Posted the [fleet repair review](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6778227425). It reproduces four source blockers; the code must change before the description can claim those fixes. Kept the review status failed.
- The maintainer explicitly chose completed source review, separately reported runtime limits, and unchanged CI gates. Recorded this [policy decision](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6778267096) on the repair. Missing source inputs and unfinished source checks still fail. Old mixed unchecked lists cannot be cleared or silently reclassified.
- Corrected the [dependency update description](https://github.com/thebristolsound/birdbrain/pull/2136#issuecomment-6778268118), applied the authorized evidence approval at the unchanged head, and refreshed the old merge-gate attempts through the repository merge script. Every required check passed before merge.
- Merged pull request 2136 as `3029954ee1338858f3be4a30a1b01c3000f14b3c`. Its tree exactly matches the simulated merge of the reviewed dependency head into main `00184202`; no change was dropped. The original branch commit is absent from ancestry because this is a squash. The remote branch is absent, confirmed with `git ls-remote` after a cleanup race warning.
- Main now includes the dependency and runtime updates. Every implementer must fetch and merge this main before final verification. The separate sharp pin will need conflict resolution when its turn comes.
- Posted the [top bar review](https://github.com/thebristolsound/birdbrain/pull/2159#issuecomment-6778289387): no source, screenshot, evidence or Summary defect remains. All 27 targeted unit tests passed; the reviewer checked all six uploaded images byte-for-byte against the local files. Its fleet and generated-verification gates remain outstanding.
- No gate override, state deletion, or paid retry was performed. A retry still depends on a corrected trusted implementation, valid inputs, and fresh completed review output.

## Recovery-thread coordination

- Read the recovery thread through its latest ownership discussion and sent the agreed split back to it. The sweep owns all open recovery pull requests through 2176. The recovery thread owns only unopened signing-tail and MHTML Parts branches; it will notify the sweep when each opens.
- The recovery thread confirmed that none of the listed veto choices has been reviewed by Matt. Agent-made decision comments are not his review. Hold these choices for concrete maintainer review before merging: 2145 export wording; 2149 missing-archive message; 2161 saved invalid patterns; 2162 version string; 2163 failed-lookup filter behavior; 2165 match-row editing; 2167 empty/no-text departure; 2171 quote cap/error; 2172 selection-dependent content/frame gap; 2173 restored highlight; 2174 notice/per-tab guard; 2175 refusal and Data-screen wording.
- Notify the recovery thread when 2175 is settled or merged, and before any change to `fix/signing-refuses-empty-operator-name`. Keep `refactor/mhtml-walk-every-part` stable and notify before merging or changing the base of 2176. Its unopened children are `feat/mhtml-parts-ipc` and `feat/mhtml-parts-tab`; do not touch them.
- Both sides agreed to use `flock /home/matt/worktrees/birdbrain/.preflight.lock` for full preflight, coverage, and reliability runs. Relayed this operational constraint to the existing fleet implementer without assigning another review.
- Preserve the later 2172 review fixes when integrating 2173 and 2174, which started from its first-round commit. Use merge-based updates and fast-forward pushes, not history rewrites. Expect path-list table overlap between 2142, 2162, and the future Parts API change.

## New review and logging follow-up

- Posted the [design review](https://github.com/thebristolsound/birdbrain/pull/2158#issuecomment-6778772932): two prose blockers remain, unsupported timeout diagnosis and contradictory resume-order claims. Its integration trial with main is clean. The coordinator will fix these small findings; no executable behavior change is requested.
- Posted the [test-lock review](https://github.com/thebristolsound/birdbrain/pull/2126#issuecomment-6778773447): four source blockers remain. Its 83 targeted tests, 41 inherited-environment tests, and six counterchecks do not make those reproduced cases safe. The integration trial preserves main's dependency changes.
- Read all sixteen non-blocking findings for 2133, including the item omitted from its displayed fleet table, from all four original artifacts. Posted [individual dispositions](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6778590740) and narrowed the Summary and proof claims to accepted jobs, refused-redirect exceptions, actual outcome fields, historical design context, and CI rather than local verification. Development-only throw boundaries and remaining test gaps stay explicit.
- No source changed on 2133. Its original source review remains successful; the fleet remains failed. No additional full suite or build ran for these description-only corrections.

## Repair and design checkpoint

- The fleet implementer pushed `e421f19ec28af927c77f07e91c6894f50cf797c8` to 2160. Its locked full verification passed at that commit: 9,889 tests passed, 66 skipped. Main's dependency changes merged cleanly without dropping a commit. The implementation separates completed source review from unverified runtime limits, retains missing-source failures and CI gates, and repairs all four reproduced source blockers.
- Updated the fleet description from `/tmp/pr2160-repair/body.md`, verified the readback, and posted all five keyed disposition files. The [source-blocker reply](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6779511010) records the changes without claiming fleet success. The review status is pending for a new independent delta review. Trusted-main deployment and valid completed fleet output remain necessary; no state deletion, override or manual paid retry occurred.
- Posted the [signing review](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6779298697) and failed its review status. Shared-case signing, abandoned render streams, overlapping backfill and current-fixture acceptance remain source blockers. The recovery owner was notified before assigning branch changes. Keep the unopened signing tail held and tell its owner when the branch is settled.
- The maintainer's refusal-message and Data-screen wording choices remain unanswered. Preserve the current copy while repairing source behavior; no agent approval substitutes for those choices or waives screenshot provenance.
- The coordinator committed the two small design corrections locally as `28a6e86aa7fbd0f3699d4efb9174d761eceabe53`, in `/home/matt/worktrees/birdbrain/scratch/pr2158-sweep-dd7afcff`. They qualify the timeout evidence and reconcile the documented resumed-job order with the actual slice-three query. Vale and whitespace checks passed. Nothing from that scratch branch has been pushed; main integration and final verification remain due.
- All five new logging-review inline comments now have keyed replies. The first is [the recovery-rule reply](https://github.com/thebristolsound/birdbrain/pull/2133#discussion_r4530589486). Four findings require aligning its older design copy with the verified canonical design. The generic refusal-label wording remains a disclosed clarity advisory. No source fix was claimed or pushed, and the logging review status now fails pending design alignment.
- The test-lock implementer remains assigned to 2126. Full verification on every branch must take `/home/matt/worktrees/birdbrain/.preflight.lock`; no concurrent coverage or reliability runs are authorized.
- Next coordinator command: `git -C /home/matt/worktrees/birdbrain/scratch/pr2158-sweep-dd7afcff fetch origin main`. Merge current main without rewriting history, compare the result against `28a6e86a`, verify under the shared lock, then push only as a fast-forward of the reviewed remote head. After that design is verified, align the logging branch's design copy without removing its instrumentation notes.

## Test-lock repair checkpoint

- The lock implementer pushed `84d56578cafe9771f0cc05220f887545e124cab7` to 2126. Its locked full verification passed with 9,875 tests passed and 66 skipped; the two focused files passed all 95 tests. Main integrated without conflicts or dropped commits. Cleanup guards never expire, unknown ownership remains held, and source-control discovery errors stop execution.
- Posted the corrected description and all seven keyed disposition files from `/tmp/pr2126-implementation/`. The [current source-blocker reply](https://github.com/thebristolsound/birdbrain/pull/2126#issuecomment-6779557220) records the repairs and remaining limits. Orphaned cleanup guards require manual inspection; surviving descendants are outside the wrapper's protection. The review status is pending for an independent delta review, and the fleet remains a separate requirement.
- The next agent batch consists of independent delta reviews of 2126 and 2160, plus implementation of the existing 2175 signing findings. Each uses its application-provided isolated worktree; no new signing-tail or MHTML work is assigned.

## Signing wording decision

- Matt selected both concrete choices: keep the existing deletion, pooled-file, bulk-deletion and recapture refusal messages, and keep Data's Unnumbered label and tooltip. Preserve that copy during repair. This settles the wording choices without waiving source, screenshot or merge requirements.
- The recovery owner reconfirmed that the signing tail stays held until the coordinator supplies 2175's settled head. The tail starts from its earlier first-round commit and will be updated and verified by that owner, outside this repair.

## Independent review and design push checkpoint

- The new [test-lock review](https://github.com/thebristolsound/birdbrain/pull/2126#issuecomment-6779833811) independently validates all four earlier repairs and finds a separate missing-owner bypass: the literal inherited marker `undefined` matches `String(readOwner(dir)?.pid)`. Its overlapping-command reproduction is confirmed; all 95 targeted tests passed. Published the verdict, narrowed the unfixed description, and failed the review status. The coordinator will fix this small source finding directly with an absent-owner and unusable-owner regression, then repeat verification.
- The new [fleet repair review](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6779895264) validates the earlier repairs but reproduces three remaining source blockers: duplicate serious rulings can pass, inline-review anchors supply the parent description, and a failed removal stops before disabling auto-merge. All 327 touched tests passed. Published the verdict and failed status, and narrowed the current description's unsupported guarantees. These defects require another implementation round; green product CI does not resolve them.
- The two comment notifications on logging were repeats. The visible walkthrough exactly matched the previously read copy, and the machine comment already retained the unmet host requirement and failed fleet status. Head `5edd154ce905` remains unchanged. No duplicate reply, new watch or link was posted.
- Pushed the two small design corrections and main integration as `e77e1224b2bc4ee4053928acaccf730bbe99e3aa` on 2158. Locked full verification passed with 9,821 tests passed and 66 skipped; coverage thresholds passed and diff coverage was not scored because no instrumented source changed. The index and final commit tree exactly match the simulated merge; no earlier commit was dropped, and non-document files match main. The staged whitespace check reported main's existing blank line at the fleet prompt's end; the contribution relative to main passes whitespace checks.
- Updated the design description with the generated final-head verification, exact Summary corrections and the retained historical failed record. Posted the [keyed correction reply](https://github.com/thebristolsound/birdbrain/pull/2158#issuecomment-6779911381), linked the pushed pull request, and left the review pending for an independent prose delta review. The logging branch's glossary already matches; its shared spec will be aligned after that review.
- Design verification and comparison artifacts are in `/tmp/pr2158-sweep-sol/`. The teardown helper removed ignored build/coverage outputs but refused to remove `/home/matt/worktrees/birdbrain/scratch/pr2158-sweep-dd7afcff` because its temporary local branch has no matching pull request. The clean tree stays for that stated reason; no force removal was attempted.
- Next agent batch: repair the three new fleet findings on the existing branch and independently review the small design delta. The signing implementer remains active with the approved copy preserved. Next coordinator source task is the missing-owner marker fix on 2126, using a separate coordinator-owned scratch tree and the existing shared verification lock.

## Local marker repair and logging alignment

- The eleven logging notifications add no new substantive finding. Each edited bot inline differs only in its hidden footer, the five machine replies already identify the pending corrections, and the omitted conversation comment is the existing scope-departure note. Head `5edd154ce905` and its failed design-review status are unchanged. No duplicate reply was posted.
- Published the [independent design review](https://github.com/thebristolsound/birdbrain/pull/2158#issuecomment-6780165197): both prose blockers are fixed and no Summary or body correction remains. Its overall status still fails for missing automated review and merge controls; this does not claim deployment of the fleet policy.
- Fixed the remaining marker bypass locally on 2126 as `ad7de93b03835ba52be932ef40b94a67d106ecc1`, in `/home/matt/worktrees/birdbrain/scratch/pr2126-marker-dd7afcff`, branch `work/pr2126-marker-dd7afcff`. The nested-run exception now requires a readable recorded owner with a positive integer PID before comparing its marker. Nine new CLI regressions cover absent, unreadable and unusable owners. All 104 touched-file tests pass; formatting and whitespace checks pass.
- The standalone Node probe genuinely reproduced overlapping live commands before the source fix, exit 1, then proved acquisition and contender waiting after it, exit 0. Logs are `/tmp/pr2126-marker-sol/builtin-before.log` and `builtin-after.log`. The queued Vitest marker run happened after the fix and passed ten selected tests with 52 filtered out; do not misreport it as a pre-fix red run.
- The first full marker verification failed, exit 1: 9,883 tests passed, 66 skipped, and the existing two-second polling test at `tests/dispatchChecks.test.ts:370` expected at least one sleep but observed none. No test assertion or timeout was changed. All other verification steps passed; coverage was not produced. The failed record is preserved in `/tmp/pr2126-marker-sol/preflight-first.log`, `.exit` and `verification-first.md`. A separate run of that file is queued under the shared lock, execution session 77056. If it passes, repeat the full check at the same commit under that lock before pushing. The marker commit remains unpublished; remote 2126 is still `84d56578`.
- Reused the coordinator's clean former design scratch tree for logging, without touching another session's tree. Its path remains `/home/matt/worktrees/birdbrain/scratch/pr2158-sweep-dd7afcff`; its branch is now `work/pr2133-design-dd7afcff`. Main merged cleanly as `cef78ce7`; the merge tree matches the simulation and no old commit was dropped. All eight instrumentation source files remain byte-identical to reviewed `5edd154c` through that integration. Package files match the already-installed main dependencies.
- Copied the exact independently approved design blob from 2158 into logging and committed it as `836b6c55d5d56150fbbc114e38bd9831c7ceb2d6`. Its locked full verification passed, exit 0: 9,852 tests passed, 66 skipped, coverage thresholds passed, and all 72 scored changed lines covered. `src/shared/types.ts` is uninstrumented. Artifacts and the generated stamp are in `/tmp/pr2133-design-sol/`. Nothing from this local branch has been pushed yet.
- The Diagnostics Log tab renders the five new labels through `labelForCode`; that is visible text despite the old No-visual-change declaration. Required matching screenshots remain before publication. The capture task uses before main `3029954ee` and after the committed logging candidate above, with no product-code change. Mechanical sequencing decision: hold the existing host verification lock for the whole app driver session, since the app's capture-server port is fixed at 19845. The signing implementer received this operational constraint. Every capture uses its own temporary profile, tmux name and screenshot folder and closes only its own app.

## Fleet writer reconciliation

- The second sweep implementer preserved three fixes at `4c7a9958012e0fa72494213775c37f1dfe8dcaab`, branch `repair/pr2160-second-source`, and stopped without pushing after remote 2160 moved unexpectedly to `65de8a86dd8f58b2b13ae3a94d58cb412904a6cd`. Its 113 focused tests pass; its own full preflight was interrupted, exit 143. `/tmp/pr2160-second-repair/report.md` and its checked draft replies record local-only work. Do not publish its incomplete body as a verified repair.
- A separate repair session pushed six commits and has another local duplicate-ruling fix at `4687689f`. It still plans a final push. Comparing the two local repairs produces conflicts in `inputs.mjs`, `merge-on-label.yml` and `reviewFleet.test.ts`. No merge or overwrite was attempted. At remote 65de, ruling aggregation and validation are byte-identical to the failed e421 review; posted a head-pinned failed independent-review status for that still-unfixed defect.
- Matt explicitly chose the other repair session as the sole further writer. Sent that session the ownership decision, preserved-commit/report pointers, shared-lock constraint, and request for its settled head and verification paths. The sweep will review that final head and add only missing regressions after handoff. No override, saved-state deletion or manual paid retry was authorized. The live fleet is held by its 40-head daily cap, not made successful by these local tests.
- Next coordinator actions: finish the isolated polling check and full marker verification; obtain the Diagnostics screenshots; publish each existing branch only after genuine committed-head verification and complete body evidence. Review the fleet owner's settled head when it arrives, using the preserved repair's counterchecks as leads rather than blindly combining implementations.

## Logging reply notification checkpoint

- Read all five new inline replies and the failed merge job at head `5edd154c`. Four design findings correctly remain open until the branch update is published. The bot withdrew and resolved its generic skipped-label finding; no wording change is needed. Its offer to open another durable-recovery issue was not accepted, and no new issue was filed.
- The failed [merge job](https://github.com/thebristolsound/birdbrain/actions/runs/42902609161/job/130132332524) names failed `review/fleet` as its reason. It does not report a new code failure or a passing review. The existing watch remains; no link, watch or list operation was repeated for this notification.
- The local logging candidate still has a passing committed-head full verification. Its screenshot task is active and uses the exact candidate. The marker fix's isolated timing check remains queued. Queued one guarded full retry at the unchanged marker commit, only after the isolated file reports exit 0; a missing or failed isolated result exits without starting the full run. The first failed log remains preserved, and there is no automatic third attempt or weakened assertion.

## Coordinator change

- Matt handed the sweep from Sol to Fable at 22:28 UTC on November 10, 2026, in the same coordinating session. The split with the recovery thread is unchanged, and that thread received a note saying so. Its preflight for the unopened Parts API branch held the shared verification lock at the handover.
- Cancelled the 21 queued pull request notifications that predate the handover. A fresh read of every open pull request replaced them: 38 are open, two conflict with main (2120 and 2148), and all but the six drafts fail or await the automated fleet review. The fleet reports the same reason on each: a Claude pass listed work it did not check. The two newest heads (2160 and 2175) are held by the fleet's daily limit of 40 heads in 24 hours.
- Pull request 2175: the signing implementer pushed `da541ed81f5f` as a fast-forward of `c945b741666c`, with main `3029954ee` merged in. Its locked full verification passed: 9,871 tests passed, 66 skipped, 97.18% of 142 changed lines covered. Posted the [20 screenshots](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6781124036) as the machine account after matching all 20 digests to the capture manifest, replaced the description with the uploaded links, and posted the [keyed dispositions](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6781130430). The review status is pending and an independent delta review against `c945b741666c` is running. The branch is not settled until that review returns; the recovery thread keeps its signing tail held.
- Pull request 2160: the other repair session finished at `39fd0763ce96` and plans no further writes. Its locked full verification passed: 9,905 tests passed, 66 skipped. The review status is pending and an independent delta review against `e421f19ec28a` is running, with the preserved local repair `4c7a9958012e` supplied as a source of counterchecks only.
- Pull request 2126: the local fix is now two commits, `ad7de93b0383` and the documentation commit `d50ea26b5d2a`, on `work/pr2126-marker-dd7afcff`. The isolated polling test passed alone, exit 0. One full verification at `d50ea26b5d2a` is queued behind the shared lock; its log and exit code go to `/home/matt/pr-sweep-fable/pr2126-preflight.log` and `.exit`. Push only if it exits 0, as a fast-forward of `84d56578cafe` on `fix/serialize-full-test-suites`. A second failure of the same polling test goes to Matt as a question, not to a third run.
- Pull request 2133: unchanged. The verified local candidate `836b6c55d5d5` still needs Diagnostics Log screenshots before it is pushed. The earlier capture task waited 600 seconds for the shared lock and took no images.
- Next coordinator actions: publish each delta verdict when its review returns; publish 2126 after a passing verification and send it to a delta review; take the 2133 screenshots when the lock is free; then send the settled 2175 head to the recovery thread.

## Open question on the fleet gate

Every pull request the fleet covers fails its check for the policy reason that pull request 2160 repairs. The repair takes effect only once it is on main, and the fleet cannot pass 2160 itself for the same reason. The maintainer's override label is the documented path past a failed fleet check. Matt has not authorized it for this sweep, so no pull request can merge until he decides whether to apply it to 2160 after its independent review approves.

## Second test-lock verification failure

- The queued full verification of pull request 2126 at `d50ea26b5d2a` failed, exit 1: 9,881 tests passed, 3 failed, 66 skipped. Every step before the coverage run passed. The log and exit code are `/home/matt/pr-sweep-fable/pr2126-preflight.log` and `.exit`.
- The failures are the same two-second polling test at `tests/dispatchChecks.test.ts:370` and two 15-second timeouts in `tests/main/services/derivedFileStates.test.ts`. The branch changes neither file. Both are on the recovery thread's list of tests that fail under load and pass alone.
- The machine was oversubscribed during the run: the 15-minute load average read 16.7 on 4 cores, with both delta reviewers running test files beside the coverage run. Run alone under the shared lock at the same commit, the two files passed all 43 tests in 29 seconds, exit 0 (`/home/matt/pr-sweep-fable/pr2126-two-files-alone.log`).
- No assertion or timeout changed, nothing was pushed, and remote 2126 is still `84d56578cafe`. No third full run starts without Matt's answer. The question for him: rerun the full verification once, with no reviewer or other test run on the machine, or publish with CI as the full-suite evidence.

## Fleet repair round three verdict

- Posted the [independent review of 2160](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6781485316) at `39fd0763ce96` and failed its review status. All three earlier blockers are fixed, each confirmed by undoing the fix and seeing a named test fail. Product CI passes at that head.
- One source blocker remains: a comment link in the Files changed form, or with a comment-like fragment outside the three recognized names, still reads as the pull request in `inputs.mjs`. Two claim findings remain: Summary sentence three overstates what a confirmation survives, and the decision record and the background-jobs guide say malformed comment links fail when several shapes do not.
- The reviewer left one behaviour as a maintainer decision: a later separate check of the same finding by the Claude reviewer replaces its earlier confirmation. That predates this change on main. The fix round corrects the sentence and leaves the behaviour.
- A sweep implementer owns the fix round in its own application checkout. It pushes only after one passing locked verification and only as a fast-forward of `39fd0763ce96`. It returns its body and replies under `/tmp/pr2160-fix-r4/`. The earlier branch holder was told the sweep now writes to the branch and that its tree stays untouched.
- Next coordinator actions for 2160: post the returned body and replies, then send the new head to a delta review against `39fd0763ce96`.

## Signing repair round two verdict

- Posted the [independent review of 2175](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6781513689) at `da541ed81f5f` and failed its review status. All five earlier blockers are fixed, each confirmed by undoing the fix and seeing a test fail. All 20 uploaded screenshots match the capture manifest. Product CI passes at that head.
- One source blocker remains on the evidence path: a thumbnail entry can still be signed with a blank operator name when a screenshot becomes verifiable during a blank-name numbering pass. The reviewer reproduced it with real file operations and checked that a blank-name guard before the thumbnail render removes it. Three claims depend on that fix. Two changed screens lack a screenshot pair: the failed sync state for a shared case with no name, and the new cleanup error notice.
- One product question goes to Matt: a shared case with no operator name shows its sync as failed and gives no reason. His earlier wording decision does not cover that state. The fix round leaves the behaviour and describes it.
- A sweep implementer owns the fix round in its own application checkout. It pushes only after one passing locked verification and only as a fast-forward of `da541ed81f5f`. It returns its body, replies, screenshot comment and capture manifest under `/tmp/pr2175-fix-r3/`. The recovery thread was told another commit will land and keeps its signing tail held.
- Next coordinator actions for 2175: upload the new screenshot pairs, post the returned body and replies, then send the new head to a delta review against `da541ed81f5f`.

## Fleet repair fix round four

- The sweep implementer pushed `0cab8a06791b` to 2160 as a fast-forward of `39fd0763ce96`, four commits. Its one locked full verification passed at that commit, exit 0: 9,950 tests passed, 66 skipped. Main had not moved, so there was no merge.
- The blocker is fixed in `024585b0`: comment links in the Files changed form read as the comment, and a comment-like fragment in no supported form fails. The red run before the fix failed 30 of 63 cases. Two advisories became fixes: an unreadable label list now withdraws every label and fails the job, and the test stub applies the real query. The across-checks ruling order is unchanged and stays a maintainer decision.
- Replaced the description from `/tmp/pr2160-fix-r4/body.md` and posted the four reply files as the machine account, starting with the [verdict replies](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6782018526). The review status is pending.
- A delta review against `39fd0763ce96` is running. It also runs the stricter link rule over every open pull request description, because a legitimate link that now fails would fail every fleet pass once this change is on main.

## Fleet repair round four verdict

- Posted the [independent review of 2160](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6782336182) at `0cab8a06791b` and failed its review status. The Files changed link fix is verified: 23 mutations each failed a test, and no link in 38 open descriptions, 280 open issues or 400 merged descriptions is newly rejected.
- One blocker remains, older than the fix round: a comment-number pointer is read only as an issue comment. Four of the eight pointers in the open issues name inline review comments. The input preparation exits 1 for pull requests 2175 and 2145, so every fleet pass on both would fail once this change is on main. Main today reads the closed issue and proceeds, so merging the unfixed head would be a regression for those two.
- The same implementer has the second fix round in its existing checkout, with the same single locked verification and fast-forward rules. It returns its files under `/tmp/pr2160-fix-r5/`.
- Next coordinator actions for 2160: post the returned body and replies, then send the new head to a delta review against `0cab8a06791b`.

## Signing repair fix round three

- The sweep implementer pushed `1a5a82f5bab1` to 2175 as a fast-forward of `da541ed81f5f`, three commits, with no main merge. Its one locked full verification passed at that commit, exit 0: 9,872 tests passed, 66 skipped, 97.26% of 146 changed lines covered.
- The blocker is fixed in `8fbdb96f`: the thumbnail backfill defers before rendering when the pass's operator name is blank. The new regression failed before the fix with one appended entry carrying a blank name, and the reviewer's own reproduction appends nothing against the fix.
- Posted the [four new screenshots](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6782441672) after matching their digests to the capture manifest, replaced the description (24 uploaded images), and posted the [keyed replies](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6782442707) and two thread replies. The review status is pending and a delta review against `da541ed81f5f` is running.
- Pending substitution: the description says the mutation probe at `1a5a82f5bab1` was still running, CI run 42923910066. When it finishes, put its figures in `ciProbe` and `replyA4` in `/tmp/pr2175-fix-r3/facts.json`, rerun `python3 /tmp/pr2175-fix-r3/assemble.py`, substitute the 24 attachment links again and rewrite the description.
- The cleanup screenshot pair shows a second product point for Matt: the notice says the app could not clean up the background capture, but in that run the cleanup succeeded and the failure was the read. The fix round left the label and lists it as left out.
- One unanswered bot finding at the new head goes to the delta reviewer: clearing the name in Settings while a thumbnail renders still signs with the name captured at the start of the pass.

## Parts tab stack handed over

- The recovery thread opened and handed over the last two parts of issue 991, and will not push to either. The sweep now owns the whole stack and linked both to the coordinating session. 40 pull requests are open.

  | Pull request | Head | Base | Next requirement |
  | --- | --- | --- | --- |
  | [#2177](https://github.com/thebristolsound/birdbrain/pull/2177) | `127f7b21af31` | `refactor/mhtml-walk-every-part` | Land 2176 first; fleet check held by its daily limit |
  | [#2178](https://github.com/thebristolsound/birdbrain/pull/2178) | `2c37a52ca2d7` | `feat/mhtml-parts-ipc` | Land 2177 first; fleet check held by its daily limit; closes 991 |

- Both carry a successful review status at head, the evidence label and a passing verification from their author. Neither has the maintainer's evidence approval.
- Two more choices wait for Matt before these merge. On 2177: a synchronous read of a deliberately extreme 199 MB archive of tiny parts blocks the main process for about 22 seconds, and 2178 triggers that read when a row is selected. On 2178: the tab's copy and layout strings, the features page sentence, and the reading of the issue's second acceptance criterion as refusing before reading.
- Tell the recovery thread before merging or rebasing anything in this stack. Its only remaining work is the held signing tail.

## Fleet repair fix round five

- The same implementer pushed `38d707d05458` to 2160 as a fast-forward of `0cab8a06791b`, five commits, with no main merge. Its one locked full verification passed at that commit, exit 0: 9,977 tests passed, 66 skipped.
- The blocker is fixed in `6d4a5d73`: a comment-number pointer is read as an issue comment first and as an inline review comment only when the first read answers not found. Any other error on the first read fails. The red run failed 16 of 89 cases. Input preparation now exits 0 for pull requests 2175, 2145 and 2160, and the implementer's final scan of all 40 open pull requests found none that fails it.
- Three advisories became fixes: link fragments are decoded before they are read, the trailing punctuation strip runs in one pass under a timed test, and the label list must be exactly one list of names.
- Replaced the description from `/tmp/pr2160-fix-r5/body.md` and posted the [reply](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6782700147). The review status is pending and a delta review against `0cab8a06791b` is running.
- The delta review has three extra checks: rerun input preparation for every open pull request and name any that fails, because the implementer's earlier scan had one unexplained failure; test whether the timed test can pass with the defect restored or fail under load; and state exactly which existing fleet results and overrides stop counting when this change merges.

## Signing repair approved

- Posted the [approving review of 2175](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6782725181) at `1a5a82f5bab1` and set its review status to success. With the fix removed, the new regression failed in 38 of 38 runs, 10 of them under load, and the reviewer showed its result does not depend on timing. All 24 screenshots match their manifests. The Summary needed no correction.
- Applied the reviewer's description corrections without a code change: the finished mutation run's figures (40 of 172 sites, 13 caught, 3 survived, 24 not run), the untested rechecks sentence, the Backfill bullet, the Screenshots block, the cleanup label sentence, the observed pixels bullet and one added left-out item. Posted a [follow-up note](https://github.com/thebristolsound/birdbrain/pull/2175#issuecomment-6782728574) and answered the one open bot thread.
- Sent the recovery thread the settled head `1a5a82f5bab1` so it can rebase and open the signing tail on that branch.
- 2175 is in the merge lane except for two inputs: the fleet check, held by its daily limit, and the maintainer's evidence approval label, which the coordinator applies at merge time. The sync refusal with no reason shown and the cleanup notice label are product questions for Matt and do not block the merge.
- A new question from the reviewer for Matt, not needed for this change: when the operator name is cleared while an operation is in flight, the entry carries the name read at the operation's check on every path except the trusted-time worker, which reads it again.

## Fleet repair approved

- Posted the [approving review of 2160](https://github.com/thebristolsound/birdbrain/pull/2160#issuecomment-6783111826) at `38d707d05458` and set its review status to success. The pointer fix is verified by mutation, input preparation exits 0 for all 40 open pull requests in three full runs, the timed test fails with the slow code restored and passes in under 300 ms under load, and the label-withdrawal step was run 43 times under bash. Product CI passes. No Summary or description sentence needs correcting.
- 2160 cannot merge on the fleet check: its status is pending behind the daily limit of 40 heads, and the fleet on main would fail it for the reason it repairs. The maintainer's override label is the only path, and Matt has not authorized it.
- What merging changes, from the reviewer's read-only run over the live queue: no open pull request moves from passing to failing. The 31 with a saved review already read failed and will read failed for a new reason, needing a new completed source review. Four have no saved review and stay pending. Five are drafts. None carries the override label, and a label applied before the merge would have to be removed and applied again.
- Landing 2160 does not by itself turn the queue green. Each of the 31 needs a new commit or a deleted saved record before the fleet reviews it again, and each new review uses one of 40 daily slots. Deleting saved records, raising the limit and overriding individual pull requests are all Matt's decisions.
- Advisories left open on 2160: a single failed network read fails a pass with no retry, and one such failure occurred in 51 reads during the review; three reader outcomes lack a test.

## Fleet repair merged by the maintainer

- Matt applied the override label to 2160 at 00:34 UTC on November 11 and merged it one minute later as `751e9841bd0d`. The coordinator did neither. The merged tree is identical to the reviewed head `38d707d05458`, and the squash body is the reviewed Summary; no change was dropped.
- Main now carries the repaired fleet scripts and merge workflows. 39 pull requests are open. No implementer was in flight at the merge; the 2133 screenshot task builds fixed commits and is unaffected.
- The fleet check on the remaining pull requests has not changed yet. Pull requests with a saved review still read failed, and 2175, 2177 and 2178 still wait behind the daily limit. Most saved reviews ran near 09:22 UTC on November 10, so their slots in the 24-hour limit free near that time on November 11.
- How the 31 saved reviews get redone is still Matt's decision: a merge of main into each branch, a higher daily limit, deleted saved records, or the override on individual pull requests. Do not push merge commits to the queue for this purpose without his answer.
- Watch main's CI once, at the final merge of the sweep, not at this one.

## Logging candidate published

- The second capture task took the Diagnostics Log pair under the shared lock in one 15 second hold. On main the five rows show only source and time; at the candidate they show the five new labels. The pair proves the label mapping in the running app only, from five invented log entries.
- Pushed the verified candidate `836b6c55d5d5` to 2133 as a fast-forward of `5edd154ce905`. Its locked full verification had passed before the handover: 9,852 tests passed, 66 skipped, all 72 scored changed lines covered. The branch contains main `3029954ee`, not the later fleet repair merge, and merges cleanly with it.
- Posted the [screenshot pair](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6783379808) after matching both digests to the capture manifest. Replaced the description: visual change declared with uploaded links, the passing verification block, a main integration bullet, and the design bullet naming the reviewed copy. Checked two claims against git first: the design file is the same blob as pull request 2158's at `e77e1224b2bc`, and the seven source files the change edits are identical to `5edd154ce905`. Sol's note said eight; git shows seven.
- Answered the four open design threads, set the review status to pending, and started a delta review against `5edd154ce905`.
- The approval label Sol applied at the old head no longer shows on 2133. Apply it again at merge time, at the reviewed head.
- After a merge, reopen issue 2127 with its remaining first criterion, the job's address host in logs, as recorded earlier.

## Signing tail handed over

- The recovery thread opened the four signing tail pull requests on the settled 2175 head and handed them over. It has finished its work and runs nothing. The sweep owns the whole stack, linked all four to the coordinating session, and owns any later rebase. 43 pull requests are open, more than the fleet's daily limit of 40 heads.

  | Pull request | Head | Base | Next requirement |
  | --- | --- | --- | --- |
  | [#2179](https://github.com/thebristolsound/birdbrain/pull/2179) | `83e6d6e8da1c` | `fix/signing-refuses-empty-operator-name` | Land 2175 first; fleet check held by its daily limit; does not close 639 |
  | [#2180](https://github.com/thebristolsound/birdbrain/pull/2180) | `1226a7bbdfce` | `fix/timestamp-worker-takes-case-slot` | Land 2179 first; fleet check held |
  | [#2181](https://github.com/thebristolsound/birdbrain/pull/2181) | `1e134a64a7f1` | `fix/manifest-provenance-invariants` | Land 2180 first; fleet check held |
  | [#2182](https://github.com/thebristolsound/birdbrain/pull/2182) | `516a05b32d37` | `fix/self-test-teardown-guard` | Land 2181 first; fleet check not yet reported |

- Each carries a successful review status at head from the recovery thread's reviewer, the evidence label and its author's passing verification. None has the maintainer's evidence approval. The author reports one hand-resolved import conflict on 2182 and one verification rerun on 2180 after the known polling-test failure.
- Keep the first line of 2179 as written, so the merge does not close issue 639.
- Two more choices wait for Matt before these merge. On 2181: a new notice saying the self-test case was kept because something else wrote to it, a new documentation bullet, and the launch sweep of an empty, unarchived case that an operator named exactly like the self-test sandbox. On 2182: a narrower demo-seed guard than the one ruled under issues 1301 and 1297.

## Logging change approved

- Posted the [approving review of 2133](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6783578434) at `836b6c55d5d5` and set its review status to success. The merge commit holds no hand resolution, the seven source files and five test files are identical to the previously approved commit, the design file is the reviewed copy, and both screenshot digests match. The Summary needed no correction. Product CI passes at head.
- Corrected one Changes sentence without a code change, so the main integration bullet names all four merged changes, and posted a [follow-up note](https://github.com/thebristolsound/birdbrain/pull/2133#issuecomment-6783579266).
- 2133 is in the merge lane except for the fleet check, held by its daily limit, and the maintainer's evidence approval label, applied at merge time. One bot thread stays open on durable recovery, which the reviewer rates advisory and outside this change.
- Advisory notes to carry forward: the design's status line calls 2133 a draft and says none of the six slices is merged, which becomes false on main when 2133 merges. Fix it in 2158 or the next slice with the wording in the review. The fleet's twelve non-blocking findings on the design text in 2158 apply to this copy as well.
- Three pull requests now hold an approving independent review at head with green product checks: 2175, 2133, and the four-part signing tail behind 2175 from its own reviewer. No agent is running. Everything left waits on Matt's choices about the fleet check and on the open verification question for 2126.

## Matt's decisions and the main merge across the queue

- Another session relayed Matt's answers, and the coordinator read them in their source before acting: his replies in the "Agents in Flight and Pause Points" chat session at about 00:33 and 00:59 UTC on November 11, 2026. He approved the override and merge of 2160, which that session carried out. He chose a merge of main into each pull request with a saved fleet review, starting with the Parts tab stack and paced by the daily limit. He accepted shipping 2177 with the 22 second main-process block and asked for a follow-up issue. He had the hourly Dispatch workflow disabled until the queue drains; do not enable it.
- Filed the follow-up as issue [#2183](https://github.com/thebristolsound/birdbrain/issues/2183) under the machine account, labelled for triage and performance. It names `src/main/services/mhtmlParts.ts:40` on the branch of 2177.
- Pushed one merge commit to each of 28 pull requests. Each is a two-parent commit built without a checkout, only where the automatic merge was clean, and pushed as a fast-forward of the reviewed head. For each, the files that differ between the old and new head are all files the merged side changed. The helper scripts and the record of old and new heads are in `/home/matt/pr-sweep-fable/merges/` (`merge-clean.sh`, `batch-main.sh`, `stack-child.sh`, `done.txt`, `mhtml-stack.txt`).
  - Parts tab stack: 2176 took main `751e9841bd0d` and is now `f4a3394b9581`; 2177 took its parent and is `a5052335f547`; 2178 took its parent and is `d88b73d1c3fb`.
  - Eighteen based on main: 2142, 2143, 2144, 2145, 2149, 2150, 2153, 2154, 2155, 2156, 2157, 2158, 2159, 2161, 2162, 2163, 2165 and 2169.
  - Seven stacked children, each taking its parent's new head: 2166, 2167, 2170, 2171, 2172, 2173 and 2174.
- No local test ran for these merge commits. CI at each new head is the verification. After CI passes at a head, replace that description's verification block with the output of `.claude/skills/post-pr-body/scripts/verification-from-ci.sh <n>`.
- Review status: carried forward as success on the 23 whose last review approved, with a comment on each. Left pending on 2157, 2158 and 2159, whose last review did not approve because the fleet had failed. Left pending on 2173 and 2174 for a different reason: 2172 gained seven review-round commits after those two were built, so the merge is the first time their code sits on that work. Send both to a delta review once CI finishes.
- Not merged with main: 2126, whose fix is still unpublished; 2148 and 2120, which conflict; and 2125, a maintainer-authored branch, held for a direct question. 2175, 2133 and the signing tail have no saved fleet review and need no new head.
- The 28 new heads plus the nine already waiting come to 37 heads against a daily limit of 40, so any fix round today waits for the next day's slots.

## Override merges and the signing tail on main

- Matt approved the override on 2175 and 2133, a main merge into his 2125 branch, and one more full verification of 2126 on a quiet machine, in the "Agents in Flight and Pause Points" chat session at 02:47 UTC on November 11, 2026. That session applied the override label to both pull requests at their reviewed heads.
- Merged 2175 with its evidence approval label at `1a5a82f5bab1` as `b2dd4c3f` on main. The remote branch is deleted and issue 1332 is closed.
- 2133 then conflicted with main in `src/main/services/recapture.ts`, where main's operator name check replaced the settings read that 2133 timed. The resolution keeps main's two lines and 2133's ingest timer and drops the unused settings read. Typecheck passed, lint passed on the three merged source files, and `recapture.test.ts` (85) and `notify.test.ts` (8) passed. Pushed as `ff1f8d3feb6c`, a fast-forward with no commit dropped; review status pending. The override and approval labels were tied to `836b6c55`, so 2133 needs a delta review of the resolution and Matt's override again at the new head before it merges.
- Signing tail: 2179 holds 2175's own commits, so a plain merge of main conflicted in three files. Built the merge with 2175's reviewed head as the base, which brings in only the fleet repair main gained after that head; its diff equals the diff from 2175's head to main. 2179 is now `553ee6dc2300`, 2180 `d87b5c6e`, 2181 `b47ea255`, 2182 `a28d2cd4`, each with its review status carried forward and a note. They still need fleet reviews and Matt's evidence approval, and merge in order.
- 2125 took main as `a607e8c7`, approval carried forward.
- Reran the failed end-to-end job on 2143's new head: two tests timed out waiting for the app window, in a change that only touches the viewer's file prefix check.
- In flight: the full verification of 2126 at `d50ea26b5d2a`, under the shared lock with the machine idle (load 0.35 on 18 cores at start). Log and exit code: `/home/matt/pr-sweep-fable/pr2126-preflight.log` and `.exit`; the earlier failed run is kept as `pr2126-preflight-run2.log`. Push only on exit 0, as a fast-forward of `84d56578cafe`.
- Next: after that verification, send 2133's resolution, 2173 and 2174 to delta reviews. Fleet slots free from about 09:22 UTC.
- 2126 verification: the first rerun stopped before any test because the test-only sharp build in that tree linked the removed `libOpenEXR-3_4.so.33` (log kept as `pr2126-preflight-run3-sharp.log`). After `env -u PKG_CONFIG_PATH pnpm build:test-sharp`, the full verification at `d50ea26b5d2a` passed: 9884 tests, 66 skipped, thresholds met. Pushed as a fast-forward of `84d56578cafe`, replaced the description's verification and corrected the Summary and Changes for the marker fix, posted a note, review status pending.
- Three delta reviews are running as delegated tasks: 2133's conflict resolution at `ff1f8d3feb6c`, 2126 at `d50ea26b5d2a`, and 2173 at `4e05c944` with 2174 at `4475889c`. Publish each verdict when it returns. 2133 still needs Matt's override again at its new head before it merges.
- Delta verdicts published, each with review status success: 2133 at `ff1f8d3feb6c` (merge verified; one non-blocking note that a job refused for a missing operator name logs the error name `UnknownError`, recorded in the description), 2126 at `d50ea26b5d2a` (marker fix verified by revert and mutation; a comment overclaims for a hand-set marker; the description's 12-test sentence now names its round), 2173 at `4e05c944` and 2174 at `4475889c` (own diffs unchanged; descriptions corrected for the merged stack). Their verification records still name earlier heads and are replaced with CI's result once merge-gate can pass.
- 2133 waits only on Matt's override at `ff1f8d3feb6c`; then apply the approval label and merge. Told the "Agents in Flight and Pause Points" session so Matt sees it there.
- Matt said he applied the override to 2133 himself, in the "Agents in Flight and Pause Points" chat session at 04:40 UTC on November 11, 2026; the label history shows it at 03:06 UTC, after `ff1f8d3feb6c` was pushed. Applied the approval label and merged 2133 as `4ab679cf` on main. The remote branch is deleted.
- Merging closed issue 2127, so it was reopened with a comment naming the open item: its first criterion asks for the job's URL host in the failed and skipped log line, which 2133 left out on purpose.
- The recapture series draft 2135 targets main and now conflicts with it after the 2133 merge. It is a draft, so the sweep leaves it alone.
- Next: fleet slots free from about 09:22 UTC. Then the MHTML stack 2176, 2177 and 2178 in order, needing Matt's approval label at each head, and the signing tail 2179 to 2182 in order.
