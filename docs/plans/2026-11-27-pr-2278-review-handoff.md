# PR 2278 review handoff

**Status:** historical checkpoint captured before verification of the HTML fixes. This file
records the work at that time. Use the
[PR description](https://github.com/thebristolsound/birdbrain/pull/2278) for the published head
and its verification result.

## Preserved work

- `9a277ba74`: validator, template, merge withdrawal, and source-attribution fixes.
- `581e26366`: proof continuation rows, escaped and multiline image syntax, bounded merge
  queuing, description freshness, and commit-bound sign-offs. Its full verification passed:
  12,700 tests passed, 66 skipped, and coverage thresholds met.
- `12d28b03d`: screenshot declarations and Before/After rows cannot use code-block
  indentation. Its full verification passed: 12,707 tests passed, 66 skipped, and coverage
  thresholds met. The finding received a reply and its thread is resolved.
- `691ad7758`: opening fences start in the first column, so list boundaries cannot hide a
  later image. Its full verification passed: 12,714 tests passed, 66 skipped, and coverage
  thresholds met. The finding received a reply and its thread is resolved.
- `808701107`: table dividers with optional outer pipes never count as filled rows. Its full
  verification passed: 12,727 tests passed, 66 skipped, and coverage thresholds met. The finding
  received a reply and its thread is resolved.
- `ebd2b531f`: local batch for the earlier fleet findings below. Its full run passed 12,746
  tests with 66 skipped, typechecking, build, and coverage thresholds, but failed lint on a
  new test regex. The follow-up changes that regex to use an explicit space count.
- `f9930c367`: paragraph, table, quote and fence boundaries are preserved. Its full verification
  passed: 12,751 tests passed, 66 skipped, and coverage thresholds met.

## In flight at this checkpoint

The [earlier fleet report](https://github.com/thebristolsound/birdbrain/pull/2278#issuecomment-7231512167)
has seven findings. F1 is already fixed by `691ad7758`. This checkpoint preserves the remaining
batch and its implementation:

- F2: short comment endings no longer hide rendered images or visible Summary text.
- F3: the decision record's status names the later amendments.
- F4: a canceled merge request exits before comparing descriptions.
- F5: tests cover quiet unrequested edits, unarmed withdrawal notices, unreadable live labels,
  and the action binding.
- F6: the comment fixture keeps the image and the prohibited prose on one line. A temporary
  greedy-strip mutation loses that prose; the real function reports it.
- F7: code spans continue across paragraph lines, with boundaries for blanks and other blocks.
  GitHub's Markdown API confirms both the hidden-image reproduction and the quoted-image
  control. It refutes the report's claim that the invalid-fence fixture renders no image, so
  that fixture remains unchanged.

The renderer inputs and outputs are under `/tmp/birdbrain-2278-render-*`. The follow-up fixes
three reproduced boundary cases: a pipe-prefixed paragraph is not automatically a table;
a deeper quote starts a new block; and removed fenced lines still separate paragraphs in
Screenshots. GitHub's renderer confirms the new image and quoted-image controls.

The [later fleet report](https://github.com/thebristolsound/birdbrain/pull/2278#issuecomment-7232100157)
repeats the code-span, status-line, comment-fixture and withdrawal-test findings, covered above.
Its additional fixes in this checkpoint are:

- HTML tags and autolinks consume their backticks before an inline code span opens.
- Screenshot pairs use Markdown rows or the supported collapsed layout; other standalone
  HTML wrappers are refused because they can leave the image rows as plain text.
- ADR-0041 names description edits among the withdrawal triggers.
- This checkpoint is explicitly historical, and the metadata comment and withdrawal step
  name match the implementation.

Verification was the next action when this checkpoint was written.

## Next command at this checkpoint

After committing this checkpoint with the fix:

```bash
mise exec -- pnpm preflight > /tmp/birdbrain-2278-html-preflight.log 2>&1
```

After it passes, push the branch, refresh the PR's Proof and Verification sections, and reply
to the finding with the commit and actual result. Keep the existing PR watch. Merging remains
the maintainer's action.

## Open questions

None for this batch. The separate final-body-read/merge timing window remains
documented in ADR-0022 and the PR's Not done section; the operations are not atomic.
