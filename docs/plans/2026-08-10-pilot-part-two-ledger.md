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

- Mergeable: **5 of 5.**
- At ≤1 pre-pass round: **0 of 5.** Rounds were 2, 2, 2, 2, 4.

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

# 1. Cohort
gh api --paginate "repos/$R/issues?state=all&labels=agent-pr&per_page=100"

# 2. Per PR in the cohort
gh api          "repos/$R/pulls/<n>"                          # merged, commits, changed_files
gh api --paginate "repos/$R/issues/<n>/comments?per_page=100"   # pre-pass comments live here
gh api --paginate "repos/$R/pulls/<n>/reviews?per_page=100"     # formal review states
gh api --paginate "repos/$R/pulls/<n>/comments?per_page=100"    # diff review comments
gh api          "repos/$R/issues/<n>/labels"                  # evidence-affecting
```

**Cohort and ordering.** Part two is every `agent-pr` PR whose `created_at` is
later than #308's `closed_at` of `2026-08-02T22:04:34Z`. Order the table by PR
number ascending; "the last five" means the five highest PR numbers, which for
this cohort is also the five most recently created.

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

**Bar arithmetic.** "Mergeable" is `.merged == true`. "≤1 review round" is a
round count of 0 or 1 under the definition above. The bar asks for 4 of the last
5 to satisfy both.
