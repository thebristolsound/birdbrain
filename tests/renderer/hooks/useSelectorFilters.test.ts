// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { fakeBridge } from '../fakeBridge'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { useAppStore } from '@renderer/stores/appStore'

beforeEach(() => {
  useAppStore.getState().clearSelectorFilters()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSelectorFilters', () => {
  it('clears the filter when no selector is active', async () => {
    useAppStore.getState().setFilteredCaptureIds(['stale'])
    const matchingCaptures = vi.fn(async () => [])
    fakeBridge({ selectors: { matchingCaptures } })

    renderHook(() => useSelectorFilters('case-1'))

    expect(useAppStore.getState().filteredCaptureIds).toBeNull()
    expect(matchingCaptures).not.toHaveBeenCalled()
  })

  it('publishes the matching capture ids for the active selectors', async () => {
    useAppStore.getState().addSelectorFilter('s1')
    const matchingCaptures = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({ selectors: { matchingCaptures } })

    renderHook(() => useSelectorFilters('case-1'))

    await waitFor(() => expect(useAppStore.getState().filteredCaptureIds).toEqual(['c1', 'c2']))
    expect(matchingCaptures).toHaveBeenCalledWith('case-1', ['s1'])
  })

  it('falls back to no filter when the lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAppStore.getState().addSelectorFilter('s1')
    fakeBridge({
      selectors: { matchingCaptures: vi.fn(async () => Promise.reject(new Error('boom'))) }
    })

    renderHook(() => useSelectorFilters('case-1'))

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(useAppStore.getState().filteredCaptureIds).toBeNull()
  })
})
