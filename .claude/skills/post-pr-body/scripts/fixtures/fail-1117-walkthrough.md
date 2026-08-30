Closes #461.

## What changed

`tests/preload/bridge.test.ts` gains a second assertion over `ROOT_LEVEL_LEAVES`, independent of
path derivation:

> every leaf whose path contains no dot must be named in `ROOT_LEVEL_LEAVES`

The existing path check could never gate a root-placed event. `expectedBridgePath` returns an
event's bare method name (#338 exempts events from the `domain.method` rule deliberately), so a
root-placed `on*` leaf always equalled its expected path and the `!ROOT_LEVEL_LEAVES.has(...)`
filter never fired for one. Membership is checked directly instead, so both kinds are gated.

The comment above the list is rewritten to describe what the two checks now enforce between them —
the old text said the `on*` entries "are descriptive only and are not gated here", which this
change makes false (AC 5).

No change to `src/preload/index.ts`, `src/shared/ipc.ts`, or any runtime behaviour (AC 4):
`git diff --name-only origin/main...HEAD` is exactly `tests/preload/bridge.test.ts`.

### The new check found a live instance

On `main` the new assertion fails:

```
× preload bridge > places a leaf at the bridge root only when the allowlist names it
  → expected [ Array(1) ] to deeply equal []
+   "birdbrain.onExtensionAttach -> event:extensionAttach",
```

`onExtensionAttach` was added to the bridge root by #1038 (`55d2d940`), after #461 was filed and
while the allowlist still gated invokes only — the exact failure mode the issue predicts. Its
placement is correct (every other event subscriber sits at the root too), so the disposition is to
list it, which is the reviewed contract decision the allowlist exists to force. It is added with a
comment naming the PR it arrived in. Nothing is filed against #1038: there is no defect in it, only
a placement that had no review signal at the time.

## Acceptance criteria, by mutation

Each mutation was applied, the single test file run, then reverted. Head at the time of these runs
is the committed diff.

**AC 1 — a new unlisted root-level `on*` leaf fails.** Added `EXTENSION_PING: 'event:extensionPing'`
to `IPC_CHANNELS` and `onExtensionPing: subscribe(IPC_CHANNELS.EXTENSION_PING)` at the bridge root.
The name derives correctly from the channel, so this isolates root placement from every other
check:

```
   ✓ preload bridge > exposes exactly the main -> renderer event channels 0ms
   ✓ preload bridge > places each leaf at the full bridge path derived from its channel 0ms
   × preload bridge > places a leaf at the bridge root only when the allowlist names it 4ms
     → expected [ Array(1) ] to deeply equal []
   ✓ preload bridge > names each method after the action segment of its channel 0ms
      Tests  1 failed | 7 passed (8)
```

The new assertion is the only thing that fails. The same mutation against `main`'s version of the
test file, with the identical `src/` mutation in place:

```
 ✓ |node| tests/preload/bridge.test.ts (7 tests) 3ms
      Tests  7 passed (7)
```

**AC 2 — deleting an existing event from `ROOT_LEVEL_LEAVES` fails.** Removed `'onUpdateStatus'`;
the issue's table records this as "7 passed" before:

```
   ✓ preload bridge > places each leaf at the full bridge path derived from its channel 0ms
   × preload bridge > places a leaf at the bridge root only when the allowlist names it 4ms
     → expected [ Array(1) ] to deeply equal []
      Tests  1 failed | 7 passed (8)
```

**AC 3 — the three root-level invokes remain gated as they are.** The path check's body is
byte-identical to `main`'s. Removing `'search'` still fails it, with the same message, and now also
fails the new check:

```
   × preload bridge > places each leaf at the full bridge path derived from its channel 4ms
+   "birdbrain.search -> search:query (expected birdbrain.search.search)",
   × preload bridge > places a leaf at the bridge root only when the allowlist names it 0ms
+   "birdbrain.search -> search:query",
      Tests  2 failed | 6 passed (8)
```

## Evidence gate

**Did not fire, at either tier.** Two triggers checked:

- Issue #461 carries `enhancement`, `ready-for-agent` — no `evidence-affecting` label.
- The diff is one file, `tests/preload/bridge.test.ts`. The include list in
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` (as tiered by ADR-0014) has no
  `tests/**` entry. The nearby entry is `src/preload/index.ts`, advisory tier, and this PR does not
  touch it — AC 4 forbids it.

So no `evidence-affecting` label is required and no Evidence impact section is owed. The change
does *strengthen* a known-answer test guarding advisory-tier surface, which is a direction of
travel the gate favours, but a test-only diff on an unlisted path is not itself a hit.

## Handed to the dispatcher

I did not open this PR and cannot apply labels from this session. The dispatcher opens it as the
machine account and applies `agent-authored` plus `agent-pr` (dispatch slot). `evidence-affecting`
is not required, per the section above.

<!-- preflight v1 sha=2c8c60c22a9dc92a778ef74653b7d5aa8be2ee4c status=pass -->
## Verification

`pnpm preflight` at `2c8c60c22a9dc92a778ef74653b7d5aa8be2ee4c` on Node v20.20.2; diff scored against `origin/main` (merge base `0b48d79fc`). Result: **pass**.

- `pnpm lint` - pass (exit 0)
- `pnpm typecheck` - pass (exit 0)
- `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` - pass (exit 0) - 3648 passed, 8 skipped (3656)
- `pnpm build` - pass (exit 0)
- `pnpm build:extension` - skipped - no extension/ changes
- `pnpm test:coverage` - pass (exit 0) - 3648 passed, 8 skipped (3656), thresholds met
- `pnpm coverage:diff` - pass (exit 0) - not scored, no instrumented source lines changed

Pull request description generated by Claude Code



<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **Tests**
  * Expanded validation of supported root-level events in the preload bridge.
  * Added coverage ensuring unlisted root-level events are rejected.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->
