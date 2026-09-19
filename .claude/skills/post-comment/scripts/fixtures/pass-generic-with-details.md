Scope correction from the review of PR #1125.

The Wayback tab is already half-fixed; the live pane is not.

<details>
<summary>The trace behind that</summary>

`WaybackComparePane.tsx:77` mounts `MhtmlViewer` for the stored pane only; `LivePane.tsx` still
uses the legacy iframe path.

```
git grep -n MhtmlViewer src/renderer
```

</details>
