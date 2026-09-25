// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the router module so we don't pull in the full route tree, and so we can
// assert navigation intent and control the current pathname. vi.hoisted keeps
// these refs available inside the hoisted vi.mock factory.
const { navigate, routerState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerState: { location: { pathname: '/' } }
}))
vi.mock('@renderer/router', () => ({
  router: {
    navigate,
    get state() {
      return routerState
    }
  }
}))

import { useServerStatus } from '@renderer/hooks/useServerStatus'
import { useAppStore } from '@renderer/stores/appStore'
import { queryClient } from '@renderer/lib/queryClient'
import { queryKeys } from '@renderer/lib/queries'
import type { Capture } from '@shared/types'
import type { DeepLinkTarget, ExtensionAttachEvent } from '@shared/ipc'
import { fakeBridge } from '../fakeBridge'

// Registry of the callbacks the hook subscribes with, keyed by channel.
type Handlers = {
  extension?: (p: { connected: boolean }) => void
  session?: (s: { sessionActive: boolean; activeCaseId?: string | null }) => void
  capture?: (e: unknown) => void
  newCapture?: (c: Capture) => void
  extensionAttach?: (e: ExtensionAttachEvent) => void
  selectorRematched?: (p: { caseId: string }) => void
  deepLink?: (t: DeepLinkTarget) => void
}

function installBirdbrain(handlers: Handlers, unsubs: Record<string, ReturnType<typeof vi.fn>>) {
  const register = (key: keyof Handlers, unsubKey: string) => (cb: unknown) => {
    handlers[key] = cb as never
    unsubs[unsubKey] = unsubs[unsubKey] ?? vi.fn()
    return unsubs[unsubKey]
  }
  fakeBridge({
    onExtensionConnection: register('extension', 'extension'),
    onSessionStateChanged: register('session', 'session'),
    onCaptureActivity: register('capture', 'capture'),
    onNewCapture: register('newCapture', 'newCapture'),
    onExtensionAttach: register('extensionAttach', 'extensionAttach'),
    onSelectorRematched: register('selectorRematched', 'selectorRematched'),
    onDeepLinkNavigate: register('deepLink', 'deepLink')
  })
}

function makeCapture(caseId: string, id: string): Capture {
  return {
    id,
    caseId,
    url: 'https://example.test',
    title: 'Example',
    hash: 'a'.repeat(64),
    timestamp: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension'
  } satisfies Capture
}

