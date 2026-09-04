// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import { useTagFilters } from '@renderer/hooks/useTagFilters'
import { invalidateTagCounts } from '@renderer/lib/api/tags'
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
  store().clearTagFilters()
  store().clearSelectorFilters()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useTagFilters (#918)', () => {
  it('clears the filter when no tag is active', () => {
    store().setTagFilteredCaptureIds(['stale'])
    const capturesWithAnyTag = vi.fn(async () => [])
    const list = vi.fn(async () => [])
    fakeBridge({ tags: { capturesWithAnyTag, list } })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    expect(store().tagFilteredCaptureIds).toBeNull()
    expect(capturesWithAnyTag).not.toHaveBeenCalled()
    // The tag list is only watched while a filter is active.
    expect(list).not.toHaveBeenCalled()
  })

  it('publishes the capture ids covered by the active tags', async () => {
    store().addTagFilter('t1')
    store().addTagFilter('t2')
    const capturesWithAnyTag = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({
      tags: { capturesWithAnyTag, list: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]) }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1', 'c2']))
    expect(capturesWithAnyTag).toHaveBeenCalledWith('case-1', ['t1', 't2'])
  })

  it('asks for nothing without a case', () => {
    store().addTagFilter('t1')
    const capturesWithAnyTag = vi.fn(async () => ['c1'])
    fakeBridge({ tags: { capturesWithAnyTag, list: vi.fn(async () => [{ id: 't1' }]) } })

    renderHook(() => useTagFilters(null), { wrapper: withClient(newClient()) })

    expect(store().tagFilteredCaptureIds).toBeNull()
    expect(capturesWithAnyTag).not.toHaveBeenCalled()
  })

  // A membership write (tag editor, batch apply, extension attach) reaches the
  // filter through the same invalidation the count badges use, so the list
  // under "1 tag filter" follows the write rather than the last tag pick.
  it('re-resolves after a membership write invalidates the tag reads', async () => {
    store().addTagFilter('t1')
    const capturesWithAnyTag = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1'])
      .mockResolvedValueOnce(['c1', 'c2'])
    fakeBridge({ tags: { capturesWithAnyTag, list: vi.fn(async () => [{ id: 't1' }]) } })
    const client = newClient()

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(client) })
    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1']))

    act(() => invalidateTagCounts(client))

    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1', 'c2']))
    expect(capturesWithAnyTag).toHaveBeenCalledTimes(2)
  })

  // Fail closed while a newly picked tag set is unresolved: the strip names the
  // new filter immediately, so publishing the previous union would answer for
  // the wrong tags and publishing null would show every capture.
  it('hides every capture until the query for a newly picked tag lands', async () => {
    store().addTagFilter('t1')
    let release: (ids: string[]) => void = () => {}
    const capturesWithAnyTag = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1'])
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            release = resolve
          })
      )
    fakeBridge({
      tags: { capturesWithAnyTag, list: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]) }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })
    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1']))

    act(() => store().addTagFilter('t2'))
    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual([]))

    await act(async () => release(['c1', 'c2']))
    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1', 'c2']))
  })

  // A refetch of the same key keeps its data, so an invalidation must not blank
  // the list on its way to the same answer.
  it('keeps the resolved ids while the same tag set refetches', async () => {
    store().addTagFilter('t1')
    const capturesWithAnyTag = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['c1'])
      .mockImplementationOnce(() => new Promise<string[]>(() => {}))
    fakeBridge({ tags: { capturesWithAnyTag, list: vi.fn(async () => [{ id: 't1' }]) } })
    const client = newClient()

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(client) })
    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1']))

    act(() => invalidateTagCounts(client))

    await waitFor(() => expect(capturesWithAnyTag).toHaveBeenCalledTimes(2))
    expect(store().tagFilteredCaptureIds).toEqual(['c1'])
  })

  // Fail closed: neither hiding every capture nor showing every capture under a
  // strip that still says "1 tag filter" is a claim a failed lookup can make.
  it('drops the filter and tells the operator when the lookup fails', async () => {
    store().addTagFilter('t1')
    store().setTagFilteredCaptureIds(['stale'])
    fakeBridge({
      tags: {
        capturesWithAnyTag: vi.fn(async () => Promise.reject(new Error('boom'))),
        list: vi.fn(async () => [{ id: 't1' }])
      }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().activeTagFilters).toEqual([]))
    expect(store().tagFilteredCaptureIds).toBeNull()
    expect(notify.error).toHaveBeenCalledWith(
      "Couldn't apply the tag filter.",
      expect.objectContaining({ code: 'query.failed' })
    )
  })

  // After a delete or merge the refreshed tag list no longer carries the id,
  // so the Filter menu has no row left to untick; the hook unticks it.
  it('drops an active tag the refreshed tag list no longer contains', async () => {
    store().addTagFilter('t1')
    store().addTagFilter('gone')
    fakeBridge({
      tags: {
        capturesWithAnyTag: vi.fn(async () => ['c1']),
        list: vi.fn(async () => [{ id: 't1' }])
      }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().activeTagFilters).toEqual(['t1']))
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('keeps every active tag while the tag list has not loaded', async () => {
    store().addTagFilter('t1')
    fakeBridge({
      tags: {
        capturesWithAnyTag: vi.fn(async () => ['c1']),
        list: vi.fn(() => new Promise<never>(() => {}))
      }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1']))
    expect(store().activeTagFilters).toEqual(['t1'])
  })

  // The selector hook nulls its own slot on the same mount; the two must not
  // reach for each other's.
  it('leaves the selector slot untouched', async () => {
    store().setFilteredCaptureIds(['sel-cap'])
    store().addTagFilter('t1')
    fakeBridge({
      tags: { capturesWithAnyTag: vi.fn(async () => ['c1']), list: vi.fn(async () => [{ id: 't1' }]) }
    })

    renderHook(() => useTagFilters('case-1'), { wrapper: withClient(newClient()) })

    await waitFor(() => expect(store().tagFilteredCaptureIds).toEqual(['c1']))
    expect(store().filteredCaptureIds).toEqual(['sel-cap'])
  })
})
