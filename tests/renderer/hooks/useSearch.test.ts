// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useSearch } from '@renderer/hooks/useSearch'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useSearch', () => {
  let searchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    searchMock = vi.fn(async (q: string) => [{ id: 'r1', query: q }])
    ;(window as unknown as { birdbrain: unknown }).birdbrain = { search: searchMock }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with empty results and does not query for an empty term', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: withClient(newClient()) })
    expect(result.current.results).toEqual([])
    expect(result.current.searching).toBe(false)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('runs the query and exposes results after search()', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper: withClient(newClient()) })

    act(() => {
      result.current.search('hello')
    })

    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(searchMock).toHaveBeenCalledWith('hello')
    expect(result.current.results[0]).toMatchObject({ query: 'hello' })
  })

  it('trims whitespace off the search term', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper: withClient(newClient()) })

    act(() => {
      result.current.search('  spaced  ')
    })

    await waitFor(() => expect(searchMock).toHaveBeenCalledWith('spaced'))
  })

  it('does not query when the trimmed term is empty', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: withClient(newClient()) })
    act(() => {
      result.current.search('   ')
    })
    expect(searchMock).not.toHaveBeenCalled()
    expect(result.current.results).toEqual([])
  })

  it('clear() resets the query so results return to empty', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper: withClient(newClient()) })

    act(() => {
      result.current.search('hello')
    })
    await waitFor(() => expect(result.current.results).toHaveLength(1))

    act(() => {
      result.current.clear()
    })
    await waitFor(() => expect(result.current.results).toEqual([]))
  })
})
