**Review verdict: request changes**

1. The description does not name every place the changed viewer is used, so the evidence review is incomplete.
2. One new test is titled for a missing-archive case but checks the loading text instead.

Context sentence 1 that belongs in the report.
Context sentence 2 that belongs in the report.
Context sentence 3 that belongs in the report.
Context sentence 4 that belongs in the report.
Context sentence 5 that belongs in the report.
Context sentence 6 that belongs in the report.
Context sentence 7 that belongs in the report.

<details>
<summary>Full report</summary>

Reviewed commit: bae47d99a1b2c3d4e5f60718293a4b5c6d7e8f90

| # | severity | file:line | finding |
|---|---|---|---|
| 1 | blocking | PR body, Evidence impact | `MhtmlViewer` is also mounted by the Wayback stored pane, which the gate artifact never names. |
| 2 | non-blocking | tests/components/MhtmlViewer.test.tsx:108 | The case is titled `reports a missing archive` but asserts the loading text. |

Failure scenario for 1: open a pre-v11 capture, switch to the Wayback tab; the stored pane
mounts `MhtmlViewer` through `WaybackComparePane.tsx:77`, a path the Evidence impact section
does not list, so the backward-verification claim is untested there.

</details>
