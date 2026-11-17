import { contextBridge, ipcRenderer } from 'electron'
import { buildBridge, type BridgeInvoke, type BridgeSubscribe } from '@shared/birdbrainApi'
import type { ContractedChannel, IpcEventChannel, IpcEventContract, IpcRefusal } from '@shared/ipc'

// Every invoke channel is registered through handle(), so every result carries
// the { ok, data | error } envelope. A result without one means the channel was
// registered raw — a wiring bug we surface rather than pass through.
//
// The context bridge copies only an Error's message into the renderer, so a
// `code` set on one never arrives. A refused call therefore rejects with a
// plain IpcRefusal, which crosses whole; the renderer's bridge adapter
// (src/renderer/lib/birdbrain.ts) turns it back into an Error.
async function unwrapIpc<T>(promise: Promise<unknown>): Promise<T> {
  const result = await promise
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('IPC result is missing its envelope')
  }
  if ((result as { ok: boolean }).ok) {
    return (result as { ok: true; data: T }).data
  }
  const { error, code } = result as { ok: false; error: string; code?: string }
  const refused: IpcRefusal = { message: error, code }
  throw refused
}

// Builds a renderer-facing method for one invoke channel. Both the argument
// tuple and the resolved type come from IpcInvokeContract, so a bridge method
// has no hand-written signature that could drift from its handler.
function invoke<C extends ContractedChannel>(channel: C): BridgeInvoke<C> {
  return (...args) => unwrapIpc(ipcRenderer.invoke(channel, ...args))
}

// Builds a renderer-facing subscribe method for one event channel. The callback
// payload comes from IpcEventContract; the returned function detaches the
// listener.
function subscribe<C extends IpcEventChannel>(channel: C): BridgeSubscribe<C> {
  return (callback) => {
    const handler = (_: unknown, payload: IpcEventContract[C]): void => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

// One leaf per contracted channel, placed by its channel name (buildBridge in
// src/shared/birdbrainApi.ts). Nothing here names a channel, so the bridge
// exposes exactly what IPC_CHANNELS declares.
const birdbrain = buildBridge({ invoke, subscribe })

contextBridge.exposeInMainWorld('birdbrain', birdbrain)
