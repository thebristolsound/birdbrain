# PR 2278 review handoff

**Status:** active checkpoint before verification of the table-divider fix. The
[PR description](https://github.com/thebristolsound/birdbrain/pull/2278) holds the later
verification result and current head.

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

## In flight at this checkpoint

The table-divider finding reproduced: empty Proof and Changes tables passed when their
divider omitted its closing pipe. The pending fix recognizes dividers with optional outer
pipes in both table consumers. Regression cases cover empty and filled tables, empty Decisions
tables, and a one-cell continuation that must still fail for missing proof. Full verification
at the new commit is still owed.

## Exact next command

After committing this checkpoint with the fix:

```bash
mise exec -- pnpm preflight > /tmp/birdbrain-2278-table-preflight.log 2>&1
```

After it passes, push the branch, refresh the PR's Proof and Verification sections, and reply
to the finding with the commit and actual result. Keep the existing PR watch. Merging remains
the maintainer's action.

## Open questions

None for the table-divider fix. The separate final-body-read/merge timing window remains
documented in ADR-0022 and the PR's Not done section; the operations are not atomic.
