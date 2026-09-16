// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import {
  exhibitInventoryQueryOptions,
  manifestSnapshotQueryOptions,
  useExhibitsMutations
} from '@renderer/lib/api/exhibits'
import { queryKeys } from '@renderer/lib/api/keys'

afterEach(() => cleanup())

describe('exhibit query options', () => {
  it('read the inventory and the snapshot through the bridge, keyed per case', async () => {
    const inventory = vi.fn(async () => ({ caseId: 'case1', rows: [] }))
    const snapshot = vi.fn(async () => ({
      caseId: 'case1',
      entries: [],
      chain: { valid: true },
      signers: [],
      head: null
    }))
    fakeBridge({ exhibits: { inventory }, manifest: { snapshot } })

    const inv = exhibitInventoryQueryOptions('case1')
    expect(inv.queryKey).toEqual(queryKeys.exhibitInventory('case1'))
    await expect((inv.queryFn as () => Promise<unknown>)()).resolves.toEqual({
      caseId: 'case1',
      rows: []
    })
    expect(inventory).toHaveBeenCalledWith('case1')

    const snap = manifestSnapshotQueryOptions('case1')
    expect(snap.queryKey).toEqual(queryKeys.manifestSnapshot('case1'))
    await (snap.queryFn as () => Promise<unknown>)()
    expect(snapshot).toHaveBeenCalledWith('case1')
  })

  it('are disabled without a case id', () => {
    expect(exhibitInventoryQueryOptions('').enabled).toBe(false)
    expect(manifestSnapshotQueryOptions('').enabled).toBe(false)
  })
})

describe('useExhibitsMutations', () => {
  it('verify writes the result into the per-Exhibit slot and invalidates captures and inventory', async () => {
    const result = { exhibitId: 'ex1', caseId: 'case1', kind: 'capture', status: 'verified' }
    const verify = vi.fn(async () => result)
    fakeBridge({ exhibits: { verify } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { result: hook } = renderHook(() => useExhibitsMutations('case1'), { wrapper })
    hook.current.verify.mutate('ex1')

    await waitFor(() => expect(verify).toHaveBeenCalledWith('case1', 'ex1'))
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.exhibitVerification('case1', 'ex1'))).toEqual(result)
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.captures('case1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('case1') })
  })
})
