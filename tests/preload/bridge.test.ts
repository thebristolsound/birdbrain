import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'

// BirdbrainAPI statically guards the bridge's shape and signatures. These tests
// provide the runtime complement: they load the real preload bundle against a
// stub electron, call every exposed leaf, and check both its full path and the
// channel it reaches against IPC_CHANNELS.
const electronStub = vi.hoisted(() => ({
  exposedKey: null as string | null,
  exposed: null as Record<string, unknown> | null,
  invoked: [] as string[],
  listened: [] as string[]
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld(key: string, api: Record<string, unknown>) {
      electronStub.exposedKey = key
      electronStub.exposed = api
    }
  },
  ipcRenderer: {
    invoke(channel: string) {
      electronStub.invoked.push(channel)
      // The bridge unwraps an { ok, data } envelope and throws without one.
      return Promise.resolve({ ok: true, data: null })
    },
    on(channel: string) {
      electronStub.listened.push(channel)
    },
    removeListener() {}
  }
}))

// Side-effect import: the bundle exposes its API at module load. Relative
// because src/preload has no path alias.
import '../../src/preload/index'

interface BridgeLeaf {
  /** Dotted path under `window.birdbrain`, e.g. `wayback.list`. */
  path: string
  /** Last segment of the path — the method name the renderer calls. */
  method: string
  channel: string
  kind: 'invoke' | 'event'
}

// Leaves that reached neither ipcRenderer.invoke nor ipcRenderer.on.
const strays: string[] = []

function probeBridge(api: Record<string, unknown>): BridgeLeaf[] {
  const leaves: BridgeLeaf[] = []

  const walk = (node: Record<string, unknown>, prefix: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key].join('.')
      if (typeof value === 'function') {
        const invokedBefore = electronStub.invoked.length
        const listenedBefore = electronStub.listened.length
        // Every leaf is either a bridge() (invokes) or a subscribe() (listens);
        // one no-op callback argument satisfies both shapes.
        const result = (value as (arg: unknown) => unknown)(() => {})
        // bridge() resolves through the envelope stub; swallow so a rejection
        // never escapes the probe.
        if (result instanceof Promise) result.catch(() => {})
        if (electronStub.invoked.length > invokedBefore) {
          const channel = electronStub.invoked[invokedBefore]
          leaves.push({ path, method: key, channel, kind: 'invoke' })
        } else if (electronStub.listened.length > listenedBefore) {
          const channel = electronStub.listened[listenedBefore]
          leaves.push({ path, method: key, channel, kind: 'event' })
        } else {
          strays.push(path)
        }
      } else if (value !== null && typeof value === 'object') {
        walk(value as Record<string, unknown>, [...prefix, key])
      } else {
        strays.push(path)
      }
    }
  }

  walk(api, [])
  return leaves
}

const exposed = electronStub.exposed ?? {}
const leaves = probeBridge(exposed)
const invokeLeaves = leaves.filter((leaf) => leaf.kind === 'invoke')
const eventLeaves = leaves.filter((leaf) => leaf.kind === 'event')

const allChannels = Object.values(IPC_CHANNELS)
const invokeChannels = allChannels.filter((channel) => !channel.startsWith('event:'))
const eventChannels = allChannels.filter((channel) => channel.startsWith('event:'))

// These leaves intentionally sit at the bridge root. Keeping the allowlist
// explicit makes any new root-level placement a reviewed contract decision.
const ROOT_LEVEL_LEAVES = new Set([
  'search',
  'testPipeline',
  'testHttp',
  'onExportProgress',
  'onArchiveProgress',
  'onNewCapture',
  'onSessionStateChanged',
  'onExtensionConnection',
  'onCaptureActivity',
  'onLogEntry',
  'onSelectorRematched',
  'onDeepLinkNavigate',
  'onUpdateStatus'
])

