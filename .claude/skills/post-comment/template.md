# Comment shapes, one example per kind

## Cycle claim (3 lines)

```
Cycle claim: PR #1125

Claiming the reviewer pre-pass at head `bae47d99`.
```

## Cycle release (2 lines)

```
Cycle release: PR #1125
```

## Pre-pass verdict (20 lines, at most 5 rows)

```
**Reviewer pre-pass (bae47d99): request changes** - 2 of 2 reporters in on this sha

| # | severity | file:line | finding |
|---|---|---|---|
| 1 | blocking | PR body, Evidence impact | `MhtmlViewer` is also mounted by the Wayback stored pane, which the gate artifact never names. |
| 2 | non-blocking | tests/components/MhtmlViewer.test.tsx:108 | The case is titled `reports a missing archive` but asserts the loading text. |

Full report: https://gist.github.com/birdbrain-agent/0123456789abcdef
```

## Review reply (1 line)

```
applied 4e9ed05e
```

```
not applied: the suggested guard is unreachable because MutationObserver drops the previous observer on a second mutate().
```

## Give-up or defect (20 lines)

```
Defect: LegacyHtmlViewer sizes its guest to the parent's min-height rather than its height.

**What:** The stored pane of the Wayback compare view renders at 0px until the window resizes.
**Where:** src/renderer/components/captures/LegacyHtmlViewer.tsx:41
**Reproduce:** Open a pre-v11 capture, switch to the Wayback tab, compare against any snapshot.
```
