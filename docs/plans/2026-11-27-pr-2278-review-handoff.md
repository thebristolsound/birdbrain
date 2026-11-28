# PR 2278 review handoff

**Status:** active checkpoint before verification of the indentation fix. The
[PR description](https://github.com/thebristolsound/birdbrain/pull/2278) holds the later
verification result and current head.

## Preserved work

- `9a277ba74`: validator, template, merge withdrawal, and source-attribution fixes.
- `581e26366`: proof continuation rows, escaped and multiline image syntax, bounded merge
  queuing, description freshness, and commit-bound sign-offs. Its full verification passed:
  12,700 tests passed, 66 skipped, and coverage thresholds met.

## In flight at this checkpoint

The [indented screenshot finding](https://github.com/thebristolsound/birdbrain/pull/2278#discussion_r4724819778)
reproduced: the validator accepted a pair written as literal code. The pending fix rejects
code-block indentation on screenshot declarations and Before/After rows. Four indentation
reproductions failed before the fix; all seven focused cases pass afterward, including
ordinary three-space indentation and indented declarations. Full verification at the new
commit is still owed.

## Exact next command

After committing this checkpoint with the fix:

```bash
mise exec -- pnpm preflight > /tmp/birdbrain-2278-indent-preflight.log 2>&1
```

After it passes, push the branch, refresh the PR's Proof and Verification sections, and reply
to the finding with the commit and actual result. Keep the existing PR watch. Merging remains
the maintainer's action.

## Open questions

None for the indentation fix. The separate final-body-read/merge timing window remains
documented in ADR-0022 and the PR's Not done section; the operations are not atomic.
