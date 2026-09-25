// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useSearch } from '@renderer/hooks/useSearch'
import { fakeBridge } from '../fakeBridge'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const CASE_ID = 'case-1'

describe('useSearch', () => {
  let searchMock: ReturnType<typeof vi.fn>
  let notesSearchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    searchMock = vi.fn(async (caseId: string, q: string) => [{ id: 'r1', caseId, query: q }])
    notesSearchMock = vi.fn(async (caseId: string, q: string) => [
      { id: 'n1', caseId, title: q, body: 'note body' }
    ])
    fakeBridge({ search: searchMock, notes: { search: notesSearchMock } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with empty results and does not query for an empty term', () => {
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })
    expect(result.current.results).toEqual([])
    expect(result.current.noteResults).toEqual([])
    expect(result.current.searching).toBe(false)
    expect(searchMock).not.toHaveBeenCalled()
    expect(notesSearchMock).not.toHaveBeenCalled()
  })

  it('runs case-scoped capture and note queries after search()', async () => {
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })

    act(() => {
      result.current.search('hello')
    })

    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(searchMock).toHaveBeenCalledWith(CASE_ID, 'hello')
    expect(result.current.results[0]).toMatchObject({ query: 'hello' })

    await waitFor(() => expect(result.current.noteResults).toHaveLength(1))
    expect(notesSearchMock).toHaveBeenCalledWith(CASE_ID, 'hello')
  })

  it('trims whitespace off the search term', async () => {
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })

    act(() => {
      result.current.search('  spaced  ')
    })

    await waitFor(() => expect(searchMock).toHaveBeenCalledWith(CASE_ID, 'spaced'))
  })

  it('does not query when the trimmed term is empty', () => {
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })
    act(() => {
      result.current.search('   ')
    })
    expect(searchMock).not.toHaveBeenCalled()
    expect(notesSearchMock).not.toHaveBeenCalled()
    expect(result.current.results).toEqual([])
  })

  it('reports a failed search separately from an empty one', async () => {
    searchMock.mockRejectedValueOnce(new Error('Search could not run'))
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })
    expect(result.current.failed).toBe(false)

    act(() => {
      result.current.search('example.com')
    })

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.results).toEqual([])
  })

  it('clear() resets the query so results return to empty', async () => {
    const { result } = renderHook(() => useSearch(CASE_ID), { wrapper: withClient(newClient()) })

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
