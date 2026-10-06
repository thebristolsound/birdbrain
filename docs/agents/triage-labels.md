# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match the vocabulary you use.

## Repo-specific labels

| Label                | Meaning                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-affecting` | This issue is an Evidence-Affecting Change (see `CONTEXT.md`). Applied at triage; triggers the evidence gate in [ADR-0005](../adr/0005-unattended-agents-on-the-evidence-path.md). |
| `agent-authored`     | PR-only label recording that an agent wrote the diff. It goes on every agent PR, slot or not (#561, `.claude/skills/dispatch/SKILL.md`); the dispatch routine applies it, because that routine opens every agent PR ([ADR-0027](../adr/0027-agent-prs-are-opened-by-a-machine-account.md)). `.github/workflows/pre-pass-gate.yml` and the draft exemption in `.github/workflows/ci.yml` both key on it, so a PR that lacks it reports `agent/pre-pass success — "Not an agent PR"` and no reviewer is ever waiting on it. |
| `agent-pr`           | PR-only label marking a dispatch slot. It goes on an agent PR that takes a slot, alongside `agent-authored`; agent work that takes no slot — work run off the slot, and the process-doc changes of `.claude/skills/dispatch/SKILL.md` §3 — carries `agent-authored` alone. The routine counts open PRs carrying it, together with `agent-wip` issues, against a capacity of three ([ADR-0014](../adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md)). |
| `queued`             | Issue-only label naming the maintainer's hand-picked dispatch list ([ADR-0028](../adr/0028-dispatch-works-a-hand-picked-queue.md)). The frontier is `ready-for-agent` and `queued` together; the routine never dispatches an unqueued issue. Applied by the maintainer only. |
| `process`            | Work about the agent pipeline itself: dispatch, gates, ADRs, Vale, CI, skills. Frozen under ADR-0028: never queued, never dispatched, fixed by hand when it blocks delivery. |
| `agent-wip`          | Issue-only label claiming a dispatch slot for a cycle whose PR does not exist yet ([ADR-0006](../adr/0006-claim-the-dispatch-slot-at-dispatch-time.md)). Applied by the dispatch routine before it spawns an implementer; removed when the draft PR opens or the give-up path runs. A claim older than 4 hours with no open agent PR is stale and may be cleared. |
| `approved`           | PR-only label: the maintainer's sign-off on an `evidence-affecting` PR the maintainer opened, where GitHub will not accept an approving review from the author ([ADR-0041](../adr/0041-merges-are-requested-by-label.md)). Applying it makes `merge-on-label.yml` post a `merge/approved` status on the head commit of that moment, and `merge-gate` counts the label only with that status on the current head; an `approved` from anyone else is removed, and every push removes it. Applied by the maintainer only. |
| `merge`              | PR-only label: the maintainer's merge request. `merge-on-label.yml` composes the squash message and enables auto-merge as the machine account, and GitHub merges once every required check, `merge-gate` included, is green ([ADR-0041](../adr/0041-merges-are-requested-by-label.md)). Removed on every push and on a refused request. Applied by the maintainer only; the dispatcher never applies it. |

The `evidence-affecting` call is made by the human triaging the issue, not by the agent working
it; the agent opening a PR for a labelled issue copies the label onto the PR. The label is the
gate's primary trigger; the PR-diff path-list backstop
(`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, in force until a maintained
list supersedes it) exists to catch triage misses, not to replace the call.

## The ready-for-agent bar

`ready-for-agent` is a claim about the issue, not a hope about the agent. An issue earns the
label only when all four hold:

1. **Acceptance criteria.** Observable outcomes an agent can verify — not "improve" or
   "clean up". If two reasonable readers could disagree about whether a PR closes the issue,
   the criteria are not done.
2. **Named verification path.** Which commands prove the change works (`pnpm lint`,
   `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`,
   `pnpm build:extension`, an E2E run, a manual check the PR must describe — whatever
   applies), stated in the issue.
3. **Starting files.** The files or modules where the work begins. The agent may range wider,
   but an issue whose starting point needs discovery is research, not a ready task.
4. **Evidence-affecting call made.** Explicitly decided yes or no. If yes, the
   `evidence-affecting` label is on the issue before the agent starts.

An agent picking up a `ready-for-agent` issue checks this bar at intake. If any point fails —
or turns out mid-work to have been wrong — the give-up path applies: comment the findings on
the issue, relabel `needs-info` or `ready-for-human`, and vacate the slot. Pushing through a
mis-specified issue is the failure mode this bar exists to prevent.

### Read the history before you apply the label

The four points above are about the issue. This step is about you, and it binds every reader who
applies triage labels — a triage session, a backlog survey, a readiness assessment, or a human
doing frontier hygiene.

**Before applying `ready-for-agent`, read the issue's comments and its label timeline, not only
its body and its current labels.** A missing triage label is ambiguous: it reads identically as
"never triaged" and as "taken off the frontier on purpose", and the record that tells the two
apart usually lives in a comment.

```shell
gh api --paginate "repos/thebristolsound/birdbrain/issues/<n>/timeline?per_page=100" \
  --jq '[.[] | select(.event=="labeled" or .event=="unlabeled")
         | {event, label: .label.name, actor: .actor.login, created_at}]'
```

A prior removal with a stated reason is a decision. Respect it, or overturn it explicitly in a
comment saying why the reason no longer holds — never correct it silently as an oversight. The
silent correction is what cost a dispatch cycle on #268: `ready-for-agent` came off at
`2026-08-10T22:28:55Z` because the work had merged in PR #375, with the reason posted in a
comment eleven seconds later, and a session reading the body and labels alone put the label back
at `2026-08-11T00:41:50Z`. The dispatch routine's account of that misdispatch, and the matching
rule that an issue taken off the frontier never ends bare, are in
`.claude/skills/dispatch/SKILL.md`, section 3.

This is a different failure from #511, and neither fix covers the other. #511 is about triage
labels surviving an **auto-close**, which leaves finished work indistinguishable from queued
work; its remedy strips labels when the issue closes. #268 was never closed — it stayed open,
with a removed label as the only trace of a deliberate decision, which is what the read step
here and the never-bare rule in the dispatch skill address.

### Amending an issue to the bar is re-validation, not transcription

Lessons from pilot part one (#307), where stale claims survived an issue, its re-triage
amendment, and a bot review round before a code trace disproved them:

- **Re-derive every code claim from current code at labeling time.** A factual claim in the
  issue ("six filters", "these two paths are identical", "only X is covered by tests") is
  re-checked against the tree the day the label is applied, not carried over from the review
  that spawned the issue. Cite file:line for anything the agent will rely on.
- **Describe per-call-site deltas; never assert identity.** If the issue says two code paths
  are the same, list what actually differs between them — pilot cycle 1 found an undocumented
  delta behind an "identical" claim, and cycle 2 found a filter stage that did not exist.
- **Every acceptance criterion must hold under each solution shape the issue permits.** If the
  issue allows a pure function *or* a hook, no AC may be satisfiable by only one of them.
