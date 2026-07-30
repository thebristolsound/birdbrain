// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCaptureTagEditor } from '@renderer/components/captures/useCaptureTagEditor'
import { fakeBridge } from '../renderer/fakeBridge'

const captureId = 'cap-1'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useCaptureTagEditor', () => {
  beforeEach(() => {
    fakeBridge({
      tags: {
        list: vi.fn().mockResolvedValue([
          { id: 't1', name: 'foo', color: '#fff' },
          { id: 't2', name: 'bar', color: '#000' }
        ]),
        getForCapture: vi.fn().mockResolvedValue([{ id: 't1', name: 'foo', color: '#fff' }]),
        addToCapture: vi.fn().mockResolvedValue(undefined),
        removeFromCapture: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 't3', name: 'new', color: '#abc' })
      }
    })
  })

  it('loads tags + capture tags', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.allTags.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(result.current.tags.map((t) => t.id)).toEqual(['t1'])
  })

  it('toggleTag adds when missing, removes when present', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.toggleTag('t2')
    })
    expect(window.birdbrain.tags.addToCapture).toHaveBeenCalledWith({ captureId, tagId: 't2' })

    await act(async () => {
      await result.current.toggleTag('t1')
    })
    expect(window.birdbrain.tags.removeFromCapture).toHaveBeenCalledWith({
      captureId,
      tagId: 't1'
    })
  })

  it('createTag invokes tags.create with provided name + color', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.createTag('new', '#abc')
    })
    expect(window.birdbrain.tags.create).toHaveBeenCalledWith({ name: 'new', color: '#abc' })
  })
})
