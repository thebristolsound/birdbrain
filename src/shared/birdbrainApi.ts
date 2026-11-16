import {
  IPC_CHANNELS,
  type ContractedChannel,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcInvokeContract
} from '@shared/ipc'

// The shape of `window.birdbrain`, derived from the contract in ipc.ts. An
// invoke channel `domain:action` sits at `birdbrain.<domain>.<action>`, and an
// event channel `event:<name>` at `birdbrain.on<Name>`. The type below and
// bridgePath() state that one rule twice, once for the compiler and once for
// the preload, and tests/preload/bridge.test.ts checks the bridge they build
// against its own hand-written lists.

// The channels whose bridge path the rule does not give. A new entry needs a
// matching one in the bridge test, which is what makes it a reviewed decision:
// in METHOD_NAME_EXCEPTIONS when the method name differs from the channel's
// action, and in ROOT_LEVEL_LEAVES when the path has no dot.
export const BRIDGE_PATH_EXCEPTIONS = {
  'extension:path': 'extension.getPath',
  'export:generate': 'export.generateReport',
  'diagnostics:recent': 'diagnostics.recentEntries',
  'search:query': 'search',
  'captures:testPipeline': 'testPipeline',
  'captures:testHttp': 'testHttp',
  // The only event channel with two colons, so `on` + its capitalised name is
  // not an identifier.
  'event:selector:rematched': 'onSelectorRematched'
} as const satisfies { readonly [C in IpcChannel]?: string }

type PathExceptions = typeof BRIDGE_PATH_EXCEPTIONS

// The two statements of the rule agree only while no channel name holds a dot:
// the type would keep `a.b` as one key where buildBridge() nests it. A channel
// with a dot fails to compile here.
type AssertNever<T extends never> = T
export type NoChannelHasADot = AssertNever<Extract<IpcChannel, `${string}.${string}`>>

export type BridgePath<C extends IpcChannel> = C extends keyof PathExceptions
  ? PathExceptions[C]
  : C extends `event:${infer Name}`
    ? `on${Capitalize<Name>}`
    : C extends `${infer Domain}:${infer Action}`
      ? `${Domain}.${Action}`
      : never

export type BridgeInvoke<C extends ContractedChannel> = (
  ...args: IpcInvokeContract[C]['args']
) => Promise<IpcInvokeContract[C]['result']>

// Subscribes to one main -> renderer event; the returned function unsubscribes.
export type BridgeSubscribe<C extends IpcEventChannel> = (
  callback: (payload: IpcEventContract[C]) => void
) => () => void

type BridgeNamespace = {
  [C in ContractedChannel]: BridgePath<C> extends `${infer Namespace}.${string}` ? Namespace : never
}[ContractedChannel]

export type BirdbrainAPI = {
  [N in BridgeNamespace]: {
    [
      C in ContractedChannel as BridgePath<C> extends `${N}.${infer Method}` ? Method : never
    ]: BridgeInvoke<C>
  }
} & {
  [
    C in ContractedChannel as BridgePath<C> extends `${string}.${string}` ? never : BridgePath<C>
  ]: BridgeInvoke<C>
} & {
  [C in IpcEventChannel as BridgePath<C>]: BridgeSubscribe<C>
}

export function bridgePath<C extends IpcChannel>(channel: C): BridgePath<C>
export function bridgePath(channel: IpcChannel): string {
  const exception = (BRIDGE_PATH_EXCEPTIONS as Partial<Record<IpcChannel, string>>)[channel]
  if (exception !== undefined) return exception
  const colon = channel.indexOf(':')
  const domain = channel.slice(0, colon)
  const name = channel.slice(colon + 1)
  if (domain === 'event') return `on${name.charAt(0).toUpperCase()}${name.slice(1)}`
  return `${domain}.${name}`
}

export function isEventChannel(channel: IpcChannel): channel is IpcEventChannel {
  return channel.startsWith('event:')
}

// Builds the bridge object: one leaf per channel in IPC_CHANNELS and nothing
// else, each made by the caller. The preload passes the two functions that
// reach ipcRenderer; a test passes stubs.
export function buildBridge(leaves: {
  invoke: <C extends ContractedChannel>(channel: C) => BridgeInvoke<C>
  subscribe: <C extends IpcEventChannel>(channel: C) => BridgeSubscribe<C>
}): BirdbrainAPI {
  const bridge: Record<string, unknown> = {}
  for (const channel of Object.values(IPC_CHANNELS)) {
    const leaf = isEventChannel(channel) ? leaves.subscribe(channel) : leaves.invoke(channel)
    const [first, method] = bridgePath(channel).split('.')
    if (method === undefined) {
      bridge[first] = leaf
    } else {
      const namespace = (bridge[first] ??= {}) as Record<string, unknown>
      namespace[method] = leaf
    }
  }
  return bridge as unknown as BirdbrainAPI
}
