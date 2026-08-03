import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'

// `contextBridge.exposeInMainWorld` is typed `any`, so nothing typechecks the
// preload object against BirdbrainAPI and the two can disagree indefinitely
// (#333: the wayback namespace stayed `archive` through the #256 rename and
// `window.birdbrain.wayback` was undefined at runtime). These tests close that
// gap from the runtime side: they load the real preload bundle against a stub
// `electron`, call every exposed leaf, and check the channel each one reaches
// against IPC_CHANNELS — the constant both sides are supposed to agree with.
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
          leaves.push({ path, channel: electronStub.invoked[invokedBefore], kind: 'invoke' })
        } else if (electronStub.listened.length > listenedBefore) {
          leaves.push({ path, channel: electronStub.listened[listenedBefore], kind: 'event' })
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

// `captures:testPipeline` and `captures:testHttp` are dev-diagnostic helpers
// that sit at the bridge root rather than under `captures`. Grandfathered, not
// endorsed — moving them is a renderer-wide rename, not this test's business.
const ROOT_LEVEL_INVOKES = new Set(['testPipeline', 'testHttp'])

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

  // The assertion #256 needed and nothing had: a channel's `domain:` segment is
  // also its namespace on the bridge, so renaming one side without the other
  // fails here instead of in the running app.
  it('names each namespace after the domain segment of its channels', () => {
    const mismatches = invokeLeaves
      .filter((leaf) => !ROOT_LEVEL_INVOKES.has(leaf.path))
      .filter((leaf) => leaf.path.split('.')[0] !== leaf.channel.split(':')[0])
      .map((leaf) => `birdbrain.${leaf.path} -> ${leaf.channel}`)
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
