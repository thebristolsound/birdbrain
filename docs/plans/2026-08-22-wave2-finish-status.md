# Redesign wave 2: finishing status

Written 2026-08-22, after the phase-3 review and the first fix rounds. Companions:
`2026-08-21-redesign-wave2-ultracode-prep.md` (the prep),
`2026-08-21-wave2-phase1-findings.md` (phase 1), `2026-08-22-wave2-review-verdict.md` (the
review). This one records what moved after that verdict and what the wave is actually waiting on.

## The short version

**Everything left in the wave is gated on one merge that an agent must not perform.** #766 is
evidence-affecting, and ADR-0005 says evidence-affecting pull requests never auto-merge and always
get human review. Until a human merges it, none of the three remaining branches can rebase, and
two of them cannot even typecheck against `main`.

The code side is in better shape than the verdict left it. Four of the five blocking findings are
now fixed and verified. The fifth is deferred with a stated reason on the artifact.

## State of each pull request

| PR | Ticket | Base | Pre-pass | Blocked on |
| --- | --- | --- | --- | --- |
| #766 | #400 exclusions and Signals | `main` | success | a human. Do not merge it from an agent |
| #770 | #390 Mention editing | `main` | failure, 3 findings | #766, then a fix round |
| #769 | #402 consolidated Overview | `wave2/400-rebased` | not posted | #766. Has run zero CI |
| #715 | #404 coach marks and tour | `wave2/integration` | success | #766 |

### #766, and why it stays put

Twelve CI checks green, `agent/pre-pass` success, migration v30, three fix rounds behind it. The
wave's own merge sequence says merge it, but that sequence was written before those fix rounds and
before ADR-0005 was weighed against it. It is the one pull request in the wave whose entire reason
for existing is a claim about what does and does not enter a case. A human ratifies that claim.

### #770, Mention editing

The blocking prototype-pollution fix (B2) is real and complete. I re-enumerated the per-kind
reads with `git grep` rather than trusting the pull request body's list of five, and found nine
records or switches keyed by target type. Eight are guarded or carry a `default` arm, and the
ninth is genuinely unreachable from a pasted attribute. Two of its three new test files bite under
mutation.

Three blocking findings survived this pass:

- **#773.** `tests/components/MentionSuggestionList.test.tsx:62-70` passes with the fix fully
  reverted. React mounts `Object.prototype.toString` happily as a function component and renders
  the literal text `[object Undefined]`, so nothing throws and the only assertion holds either
  way. The body claims the file pins behaviour it does not pin.
- **#772.** A note Mention chip opens whichever note was last selected rather than the one it
  names, because `MentionChip.tsx:104-109` seeds a target only for captures while
  `RecentActivityFeed.tsx:79` leaves `selectedNoteId` in the store. Same shape as the deferred
  selector problem, except this one is wrong on `main` today.
- **#774.** The Evidence impact section said no diff path appears on the include list.
  `package.json` (row `:197`) and `pnpm-lock.yaml` (row `:198`) both do, and the prep document
  recorded that at `:88` before the work started. Corrected in the body, with the dependency
  provenance the #710 precedent set: integrity re-derived against the published registry metadata
  and byte-identical to the lockfile, MIT, zero runtime dependencies, no install lifecycle script,
  pinned exactly. The disposition holds on contents; the label is not in dispute.

One correction to the verdict, in the branch's favour. The verdict said
`CLICK_HINT.selector = 'click to edit the rule'` promises a rule and opens a different one. Today
it does not: `origin/main`'s `SelectorsOverview.tsx` has no selection state at all, so the chip
lands on the inline-editable table with nothing pre-selected. Imprecise, not false. It becomes
false when #766 lands and `allSignals[0]` starts answering.

### #769, consolidated Overview

B4 is fixed. `backlinkMapModel.ts` now derives `isEmpty` from whether the case has Mentions at all
rather than from the post-cap edge list, and adds a `notice` field with an `entities-capped`
state, which is the third state the verdict asked for. The cap arithmetic itself is unchanged,
correctly: dropping entities at 20 notes is the intended ceiling, and the defect was that the card
then claimed the case had no Mentions.

It has still run no CI at all, because `ci.yml` fires only on `pull_request: branches: [main]`.
Filed as #763.

### #715, coach marks and tour

B5 is fixed across two commits and is the main code change this session produced.

`start()` set new tour state straight over a running chapter, and `close()` was the only caller of
`completionAfter`, so a displaced chapter never recorded that it had run. Both reported paths were
verified in source rather than inherited: the case chapter auto-firing over a running intro, and
the intro's own extension step ringing the whole `ExtensionBanner` card, whose Setup Guide button
sits inside that anchor and whose ring is `pointer-events-none`, so the click lands and starts a
different chapter. Because `isFreshInstall` is latched once at `settings.ts:111` and never
cleared, a lost intro completion means the welcome card returns on every launch from then on.

