# Would two dispatch slots help?

Date: 2026-08-14
Asked by: the maintainer, 2026-08-14, while #423 was consuming the single slot.
Standing rules: `docs/adr/0005-unattended-agents-on-the-evidence-path.md`,
`docs/adr/0006-claim-the-dispatch-slot-at-dispatch-time.md`
Feeds: #310 (cron decision), #298 (autonomy map)

## Verdict

**Mechanically feasible, and a flat two-slot change is still the wrong move.** The claim
protocol generalises to N slots almost for free. Throughput would not improve, because the
binding constraint is human review, not dispatch capacity — and two of the three risks that
strict-serial WIP was built to contain get materially worse.

A **scoped** two-slot variant — one slot for evidence-affecting work, one for everything else
— captures most of the benefit while capping the risk that matters. That is the recommendation.

## What generalises for free

ADR-0006 made the claim a **comment**, whose server-assigned `created_at` and `id` give a total
order no racing session can forge. Nothing in that ordering is specific to one slot. The
settling step becomes: build the ordered list of open `agent-pr` PRs followed by claim comments
sorted by `(created_at, id)`; you hold a slot if your rank is below N. Losers withdraw exactly
as they do now.

Release points, the 4-hour staleness rule, the crash-between-comment-and-label recovery, and
one-writer-per-branch all carry over unchanged. One-writer-per-branch matters more, not less,
under N slots, and it is already stated as a discipline rather than a mechanism.

So the protocol is not the obstacle. Three other things are.

## Obstacle 1 — the occupancy check reads a lagging index

The slot check queries `issues?labels=agent-pr` and `issues?labels=agent-wip`. That is GitHub's
**search index**, and it lags. Observed twice on 2026-08-14 in this repo, minutes apart:

- After applying `agent-wip` to #413, the label-filtered query returned `[]` while a direct
  read of `issues/413/labels` already showed the label. It appeared ~3 seconds later.
- After removing `ready-for-agent` from #387–#406, four of the twenty still appeared in the
  filtered query after the direct reads showed them clean.

Under one slot this is nearly harmless: the settling step re-reads **claim comments**, not the
label index, and an open `agent-pr` PR always wins, so a stale index costs at most a wasted
cycle. Under N slots the same lag makes occupancy *under-count* — a dispatcher sees one
occupant where there are two and admits a third. The fix is not hard (settle on comments and
PR timestamps, never on the filtered count) but it has to be written down, because the current
skill text treats the filtered query as authoritative.

## Obstacle 2 — concurrent PRs collide in shared files, and one-writer-per-branch cannot help

One-writer-per-branch protects a branch from two agents. It says nothing about two branches
touching the same file, which is where the cost actually lands.

This is measurable rather than hypothetical, because the two tickets that *would* have run
concurrently under two slots — #413 (PR #423) and #414 (PR #427) — are both in hand. They
overlap on four files:

| file | why both touch it |
| --- | --- |
| `src/shared/types.ts` | both add entries to `LOG_CODES` / `CODE_LABELS` / `ERROR_NAMES` |
| `src/renderer/lib/notify.ts` | both add the matching notification labels |
| `src/main/index.ts` | both add startup-path error handling |
| `tests/main/services/caseArchive.test.ts` | both adjust the shared DB init |

The first two are the dangerous kind. They are append-only registries where a careless conflict
resolution silently **drops** an entry rather than breaking the build — and a dropped
`ERROR_NAMES` entry is exactly the defect the #423 review caught as its finding 4, where an
unlisted error class logs as `UnknownError`. This repo's architecture concentrates change on a
few shared surfaces (`ipcHandlers.ts`, `shared/ipc.ts`, `shared/types.ts`), so near-total file
overlap between any two tickets is the normal case, not bad luck.

Note this cost is paid at *rebase* time, by a human or by a fix round, after both PRs are
already written. It does not show up as a dispatch failure. It shows up as review time — the
resource that is already the constraint.

## Obstacle 3 — review is the constraint, so adding slots adds queue, not throughput

Dispatch has never been the bottleneck. #423 is the measurement:

- **Six implementer rounds** (initial plus five fixes), **five reviewer pre-passes**, every one
  of them `request changes`.
- Four of those five rounds fixed the reported defect and introduced a new one in the same
  function — the sixth round deleted the construct instead.
- Elapsed: roughly nine hours of agent time on one ticket, against a frontier that never held
  more than five eligible issues.

Throughput is set by the slowest stage. A second slot doubles the rate at which PRs arrive at
a human gate that is already saturated, and every one of them carries the same review cost.
The queue in front of the gate gets longer; nothing ships sooner.

There is a real anti-benefit here too. Two concurrent PRs each needing five review rounds is
worse than one PR needing five, because context-switching between two half-reviewed evidence
paths is where reviewers miss things — and the #423 history is a five-round demonstration that
this reviewer misses things when the state space grows.

## The evidence-path argument

ADR-0005 makes human review the back gate for every agent PR and forbids auto-merge on
evidence-affecting ones. Both current frontier tickets (#414, #415) and both recent ones (#413,
#414) are evidence-affecting. A flat two-slot rule therefore means, in practice, **two
concurrent unreviewed changes to the evidence path** — which is precisely the exposure
strict-serial WIP was adopted to bound.

## Recommendation — scoped slots, not a second slot

Two slots, with a rule about what may occupy each:

- **Slot E** — at most one open `agent-pr` PR carrying `evidence-affecting`.
- **Slot N** — at most one open `agent-pr` PR *without* it.

This gives:

- Concurrent evidence-path exposure stays at one, unchanged from today.
- Real parallelism where it is cheap: docs (#415, #416), tests, renderer-only work, and the
  twenty design-handoff tickets currently off the frontier — none of which touch the shared
  main-process registries where obstacle 2 bites.
- A natural reduction in obstacle 2, because the evidence/non-evidence split correlates
  strongly with the main-process/renderer-and-docs split.
- The evidence-affecting label already exists, is already enforced by a path-list backstop, and
  is already checked by both agents — so the classification needs no new machinery.

Required changes, all small:

1. Occupancy check counts per class, and settles on claim comments and PR timestamps rather
   than the filtered label count (obstacle 1).
2. Eligibility picks the lowest-numbered eligible issue **whose class has a free slot**, rather
   than the lowest overall.
3. A dispatcher that cannot classify an issue before claiming it — the label is on the issue,
   so this is usually knowable — defaults to slot E, the conservative side.
4. One-writer-per-branch restated with a cross-branch note: a rebase conflict in an append-only
   registry is resolved by keeping **both** entries, never by taking one side.

## What would change the answer

The recommendation flips to a flat second slot if review stops being the constraint — that is,
if the pre-pass starts approving in one or two rounds rather than five. That is the same
condition #310 is waiting on, and ADR-0007's consequences section already names it: heavy
override friction means the pre-pass is producing findings not worth answering, which is a
reviewer-quality problem to fix at the source. Fix the round count first, and the slot question
answers itself.

## Not assessed

Whether two *sessions* can safely dispatch at once, as distinct from two slots. This already
happens — #427 was dispatched by a session other than the one holding the slot conceptually —
and the ADR-0006 protocol is designed for it, but no deliberate test of concurrent dispatchers
has been run. Also unassessed: whether the 4-hour staleness window is still right when two
claims can be outstanding, and whether the give-up path needs to name which slot it vacates.
