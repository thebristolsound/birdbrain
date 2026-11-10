# Resume the November 10 pull request sweep

**Status:** active

## Completed survey

- Read every open pull request, its latest checks, and all issue comments on November 10, 2026. The survey found 38 open pull requests.
- Confirmed the machine account identity for comments and review statuses.
- Linked the queue to the coordinating session.
- For the [workflow action update](https://github.com/thebristolsound/birdbrain/pull/2134), confirmed the existing review names the current head, applied the authorized approval label, recorded the review status as the machine account, and refreshed the description from passing required checks. The body and comment checks passed.
- Merged the workflow action update as `00184202` after all required checks passed. The merged tree equals the simulated merge of its original head into the previous main commit; no change was dropped. The original branch commit is absent from main ancestry because the repository uses squash merges.

## Next assignments

- Review the existing fleet repair on pull request 2160 and determine why otherwise successful fleet runs report incomplete work. The release-note review has returned; see the checkpoint below.
- Review the grouped dependency update on pull request 2136 after its description and evidence label corrections. The logging review has returned; see the checkpoint below.
- Review pull request 2159 after its matching screenshots and corrected description were posted. See the checkpoint below.
- The coordinator posts comments and body updates; delegated agents return files.

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
