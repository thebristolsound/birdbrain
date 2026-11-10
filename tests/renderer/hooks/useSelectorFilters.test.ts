// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const store = () => useAppStore.getState()

beforeEach(() => {
  store().clearSelectorFilters()
  store().clearTagFilters()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useSelectorFilters', () => {
  it('clears the filter when no selector is active', () => {
    store().setFilteredCaptureIds(['stale'])
    const matchingCaptures = vi.fn(async () => [])
    const list = vi.fn(async () => [])
    fakeBridge({ selectors: { matchingCaptures, list } })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    expect(store().filteredCaptureIds).toBeNull()
    expect(matchingCaptures).not.toHaveBeenCalled()
    // The selector list is only watched while a filter is active.
    expect(list).not.toHaveBeenCalled()
  })

  it('publishes the matching capture ids for the active selectors', async () => {
    store().addSelectorFilter('s1')
    const matchingCaptures = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({ selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }]) } })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1', 'c2']))
    expect(matchingCaptures).toHaveBeenCalledWith('case-1', ['s1'])
  })

  it('asks for nothing without a case', () => {
    store().addSelectorFilter('s1')
    const matchingCaptures = vi.fn(async () => ['c1'])
    fakeBridge({ selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }]) } })

    renderHook(() => useSelectorFilters(null), { wrapper: withClient(newClient()) })

    expect(store().filteredCaptureIds).toBeNull()
    expect(matchingCaptures).not.toHaveBeenCalled()
  })

  // A recapture, a selector edit or a rescan changes match membership without
  // touching the picked ids; the list under "1 selector filter" follows it
  // through the matching-captures key rather than waiting for a re-pick.
  it('re-resolves when the matching-captures key is invalidated', async () => {
    store().addSelectorFilter('s1')
    const matchingCaptures = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1', 'c2'])
      .mockResolvedValueOnce(['c1'])
    fakeBridge({ selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }]) } })
    const client = newClient()

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(client) })
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1', 'c2']))

    act(() => {
      void client.invalidateQueries({
        queryKey: queryKeys.selectorMatchingCapturesAll('case-1')
      })
    })

    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1']))
    expect(matchingCaptures).toHaveBeenCalledTimes(2)
  })

  // Fail closed while a newly picked selector set is unresolved: the strip
  // names the new filter immediately, so the previous intersection would
  // answer for the wrong selectors and null would show every capture.
  it('hides every capture until the query for a newly picked selector lands', async () => {
    store().addSelectorFilter('s1')
    let release: (ids: string[]) => void = () => {}
    const matchingCaptures = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1', 'c2'])
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            release = resolve
          })
      )
    fakeBridge({
      selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }, { id: 's2' }]) }
    })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1', 'c2']))

    act(() => store().addSelectorFilter('s2'))
    await waitFor(() => expect(store().filteredCaptureIds).toEqual([]))

    await act(async () => release(['c2']))
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c2']))
  })

  // A refetch of the same key keeps its data, so an invalidation must not blank
  // the list on its way to the same answer.
  it('keeps the resolved ids while the same selector set refetches', async () => {
    store().addSelectorFilter('s1')
    const matchingCaptures = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1'])
      .mockImplementationOnce(() => new Promise<string[]>(() => {}))
    fakeBridge({ selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }]) } })
    const client = newClient()

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(client) })
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1']))

    act(() => {
      void client.invalidateQueries({
        queryKey: queryKeys.selectorMatchingCapturesAll('case-1')
      })
    })

    await waitFor(() => expect(matchingCaptures).toHaveBeenCalledTimes(2))
    expect(store().filteredCaptureIds).toEqual(['c1'])
  })

  // Rewritten from the old fallback test, which pinned a null slot under a
  // live label: the list model reads null as "no selector filter" while the
  // strip and the Filter badge still count one, so every capture showed under
  // a claimed narrowing. Neither that nor an empty list is a claim a failed
  // lookup can make, so the filter is dropped and the operator told why.
  it('drops the filter and tells the operator when the lookup fails', async () => {
    store().addSelectorFilter('s1')
    store().setFilteredCaptureIds(['stale'])
    fakeBridge({
      selectors: {
        matchingCaptures: vi.fn(async () => Promise.reject(new Error('boom'))),
        list: vi.fn(async () => [{ id: 's1' }])
      }
    })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().activeSelectorFilters).toEqual([]))
    expect(store().filteredCaptureIds).toBeNull()
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.error).toHaveBeenCalledWith(
      "Couldn't apply the selector filter.",
      expect.objectContaining({ code: 'query.failed' })
    )
  })

  // The re-picked set's key still holds the cached failure while its retry is
  // in flight; reading that as a fresh failure would drop the filter again
  // the moment the operator re-picks it.
  it('keeps a re-picked selector while the retry of a failed lookup is in flight', async () => {
    store().addSelectorFilter('s1')
    let release: (ids: string[]) => void = () => {}
    const matchingCaptures = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1'])
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            release = resolve
          })
      )
    fakeBridge({ selectors: { matchingCaptures, list: vi.fn(async () => [{ id: 's1' }]) } })
    const client = newClient()

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(client) })
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1']))

    act(() => {
      void client.invalidateQueries({
        queryKey: queryKeys.selectorMatchingCapturesAll('case-1')
      })
    })
    await waitFor(() => expect(store().activeSelectorFilters).toEqual([]))
    expect(notify.error).toHaveBeenCalledTimes(1)

    act(() => store().addSelectorFilter('s1'))
    await waitFor(() => expect(matchingCaptures).toHaveBeenCalledTimes(3))
    expect(store().activeSelectorFilters).toEqual(['s1'])
    expect(notify.error).toHaveBeenCalledTimes(1)

    await act(async () => release(['c2']))
    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c2']))
    expect(store().activeSelectorFilters).toEqual(['s1'])
  })

  // After a delete the refreshed selector list no longer carries the id, so
  // nothing on screen names the filter for the operator to remove.
  it('drops an active selector the refreshed selector list no longer contains', async () => {
    store().addSelectorFilter('s1')
    store().addSelectorFilter('gone')
    fakeBridge({
      selectors: {
        matchingCaptures: vi.fn(async () => ['c1']),
        list: vi.fn(async () => [{ id: 's1' }])
      }
    })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().activeSelectorFilters).toEqual(['s1']))
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('keeps every active selector while the selector list has not loaded', async () => {
    store().addSelectorFilter('s1')
    fakeBridge({
      selectors: {
        matchingCaptures: vi.fn(async () => ['c1']),
        list: vi.fn(() => new Promise<never>(() => {}))
      }
    })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1']))
    expect(store().activeSelectorFilters).toEqual(['s1'])
  })

  // The tag hook nulls its own slot on the same mount; the two must not reach
  // for each other's.
  it('leaves the tag slot untouched', async () => {
    store().setTagFilteredCaptureIds(['tag-cap'])
    store().addSelectorFilter('s1')
    fakeBridge({
      selectors: {
        matchingCaptures: vi.fn(async () => ['c1']),
        list: vi.fn(async () => [{ id: 's1' }])
      }
    })

    renderHook(() => useSelectorFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().filteredCaptureIds).toEqual(['c1']))
    expect(store().tagFilteredCaptureIds).toEqual(['tag-cap'])
  })
})
