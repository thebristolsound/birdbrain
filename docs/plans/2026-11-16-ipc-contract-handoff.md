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

Change 2 is merged to `main`.

## Change 3: handler logic out of `registerIpcHandlers`

The shape, set by the first slice:

- `src/main/ipc/handlers.ts` holds `IpcHandlers<C>`, a table of handlers keyed by channel, and
  `registerHandlers(table)`, which registers each one through `handle()`.
- A handler takes an `IpcCaller` and then the channel's contract arguments. The caller sends an
  event to the window that made the call. A handler never sees Electron's invoke event.
- A domain module exports a function that takes its ports and returns its table.
  `registerIpcHandlers` builds the table and registers it.
- `tests/main/ipcHandlers.test.ts` stays as it is. It calls the registered channels with
  Electron mocked, so it shows a moved domain behaves as before, and it keeps its check that
  every invoke channel in `IPC_CHANNELS` is registered.

Decisions taken, with the reason for each:

- **A table per domain, keyed by channel, not plain functions with one table in
  `ipcHandlers.ts`.** With plain functions every channel is written twice, once as a function
  and once as a table row that forwards to it, and most handlers are one line already.
- **The caller is a port with `send` only.** Four handlers use the calling window today, all to
  send progress. The Wayback batch also stops when its window goes away, so its slice adds that
  to the port.
- **A check that two handlers of a moved domain repeat gets one function in the domain
  module.** No handler gains a check it did not have.
- **`src/main/ipc/**` joins the evidence path list at the advisory tier**, the tier of
  `ipcHandlers.ts`, so moved logic keeps the review it had.

Domains moved:

- Shell reveal and open, with the list of files the app wrote (`src/main/ipc/revealFiles.ts`).
  The report export and the Case archive export tell it about each file they write.

## Next

- Next slice: the report export (`export:preflight`, `export:generate`), which uses the save
  dialog, the caller's `send` and `remember` from the reveal module.
- After that, in the order they appear in `registerIpcHandlers`: the domains that call `dialog`
  or `shell` (Case archive, Captures, Personas, Selectors, extension, settings, Staging Pool,
  diagnostics, database backups), then the Wayback batch, then the rest.
- For each slice: move the block as it is, register the table, add a test that calls the table
  with fake ports, run `pnpm test tests/main/ipcHandlers.test.ts`, then `pnpm preflight`.

## Open questions

None.
