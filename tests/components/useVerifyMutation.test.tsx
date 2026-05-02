// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useVerifyMutation } from '@renderer/components/captures/useVerifyMutation'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useVerifyMutation', () => {
  it('shares pending state across observers for the same capture', async () => {
    const verifyResult = deferred<{
      status: 'verified'
      computedHash: string
      verifiedAt: string
    }>()

    ;(
      window as unknown as {
        birdbrain: { captures: { verify: ReturnType<typeof vi.fn> } }
      }
    ).birdbrain = {
      captures: {
        verify: vi.fn().mockImplementation(() => verifyResult.promise)
      }
    }

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })

    const { result } = renderHook(
      () => ({
        first: useVerifyMutation('capture-1', 'case-1'),
        second: useVerifyMutation('capture-1', 'case-1')
      }),
      {
        wrapper: withClient(client)
      }
    )

    act(() => {
      result.current.first.verify()
    })

    await waitFor(() => {
      expect(result.current.first.isPending).toBe(true)
      expect(result.current.second.isPending).toBe(true)
    })

    await act(async () => {
      verifyResult.resolve({
        status: 'verified',
        computedHash: 'abc123',
        verifiedAt: '2026-05-02T00:00:00.000Z'
      })
      await verifyResult.promise
    })

    await waitFor(() => {
      expect(result.current.first.isPending).toBe(false)
      expect(result.current.second.isPending).toBe(false)
    })
  })
})
