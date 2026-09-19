Defect: the legacy page viewer sizes itself to the wrong parent measurement.

**What:** The stored pane of the Wayback compare view renders at zero height until the window resizes.

<details>
<summary>Where it is and how to reproduce it</summary>

**Where:** src/renderer/components/captures/LegacyHtmlViewer.tsx:41
**Reproduce:** Open a pre-v11 capture, switch to the Wayback tab, compare against any snapshot.

```
pnpm test tests/components/LegacyHtmlViewer.test.tsx
```

</details>
