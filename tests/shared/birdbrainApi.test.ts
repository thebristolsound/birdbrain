import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  BRIDGE_PATH_EXCEPTIONS,
  bridgePath,
  buildBridge,
  isEventChannel,
  type BirdbrainAPI,
  type BridgePath,
  type MisnamedChannel,
  type MisplacedPath
} from '@shared/birdbrainApi'
import {
  IPC_CHANNELS,
  type IpcChannel,
  type SelectorRematchedEvent,
  type SelfTestResult
} from '@shared/ipc'
import type { Capture, MhtmlPartsListing } from '@shared/types'

// The bridge's shape is one rule stated twice: BridgePath for the compiler and
// bridgePath() for the preload. The known answers in the first three tests are
// asserted both ways.

describe('bridgePath', () => {
  it('places an invoke channel at its domain and action', () => {
    expect(bridgePath('captures:listMhtmlParts')).toBe('captures.listMhtmlParts')
    expectTypeOf<BridgePath<'captures:listMhtmlParts'>>().toEqualTypeOf<'captures.listMhtmlParts'>()
  })

  it('places an event channel at the root, as on + its capitalised name', () => {
    expect(bridgePath('event:newCapture')).toBe('onNewCapture')
    expectTypeOf<BridgePath<'event:newCapture'>>().toEqualTypeOf<'onNewCapture'>()
  })

  it('places an excepted channel where the table says', () => {
    expect(bridgePath('extension:path')).toBe('extension.getPath')
    expect(bridgePath('export:generate')).toBe('export.generateReport')
    expect(bridgePath('diagnostics:recent')).toBe('diagnostics.recentEntries')
    expect(bridgePath('search:query')).toBe('search')
    expect(bridgePath('captures:testPipeline')).toBe('testPipeline')
    expect(bridgePath('captures:testHttp')).toBe('testHttp')
    expect(bridgePath('event:selector:rematched')).toBe('onSelectorRematched')
    expectTypeOf<BridgePath<'extension:path'>>().toEqualTypeOf<'extension.getPath'>()
    expectTypeOf<BridgePath<'export:generate'>>().toEqualTypeOf<'export.generateReport'>()
    expectTypeOf<BridgePath<'diagnostics:recent'>>().toEqualTypeOf<'diagnostics.recentEntries'>()
    expectTypeOf<BridgePath<'search:query'>>().toEqualTypeOf<'search'>()
    expectTypeOf<BridgePath<'captures:testPipeline'>>().toEqualTypeOf<'testPipeline'>()
    expectTypeOf<BridgePath<'captures:testHttp'>>().toEqualTypeOf<'testHttp'>()
    expectTypeOf<BridgePath<'event:selector:rematched'>>().toEqualTypeOf<'onSelectorRematched'>()
  })

  it('has exactly the seven exceptions the test above answers for', () => {
    expect(Object.keys(BRIDGE_PATH_EXCEPTIONS).sort()).toEqual([
      'captures:testHttp',
      'captures:testPipeline',
      'diagnostics:recent',
      'event:selector:rematched',
      'export:generate',
      'extension:path',
      'search:query'
    ])
  })

  it('gives every channel a path of its own', () => {
    const paths = Object.values(IPC_CHANNELS).map((channel) => bridgePath(channel))
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('BirdbrainAPI', () => {
  it('types a namespaced method by its contract entry', () => {
    expectTypeOf<BirdbrainAPI['captures']['listMhtmlParts']>().toEqualTypeOf<
      (captureId: string) => Promise<MhtmlPartsListing | null>
    >()
    expectTypeOf<BirdbrainAPI['extension']['getPath']>().toEqualTypeOf<() => Promise<string>>()
  })

  it('types a root-level method and an event subscription the same way', () => {
    expectTypeOf<BirdbrainAPI['search']>().toEqualTypeOf<
      (caseId: string, query: string) => Promise<Capture[]>
    >()
    expectTypeOf<BirdbrainAPI['testPipeline']>().toEqualTypeOf<() => Promise<SelfTestResult>>()
    expectTypeOf<BirdbrainAPI['onSelectorRematched']>().toEqualTypeOf<
      (callback: (payload: SelectorRematchedEvent) => void) => () => void
    >()
  })

  it('has no member at the path an exception moved a channel away from', () => {
    expectTypeOf<BirdbrainAPI['extension']>().not.toHaveProperty('path')
    expectTypeOf<BirdbrainAPI['export']>().not.toHaveProperty('generate')
    expectTypeOf<BirdbrainAPI['diagnostics']>().not.toHaveProperty('recent')
    expectTypeOf<BirdbrainAPI['captures']>().not.toHaveProperty('testPipeline')
    expectTypeOf<BirdbrainAPI['captures']>().not.toHaveProperty('testHttp')
    // `search` is a function at the root, so it holds no `query` method.
    expectTypeOf<BirdbrainAPI['search']>().not.toHaveProperty('query')
    expectTypeOf<BirdbrainAPI>().not.toHaveProperty('onSelector:rematched')
  })

  it('has no namespace for the event channels', () => {
    expectTypeOf<BirdbrainAPI>().not.toHaveProperty('event')
  })
})

// The compile-time guards fail the build when their union is not empty. These
// feed each clause a name or path it exists to reject.
describe('MisnamedChannel', () => {
  it('names a channel with no colon, or with a dot', () => {
    expectTypeOf<MisnamedChannel<'ping', 'ping', never>>().toEqualTypeOf<'ping'>()
    expectTypeOf<MisnamedChannel<'cases:a.b', 'cases:a.b', never>>().toEqualTypeOf<'cases:a.b'>()
  })

  it('names a channel whose prefix disagrees with the contract that holds it', () => {
    expectTypeOf<
      MisnamedChannel<'tabs:picked', never, 'tabs:picked'>
    >().toEqualTypeOf<'tabs:picked'>()
    expectTypeOf<MisnamedChannel<'event:run', 'event:run', never>>().toEqualTypeOf<'event:run'>()
  })

  it('names nothing when every channel fits', () => {
    expectTypeOf<
      MisnamedChannel<'cases:list' | 'event:run', 'cases:list', 'event:run'>
    >().toBeNever()
  })
})

describe('MisplacedPath', () => {
  it('names a path with two dots, and an event path under a namespace', () => {
    expectTypeOf<MisplacedPath<'a.b.c', never, 'a', never>>().toEqualTypeOf<'a.b.c'>()
    expectTypeOf<
      MisplacedPath<'tabs.onPicked', 'tabs.onPicked', never, never>
    >().toEqualTypeOf<'tabs.onPicked'>()
  })

  it('names a namespace that is also a root-level key', () => {
    expectTypeOf<
      MisplacedPath<'search' | 'search.suggest', never, 'search', 'search'>
    >().toEqualTypeOf<'search'>()
  })

  it('names nothing when every path fits', () => {
    expectTypeOf<
      MisplacedPath<'cases.list' | 'search' | 'onRun', 'onRun', 'cases', 'search' | 'onRun'>
    >().toBeNever()
  })
})

describe('buildBridge', () => {
  const tagged = (kind: string, channel: IpcChannel) => Object.assign(() => {}, { kind, channel })
  const bridge = buildBridge({
    invoke: (channel) => tagged('invoke', channel) as never,
    subscribe: (channel) => tagged('event', channel) as never
  }) as unknown as Record<string, unknown>

  const leafAt = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], bridge)

  it('puts one leaf for each channel at its bridge path, of the kind the channel is', () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      const leaf = leafAt(bridgePath(channel)) as { kind?: string; channel?: string } | undefined
      expect([leaf?.kind, leaf?.channel], channel).toEqual([
        isEventChannel(channel) ? 'event' : 'invoke',
        channel
      ])
    }
  })

  it('builds nothing but those leaves', () => {
    const leaves: unknown[] = []
    const walk = (node: Record<string, unknown>): void => {
      for (const value of Object.values(node)) {
        if (typeof value === 'function') leaves.push(value)
        else walk(value as Record<string, unknown>)
      }
    }
    walk(bridge)
    expect(leaves).toHaveLength(Object.values(IPC_CHANNELS).length)
  })
})
