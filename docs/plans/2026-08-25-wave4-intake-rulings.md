# Wave 4 intake: rulings W1-W26

Opened 2026-08-25 in the intake session that followed the fourteen-reader phase-1 pass, and
finished 2026-08-26. The plan this amends is `docs/plans/2026-08-25-wave4-ultracode-prep.md`;
phase 1 raised forty-eight blocking questions in six themes. Round 1 (W1-W15) settled the ones
that gate the most work; round 2 (W16-W26) settled the rest.

Numbered W1-W26 to keep them distinct from wave 3's R1-R23, which still bind. Where a ruling
below contradicts the prep document, the ruling wins; where a ruling comment posted on an issue
contradicts both, the comment wins.

**W10 through W15 were taken by the agent under ADR-0015** rather than asked, because each is
groundable in an existing pattern, the ticket's own body, or the toolchain. They are marked
*taken* and are open to veto, which amends ADR-0015 by its own terms.

## Track A: the evidence tickets

**W1 (#803) - the MHTML Parts tab is deferred out of #803 and becomes its own ticket.** Nothing
in the tree parses MIME today and stored `.mhtml` files run to the 200 MB `MAX_MHTML_SIZE` cap
(`src/shared/constants.ts:5`), so the tab needs either a hand-rolled streaming multipart walker or
a new dependency, and that decision should not ride inside the wave's largest ticket. #803 ships
the artifact browser without Parts. Filed as **#991**, which carries the parsing question and the
200 MB constraint with it. This removes one of #803's six blocking questions and shrinks a `very-large`
ticket that was the wave's biggest unknown.

**W2 (#829) - the rescan is additive, never clear-then-rescan.** `matchSelectorAgainstCaptures`
is `INSERT OR IGNORE` (`src/main/services/db/selectorRepo.ts:193-205`), so an additive pass can
only add rows. The clear-first shape that `updateSelector` uses (`selectorLifecycle.ts:126-127`)
deletes a selector's matches and then skips any capture whose text will not load
(`selectorLifecycle.ts:66-67`), which silently drops rows that ride inside case archives
(`selectorRepo.ts:377-385`). An additive rescan cannot retire a now-stale match; that is the
accepted cost, and it is the same behaviour create-time backfill already has.

**W10 (#829, taken) - the rescan is unbounded over the case.** The ticket's own motivation, new
captures landing beyond the create-time window, only works unbounded, and
`scheduleRetroactiveMatch` already takes `{ unbounded: true }` (`selectorLifecycle.ts:40, :48`) on
the path `updateSelector` uses. Bounding it at `RETRO_MAX_CAPTURES` (500) would reproduce the gap
the ticket exists to close.

**W11 (#829, taken) - the rescan runs on a selector that is turned off.**
`matchSelectorAgainstCaptures` does not check `enabled` (`selectorRepo.ts:189-205`), unlike
`matchSelectorsForCapture` (`:170`), so create-time backfill already writes matches for a selector
created turned off. Available-always is the consistent answer, and the ticket names re-enabling a
selector as a motivating case. #701's registry renders the menu item from this, so the item is
never greyed.

**W3 (#830) - per-entity export produces an evidence package from a derived capture set.** For a
tag it is the tagged captures, for a selector its matched captures, for a note its anchored
capture. Each derives a `captureIds` set and exports through the same signed, verifiable path the
selection-scoped export already uses. The convenience-file alternative was rejected: an unsigned
per-entity artifact that looks like an export is exactly the thing a recipient mistakes for
evidence. The existing per-selector CSV on the Signals rail
(`SignalDetailRail.tsx:100-109`) stays what it is, a data dump, and is not renamed into an export.

**#985 rides with this ticket.** A selection-scoped export ships `notes.md` for the
whole case (`export.ts:382`, `:605-606`), and a single-entity export is the smallest possible
selection, so it is the largest possible over-disclosure. #830 does not ship until that is scoped.

**W4 (#861, closed on this ruling) - `snapshot` folds into #803's artifact rows; the other four unowned kinds are
declined.** Five of the mock's thirteen context-menu kinds are owned by no ticket: `case`,
`event`, `link`, `snapshot` and `spawn`. Snapshot maps onto a stored artifact, so #803's rows
carry it. The remaining four are mock concepts the app has not adopted, recorded on the #708
corrections register rather than built. #861 closes on this ruling.

## Track B: the product decisions

**W5 (#698) - per-capture AI analysis is removed entirely, including the `capture_analyses`
table.** The 2026-08-21 mock carries no AI surface at all, and the maintainer took that as the
product decision rather than an omission. The removal covers `AnalysisTab.tsx`, the `ai:` channels
and their handlers, `src/main/services/ai/analysisService.ts`, the archive import, the archive export
helpers, the AI settings that exist only for it, and a migration dropping the table.

Three consequences the implementing ticket owns, stated here so none is discovered late:

- **This deletes operator data.** Existing `capture_analyses` rows go away with the table. That is
  a migration and a data deletion, so it is outside ADR-0016's proceed-without-approval criteria
  and outside the ADR-0015 classes; it lands as its own reviewed change.
- **Archives written at `CASE_ARCHIVE_SCHEMA_VERSION` 4 and earlier carry analyses.** Import must
  skip them without failing the import, and the archive round trip needs a test proving an older
  archive still imports cleanly with its analyses dropped.
- **CLAUDE.md is wrong the moment this lands.** It states that per-capture analysis
  exists again and is not dead code. That paragraph and the AI services section go in the same
  change.

**W6 (#682, #813) - one state model: a session is a capture session, and the control is named for
it.** `sessionActive` means a capture session is running. Selector scanning stays session-scoped,
so the extension does no scanning work the operator did not ask for. The top-bar control and its
`aria-label` become "Capture Session," which is what the 2026-08-25 triage comment on #813
recommended, and the getting-started copy follows. #682's match-summary line then renders whenever
a session runs, which is the condition it was written for. Signals keeps auto-capture as its own
setting, shown where it is set. Both tickets close against this one model.

**W7 (#918) - a new unbounded `tagRepo` query, and the filter is multi-select.**
`getTagCaptureMatrix` (`tagRepo.ts:156-172`) is capped at the N most recent captures, so reusing it
would give an investigator a tag filter that silently omits older captures. Multi-select matches
`activeSelectorFilters` (`appStore.ts:170-186`) and the symmetry #918 asks for. The store question
phase 1 raised stands as an implementation constraint: a tag filter must not share the single
`filteredCaptureIds` slot in a way that lets `removeSelectorFilter` null it
(`appStore.ts:177-183`), and one control clears both filter kinds.

**W8 (#824) - the Watch toggle ships turned off, with copy naming the reason.** The #386
auto-capture hotfix is still in place on `main` at six sites in `extension/src/background.ts`
(`:157, :321, :343, :630, :857, :881`), so a live Watch toggle would promise behaviour the
extension does not perform. It renders off and non-interactive with copy that says why, and it
turns on when auto-capture returns, with no redesign. Repointing it at the selector's `enabled`
flag was rejected: that flag means something different from what the mock label says.

## Process

**W9 (#964) - `extension/**` gets instrumented for coverage.** It is absent from the vitest
coverage include list (`vitest.config.ts:25`), so `scripts/diff-coverage.mjs` prints `NOT SCORED`
and the 90%-changed-lines gate checks nothing on an extension-only diff. PR #961 is that case, and
wave 4 has more extension work coming. Expect existing extension files to score badly on first
inclusion; a per-file threshold or a follow-up test ticket is the expected fallout, not a reason
to defer.

**W12 (#952, taken) - scope it to `tests/components/useCopyCaptureHash.test.tsx` only.** PR #958
rewrites `CapturesRoute.test.tsx`, so touching both files is a merge conflict for no gain.
Mechanical sequencing.

**W13 (#956, taken) - stays deferred to #701.** Its own body says the Radix adoption in #701
supplies the roving `tabindex` and arrow-key navigation for free, so hand-rolling them now is work
#701 deletes.

**W14 (#899, #708, taken) - these close by posting GitHub comments, not by a diff.** No agent PR
can close them, so the dispatcher performs them directly and they take no slot.

**W15 (#534, #944, taken) - both closed.** #534's subject file was deleted by #766 (`95f62cd3`)
and `--d-head` is now read by nothing, filed as #990. #944's requested hook-boundary case is on
`main` at `tests/components/useCopyCaptureHash.test.tsx:153-163`.

## Round 2, ruled 2026-08-26

The maintainer answered the remaining intake questions in one pass. W16 through W26 are their
rulings, not takings, and they close every question the first round left open except the two
outstanding inputs recorded at the end.

**W16 (#675) - imported selector matches carry a null `matched_at` and stay out of the feed.**
Matches restored from an archive written at `CASE_ARCHIVE_SCHEMA_VERSION` 4 or earlier have no
recorded match time, so the column carries null rather than a substitute, and the recent-activity
feed excludes null rows. Inheriting the capture's `created_at` or the import time would put a
fabricated instant on the evidence path, which is the thing the feed exists to report honestly.
An imported case therefore shows an empty feed until new matches occur, and that is correct.

**W17 (#830) - per-entity export covers notes, selectors, and tags. Capture export is dropped.**
The selection bar already produces a scoped evidence package when exactly one capture is
selected, so a fourth kind would be a second code path building the same artifact, with a
standing obligation to keep the two identical. The ticket shrinks to three kinds and the
drill-down items follow per kind from W3's evidence-package shape.

**W18 (#405) - an agent captures the demo fixture from a site list the maintainer supplies.**
The taste call and the work split. The maintainer names the sites; an agent captures them,
exports the archive, and checks it in. **The list is an outstanding input and #405 cannot start
without it.**

**W19 (#405) - the tour's delete step removes the case directory as well as the row, for the
demo case only.** `cases:delete` deletes the database row and leaves the case directory on disk
(`src/main/services/db/caseRepo.ts:55`, and `src/main/ipcHandlers.ts:173` wires nothing else),
which is the right default for real evidence. A demo case is disposable, so completing the tour
leaves nothing behind. This does not change `cases:delete` itself.

**W20 (#922) - the Notes context rail mounts only when a note is selected.** All three blocks are
per-note, so there is nothing honest to render without one. No permanent empty column.

**W21 (#922) - Suggested is driven by shared tags and shared mention targets.** Both are already
indexed, `note_references` covers mentions, so it is one query and nothing is inferred. It is a
weak recommendation and an honest one. The block ships rather than being omitted, so no
divergence goes to #708.

**W22 (#902) - accelerator hints become platform-aware.** Hints render Cmd on macOS and Ctrl
elsewhere, from one helper. Every handler already accepts `ctrlKey || metaKey`, so this is a
display change. It overturns the prior decision recorded in the comment at
`src/renderer/components/captures/CaptureDetailsPanel.tsx:301`, which is deleted rather than
left contradicting the code.

**W23 (#665) - the batch-tag picker ships all four gaps.** Create-from-picker, multi-tag apply,
which tags the selection already carries in part versus in full, and batch untagging. Two IPC additions,
one of them a `removeFromCaptures` counterpart to `addToCaptures`. This is the only version in
which the selection bar's Tag action is finished, and a smaller version means designing the same
popover twice.

**W24 (#963) - build the shared in-flight guard, in batch 4.** The ticket records that nothing
corrupts, since per-tab suppression holds the latch and the server chains attach requests per
case and URL, so this is wasted capture work. It is cheap to remove while the selection-bar code
is already open.

**W25 (#967) - `extension/src/selectionBar.ts` joins the blocking tier.** It injects DOM that can
land inside captured bytes, which is the class the assessment puts `toast.ts` on the blocking
tier for (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md:169`). Same failure mode,
same treatment. The consequence is that batch 4 needs human review and cannot auto-merge.

**W26 (#803) - the agent drafts the a-d split and the maintainer vetoes.** Written against the
scope W1 and W4 left, with the Parts tab and its MIME dependency already moved to #991. The
split is mechanical sequencing once the scope questions are settled, so it costs a read rather
than a drafting session.

## Outstanding inputs

Not questions any more. Two things the maintainer owes before the tickets they gate can start.

- **#405 needs the site list** (W18). Nothing else blocks it.
- **PR #961's ADR-0007 override record needs the maintainer's dispositions.** The agent drafts
  the record with the finding and the underlying defect (#1006) written up; the dispositions
  themselves are not an agent's to write.
