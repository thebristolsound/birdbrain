import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  recaptureQueueQueryOptions,
  testCaptureHttp,
  testCapturePipeline
} from '@renderer/lib/api/recapture'
import { queryKeys } from '@renderer/lib/api/keys'

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
