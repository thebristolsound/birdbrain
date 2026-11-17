import type { IpcMainInvokeEvent } from 'electron'
import { handle, sendEvent } from '@main/ipcWrap'
import type {
  ContractedChannel,
  IpcEventChannel,
  IpcEventContract,
  IpcInvokeContract
} from '@shared/ipc'

// The window that made a call, as far as a handler may use it.
export interface IpcCaller {
  // Pushes an event to that window only.
  send<E extends IpcEventChannel>(channel: E, payload: IpcEventContract[E]): void
}

type IpcHandler<C extends ContractedChannel> = (
  caller: IpcCaller,
  ...args: IpcInvokeContract[C]['args']
) => IpcInvokeContract[C]['result'] | Promise<IpcInvokeContract[C]['result']>

// One domain's handlers, keyed by channel. A domain module builds its table
// from the ports it is given (dialog, shell, other domains), so a test can call
// a handler with fakes and no Electron.
export type IpcHandlers<C extends ContractedChannel> = { readonly [K in C]: IpcHandler<K> }

function callerOf(event: IpcMainInvokeEvent): IpcCaller {
  return { send: (channel, payload) => sendEvent(event.sender, channel, payload) }
}

// Registers every handler of a table through handle(), which wraps results and
// refusals in the envelope the preload expects.
export function registerHandlers<C extends ContractedChannel>(table: IpcHandlers<C>): void {
  for (const channel of Object.keys(table) as C[]) {
    const handler = table[channel] as (caller: IpcCaller, ...args: unknown[]) => unknown
    handle(channel, ((event: IpcMainInvokeEvent, ...args: unknown[]) =>
      handler(callerOf(event), ...args)) as Parameters<typeof handle<C>>[1])
  }
}