// Method names that predate the action-segment convention, keyed by the channel
// each one stands for. Keeping the channel as the key is the point: legitimising
// a rename means editing a line that names the channel it diverges from, which
// is reviewable, rather than silently renaming a key in the preload literal.
const METHOD_NAME_EXCEPTIONS: Record<string, string> = {
  'extension:path': 'getPath',
  'search:query': 'search',
  'export:generate': 'generateReport',
  'diagnostics:recent': 'recentEntries',
  // The only event channel with two colons, so `on` + PascalCase(action) does
  // not produce a legal identifier for it.
  'event:selector:rematched': 'onSelectorRematched'
}

// An invoke channel's action segment is its method name; an event channel's
// subscriber is `on` + the PascalCased action.
function expectedMethodName(channel: string, kind: 'invoke' | 'event'): string {
  const exception = METHOD_NAME_EXCEPTIONS[channel]
  if (exception !== undefined) return exception
  const action = channel.slice(channel.indexOf(':') + 1)
  if (kind === 'invoke') return action
  return `on${action.charAt(0).toUpperCase()}${action.slice(1)}`
}

function expectedBridgePath(leaf: BridgeLeaf): string {
  if (leaf.kind === 'event') return expectedMethodName(leaf.channel, leaf.kind)
  const domain = leaf.channel.slice(0, leaf.channel.indexOf(':'))
  return `${domain}.${expectedMethodName(leaf.channel, leaf.kind)}`
}

describe('preload bridge', () => {
  it('exposes the API as window.birdbrain', () => {
    expect(electronStub.exposedKey).toBe('birdbrain')
    expect(electronStub.exposed).not.toBeNull()
  })

  it('routes every exposed leaf to an IPC channel', () => {
    expect(strays).toEqual([])
  })

  it('exposes exactly the contracted invoke channels', () => {
    const reached = invokeLeaves.map((leaf) => leaf.channel).sort()
    expect(reached).toEqual([...invokeChannels].sort())
  })

  it('exposes exactly the main -> renderer event channels', () => {
    const reached = eventLeaves.map((leaf) => leaf.channel).sort()
    expect(reached).toEqual([...eventChannels].sort())
  })

  // A leaf's complete path is derived from its channel, so extra nesting and
  // moving an event under a namespace fail here as well as domain renames.
  it('places each leaf at the full bridge path derived from its channel', () => {
    const mismatches = leaves
      .filter((leaf) => !ROOT_LEVEL_LEAVES.has(leaf.path))
      .filter((leaf) => leaf.path !== expectedBridgePath(leaf))
      .map(
        (leaf) =>
          `birdbrain.${leaf.path} -> ${leaf.channel} ` +
          `(expected birdbrain.${expectedBridgePath(leaf)})`
      )
    expect(mismatches).toEqual([])
  })

  // Pinning the method name separately keeps failures local and readable when
  // the final path segment diverges from its channel's action.
  it('names each method after the action segment of its channel', () => {
    const mismatches = leaves
      .filter((leaf) => leaf.method !== expectedMethodName(leaf.channel, leaf.kind))
      .map(
        (leaf) =>
          `birdbrain.${leaf.path} -> ${leaf.channel} ` +
          `(expected ${expectedMethodName(leaf.channel, leaf.kind)})`
      )
    expect(mismatches).toEqual([])
  })

  // Known-answer test for the #333 regression itself.
  it('reaches the wayback channels through birdbrain.wayback', () => {
    const wayback = Object.fromEntries(
      invokeLeaves
        .filter((leaf) => leaf.channel.startsWith('wayback:'))
        .map((leaf) => [leaf.path, leaf.channel])
    )
    expect(wayback).toEqual({
      'wayback.lookup': 'wayback:lookup',
      'wayback.list': 'wayback:list',
      'wayback.pin': 'wayback:pin',
      'wayback.unpin': 'wayback:unpin'
    })
    expect(exposed).not.toHaveProperty('archive')
  })
})
