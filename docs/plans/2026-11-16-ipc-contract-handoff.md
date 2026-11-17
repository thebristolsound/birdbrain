# Resume the renderer-to-main IPC contract work

**Status:** active

Matt asked for this unit in the architecture review thread on 2026-11-16, after reading the
review of `origin/main`. It has three changes, each its own pull request, merged in this order.
This file is appended after each one.

## The three changes

1. Carry refusal codes across the bridge on every channel, and name in the contract the codes
   that callers branch on.
2. Derive the preload bridge and the `window.birdbrain` type from the contract.
3. Move handler logic out of the `registerIpcHandlers` closure, one domain per pull request.

## Change 1: refusal codes

What it does:

- The preload rejects every refused call with a plain `{ message, code }` object. The 16
  hand-marked channels and the marker are gone, including the one the Persona import fix
  added the same day.
- `adaptBridge` in `src/shared/bridgeAdapter.ts` turns that object back into an Error that
  carries the code. `src/renderer/lib/birdbrain.ts` binds it to `window.birdbrain`, and renderer
  invoke calls go through it, apart from the four error-reporting modules under
  `src/renderer/lib/`. ESLint fails a direct reference to `window.birdbrain` anywhere else
  under `src/renderer/` except a subscription.
- `IPC_REFUSALS` in `src/shared/ipc.ts` names the codes that callers of two channels read
  (`persona:import` and `launchedBrowser:launch`), and `refusalCode(err, channel)` reports only
  those, typed per channel. The sharing screens keep `SHARING_ERROR_CODES` and their own
  `sharingErrorCode`.

Decisions taken, with the reason for each:

- **Every channel delivers its code, with no per-channel switch.** A switch in the contract
  would still leave a second step in the renderer, and a missed second step would hand a
  screen a plain object instead of an Error.
- **The renderer calls an imported `birdbrain`, not a replaced `window.birdbrain`.** The
  preload's `window.birdbrain` cannot be reassigned, and installing a wrapper under that name
  at startup would make the end-to-end specs race the renderer bundle.
- **Subscriptions stay on `window.birdbrain`.** They return no promise, so the adapter has
  nothing to do for them, and leaving them alone keeps this change out of four files on the
  blocking tier of the evidence path list.
- **The error-reporting modules stay on `window.birdbrain`.** The query layer design keeps
  error-reporting paths off any extra layer and names three of the four, and
  `globalErrorLog.ts` reports errors the same way. All four discard a rejection, so its shape
  does not reach a screen.
- **The table names only codes that a caller reads through `refusalCode`.** A full inventory
  would be a fifth hand-written statement per channel with no reader, and the launch channel
  passes service codes through, so a list claimed complete could not be checked.
- **The adapter's logic lives under `src/shared/`.** The two test type projects keep
  main-process and renderer code apart, and the test that follows a refusal from `handle()` to
  the adapter needs both.

Change 1 is merged to `main`.

## Change 2: the derived bridge

What it does:

- `src/shared/birdbrainApi.ts` derives the `BirdbrainAPI` type from `IpcInvokeContract` and
  `IpcEventContract`, and `buildBridge` builds the preload's object from `IPC_CHANNELS` by the
  same path rule. `BRIDGE_PATH_EXCEPTIONS` places the seven channels the rule does not.
- `src/preload/index.ts` passes its two leaf makers to `buildBridge` and names no channel.
- `tests/renderer/fakeBridge.ts` reads its namespace, event and top-level lists from the same
  rule. The bridge test keeps its own hand-written rule, `METHOD_NAME_EXCEPTIONS` and
  `ROOT_LEVEL_LEAVES`.

Decisions taken, with the reason for each:

- **A mapped type over the flat contract, not a nested contract or a generated file.** The
  derived type equals the hand-written one except that `onLaunchedBrowserPickTab` now takes a
  callback with a `null` payload. Hover text and error messages match, and find-references
  works. Go-to-definition on a bridge method finds nothing, where it used to land on the
  duplicate signature.
- **The contract stays TypeScript-first.** Whether Zod schemas should become its source of
  truth is an open question this change does not answer.
- **The comments from the old bridge type moved to the contract entries.**

## Next

- Change 2 is in review. When it merges, change 3 starts from `main`, one domain per pull
  request, each merged before the next opens.
- Change 3 begins by reading `registerIpcHandlers` in `src/main/ipcHandlers.ts` and choosing
  the first domain to move. `tests/main/ipcHandlers.test.ts` keeps its check that every
  invoke channel in `IPC_CHANNELS` is registered.

## Open questions

None.
