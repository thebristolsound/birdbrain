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
