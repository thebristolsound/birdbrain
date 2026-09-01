// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { fakeBridge } from '../fakeBridge'
import { useTagFilters } from '@renderer/hooks/useTagFilters'
import { useAppStore } from '@renderer/stores/appStore'

beforeEach(() => {
  useAppStore.getState().clearTagFilters()
  useAppStore.getState().clearSelectorFilters()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useTagFilters (#918)', () => {
  it('clears the filter when no tag is active', () => {
    useAppStore.getState().setTagFilteredCaptureIds(['stale'])
    const capturesWithAnyTag = vi.fn(async () => [])
    fakeBridge({ tags: { capturesWithAnyTag } })

    renderHook(() => useTagFilters('case-1'))

    expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
    expect(capturesWithAnyTag).not.toHaveBeenCalled()
  })

  it('publishes the capture ids covered by the active tags', async () => {
    useAppStore.getState().addTagFilter('t1')
    useAppStore.getState().addTagFilter('t2')
    const capturesWithAnyTag = vi.fn(async () => ['c1', 'c2'])
    fakeBridge({ tags: { capturesWithAnyTag } })

    renderHook(() => useTagFilters('case-1'))

    await waitFor(() => expect(useAppStore.getState().tagFilteredCaptureIds).toEqual(['c1', 'c2']))
    expect(capturesWithAnyTag).toHaveBeenCalledWith('case-1', ['t1', 't2'])
  })

  it('asks for nothing without a case', () => {
    useAppStore.getState().addTagFilter('t1')
    const capturesWithAnyTag = vi.fn(async () => ['c1'])
    fakeBridge({ tags: { capturesWithAnyTag } })

    renderHook(() => useTagFilters(null))

    expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
    expect(capturesWithAnyTag).not.toHaveBeenCalled()
  })

  // Null rather than an empty list: an empty list would hide every capture and
  // read as "nothing carries this tag", which a failed lookup cannot claim.
  it('falls back to no filter when the lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAppStore.getState().addTagFilter('t1')
    useAppStore.getState().setTagFilteredCaptureIds(['stale'])
    fakeBridge({
      tags: { capturesWithAnyTag: vi.fn(async () => Promise.reject(new Error('boom'))) }
    })

    renderHook(() => useTagFilters('case-1'))

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
  })

  // The selector hook nulls its own slot on the same mount; the two must not
  // reach for each other's.
  it('leaves the selector slot untouched', async () => {
    useAppStore.getState().setFilteredCaptureIds(['sel-cap'])
    useAppStore.getState().addTagFilter('t1')
    fakeBridge({ tags: { capturesWithAnyTag: vi.fn(async () => ['c1']) } })

    renderHook(() => useTagFilters('case-1'))

    await waitFor(() => expect(useAppStore.getState().tagFilteredCaptureIds).toEqual(['c1']))
    expect(useAppStore.getState().filteredCaptureIds).toEqual(['sel-cap'])
  })
})