describe('useServerStatus', () => {
  let handlers: Handlers
  let unsubs: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    handlers = {}
    unsubs = {}
    navigate.mockClear()
    routerState.location.pathname = '/'
    installBirdbrain(handlers, unsubs)
    // Reset shared store state used across assertions.
    useAppStore.getState().setConnectedToExtension(false)
    useAppStore.getState().setSessionActive(false)
    queryClient.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens and selects the exact capture requested by a card', async () => {
    navigate.mockResolvedValueOnce(undefined)
    renderHook(() => useServerStatus())
    await act(async () => handlers.deepLink?.({ caseId: 'case-4', captureId: 'cap-9' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-4' },
      search: { captureId: 'cap-9' }
    })
    expect(useAppStore.getState().selectedCaptureId).toBe('cap-9')
  })

  it('mirrors extension connection state into the store', () => {
    renderHook(() => useServerStatus())
    act(() => handlers.extension?.({ connected: true }))
    expect(useAppStore.getState().connectedToExtension).toBe(true)
    act(() => handlers.extension?.({ connected: false }))
    expect(useAppStore.getState().connectedToExtension).toBe(false)
  })

  it('updates session active state and appends capture activity', () => {
    renderHook(() => useServerStatus())
    act(() => handlers.session?.({ sessionActive: true }))
    expect(useAppStore.getState().sessionActive).toBe(true)

    const before = useAppStore.getState().captureEvents.length
    act(() => handlers.capture?.({ type: 'success', url: 'https://x.test' }))
    expect(useAppStore.getState().captureEvents.length).toBe(before + 1)
  })

  it('navigates to the active case when not already viewing it', () => {
    renderHook(() => useServerStatus())
    act(() => handlers.session?.({ sessionActive: true, activeCaseId: 'case-9' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId',
      params: { caseId: 'case-9' }
    })
  })

  it('does not navigate when already on that case', () => {
    routerState.location.pathname = '/cases/case-9/captures'
    renderHook(() => useServerStatus())
    act(() => handlers.session?.({ sessionActive: true, activeCaseId: 'case-9' }))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('prepends a new capture into the cache and invalidates counts', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(queryKeys.captures('case-1'), [makeCapture('case-1', 'old')])

    renderHook(() => useServerStatus())
    act(() => handlers.newCapture?.(makeCapture('case-1', 'new')))

    const list = queryClient.getQueryData<Capture[]>(queryKeys.captures('case-1'))
    expect(list?.map((c) => c.id)).toEqual(['new', 'old'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captureCounts })
    // The dashboard feed does not remount while it is being looked at (#403).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.recentActivityAll })
    // An open Data screen refetches its inventory and ledger (#1552).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('case-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('case-1') })
  })

  it('seeds a fresh list when no captures were cached', () => {
    renderHook(() => useServerStatus())
    act(() => handlers.newCapture?.(makeCapture('case-2', 'first')))
    const list = queryClient.getQueryData<Capture[]>(queryKeys.captures('case-2'))
    expect(list?.map((c) => c.id)).toEqual(['first'])
  })

  // #852: the extension attach routes bypass the mutation hooks, so this
  // listener is the only thing that refetches the case an operator is looking
  // at. Both assertions name the keys the corresponding mutations invalidate.
  it('invalidates tag caches when the extension applies a tag', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useServerStatus())
    act(() => handlers.extensionAttach?.({ kind: 'tag', caseId: 'case-4', captureId: 'cap-4' }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tags })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tagsForCapture('cap-4') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tags', 'usageCounts'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tags', 'caseCount'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tags', 'captureMatrix'] })
    // A tag apply changes no note, and refetching the notes views on it would
    // hide a real drift behind a refetch that happens to succeed.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.notes('case-4') })
  })

  it('invalidates note caches when the extension creates a note', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useServerStatus())
    act(() => handlers.extensionAttach?.({ kind: 'note', caseId: 'case-5', captureId: 'cap-5' }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.notes('case-5') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.noteCount('case-5') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notes', 'search', 'case-5'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.noteReferenceEdges('case-5') })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.tagsForCapture('cap-5') })
  })

  // The listener refetches; it never writes what the event said into the cache.
  // A displayed Tag or Note therefore comes from the database, not from this
  // event's account of the write.
  it('does not seed any cache from the attach payload', () => {
    queryClient.setQueryData(queryKeys.notes('case-6'), [])
    renderHook(() => useServerStatus())
    act(() => handlers.extensionAttach?.({ kind: 'note', caseId: 'case-6', captureId: 'cap-6' }))
    expect(queryClient.getQueryData(queryKeys.notes('case-6'))).toEqual([])
  })

  it('invalidates selector caches on rematch', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useServerStatus())
    act(() => handlers.selectorRematched?.({ caseId: 'case-3' }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.selectorMatchCounts('case-3')
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.selectorCoverage('case-3')
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.selectorMatchingCapturesAll('case-3')
    })
    // The matrix backs the coverage strip and the Signals rail's "Appears in"
    // list; without it those showed pre-rescan membership beside a moved count.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.selectorCaptureMatrix('case-3')
    })
  })

  it('routes deep links to settings or dashboard', () => {
    renderHook(() => useServerStatus())
    act(() => handlers.deepLink?.('settings'))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
    act(() => handlers.deepLink?.('dashboard'))
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('unsubscribes every channel on unmount', () => {
    const { unmount } = renderHook(() => useServerStatus())
    unmount()
    for (const fn of Object.values(unsubs)) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(Object.keys(unsubs)).toHaveLength(7)
  })
})
