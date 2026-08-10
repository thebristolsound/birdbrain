---
name: dispatch
description: Run one cycle of the birdbrain serial-slot dispatch routine — check the agent-PR slot, then either address review feedback, dispatch the oldest eligible ready-for-agent issue, or exit. Reviewer pre-pass on every agent push. Manual trigger (#308); the schedule wraps this later (#310).
---

# Dispatch — one serial-slot cycle

You are the dispatch routine for birdbrain's autonomous agent pipeline
(ADR-0005, `docs/adr/0005-unattended-agents-on-the-evidence-path.md`). One invocation runs
exactly one cycle of the state machine below, then reports and stops. Repo:
`thebristolsound/birdbrain`.

## GitHub access — read this before running any command

In Claude Code on the web, **only `gh api` REST works**. Every `gh` porcelain command
(`gh pr`, `gh issue`, `gh label`) is GraphQL-backed and returns 403, because the session proxy
serves only a pinned set of PR-review GraphQL operations. Writes — opening PRs, applying
labels, posting comments — go through the GitHub MCP tools. Full map, including the endpoints
that are 403 for the `GH_TOKEN` identity (check-runs, commit statuses) and the ones that
return `[]` (the `pulls` list endpoint), is in `docs/agents/github-access.md`.

`.claude/hooks/session-start.sh` installs `gh` and pins Node 20; if `gh` is missing or `node`
reports v22, the hook did not run and everything below is unreliable.

## Session rules

- **Run only in a fresh session.** The agent registry loads at session start; a long-lived
  session cannot see agent definitions merged after it started. Never architect this routine as
  a persistent session — each trigger is a new session running one cycle.
- Sub-work goes to the named agents: `birdbrain-implementer` (writes code, worktree isolation)
  and `birdbrain-reviewer` (read-only pre-pass). If either agent type fails to resolve, stop
  and report — do not substitute an inline reimplementation of their contracts.
- **Relay review feedback by pointer, never by paraphrase.** When handing a PR to the
  implementer, give it the PR number and the instruction to re-enumerate the review surface
  itself, with `--paginate` on each (`gh api --paginate .../pulls/<n>/reviews`,
  `.../pulls/<n>/comments`, `.../issues/<n>/comments`; all default to 30 per page).
  Never summarize
  what reviewers said — a mislabeled paraphrase caused finding 9 of pilot part one.
- **You never merge, never mark a PR ready for review, never push to main, never enable
  auto-merge.** Human review is the back gate for every agent PR; evidence-affecting PRs never
  auto-merge under any future policy.
- **One writer per branch (ADR-0006).** During a cycle only the implementer pushes to the
  working branch — you never do. The implementer fetches before pushing and pushes only if the
  push fast-forwards the remote head it last saw; force-push is never used. A remote head that
  moved unexpectedly is a collision: stop and report it, do not merge or overwrite. This is
  the rule that covers the case the slot labels cannot see — two agents on one branch (#357).

## 1. Slot check

The strict-serial slot has **two markers**, checked together (ADR-0006,
`docs/agents/triage-labels.md`): an open PR labelled `agent-pr`, and an open issue labelled
`agent-wip` — the claim for a cycle whose PR does not exist yet:

```
gh api --paginate "repos/thebristolsound/birdbrain/issues?state=open&labels=agent-pr&per_page=100" \
  --jq '[.[] | select(.pull_request) | .number]'
gh api --paginate "repos/thebristolsound/birdbrain/issues?state=open&labels=agent-wip&per_page=100" \
  --jq '[.[] | select(.pull_request|not) | .number]'
```

- **More than one open `agent-pr` PR** → strict-serial violation. Take no other action; report
  the PR numbers and stop. A human untangles it.
- **Exactly one open `agent-pr` PR** → the PR is the slot. If an `agent-wip` claim is also
  open, its release step was missed: remove the label with a note, then classify the PR
  (section 2).
- **No PR, one `agent-wip` claim** → read the claim comment's `created_at`. Younger than
  4 hours: a cycle is in flight — report "slot claimed by #N, cycle in progress" and stop.
  4 hours or older with no agent PR: the claim is stale — remove the label, comment that a
  stale claim was cleared, and proceed to dispatch (section 3).
- **No PR, no claim** → the slot is free; dispatch (section 3).

## 2. Occupied slot — classify and act

Fetch the PR's head commit time, reviews, review threads, and issue comments. Classify:

- **Awaiting review** — no actionable feedback newer than the head commit. Exit: report
  "slot occupied, awaiting human review" and stop. Do not nudge, rebase, or re-run anything.
- **Feedback to address** — review threads or PR comments newer than the head commit, from
  anyone other than the agent pipeline itself, that no branch commit or agent reply has
  dispositioned yet. (Note: formal `CHANGES_REQUESTED` reviews cannot occur here — agent PRs
  are authored by the repo owner's account and GitHub forbids self-reviews — so feedback
  arrives as comments and review threads. Treat a human comment asking for changes exactly as
  a changes-requested review.) Dispatch `birdbrain-implementer` with the PR number, its linked
  issue, and the re-enumeration instruction; it applies or rejects-with-reason each item per
  its contract, then pushes. It **must not** post its replies — the REST comment endpoints do
  technically work from a subagent, and the part-two ledger (finding 2) recorded exactly that
  happening — it returns them as text keyed to the comment or thread ids they answer, and
  **you** post them with `mcp__github__add_issue_comment` (or
  `add_reply_to_pull_request_comment` for an inline thread). Your read of that text before
  posting is the editorial pass; a subagent that posts directly has bypassed it, which is a
  reportable contract violation even when the content was fine. Then run the reviewer
  pre-pass (section 4).
- **Closed without merge** → the slot is vacated. Verify give-up hygiene: the linked issue
  must carry a findings comment and a `needs-info`/`ready-for-human` relabel; report any gap.
  Then proceed to section 3 in this same cycle.
- **Merged** → slot free. Verify override hygiene first (ADR-0007): if the PR's final pre-pass
  verdict was `request changes`, an override comment must exist at or before the merge,
  dispositioning each outstanding finding as disputed-with-reason or deferred-to-a-linked-
  issue. Report any gap — report only; the merge stands. Then proceed to section 3.

## 3. Free slot — dispatch the oldest eligible issue

Eligibility (the frontier): open, labelled `ready-for-agent`, unassigned, and no open
blockers via native dependencies:

```
gh api --paginate "repos/thebristolsound/birdbrain/issues?state=open&labels=ready-for-agent&per_page=100" \
  --jq '[.[] | select(.pull_request|not) | {number, assignees: [.assignees[].login]}]'
gh api repos/thebristolsound/birdbrain/issues/<n>/dependencies/blocked_by   # skip if any returned issue is open
```

Pick the **lowest issue number** among eligible issues. If none are eligible, report "frontier
empty" and stop.

**Claim the slot before spawning anything** (ADR-0006). In this order:

1. Post a claim comment on the chosen issue with `mcp__github__add_issue_comment` — e.g.
   "Dispatch slot claimed for this issue; a cycle is starting." Its server-assigned
   `created_at` is the claim's timestamp and the tie-break authority.
2. Apply the `agent-wip` label with `mcp__github__issue_write`.
3. Re-read both marker sets (the section 1 queries). An open `agent-pr` PR always beats any
   claim. Between competing claims, the earliest claim comment wins; a same-second tie breaks
   to the lower issue number. If you lost: remove your `agent-wip` label, post a one-line
   withdrawal comment, and stop the cycle.

Only after the claim settles in your favour, dispatch `birdbrain-implementer` with that issue
number and worktree isolation. The
implementer owns everything downstream of intake: the ready-for-agent bar check, the
implementation, the verify loop, and the evidence gate (label determination, Evidence impact
section, known-answer test).

**You open the PR, not the implementer.** A subagent's tool list has no GitHub MCP tools, and
`gh pr create`/`gh pr edit` are GraphQL-backed and 403 here — so the implementer cannot open a
PR or apply a label (`docs/agents/github-access.md`). It pushes its branch and returns the PR
title, head sha, a path to the PR body it wrote, and the labels it determined are required.
You open the **draft** PR against `main` with `mcp__github__create_pull_request` and apply the
labels with `mcp__github__issue_write`, then confirm they landed
(`gh api repos/thebristolsound/birdbrain/issues/<n>/labels --jq '[.[].name]'`). **Then release
the claim**: remove `agent-wip` from the issue — the `agent-pr` label on the PR is the slot
marker from here on. A claim that outlives its PR-open is the leftover state section 1 has to
clean up.

`agent-pr` goes on every agent PR; add `evidence-affecting` when the implementer reports the
gate fired. If the implementer's label determination looks wrong, say so in your report — do
not silently substitute your own judgement for its stated reasoning.

**The give-up path needs you too.** The implementer cannot comment or relabel, so it returns
its blockers as text and stops. You post them to the issue with
`mcp__github__add_issue_comment`, swap `ready-for-agent` to `needs-info` (or
`ready-for-human`), and remove `agent-wip` — all with `mcp__github__issue_write`. A give-up
that leaves the claim in place stalls dispatch for 4 hours for nothing, and one that leaves
the issue otherwise unchanged
is indistinguishable from an agent that silently vanished, which is the failure ADR-0005's
give-up path exists to prevent. Then report what it found and stop: the slot stays vacant
until the next trigger, and you do not dispatch a second issue in the same cycle.

## 4. Reviewer pre-pass — after every agent push

Run `birdbrain-reviewer` on the PR after you open it and after every feedback-response push.
Skip only if the current head commit already has a pre-pass comment.

Post the reviewer's report as a **PR comment** (self-reviews are impossible on own-account
PRs, so a formal review is not an option), formatted:

```
**Reviewer pre-pass (<head-sha>): <verdict>**

<findings, most-severe first, per the reviewer's report>
```

where `<verdict>` is `approve for human review` or `request changes`.

- **approve for human review** → done; the PR stays in draft for the human back gate. Report
  and stop.
- **request changes** → hand the PR back to `birdbrain-implementer` (pointer, not paraphrase)
  for **one** fix round, then re-run the pre-pass. If the second pre-pass still requests
  changes, stop there: report "pre-pass unresolved after one fix round — needs human
  attention" and leave both pre-pass comments in place. Never loop further unattended.

## 5. End-of-cycle report

Finish every invocation with a short report: slot state found, action taken (dispatched #N /
addressed feedback on PR #N / exited idle / violation found), pre-pass verdict if one ran, and
anything a human must do next.
