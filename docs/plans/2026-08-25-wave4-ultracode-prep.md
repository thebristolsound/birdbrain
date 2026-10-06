# Redesign program: `ultracode` session prep (wave 4)

Prepared 2026-08-25. Parent specification: #382. Companion documents:
`docs/plans/2026-08-23-redesign-wave3-ultracode-prep.md` (wave 3, the plan this continues),
`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md` (rulings R1-R23, which still bind),
`docs/plans/2026-08-19-wave1-implementation-notes.md` (adjudications that still bind).
Pixel truth: `docs/design-handoff/2026-08-21-birdbrain-standalone/`. Read that folder's README
first; the file ships packed, so a plain grep for `onClick` or `viewBox` finds nothing.

**Wave 3 said it was the last wave. It was wrong, and the reason is worth stating.** That
document scoped thirteen items and closed thirty `redesign`-labelled issues. The programme did not
end, because each wave's review rounds filed new `redesign` issues faster than the tail shrank:
nineteen of them are open today and none was ever scoped into a wave. Wave 4 is the wave that
absorbs that residue. Its completion test is not "the board is empty" but "no open
`redesign`-labelled issue carries scope", which is the bar wave 3 set for itself and did not meet.

## Program state

Re-verified against `origin/main` at `06eb76e5` on 2026-08-26. The first pass was written
against `e4d16e3b` on 2026-08-25, before the three wave-3 PRs merged; every figure below moved.

- `LATEST_SCHEMA_VERSION` is **33** (`src/main/services/db/core.ts:6`). PR #958 took v33 on merge.
- `CASE_ARCHIVE_SCHEMA_VERSION` is **5** (`src/main/services/caseArchive.ts:80`). PR #958 bumped
  it from 4 so an older reader cannot mistake a duplicate entry for a tampered chain.
- **All three wave-3 PRs merged on 2026-08-26**: #955 (closed #828, merge tags), #958 (closed
  #827, duplicate capture), #961 (closed #393, extension in-page selection bar). Nothing from
  wave 3 is queued at the human review gate, and all three dispatch slots are free.
- 368 issues are open in total, 208 of them `ready-for-agent`. Only 25 carry `redesign`. The
  backlog outside this programme is a separate problem and this document does not address it.
- **The three merges filed roughly twenty-five new issues between them**, review fallout that
  postdates this document's intake list and sits in no batch below. The intake session absorbs
  them: #992-#994 and #1002-#1009 are batch-4 territory, #998-#1001, #1015 and #1017 are batch-5
  territory, and #1013 is a test flake that fails `pnpm test:coverage` and therefore every
  wave-4 verify loop until it is fixed.

### Rulings that carry forward

Every ruling in `docs/plans/2026-08-24-wave3-phase2-intake-rulings.md` (R1-R23) still binds, and
the ruling comments posted on the issues outrank both that document and this one wherever they
conflict. The four that shape wave 4 most:

- **R16, migration numbers are assigned by merge order.** Migrations are append-only, so whichever
  branch merges first takes the next version and bumps `LATEST_SCHEMA_VERSION`. **No number in
  this document is a pin.** With #958 merged and holding v33, any wave-4 ticket needing schema
  takes "the next version at merge" and nothing else.
- **R13, capability tickets land as small independent PRs**, and #701's registry absorbs late
  arrivals at near-zero cost. That is why the registry does not gate the inline routes.
- **R8, the one-click Selector path shipped in #393**; the typed confirm popover is #824 and is a
  separate ticket, not a revision of the first.
- **R22, #401's compare panel runs two live guests under two partitions.** Merged, but it is the
  precedent for any future ticket that adds a webview: the decision belongs in
  `src/main/webviewPolicy.ts`, not beside it.

## The rules changed again, in the middle of wave 3

Six ADRs merged on 2026-08-25 as `e4d16e3b` and every wave-4 session runs under them. They are
standing approvals, not suggestions: a session that waits where an ADR says proceed is burning the
maintainer's attention, which is the scarce resource this programme is actually bounded by.

- **ADR-0015, recommendation-grade decisions are pre-approved** when the class is on its list and
  the recommendation is groundable in a repo doc, an ADR, an existing pattern, or the toolchain.
  Take it, log it under "Decisions taken," do not ask. Still ask for: new dependencies,
  destructive or irreversible actions, spend, scope expansion, blocking-tier evidence paths,
  conflicts between documented rules, product decisions with no precedent, and taste-only calls.
