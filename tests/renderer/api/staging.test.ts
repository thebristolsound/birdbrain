// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { fakeBridge } from '../fakeBridge'
import { useStagingMutations } from '@renderer/lib/api/staging'
import { queryKeys } from '@renderer/lib/api/keys'

const notifyWarn = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: notifyWarn, success: vi.fn(), info: vi.fn() }
}))

afterEach(() => {
  cleanup()
  notifyWarn.mockReset()
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const { result } = renderHook(() => useStagingMutations('case1'), { wrapper })
  return { result, invalidate }
}

describe('useStagingMutations', () => {
  it('upload refreshes the inventory only when something landed', async () => {
    const upload = vi.fn(async (): Promise<Array<{ id: string }>> => [])
    fakeBridge({ staging: { upload } })
    const { result, invalidate } = setup()
    result.current.upload.mutate()
    await waitFor(() => expect(upload).toHaveBeenCalledWith('case1'))
    await waitFor(() => expect(result.current.upload.isSuccess).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()

    upload.mockResolvedValueOnce([{ id: 's1' }])
    result.current.upload.mutate()
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('case1') })
    )
  })

  it('commit refreshes the inventory and the manifest snapshot', async () => {
    const commit = vi.fn(async () => ({ outcomes: [] }))
    fakeBridge({ staging: { commit } })
    const { result, invalidate } = setup()
    result.current.commit.mutate(['s1', 's2'])
    await waitFor(() => expect(commit).toHaveBeenCalledWith('case1', ['s1', 's2']))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.manifestSnapshot('case1') })
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('case1') })
  })

  it('says a commit refused for want of an operator name was refused, once per batch (X47)', async () => {
    const commit = vi.fn(async () => ({
      outcomes: [
        { stagingId: 's1', status: 'refused', reason: 'operator_name_required' },
        { stagingId: 's2', status: 'refused', reason: 'operator_name_required' }
      ]
    }))
    fakeBridge({ staging: { commit } })
    const { result } = setup()
    result.current.commit.mutate(['s1', 's2'])
    await waitFor(() => expect(result.current.commit.isSuccess).toBe(true))
    expect(notifyWarn.mock.calls).toEqual([
      ['Set an operator name in Settings before committing a pooled file']
    ])
  })

  it('says nothing about a commit no operator check refused', async () => {
    const commit = vi.fn(async () => ({
      outcomes: [{ stagingId: 's1', status: 'refused', reason: 'changed' }]
    }))
    fakeBridge({ staging: { commit } })
    const { result } = setup()
    result.current.commit.mutate(['s1'])
    await waitFor(() => expect(result.current.commit.isSuccess).toBe(true))
    expect(notifyWarn).not.toHaveBeenCalled()
  })

  it('discard refreshes the inventory', async () => {
    const discard = vi.fn(async () => ({ discarded: ['s1'] }))
    fakeBridge({ staging: { discard } })
    const { result, invalidate } = setup()
    result.current.discard.mutate(['s1'])
    await waitFor(() => expect(discard).toHaveBeenCalledWith('case1', ['s1']))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.exhibitInventory('case1') })
    )
  })
})
