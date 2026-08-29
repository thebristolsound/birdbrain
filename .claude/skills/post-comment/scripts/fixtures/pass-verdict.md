**Reviewer pre-pass (bae47d99): request changes** - 2 of 2 reporters in on this sha

| # | severity | file:line | finding |
|---|---|---|---|
| 1 | blocking | PR body, Evidence impact | `MhtmlViewer` is also mounted by the Wayback stored pane, which the gate artifact never names. |
| 2 | non-blocking | tests/components/MhtmlViewer.test.tsx:108 | The case is titled `reports a missing archive` but asserts the loading text. |

Full report: https://gist.github.com/birdbrain-agent/0123456789abcdef
