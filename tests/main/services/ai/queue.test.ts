import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initQueue, enqueue, getQueueStatus, clearQueue, resetQueue } from '../../../../src/main/services/ai/queue'

describe('ai/queue', () => {
  beforeEach(() => {
    resetQueue()
  })

  it('processes jobs sequentially', async () => {
    const processed: string[] = []
    const processor = vi.fn(async (captureId: string) => {
      await new Promise((r) => setTimeout(r, 10))
      processed.push(captureId)
    })

    initQueue(processor)
    enqueue('cap-1')
    enqueue('cap-2')

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100))

    expect(processed).toEqual(['cap-1', 'cap-2'])
    expect(processor).toHaveBeenCalledTimes(2)
  })

  it('deduplicates pending jobs', async () => {
    const processor = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    initQueue(processor)
    enqueue('cap-1')
    enqueue('cap-1')
    enqueue('cap-1')

    await new Promise((r) => setTimeout(r, 200))

    expect(processor).toHaveBeenCalledTimes(1)
  })

  it('calls completion callback', async () => {
    const onComplete = vi.fn()
    const processor = vi.fn(async () => {})

    initQueue(processor, onComplete)
    enqueue('cap-1')

    await new Promise((r) => setTimeout(r, 50))

    expect(onComplete).toHaveBeenCalledWith('cap-1')
  })

  it('handles processor errors gracefully', async () => {
    const processor = vi.fn(async () => {
      throw new Error('fail')
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    initQueue(processor)
    enqueue('cap-1')
    enqueue('cap-2')

    await new Promise((r) => setTimeout(r, 100))

    // Both should have been attempted
    expect(processor).toHaveBeenCalledTimes(2)
    consoleSpy.mockRestore()
  })

  it('reports queue status', () => {
    initQueue(async () => {
      await new Promise((r) => setTimeout(r, 1000))
    })
    enqueue('cap-1')

    const status = getQueueStatus()
    // The first job starts immediately (running), no more pending
    expect(status.pending + status.running).toBeLessThanOrEqual(1)
  })
})
