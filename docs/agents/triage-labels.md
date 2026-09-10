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
| `agent-pr`           | PR-only label marking the strict-serial dispatch slot. Applied by the implementer to every agent-opened PR; the dispatch routine (`.claude/skills/dispatch/SKILL.md`) treats any open PR carrying it as the occupied slot. |
| `agent-wip`          | Issue-only label claiming the dispatch slot for a cycle whose PR does not exist yet ([ADR-0006](../adr/0006-claim-the-dispatch-slot-at-dispatch-time.md)). Applied by the dispatch routine before it spawns an implementer; removed when the draft PR opens or the give-up path runs. A claim older than 4 hours with no open agent PR is stale and may be cleared. |

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