The pre-pass on the first commit found that the fix was itself incomplete and had introduced the
wave's own recurring defect. `stateRef` was assigned only during render, so when the intro and
case auto-fires ran in a single passive-effect flush the second `start()` read `null`, found
nothing to displace, and lost the completion by the same mechanism. And two docstrings, in
`startTour.ts` and `completionAfter`, now asserted the opposite of what the code did. The second
commit fixes all three. Every new test was mutation-checked, and the one that does not bite is
labelled as such rather than counted as evidence.

Not fixed, filed as **#771**: a chapter displaced on its *first* step is still recorded complete,
so the ten-step case chapter can end after one card if the operator clicks Learn more in the
Captures empty state. That is the same trade-off the 2026-08-21 skip ruling already makes, so
reversing it here is a maintainer call rather than a fix-round one.

## What has to happen, in order

1. **A human merges #766.** Nothing below this line moves first.
2. **#770.** Rebase onto `main` on a new branch, because force pushes are blocked. Carry the #716
   route retarget, the `CLICK_HINT` correction and the Signals target hand-off, plus #772, #773
   and the `mentionModel.ts:161` comment from #774. Open a replacement pull request.
3. **#769.** Rebase onto `main` on a new branch, open a replacement, and let it run CI for the
   first time.
4. **#715.** Rebase onto `main` on a new branch. Drop the redundant `wave2/integration` commits
   `72d35948` and `9afe596c` rather than replaying them, once #770 carries the route fix.
5. **The documentation pull request.** Scope below. It merges last.
6. `/dispatch` the twelve held fixes: #662, #667, #670, #671, #681, #683, #686, #687, #688, #689,
   #691, #692.
7. Delete `wave2/integration` and the stale pre-rebase branches `wave2/390`, `wave2/395`,
   `wave2/397`, `wave2/400`, `wave2/402`, `wave2/406`.

### Why #715 and #770 cannot rebase before #766

Not a policy preference. Both reference routes that do not exist on `main`.

`git ls-tree origin/main -- src/renderer/routes` returns exactly two files, `__root.tsx` and
`cases/$caseId/captures.tsx`, and there is no `src/renderer/components/signals/` directory.
The router is type-registered, so:

- #770's `MENTION_ROUTES` retarget to `/cases/$caseId/signals` fails `tsc -p tsconfig.web.json`
  standalone. Reproduced: `MentionChip.tsx(108,18): error TS2322`.
- #715's `useTourEngine.ts:48` already maps the tour's `signals` route to
  `/cases/$caseId/signals`, so the failure surfaces at the `navigate({ to: CASE_ROUTE_PATHS[route] })`
  call rather than at the map, which is `satisfies Record<..., string>`.

## The documentation pull request, scoped

Tracked on #737 plus blocking item 6 of the review verdict. Every claim below was checked against
the branches.

**It must merge after all the wave code, not before.** `.github/workflows/docs.yml` publishes on
`push: branches: [main]`, deliberately unfiltered by path. Landing a docs change describing
Signals while `main` still ships Selectors and Tags publishes documentation for a screen that does
not exist. Every item in this list is currently *true* on `main` and only goes false when the wave
lands, so there is no part of it that can go early.

Screenshot slugs, diffed between `origin/main` and `origin/wave2/404`:

- Removed: `screenshot-selectors`, `screenshot-tags`.
- Added: `screenshot-signals`.
- Retained but now shooting different surfaces: `screenshot-onboarding`,
  `screenshot-extension-setup`.

What the pull request has to do:

1. **`website/content/docs/screenshots.mdx:85-100`.** Replace the `### Selectors` and `### Tags`
   sections with one `### Signals` section referencing `/assets/screenshot-signals.png`. The two
   images those sections embed are no longer produced by the spec, and `screenshot-signals.png` is
   produced and displayed nowhere.
2. **`README.md:75`.** The line lists "onboarding, dashboard, selectors, notes, tags, command
   palette, settings, and the extension setup guide". Selectors and Tags become Signals, and the
   extension setup guide is deleted by #404.
3. **`website/content/docs/tester-guide.mdx:162`.** "the first-run wizard prompts you" describes a
   wizard #404 removes.
4. **Regenerate the screenshots**, which needs `README_SHOTS=1` and the merged wave code, since the
   Signals screen has to exist to be photographed. Delete the orphaned
   `website/public/assets/screenshot-selectors.png` and `screenshot-tags.png`.

Already done on `wave2/404`, so do not duplicate it: `screenshots.mdx:21-37`'s captions for
Onboarding and Extension setup were rewritten there. Only their PNGs are stale, which is what #737
is about.

No `meta.json` or `docs.json` change is needed. The page set does not change, only sections within
`screenshots.mdx`.

## Two decisions still open, neither blocking

- **#764.** Re-ratify #402's evidence disposition against the six paths its diff actually hits.
  The substance is very likely unchanged; the ruling was answered against a different question.
- **#763.** The stacked-pull-request CI gap. Retargeting each child to `main` before merge is one
  valid answer, and it is what steps 2 to 4 above do, but nothing states it as policy.

## Issues this session filed

#771 (tour chapter displaced on its first step), #772 (note Mention chip opens the wrong note),
#773 (the suggestion-list prototype test does not bite), #774 (#390's Evidence impact undercounts
the include-list hits).
