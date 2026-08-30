# Redesign program: `ultracode` session prep (wave 4, round 2)

Prepared 2026-08-29 against `origin/main` at `8cae76fc`. Parent specification: #382. Companion
documents: `docs/plans/2026-08-25-wave4-ultracode-prep.md` (the wave-4 plan this continues),
`docs/plans/2026-08-25-wave4-intake-rulings.md` (rulings W1-W26, which bind), and
`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md` (R1-R23, which also bind). Ruling
comments posted on the issues outrank all three where they conflict. Pixel truth is
`docs/design-handoff/2026-08-21-birdbrain-standalone/`; read that folder's README first, because
the mock ships packed.

**Wave 4's completion test is unchanged: no open `redesign`-labelled issue carries scope.** This
round is the remainder of that wave, not a new one. Round 1 ran as interactive dispatch cycles
on the four days ending 2026-08-29 and cleared track B and four of the six batches. What is left is
the evidence tail, the ruled-but-unbuilt product tickets, and five tickets that wait on the
maintainer.

## Program state

- `LATEST_SCHEMA_VERSION` is **33** and `CASE_ARCHIVE_SCHEMA_VERSION` is **5**, both unchanged
  since the wave-4 prep. No round-1 PR migrated.
- **Round 1 merged nine wave-4 PRs.** #1085 closed #701 (context menus), #1068 closed #829
  (selector rescan), #1050 closed #704, #1042 closed #957, #1038 closed #852, #1035 was batch 1
  (#679, #908), #1032 was batch 2 less #688 (#864, #952), #1030 closed #521, and #1020 closed
  #1013. #861 closed on W4, #534 and #944 on W15. Track B is done and the two dispatch gates are
  gone.
- **Eighteen `redesign` issues are open.** #382 is the specification and carries no scope.
  Twelve are `ready-for-agent`, three are `ready-for-human` (#991, #987, and #830's gate #985 sits
  beside them without the label), and #405 is `needs-info`.
- **One dispatch slot is occupied.** PR #1125 (#465, not a redesign ticket) is open with a
  `failure` pre-pass verdict. Two slots are free.
- **The wave-3 fallout batches 4 and 5 are still open and still unlabelled `redesign`.** Eleven
  extension follow-ups (#968, #963, #992, #993, #994, #1002, #1003, #1006, #1007, #1008, #1009)
  and eight duplicate-capture follow-ups (#970, #971, #998, #999, #1000, #1001, #1015, #1017).
  By the completion test they are outside the wave. They are listed in "Track D" below so a
  session with an idle slot has something ruled to pick up, and because #992 is a security
  finding that should not sit behind the redesign tail indefinitely.

### Rules that carry forward

Every rule in the wave-4 prep still applies: Opus at `max` is the ceiling and the floor for every
fleet agent, `Closes #N` in every body, `pnpm preflight` at head, labels in the create call,
one `birdbrain-reviewer` at a time while #969 stays open, body updates through the REST PATCH
path while #965 stays open, and `extension/**` unscored by `coverage:diff` while #964 stays
open.

**One consequence of the model rule is new to this round.** The session that plans and runs it
is a Fable session. The default for `Agent` and `Workflow` calls inherits the session model, and
the rule forbids Fable as a fleet model, so every `agent()` call in the phase-1 script and every
`Agent` call that spawns an implementer or reviewer passes `model: 'opus'` explicitly. That is a
cap, not a raise, so it stays inside the rule.

## The remaining set

| Ticket | Ruling | Tier at head | Label state | Dispatch condition |
| --- | --- | --- | --- | --- |
| #1033 | triaged 08-29 | none | correct | now |
| #688 | triaged 08-22 | none | correct | now, after #1032 left it behind |
| #902 | W22 | none | correct | now |
| #922 | W20, W21 | advisory | correct | now |
| #682 + #813 | W6, one PR | blocking (`background.ts`) | **gap**: no `evidence-affecting` | now |
| #918 | W7 | blocking (`db/**`) | **gap** | after AC3 is corrected (see below) |
| #665 | W23 | blocking (`db/**`, IPC spine) | **gap** | after #918 merges |
| #675 | W16 | blocking (migration) | **gap** | now |
| #824 | W8 | blocking (`background.ts`) | **gap** | now; the #829 dependency cleared in #1068 |
| #698 | W5 | blocking, labelled | correct | now; data deletion, human review |
| #708 | W14 | none | correct | dispatcher closes by comment, no slot |
| #803 | W1, W4, W26 | blocking, labelled | correct | split veto and one product ruling |
| #830 | W3, W17 | blocking, labelled | correct | after #985 is ruled and merged |
| #985 | none | blocking | `ready-for-human` | maintainer ruling on scope |
| #405 | R7, R12, W18, W19 | blocking, labelled | `needs-info` | site list and the #771 ruling |
| #991 | W1 | blocking | `ready-for-human` | two maintainer rulings, or an explicit deferral |
| #987 | none | none | `ready-for-human` | maintainer call |

**The label gaps are the first intake chore.** Phase 1 on 2026-08-25 reported #682, #813, #918,
#665, #675 and #824 as blocking tier, and none carries `evidence-affecting` today. The dispatch
skill keys the human-review gate on that label, so a PR opened from any of them would report as a
non-evidence PR and become eligible for auto-merge. Apply the label at intake, before any of them
dispatches, and let the phase-1 reader confirm the tier rather than set it.

**#824's tier rests on `background.ts`, not on `selectionBar.ts`.** W25 ruled that
`extension/src/selectionBar.ts` joins the blocking tier, but the path list at
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` does not carry it at head, and
#967, the ticket that adds it, is still open. #963's 2026-08-29 triage recorded the same
correction. #824 fires the tier anyway through `background.ts`, so the label is right either way;
the point is that #967 is owed before W25 is true in the gate's own terms.

**#918's third acceptance criterion cites a control that does not exist.** The W7 ruling comment
already records it: "#749's disabled state" is not on `origin/main`
(`SignalDetailRail.tsx:263`). Rewrite the criterion against what the rail renders today before
the ticket dispatches, or the implementer spends a round discovering it.

## Conflict map

Lighter than round 1's. Contention is inside the data screen and inside the shared spine.

- **`src/renderer/components/dashboard/cases/DataExplorer.tsx`.** `803b`, `803c`, and `803d` all
  rewrite it. Strict serial, each branch cut from `main` after the previous merges. `803a` touches
  only the main process and IPC and is the only part that can run beside anything else.
- **The IPC spine** (`src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`,
  `src/main/ipcHandlers.ts`). `803a`, #918, #665, #922, #675 and #830 all append. Advisory tier
  since ADR-0014; append-only; second-to-land resolves.
- **`src/main/services/db/migrations.ts` and `core.ts`.** #675 adds `selector_matches.matched_at`
  and #698 drops `capture_analyses`. R16 assigns the number at merge, so neither document pins
  one. Serialize them anyway: two open migration branches are a guaranteed rebase for the
  second, and the rebase costs a verify round.
- **`src/renderer/stores/appStore.ts`.** #918 adds the tag-filter slot beside
  `activeSelectorFilters` and must not share `filteredCaptureIds` in a way `removeSelectorFilter`
  can null (W7); #688 adds the `selectedNoteId` clearing. Different regions, but #918 should land
  first because its store change is the larger one.
- **`src/renderer/components/captures/CaptureList.tsx`.** #1033 renames three controls; #918
  adds the tag narrowing UI. #1033 is a one-file wording change, so it goes first.
- **`src/renderer/components/layout/TopBar.tsx`.** #813 renames the session control and its
  `aria-label`; #902 routes its `title` hint through the platform helper. #902 first, because its
  helper touches five other files and #813's edit is one line on top of it.
- **`extension/src/background.ts`.** #682 changes the scan gating; #824 raises the popover from
  the selection bar; every batch-4 ticket edits it too. Serialize #682/#813 before #824, and keep
  batch 4 out of the extension until both merge.
- **The renderer selection bar** (`CaptureSelectionBar`, `useCaptureSelection.ts`). #665 replaces
  the minimal tag popover; #824 adds the typed selector confirm beside it. #665 first.
- **`src/main/services/export.ts`.** #985 scopes `notes.md`; #830 builds on the scoped path.
  Strict serial, #985 first, and #830 does not open until #985 merges.
- **`src/renderer/components/onboarding/`.** #902 rewrites hint strings in `tourSteps.ts` and
  `WelcomeCard.tsx`; #405 adds the case tour and folds in #771. #405 is last and alone, unchanged.

## Track shape

Three slots. Twelve of the seventeen tickets are blocking tier, so as in round 1 the binding
constraint is the maintainer's review queue, not agent throughput. Only four tickets can
auto-merge (#1033, #688, #902, #922). The tracks are cut by file contention so each slot can
run its chain without waiting on another slot's merge.

- **Track A, the data screen.** `803a`, then `803b`, then `803c`, then `803d`. Four human reviews for one
  ticket, as the split comment says. `803a` can dispatch the moment the split is accepted and the
  sub-tickets exist; `803b` needs the extracted-data ruling as well.
- **Track B, tags, and the selection bar.** #1033, then #918, then #665, then #824. One
  auto-merge followed by three human reviews.
- **Track C, shell, notes, dashboard, and the AI removal.** #902, then #682/#813, then #688, then
  #922, then #675, then #698. Three auto-merges, then three human reviews, with the two
  migrations serialized at the end of the chain.
- **The tail, when inputs arrive.** #985 then #830 into whichever slot frees first; #405 last and
  alone after everything else merges.
- **Track D, outside the wave.** Batches 4 and 5 from the wave-4 prep, still needing the split
  that document asked for. Only for a slot that would otherwise idle, and #992 first if any of it
  runs. #963, #1000 and #1017 are `ready-for-human` and are not dispatchable.

Merge order inside a track is fixed by the conflict map. Merge order across tracks is not fixed,
except that #405 is last.

## Suggested workflow shape

Same three phases as every wave, with the same division: phase 1 is a `Workflow` call, phases 2
and 3 run through the dispatch skill from an interactive session, because a workflow cannot hold
the `birdbrain-agent` identity ADR-0012 requires or take the ADR-0006 claims.

### Phase 0: intake, before any agent runs

Interactive, no fleet. Everything here is a comment, a label, or a maintainer answer.

1. Collect the five maintainer inputs listed in the "Outstanding inputs" section. The run can start with
   two of them still open (#405's list and #991), because neither gates a track.
2. File `803a` through `803d` as sub-tickets with the split comment's scope copied into each, once
   the split is accepted. Each carries `ready-for-agent` and `evidence-affecting` in the create
   call, and #803 itself loses `ready-for-agent` so the dispatcher cannot pick up the parent.
3. Apply `evidence-affecting` to #682, #813, #918, #665, #675 and #824.
4. Correct #918's third acceptance criterion.
5. Close #708 by comment per W14, or record why it stays open. It carries no code.
6. Resolve PR #1125's `failure` verdict or close it, so all three slots are free when track A
   starts. It is not a redesign ticket; it only holds a slot.

### Phase 1: re-ground the tickets

One `Workflow` call, `wave4-round2-reground`, one reader per dispatch unit, Opus at `max`, every
`agent()` call passing `model: 'opus'`. Eleven readers, under the fifteen-agent guideline:

| Reader | Tickets |
| --- | --- |
| 1 | `803a` (and a read of `803b`-d for conflicts only) |
| 2 | #1033, #688 |
| 3 | #902 |
| 4 | #682, #813 |
| 5 | #922 |
| 6 | #918, #665 |
| 7 | #675 |
| 8 | #824 |
| 9 | #698 |
| 10 | #985, #830 |
| 11 | #405, #771 |

The script is the 2026-08-25 phase-1 script (`wf_1f09c7c2-a2d`) with three changes: the
`landed-soon` context block is replaced by the round-1 merge list in the "Program state" section, the reader is told that
its ticket was already read once on 2026-08-25 and that its job is the delta since, and the
output schema gains an `openPrConflicts` field for the three open PRs. The reader schema is
otherwise unchanged: readiness, starting files, evidence tier with the assessment line, effort,
blocking questions, stale claims with the disproving `file:line`, conflicts, dependencies, and
verification path.

**Why re-read tickets that were read four days ago.** Twenty-two PRs merged between the two
reads, including #701's registry, #829's rescan and #704's banner, which are the three surfaces
the remaining tickets build on. Every wave's recurring failure has been a stale body, and the
correction is cheaper at intake than inside a review round. The session posts each reader's
stale-claim list as a correction comment on the issue before the ticket dispatches; the readers
themselves are read-only.

### Phase 2: implement

Dispatch cycles from the interactive session, three slots, tracks A, B and C in parallel, each
implementer a `birdbrain-implementer` in worktree isolation at Opus `max`, ending with
`pnpm preflight` at head and a draft PR whose body opens with `Closes #N`. Nothing changes from
round 1 except the order of the queue.

### Phase 3: review

Reviewer pre-pass after every push, one reviewer at a time, and the sha pinned before and after. Blocking
tier PRs then wait for the maintainer. The convergence check in the dispatch skill decides when a
fix round is worth another cycle.

## Review load

Fourteen human reviews are queued behind this round if every ticket runs: four for #803, two for
#985 and #830, one each for #918, #665, #675, #824, #682/#813, #698 and #405, and one for #991 if
it is ruled in. Round 1 averaged one human review a day across 2026-08-26 to 08-29. At that rate
the round is a two-week tail bounded by the maintainer, and the four auto-merge tickets are the
only part that finishes faster than that. Any ordering that puts the auto-merges first shortens
the visible queue without shortening the tail.

## Outstanding inputs

Not questions for a reader. Five things the maintainer owes, each stated in full so no session
has to reconstruct it.

1. **#803: does the a-d split posted on 2026-08-27 stand, with `part` dropped from the menu
   criterion?** And the product question that split raised: does category-and-subcategory
   browsing of extracted data survive anywhere in the app after the Data screen becomes an
   artifact browser, or does the Extracted Text results node replace it? `803b` cannot dispatch
   without the second answer.
2. **#985: how is a selection-scoped export's `notes.md` scoped?** The candidates are notes
   anchored to a selected capture only, notes anchored to a selected capture plus unanchored
   case notes, or a dialog option. #830 does not open until this is ruled and merged.
3. **#405: the demo-fixture site list (W18), and the #771 ruling.** The #771 question, from its
   2026-08-29 triage: when a running tour chapter is displaced by another chapter starting over
   it, is the displaced chapter recorded complete even if it never got past its first card?
   Consistency with the 2026-08-21 Skip ruling argues yes.
4. **#991: a hand-rolled streaming MIME walker or a dependency, and whether a part carries a
   `SHA-256` over raw or decoded bytes.** Or an explicit deferral out of wave 4, recorded on the
   issue and by dropping the `redesign` label, since the completion test counts it.
5. **#987: does the off-by-seven citation fix in the evidence assessment go to an agent, or does
   the maintainer make it by hand?** It edits the gate's own document, which is why it was
   triaged `ready-for-human`.
