# Pilot part two — routine-driven cycles: the ledger

Date: 2026-08-10
Tracks: #309 (`wayfinder:task`, under map #298). Feeds: #310 (`wayfinder:grilling`).
Standing rules: `docs/adr/0005-unattended-agents-on-the-evidence-path.md`
Routine under evaluation: `.claude/skills/dispatch/SKILL.md`

This records what the routine-driven cycles actually produced. It deliberately
stops short of a verdict — that is #310's job. What follows is the measurement
and the findings the verdict will need.

## The exit bar, verbatim

From #309:

> Run the remaining pilot cycles by manually triggering the routine. Track
> per-issue outcome (mergeable? review rounds?) toward the exit bar: **4 of the
> last 5 issues mergeable with ≤1 review round.**

**"Review round" is not defined anywhere.** That omission decides the verdict, so
this ledger counts automated `birdbrain-reviewer` pre-pass rounds and says so
plainly, rather than picking the flattering reading. Rationale: the bar exists to
decide whether the routine can run *unattended*, and pre-pass rounds are what
measure first-pass agent quality. Human rounds are discussed separately below and
are, as it turns out, not measurable from the API at all.

## Scope

Part two = agent PRs created after #308 ("Build the dispatch routine") closed at
`2026-08-02T22:04:34Z`. Fourteen PRs. Part one (#307, ad-hoc background jobs)
closed two hours earlier and is not counted here.

## The ledger

`REQ` = pre-pass returned *request changes*. `APP` = *approve for human review*.
Read left to right in the order the pre-passes were posted.

| PR | Subject | Evidence-affecting | Merged | Rounds | Verdicts |
| --- | --- | --- | --- | --- | --- |
| #329 | extension wire contract (#227) | yes | yes | 2 | REQ, REQ |
| #332 | split `queries.ts` into per-domain modules | – | yes | 2 | REQ, APP |
| #334 | fake bridge util + retrofit eight stubs | – | yes | **1** | APP |
| #335 | expose wayback bridge namespace (#333) | yes | yes | 2 | REQ, APP |
| #343 | port residual db-domain behaviours from #339 | yes | yes | 3 | REQ, REQ, REQ |
| #345 | route remaining non-event call sites (#229) | yes | yes | **1** | APP |
| #352 | harden CI and release supply chain (#266) | yes | yes | 2 | REQ, APP |
| #354 | registry publication guard (#267) | yes | yes | 2 | REQ, REQ |
| #355 | registry guard + advisory gate (#267, duplicate) | yes | yes | 2 | REQ, REQ |
| #356 | deterministic `safeRegexTest` pin (#330) | yes | yes | 2 | REQ, APP |
| #357 | shell-open failure handling (#350) | yes | yes | 2 | REQ, REQ |
| #360 | AnalysisTab + ExportDialog restructure (#346) | yes | yes | 2 | REQ, REQ |
| #364 | six `openCaptureExternal` handlers (#349) | yes | yes | 2 | REQ, APP |
| #369 | manifest-bound sidecar verification (#234) | yes | yes | 4 | REQ, APP, REQ, APP |

## Measurement against the bar

**The last five** — #356, #357, #360, #364, #369:

- Merged: **5 of 5.**
- At ≤1 pre-pass round: **0 of 5.** Rounds were 2, 2, 2, 2, 4.

**"Merged" is a proxy for the bar's "mergeable", not the same field.** The API
exposes both: `merged` is a settled historical fact, `mergeable` is a live
computation against the current base branch that is `null` while GitHub is still
working it out and is meaningless once a PR is closed. For a retrospective cohort
of merged PRs, `mergeable` cannot be recovered — there is no observation time left
to read it at. The proxy is sound in the safe direction: everything that merged
was necessarily mergeable at the moment it merged. It would be unsound for a
cohort containing open or closed-unmerged PRs; this one contains neither.

**The bar is not met on this reading.** It requires 4 of 5; the result is 0 of 5.

Across all fourteen: 14 of 14 merged, and **2 of 14** (#334, #345) cleared the
pre-pass in a single round. Both of those were the two least-constrained tickets
in the set — a test utility and a mechanical call-site migration. Every
evidence-affecting ticket took at least two.

### Two caveats that cut in opposite directions

**Six of fourteen were merged while the final pre-pass still said `request
changes`** — #329, #343, #354, #355, #357, #360. Nearly half. In #357's case that
was deliberate and disclosed: the allowlist blocker was known, argued in the
thread, and deferred to #362 and #363. For the others the record does not say.
Whatever the bar means, "merged" and "the automated reviewer was satisfied" are
not the same event here, and 43% of the time they diverged.

**Human review rounds cannot be counted from the API.** Agents post under the
maintainer's account, so a pre-pass comment, an implementer reply, and a genuine
human review are indistinguishable by author. Across the last five PRs every
formal review is `COMMENTED` — there is not a single `APPROVED` — so the human
gate is exercised by the act of merging, leaving no reviewable trace of how many
rounds it took. If #310 wants to judge the bar on human rounds, that number does
not currently exist and would have to be reconstructed by hand.

## Structural findings

These are the substance. None are recorded anywhere else in the tracker.

**1. Strict-serial WIP does not prevent concurrent work.** The slot is claimed
when a PR opens, not when an implementer is dispatched, leaving a window where
two sessions both read it as free. Three incidents:

- #339 / #341 — first duplication.
- #354 / #355 — issue #267 implemented twice, in parallel, by two sessions that
  each checked the slot correctly and were each wrong. Both PRs are in the table
  above; that is why #267 appears twice.
- #357 — two agents committing to *one branch* while the slot was correctly held
  by one PR. The label cannot catch this case at all. One agent detected the
  collision and rebased rather than force-pushing; had it not, a commit and four
  posted review replies would have been silently lost.

**2. Subagents can write to GitHub.** `.claude/skills/dispatch/SKILL.md` states
the implementer "cannot post its replies" and that the dispatcher posts them.
That is false: `gh api --method POST` on the REST review-comment endpoints works,
and both an implementer and a reviewer used it — four review replies and two full
pre-pass comments went up without the dispatcher's involvement. Dispatcher review
of agent output before publication is an assumption, not a gate.
`docs/agents/github-access.md` is more careful and says only that a subagent
cannot open a PR or apply a label, which is correct.

**3. The front gate and the path-list backstop disagree in both directions.**

- #330: triage decided `evidence-affecting`, its comment states the label was
  applied, and the label never landed on the issue.
- #350: triage recorded "no"; the backstop fired correctly because
  `src/renderer/components/export/**` is on the list.

The backstop caught both. But the front gate's record and the front gate's state
drifted apart with nothing noticing until a reviewer read both.

**4. Agent commits can land under a human's name.** Commits `1b72ce8` and
`93b9350` on #357 are authored `Matt Donovan` because of worktree git config, not
intent. This passes ADR-0005's rule, which targets `Co-authored-by` trailers, but
`git log` cannot distinguish agent work from human work on an agent PR.

**5. A merged PR shipped a known-misleading error onto an evidence surface.**
PR #357 added failure reporting to two buttons that are refused unconditionally
by the reveal allowlist, so both now display "Path not permitted" where they
previously failed silently. Disclosed before merge and filed as #362 and #363.
Worth recording not as a process failure — the disclosure worked — but because it
is the shape of mistake the pipeline is most likely to repeat: making a failure
visible before establishing that the underlying operation can ever succeed.

## What #310 must decide

1. **What a review round is.** Without that, the bar cannot be evaluated. On
   pre-pass rounds it is 0 of 5; on human rounds it is unmeasurable as built.
2. **Whether "merged" is the right success signal**, given six of fourteen merged
   against an unresolved automated verdict.
3. **Whether the strict-serial hole blocks cron.** It is the finding most specific
   to unattended operation: three collisions in fourteen cycles, all while a human
   was watching. Scheduled operation removes the watcher.
4. **Whether the subagent-write gap blocks cron.** Same reasoning — the
   dispatcher's editorial pass over agent output does not currently exist as a
   control.

## Verification of this ledger

Every figure derives from the GitHub API, not from session recollection. The
procedure below is the whole method; following it should reproduce the table and
the 0-of-5 result exactly.

```shell
R=thebristolsound/birdbrain

# 1. Cohort — note the pull_request filter; see below
gh api --paginate "repos/$R/issues?state=all&labels=agent-pr&per_page=100" \
  --jq '.[] | select(.pull_request != null) | .number'

# 2. Per PR in the cohort
gh api          "repos/$R/pulls/<n>"                          # merged, commits, changed_files
gh api --paginate "repos/$R/issues/<n>/comments?per_page=100"   # pre-pass comments live here
gh api --paginate "repos/$R/pulls/<n>/reviews?per_page=100"     # formal review states
gh api --paginate "repos/$R/pulls/<n>/comments?per_page=100"    # diff review comments
gh api          "repos/$R/issues/<n>/labels"                  # evidence-affecting
```

**Cohort and ordering.** Part two is every `agent-pr` **pull request** whose
`created_at` is later than #308's `closed_at` of `2026-08-02T22:04:34Z`.

`/issues` returns issues *and* pull requests — GitHub models every PR as an issue,
and they share one numbering space. Discard anything whose `pull_request` field is
absent **before** applying the date filter or counting, or a labelled issue is
counted as a cycle. The label is currently PR-only in this repo, so the filter is
a no-op today; it is written down because nothing enforces that, and a single
mislabelled issue would inflate the denominator with no visible symptom.

Order the table by PR number ascending; "the last five" means the five highest PR
numbers, which for this cohort is also the five most recently created.

**What counts as a round.** One round is one comment on the *issue* timeline
(`/issues/<n>/comments`) whose body contains the string `Reviewer pre-pass`.
Rounds are ordered by `created_at`. Nothing else counts: not CodeRabbit reviews,
not diff review comments, not implementer replies, not the dispatcher's notes.
`/pulls/<n>/comments` is fetched above only to confirm no pre-pass was posted as
a diff comment by mistake — in this cohort, none was.

**Reply exclusions.** Take only top-level issue comments. A reply that quotes a
pre-pass in its body would otherwise double-count; filter to comments whose
*first line* matches `Reviewer pre-pass`.

**Verdict selection.** Within each pre-pass comment, take the first
case-insensitive match of `request changes` or `approve for human review` and
ignore the rest of the body — later occurrences are quotations of prior rounds.
Match on that verdict text, **not** on the sha in the header: two header formats
are in use, `` (`ed0150c`) `` and `(93b9350)`, and a regex written for one
silently undercounts the other. The verdicts for PR #364 were missed on the first
pass for exactly that reason.

**Bar arithmetic.** The bar's "mergeable" is read as `.merged == true`, for the
reason given under the measurement above. "≤1 review round" is a round count of 0
or 1 under the definition above. The bar asks for 4 of the last 5 to satisfy both.

## 2026-08-12 refresh

Re-run of the procedure above against the live API. The cohort has grown from
fourteen PRs to eighteen: #370, #372 and #375 landed on 2026-08-10 and #407 opened
on 2026-08-12 and is still open. Rows #329–#369 reproduce the original table
exactly, including the round counts and verdict order.

| PR | Subject | Evidence-affecting | Merged | Rounds | Verdicts |
| --- | --- | --- | --- | --- | --- |
| #329 | extension wire contract (#227) | yes | yes | 2 | REQ, REQ |
| #332 | split `queries.ts` into per-domain modules | – | yes | 2 | REQ, APP |
| #334 | fake bridge util + retrofit eight stubs | – | yes | **1** | APP |
| #335 | expose wayback bridge namespace (#333) | yes | yes | 2 | REQ, APP |
| #343 | port residual db-domain behaviours from #339 | yes | yes | 3 | REQ, REQ, REQ |
| #345 | route remaining non-event call sites (#229) | yes | yes | **1** | APP |
| #352 | harden CI and release supply chain (#266) | yes | yes | 2 | REQ, APP |
| #354 | registry publication guard (#267) | yes | yes | 2 | REQ, REQ |
| #355 | registry guard + advisory gate (#267, duplicate) | yes | yes | 2 | REQ, REQ |
| #356 | deterministic `safeRegexTest` pin (#330) | yes | yes | 2 | REQ, APP |
| #357 | shell-open failure handling (#350) | yes | yes | 2 | REQ, REQ |
| #360 | AnalysisTab + ExportDialog restructure (#346) | yes | yes | 2 | REQ, REQ |
| #364 | six `openCaptureExternal` handlers (#349) | yes | yes | 2 | REQ, APP |
| #369 | manifest-bound sidecar verification (#234) | yes | yes | 4 | REQ, APP, REQ, APP |
| #370 | this ledger + ADR-0006 + ADR-0007 | – | yes | **0** | *(none)* |
| #372 | StorageConfig failure surfacing (#351) | – | yes | 2 | APP, REQ |
| #375 | contributor intake guidance (#268) | – | yes | **1** | REQ |
| #407 | strip injected UI before capture (#379) | yes | **no — open** | 4 | APP, APP, REQ, REQ |

### Measurement against the bar

**The last five** — #369, #370, #372, #375, #407:

| PR | Merged | Rounds | ≤1 round | Satisfies bar |
| --- | --- | --- | --- | --- |
| #369 | yes | 4 | no | no |
| #370 | yes | 0 | yes | **yes** |
| #372 | yes | 2 | no | no |
| #375 | yes | 1 | yes | **yes** |
| #407 | no (open) | 4 | no | no |

- Merged: **4 of 5.**
- At ≤1 pre-pass round: **2 of 5.**
- Both: **2 of 5.** The bar asks for 4 of 5. **Not met.**

That is the literal reading. Both of those two passes were later confirmed as human
fast-tracks, which takes it to **0 of 5** — see "The zero-round question" below.

Across all eighteen: 17 of 18 merged, and **4 of 18** (#334, #345, #370, #375)
cleared in ≤1 round.

The result is insensitive to the two judgement calls available here. Excluding the
open #407 and reading "the last five" as the five most recent *merged* PRs (#364,
\#369, #370, #372, #375) also gives 2 of 5. Counting #407 as satisfying "mergeable"
on its live `mergeable: true` / `mergeable_state: clean` — legitimate for an open
PR, unlike the retrospective rows — still fails it on rounds. Either way, 2 of 5.

### What the three new merged rows change

**#370 merged with zero pre-pass rounds.** No `Reviewer pre-pass` comment exists on
it anywhere: not on the issue timeline, not as a diff comment, not as a review body.
Its only automated review is CodeRabbit's, which the counting rule excludes. Under
the bar's arithmetic a 0-round PR *satisfies* "≤1 review round" — so a PR the
reviewer never looked at scores identically to one it approved first try. One of
the two passes in the last five is of this kind. **The round count cannot
distinguish "reviewed once and approved" from "never reviewed",** and #310 should
not read 2 of 5 as "two clean first passes".

**#375's pre-pass was posted after the merge.** Merged `22:28:03Z`; the pre-pass —
`request changes` — went up at `22:32:41Z`, 4m38s later. It counts as one round by
the literal rule, and that round is the second of the two passes in the last five.
It was not a gate on anything.

**#372 merged 2m22s after a `request changes` pre-pass** (pre-pass `15:16:11Z`,
merged `15:18:33Z`), and its verdicts run APP then REQ — approved, then a further
push drew a rejection, then merge.

Taken with the original finding, the divergence between "merged" and "the automated
reviewer was satisfied" has widened: **7 of the 17 merged PRs** merged against a
final `request changes` (#329, #343, #354, #355, #357, #360, #372), and #370
merged with no verdict at all. That is **9 of 17 — 53%** of merged agent PRs
carrying no satisfied automated verdict at merge time.

**Still zero `APPROVED` formal reviews** across the cohort. Every review on the last
five is `COMMENTED`. Human rounds remain unmeasurable from the API.

### Two procedural notes for the next re-run

**The first-line filter is now load-bearing.** #407 carries an issue comment whose
first line is `Response to reviewer pre-pass e16134b (comment 5268915000)…`. A
substring match on the body — or on the first line without anchoring — counts it as
a round and reports #407 at 5. Anchor the match to the start of the first line after
stripping leading Markdown emphasis (`**`).

**Diff comments now mention pre-passes.** The original note that no pre-pass was
posted as a diff comment still holds — #370 (2) and #407 (1) have diff comments
containing the string, but all three are *replies* discussing a pre-pass, not
pre-passes. The check is no longer a no-op and must be read, not just run.

**Header shas can be malformed.** Alongside the two formats already recorded
(`` (`ed0150c`) `` and `(93b9350)`), #369's second round reads
`(4581951 6dd092f5ba12beb0a147db97f5ec52017)` — two tokens and a space where a sha
belongs. Further reason to match on the verdict text and never on the header.

### The zero-round question, and why it needs a human annotation

The refresh raises a fourth thing to settle alongside "What #310 must decide":
**does a PR with zero pre-pass rounds pass the bar, or fall outside it?** As the
arithmetic is written it passes, and that reading supplies one of the two current
passes (#370).

The maintainer's rule (2026-08-12): **it depends on whether the merge was a human
fast-track** — some merges in this cohort were pushed through deliberately for
importance or time-sensitivity, ahead of the routine. A PR the routine cleared in
one round is evidence the routine works; a PR a human fast-tracked past the routine
is not, whatever its round count.

**That distinction is not derivable from the API.** All 17 merges report
`merged_by: thebristolsound`, because agents and human act under the same account —
the same root cause that makes human review rounds uncountable. Nothing in the PR
record marks a fast-track, and `merged_by` cannot separate the two.

*Superseded below:* the hand annotations turned out to be reproducible by a rule over
data the procedure already collects — see "The bar as restated". `merged_by` is still
useless for it; the verdict-at-merge-time is not.

**Fast-track annotation — supplied by the maintainer, 2026-08-12:**

| PR | Rounds | Merged | Human fast-track? |
| --- | --- | --- | --- |
| #369 | 4 | yes | no — final verdict was APP, merged 4h27m later |
| #370 | 0 | yes | **yes** |
| #372 | 2 | yes | **yes** |
| #375 | 1 | yes | **yes** |

Maintainer's statement: every merge in the cohort was performed by hand, and every
one of the anomalies above — #370 merging with no pre-pass, #375's pre-pass landing
after the merge, #372 merging 2m22s after a `request changes` — was a deliberate
human decision, not a process failure.

**The last five, annotated: 0 of 5.** Both apparent passes were fast-tracks. #370
never ran the routine's review at all and #375 merged before its review arrived, so
neither is evidence about the routine's first-pass quality in either direction. The
remaining three fail on rounds. Restated:

| PR | Merged | Rounds | ≤1 round | Fast-track | Evidence of routine clearing the bar |
| --- | --- | --- | --- | --- | --- |
| #369 | yes | 4 | no | no | no |
| #370 | yes | 0 | yes | yes | **no — routine never ran** |
| #372 | yes | 2 | no | yes | no |
| #375 | yes | 1 | yes | yes | **no — merged before review** |
| #407 | no (open) | 4 | no | – | no |

### The merge signal carries no information

This is the substantive consequence and it supersedes the framing in "What #310 must
decide" item 2.

Merging is an exclusively human act in this pipeline — the routine cannot merge, and
17 of 17 merges were the maintainer's. So `merged == true` measures the maintainer's
willingness to ship, not the agent's output quality. It reads 17 of 17 by
construction, and it read 14 of 14 in the original ledger for the same reason. It
cannot fail, so it cannot discriminate, and half the bar rests on it.

The confirmation that the anomalies were deliberate removes the last reading under
which the merge signal might have carried something: they are not gaps in the process
where a bad PR slipped through, they are the maintainer overriding the process on
purpose. Nine of the seventeen merges — the eight against a final `request changes`
plus #370 with no verdict — are that override. **A bar of the form "N of the last M
merged with ≤1 review round" reduces, in this pipeline, to "≤1 review round",** and
on that alone the last five score 0 of 5, or 2 of 5 before the fast-track annotation.

### The bar as restated: fast-tracked merges are excluded

Maintainer decision, 2026-08-12: **fast-tracked merges are excluded from the bar.**
They leave the sample entirely — they are not counted as failures, because a PR the
human pushed through ahead of the routine is not an observation of the routine either
way. "The last five" therefore means the five most recent *non-fast-tracked* cycles.

**Fast-track is mechanically derivable after all.** Define it as *merged without a
satisfied automated verdict* — the latest pre-pass posted at or before the merge time
said `request changes`, or no eligible pre-pass existed at merge time. Ignore all
post-merge pre-passes. That rule reproduces all four of the maintainer's hand
annotations exactly: it flags #370 (no verdict), #372 (final REQ) and #375 (pre-pass
posted after the merge) and clears #369 (final APP, merged 4h27m later). It needs
nothing beyond the API calls already in the procedure, which retires the "has to be
supplied by hand" problem noted above.

Applying it to the cohort, **nine of the seventeen merges are excluded** — \#329,
\#343, #354, #355, #357, #360, #370, #372, #375. One caveat on the word: #357's
override was an argued, disclosed deferral rather than time pressure, so "fast-track"
stretches to cover it. It is excluded regardless, because the exclusion is about
merging past an unsatisfied verdict, not about the motive.

Eligible cycles, in order: #332, #334, #335, #345, #352, #356, #364, #369, and the
still-open #407.

**The last five completed eligible cycles** — #345, #352, #356, #364, #369:

| PR | Merged | Rounds | ≤1 round | Satisfies bar |
| --- | --- | --- | --- | --- |
| #345 | yes | 1 | yes | **yes** |
| #352 | yes | 2 | no | no |
| #356 | yes | 2 | no | no |
| #364 | yes | 2 | no | no |
| #369 | yes | 4 | no | no |

**1 of 5. The bar asks for 4 of 5. Not met.**

\#407 is eligible but in flight — no outcome yet, so counting it either way is wrong.
Recorded for the next re-run: if it is included in the window as not-yet-merged, the
result is 0 of 5; it currently stands at 4 rounds, so it cannot become a pass.

Every reading now on record fails: 2 of 5 literal, 0 of 5 annotated, 1 of 5 under the
restated bar. The exclusion rule does not rescue the number — it changes which five
PRs are looked at, and the ceiling stays at one pass in five. What it does buy is a
bar that measures the routine rather than the maintainer's merge button.

The verdict itself remains #310's. This ledger records the restatement and the
arithmetic under it; it does not close the question.
