import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import {
  enqueueEventRecapture,
  recaptureQueueQueryOptions,
  testCaptureHttp,
  testCapturePipeline,
  useRecaptureMutations
} from '@renderer/lib/api/recapture'
import { queryKeys } from '@renderer/lib/api/keys'
import { ContactStoppedError, settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'

describe('recaptureQueueQueryOptions', () => {
  it('reads the queue under the shared key without a poll interval', async () => {
    const queueStatus = vi.fn(async () => ({ pending: 0, inFlight: 0 }))
    fakeBridge({ recapture: { queueStatus } })

    expect(recaptureQueueQueryOptions.queryKey).toEqual(queryKeys.recaptureQueue)
    // The popover owns the interval — polling a closed popover is what the
    // enabled/refetchInterval pair at the call site exists to prevent.
    expect(recaptureQueueQueryOptions).not.toHaveProperty('refetchInterval')
    await expect(recaptureQueueQueryOptions.queryFn?.({} as never)).resolves.toEqual({
      pending: 0,
      inFlight: 0
    })
  })
})

describe('pipeline self-tests', () => {
  it('returns the pipeline test result', async () => {
    const testPipeline = vi.fn(async () => ({ success: true, durationMs: 12 }))
    fakeBridge({ testPipeline })

    await expect(testCapturePipeline()).resolves.toEqual({ success: true, durationMs: 12 })
  })

  it('returns a failed http test with its error intact', async () => {
    const testHttp = vi.fn(async () => ({ success: false, durationMs: 0, error: 'ECONNREFUSED' }))
    fakeBridge({ testHttp })

    await expect(testCaptureHttp()).resolves.toEqual({
      success: false,
      durationMs: 0,
      error: 'ECONNREFUSED'
    })
  })
})

// Every enqueue contacts a site, so each passes the VPN warning first (ADR-0032).
describe('the VPN warning before a recapture', () => {
  const accepted = { accepted: 1, rejected: [] }

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return createElement(QueryClientProvider, { client }, children)
  }

  it("queues an event's recapture once the warning lets it through", async () => {
    const checkVpnWarning = vi.fn(async () => ({ caseId: 'case-a', warn: false, canMute: false }))
    const enqueueCaptures = vi.fn(async () => accepted)
    fakeBridge({ recapture: { enqueueCaptures }, egress: { checkVpnWarning } })

    await expect(enqueueEventRecapture('case-a', 'cap-1')).resolves.toEqual(accepted)
    expect(checkVpnWarning).toHaveBeenCalledWith({ caseId: 'case-a' })
    expect(enqueueCaptures).toHaveBeenCalledWith({ caseId: 'case-a', captureIds: ['cap-1'] })
  })

  it('queues nothing when the Operator stops at the warning', async () => {
    useVpnWarningStore.setState({ open: false, request: null, settle: null })
    const checkVpnWarning = vi.fn(async () => ({ caseId: 'case-a', warn: true, canMute: true }))
    const enqueue = vi.fn(async () => accepted)
    fakeBridge({ recapture: { enqueue }, egress: { checkVpnWarning } })
    const { result } = renderHook(() => useRecaptureMutations('case-a'), { wrapper })

    let outcome: unknown
    await act(async () => {
      const pending = result.current.enqueue
        .mutateAsync({ urls: ['https://example.com'] })
        .catch((err: unknown) => err)
      await vi.waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
      settleVpnWarning('set-up-proxy')
      outcome = await pending
    })
    expect(outcome).toBeInstanceOf(ContactStoppedError)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
