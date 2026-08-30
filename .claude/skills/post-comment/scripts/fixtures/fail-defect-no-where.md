Defect: LegacyHtmlViewer sizes its guest to the parent's min-height rather than its height.

**What:** The stored pane of the Wayback compare view renders at 0px until the window resizes.
**Reproduce:** Open a pre-v11 capture, switch to the Wayback tab, compare against any snapshot.

```
pnpm test tests/components/LegacyHtmlViewer.test.tsx
```
