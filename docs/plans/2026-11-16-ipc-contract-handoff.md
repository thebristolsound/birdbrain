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
  carries the code. `src/renderer/lib/birdbrain.ts` binds it to `window.birdbrain`, and every
  renderer invoke call goes through it. ESLint fails any other use of `window.birdbrain` under
  `src/renderer/` except a subscription.
- `IPC_REFUSALS` in `src/shared/ipc.ts` names the codes that renderer code branches on, and
  `refusalCode(err, channel)` reports only those, typed per channel.

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
- **The table names only codes that a caller reads.** A full inventory would be a fifth
  hand-written statement per channel with no reader, and the launch channel passes service
  codes through, so a list claimed complete could not be checked.
- **The adapter's logic lives under `src/shared/`.** The two test type projects keep
  main-process and renderer code apart, and the test that follows a refusal from `handle()` to
  the adapter needs both.

## Next

- Change 2 follows change 1. The contract's source of truth stays the TypeScript types, and the
  `ROOT_LEVEL_LEAVES` list in `tests/preload/bridge.test.ts` stays hand-written.
- With change 1 in, the preload's own facts are five method-name exceptions and three
  root-level invokes. The refusal markers no longer count.

## Open questions

None.
