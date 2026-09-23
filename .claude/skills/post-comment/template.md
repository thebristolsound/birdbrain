# Comment shapes, one example per kind

Every comment has two layers. The top layer is plain language for a reader who does not know
this repository's tooling. Everything else (file paths, commit ids, tables, commands, traces,
test output) goes inside a `<details>` block under a plain `<summary>`, the way CodeRabbit nests
its review. Line caps count the top layer only.

## Bot trigger (1 line, the command alone)

```
@coderabbitai full review
```

## Cycle claim (3 lines, first line machine-read)

```
Cycle claim: PR #1125

Claiming the review of the latest commit on this pull request.
```

## Cycle release (2 lines, first line machine-read, no details block)

```
Cycle release: PR #1125
```

## Pre-pass verdict (10 lines, at most 5 numbered findings, full report collapsed)

```
**Review verdict: request changes**

1. The description does not name every place the changed viewer is used, so the evidence review is incomplete.
2. One new test is titled for a missing-archive case but checks the loading text instead.

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
```

When the report is too large to nest (GitHub caps a comment at 65,536 characters), the block
holds the table and a `Full report: <link>` line instead of the prose.

## Review reply (1 line; an applied reply names the commit in a details block)

```
Applied.

<details>
<summary>Commit</summary>

4e9ed05e

</details>
```

```
Not applied: the suggested guard is unreachable because the observer is replaced on a second mutation.
```

## Give-up or defect (10 lines; Where and Reproduce collapsed)

````
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
````

## Anything else (20 lines; details optional)

```
Scope correction from the review of PR #1125.

The Wayback tab is already half-fixed; the live pane is not.

<details>
<summary>The trace behind that</summary>

`WaybackComparePane.tsx:77` mounts `MhtmlViewer` for the stored pane only; `LivePane.tsx` still
uses the legacy iframe path.

</details>
```