- **ADR-0016, convention-shaped plans execute in the same turn** when they add no dependency,
  tap no blocking-tier file, carry no migration or data deletion, are reversible with git alone,
  stay inside the ADR-0015 classes, and change at most 10 files. Otherwise wait, and name the
  criterion that tripped.
- **ADR-0017, a green verify block at head replaces completion confirmation.** Exit codes captured
  at the command; any edit after a run invalidates it.
- **ADR-0018, PR body claims are computed at the head sha they describe.** The `## Verification`
  block is generated last, from a run at head. Any push invalidates it. A block describing another
  tree state is a blocking body defect by definition, with no argument about how close it is.
- **ADR-0019, doc drafts get a WIP commit before the turn ends.** This document is subject to it.
- **ADR-0020, a seeded pending pre-pass expires**, and whoever pauses the dispatch routine
  resolves every outstanding seeded `pending` status before pausing.

## Process defects that bind wave-4 sessions

These are not theoretical. Each cost real time during wave 3 and each has a filed issue.

- **Never run two `birdbrain-reviewer` agents concurrently (#969).** The reviewer has no worktree
  isolation, so it checks out the reviewed sha inside the dispatcher's own checkout. On 2026-08-25
  two concurrent reviewers cross-contaminated (a probe file from one appeared in the other's
  coverage run) and left the session in detached HEAD. Until #969 lands: one reviewer at a time,
  and re-check the branch afterwards. The t3 harness may also rename the session branch
  mid-session, so read `git reflog` rather than assuming the name.
- **`gh pr edit` fails on the machine token (#965).** It is GraphQL-backed and the machine PAT is
  `repo`-scope only. Body updates go through `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -F
  body=@<file>`. This bites precisely when a fix round must rewrite a body, which is when skipping
  it is most expensive.
- **`Implements #N` does not close an issue.** All three wave-3 PRs shipped with it and would have
  left their issues open carrying `ready-for-agent` after merge, which is the #268 misdispatch
  trap. Fixed on 2026-08-25; every wave-4 PR body opens with `Closes #N`.
- **`extension/**` is invisible to `coverage:diff` (#964).** An extension-only PR passes the
  90%-changed-lines gate unscored. The script says so honestly (`NOT SCORED`), but a wave-4
  extension ticket has no coverage floor and its reviewer must weigh tests directly.
- **A scheduled cloud dispatch cannot satisfy ADR-0027 (#960).** The Anthropic-cloud sandbox proxy
  re-authenticates every GitHub request as the session identity: the machine token, a deliberately
  bogus token, and raw `curl` all return the maintainer's login. The routine is turned off. Wave 4
  runs from interactive local sessions only.

## Session process rules

Unchanged from wave 3 except where the preceding ADRs moved them.

- Agent diffs open as `birdbrain-agent`, draft, labelled `agent-authored` plus `agent-pr` when they
  take a slot, plus `evidence-affecting` when the blocking tier fired. Labels go in the create
  call, never a second write: `ci.yml`'s draft exemption reads the `opened` webhook.
- Three concurrent slots (ADR-0014). Every branch is cut from `main`, never from another cycle's
  branch.
- Evidence-affecting PRs carry an Evidence impact section, a known-answer test or an explicit
  justification of its absence, human review, and never auto-merge.
- Verify loop per PR: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`,
  `pnpm build`, plus `pnpm build:extension` when `extension/` changed, plus `pnpm test:coverage`
  and `pnpm coverage:diff` re-run back to back after any edit.
- Reviewer pre-pass on every agent push, pinned to a sha read before and after the review.
- Definition of done per screen: pixel-match at compact density, hover/empty/keyboard states per
  the bundle, tokens only, legible at all three density steps.
- Anything infeasible as designed: send back the constraint, never a redesign.

## Phase 1: what fourteen readers found

Run 2026-08-25 as a fourteen-agent `ultracode` pass, uniform high effort, every ticket read
against `origin/main` at `e4d16e3b` rather than against its own body. Full structured output is in
the workflow journal; this is the roll-up.

| Ticket | Readiness | Evidence tier | Effort | Blocking questions | Stale claims found |
| --- | --- | --- | --- | --- | --- |
| #829 | needs-ruling | blocking | small | 3 | 5 |
| #701, #944, #952 | ready | none | medium | 0 | 8 |
| #704 | ready | none | small | 0 | 8 |
| #830 | needs-ruling | blocking | large | 4 | 6 |
| #824 | needs-ruling | blocking | small | 3 | 5 |
| #803 | needs-ruling | blocking | very-large | 6 | 9 |
| #405, #771 | ready | blocking | large | 2 | 8 |
| #922 | needs-ruling | advisory | medium | 2 | 2 |
| #918, #665 | needs-ruling | blocking | medium | 6 | 4 |
| #675 | needs-ruling | blocking | large | 3 | 5 |
| #698 | needs-ruling | blocking | medium | 3 | 3 |
| #682, #813 | needs-ruling | blocking | medium | 3 | 8 |
| #861 | needs-ruling | blocking | medium | 4 | 6 |

The batch reader covered the twenty-three small fixes separately; its proposal is the "Batches"
section below.

### Three findings that change the plan

**Only three of fourteen reports came back `ready`, and eleven carry blocking-tier evidence.**
Wave 3 ran with seven evidence reviews out of thirteen tickets and the maintainer's review was
already the binding constraint. Wave 4 as scoped is worse on that axis, not better. Any plan that
does not interleave non-evidence work deliberately will idle three slots waiting on one human.

**Eighty-five stale claims across fourteen tickets.** These are assertions in ticket bodies that
are false against `origin/main` today: wrong line citations, capabilities described as absent that
now exist, dependencies named on the wrong issue. Two examples carry real cost. #829's own body
cites the evidence assessment at line 217, which is the `captureLifecycle.ts` row; the
`selectorLifecycle.ts` row it means is line 224. And #829's claim that it unblocks "#393's popover"
is wrong twice: #393 is the in-page bar, already built in PR #961, and the popover is #824. An
implementer following either citation wastes a cycle. The intake pass corrects the bodies before
dispatch, not during it.

**Two tickets are dead and want closing rather than planned.**

- **#534 is obsolete.** Its subject file, `src/renderer/components/selectors/SelectorTable.tsx`,
  was deleted by #766 (`95f62cd3`, the consolidated-Signals change). The view has no sortable Matches
  header and no `w-24` any more, and `--d-head` is now referenced by nothing outside
  `globals.css`. Close it, and file the orphaned token separately if anyone cares.
- **#944 is already fixed on `main`.** The hook-boundary padded-digest case it asks for is at
  `tests/components/useCopyCaptureHash.test.tsx:153-163`, and #952's own body concedes it. Close
  as done.

### The intake's forty-eight rulings are settled

**Closed 2026-08-26.** `docs/plans/2026-08-25-wave4-intake-rulings.md` holds W1-W26, and every
ruling is posted as a comment on its issue, where it outranks both that document and this one.
Round 1 settled W1-W15 on 2026-08-25; round 2 settled W16-W26 the next day. The six themes below
are kept as the record of what was asked and why.

1. **Rescan and match semantics (#829, #675).** Is a rescan additive or clear-then-rescan, bounded
   at `RETRO_MAX_CAPTURES` or unbounded, available on a selector that is turned off? The clear-first shape
   deletes matches for any capture whose text is unreadable at rescan time, and those rows ride in
   case archives, so this is evidence-consequential rather than a preference. #675 adds the
   archive question: what `matched_at` do matches imported from an older archive carry?
2. **What "export" means per entity (#830).** For a note, a selector or a tag, is Export an
   evidence-class package derived from a `captureIds` set, or a convenience file? Related: whether
   exporting a single capture is a new capability at all, given the selection bar already produces
   a scoped package at one selected capture. #985, filed during this pass, is the acute case: a
   selection-scoped export ships `notes.md` for the whole case.
3. **The Data screen split (#803).** Six questions, and the ticket has never had its a-d split
   written down. The sharpest is branch (a): parse MHTML parts with a hand-rolled streaming walker
   over files up to the 200 MB cap, or add a MIME dependency. Nothing in the tree parses MIME
   today, and a new dependency is a maintainer decision by standing rule.
4. **Which mock concepts the app adopts (#861, #824, #698).** Five of the mock's thirteen
   context-menu kinds are owned by no ticket, not one. #824 asks who owns the third selection
   scope, the in-app capture Text tab. #698 asks whether the mock's total absence of any AI
   surface is an omission to correct or a decision to follow. These are product calls with no
   repo precedent, so they are exactly the class ADR-0015 keeps with the maintainer.
5. **Session versus auto-capture state (#682, #813).** The two tickets are one confusion seen from
   two ends. One sentence settles both: what `sessionActive` means, whether selector scanning is
   session-scoped, and what the top-bar control is called.
6. **Tag filtering and the batch picker (#918, #665).** Six questions, the load-bearing one being
   whether a tag filter reuses the bounded `getTagCaptureMatrix` (which silently omits older
   captures) or needs a new unbounded query, and whether it shares the single `filteredCaptureIds`
   store slot that selector filters null out today.

### Batches for the small fixes

The maintainer ruled these into grouped PRs. Verified against `origin/main` at `06eb76e5`; two
members were dropped as dead (preceding section). **Every "after PR #N" block cleared on
2026-08-26**, so all six batches are dispatchable, and batches 4 and 5 need their membership
re-read against the review fallout the merges produced before either is dispatched.

| Batch | Members | Shared ground | Evidence tier | Ready when |
| --- | --- | --- | --- | --- |
| 1. Docs corrections | #679, #908 | wave-1 notes' 18 `/tmp` citations; the corrections brief's "six V2 prose documents" | none | now |
| 2. Renderer polish plus a KAT axis | #688, #864, #952 | Dashboard/RecentActivityFeed/NotesOverview, CaptureList empty state, `useCopyCaptureHash` field provenance | none | now |
| 3. #852 alone | #852 | extension tag/note writes leave React Query caches stale | blocking | now (#955 and #958 merged) |
| 4. Selection-bar follow-ups | #962, #968, #963 (ruled in by W24), plus the #961 fallout: #992, #993, #994, #1002, #1003, #1006, #1007, #1008, #1009 | `extension/src/background.ts`, `selectionBar.ts` | blocking, and W25 puts `selectionBar.ts` on the tier explicitly | now (#961 merged) |
| 5. Duplicate-capture follow-ups | #970, #971, plus the #958 fallout: #998, #999, #1000, #1001, #1015, #1017 | `captureLifecycle.ts`, the duplicate KAT, the design doc, `certification.ts`, `lib/api/captures.ts` | blocking | now (#958 merged) |
| 6. #957 alone | #957 | tag-delete confirmation reusing the merge-dialog copy | none while it stays out of `tagRepo.ts` | now (#955 merged) |

**Batch 4 and batch 5 are too large to dispatch as written.** Each now names nine and eight
issues against one or two files, which is a merge conflict with itself, and #992 is a security
finding that should not wait behind eight cosmetic ones. Splitting them is intake work, not a
call this document makes.

#972 left batch 5: PR #958 fixed it before merge and it is closed. #1000 is in batch 5 by subject
but the schema tightening it asks for is verifier-visible and spans both the `duplicate` and
`background` method families, so it likely wants its own PR rather than a seat in a grouped one.

Scope #952 to `useCopyCaptureHash.test.tsx` only: `CapturesRoute.test.tsx` was rewritten by PR
#958, so re-read that file before touching either.

**Not batched, and why.** #956 stays deferred to #701's Radix adoption, since fixing it by hand is
work #701 deletes. #899 and #708 close by posting GitHub comments rather than by any diff, so no
agent PR can close them and the dispatcher handles them directly. #964, #965, #967 and #969 are
process and tooling rather than product, and #967 in particular edits the evidence gate itself.
One label gap to fix before batch 1 dispatches: #899, #908 and #708 carry `documentation` and
`redesign` but not `ready-for-agent`.

## Model and effort

**Ruled 2026-08-25 by the maintainer, on cost.** Opus is the ceiling for every agent this wave
runs: implementers, reviewers, planning readers, and the dispatcher itself. Fable is used only as
an advisor, meaning the interactive `advisor` consult, and never as a fleet model. A fleet stage
pointed at a quota-exhausted model fails the run rather than degrading, which is the reason this
is a hard rule and not a preference. No `Agent` or
`Workflow` call in wave 4 passes a model override to raise a stage past the session model.

**This reverses the wave-3 plan's phase-3 guidance**, which set `fable` for the adversarial verify
stage on the strength of the doc-curator A/B in
`docs/plans/2026-08-16-codex-doc-curator.md` (n=3x3, Opus invented an unsupported claim twice,
Fable never did). That reasoning was never wrong; it is outranked by the monthly budget, and the
A/B measured prose editing under numeric limits rather than code review, which the wave-3
document itself flagged as a bet rather than a result.

The exposure the reversal accepts is real and worth naming rather than glossing: the fabricated
finding is the failure mode Fable was chosen to avoid, and wave 4 carries eleven blocking-tier
tickets. Two things reduce it. Every pre-pass verdict names the sha it read and lists what it did
not check, so a reviewer's claims can be checked rather than trusted. And #986 records the harder
lesson from wave 3, that a single Opus reviewer approved #961 over an evidence-attribution defect
a separate Codex round then caught, which says the instrument needs a second reporter more than it
needs a more expensive one.

**Effort is `max` throughout, and that is a reliability rule before it is a quality one.** Wave 3
tiered effort and this wave does not, because the tiering was a savings argument and the saving is
no longer the binding constraint. The binding constraint is that a stage which routes to a model
whose monthly quota is spent does not degrade, it fails, and it fails partway through a run that
has already spent its budget getting there. Opus at `max` is the ceiling and the floor for every
substantive stage: implementation, review, and any future reader pass. Nothing in wave 4 reaches
past it.

## Track shape

Three slots, and the constraint is not agent throughput. Eleven of fourteen reports are
blocking-tier, every one of those needs human review, and three evidence PRs are already queued
at that gate. The tracks exist to keep non-evidence work flowing while evidence work waits.

- **Track A, evidence.** #829, then #830, then #803a-d, then #405. Strict serial through the
  export chain, every branch cut from `main`. Nothing here auto-merges.
- **Track B, renderer and non-evidence.** #701 (which absorbs #952's axis and closes #944 as
  already-done), #704, then batches 1 and 2. This is the track that fills slots while track A
  waits, and it is the only track that can auto-merge.
- **Track C, follow-ups behind the wave-3 PRs.** Unblocked as of 2026-08-26: #961, #958 and #955
  all merged, so batches 3, 4, 5 and 6 are dispatchable. Batches 4 and 5 need splitting first.

Merge order is not fixed beyond the tracks, because it depends on rulings the intake has not made.
**#405 goes last and alone**, unchanged from wave 3: it spotlights screens the rest of the wave
builds.

## Open items

- **The intake session is the next step, not implementation.** Forty-eight questions in six
  themes, plus the two closures. Wave 3's phase-2 intake is the template: rulings posted as
  comments on the issues, which then outrank this document.
- **#803 needs its a-d split written before it can be dispatched at all.** It is the wave's
  largest unknown, `very-large`, evidence-affecting, and six of its questions are unanswered.
- **Three issues were filed by the reader pass** (#984, #985, #987) under the maintainer's
  GitHub identity, because workflow subagents inherit the session's `gh` credentials. The findings
  are sound; the provenance is not what the pipeline intends. Tracked as #989.
- **Two process gaps bind wave 4, and the maintainer ruled the order on 2026-08-26.** #1013 goes
  first: `mentionSuggestion.test.tsx` throws an unhandled `getClientRects` error that fails
  `pnpm test:coverage`, which is inside the verify block every wave-4 PR must pass, so any work
  started before it fails loops at random. #521 goes second: the dispatch routine takes no claim
  on the occupied-slot path, which is how two sessions worked PR #958's round 3 in parallel and
  threw away an hour of Opus implementation. It is built before track B dispatches, because one
  cycle spent on it returns the other two of the three slots. #1016 filed the same defect on
  2026-08-26 and is closed in favour of #521, which filed it on 2026-08-17 with the fuller
  acceptance criteria.
- **PR #961 merged over a `failure` pre-pass verdict with no ADR-0007 override record.** The
  deferred finding is that the Evidence impact section overclaimed the navigation guard, and the
  underlying defect is filed as #1006. The record itself is still owed, and it needs the
  maintainer's dispositions rather than an agent's.
