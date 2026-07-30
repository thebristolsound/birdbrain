// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCaptureThumbnail } from '@renderer/hooks/useCaptureThumbnail'
import { fakeBridge } from '../fakeBridge'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type GetThumbnail = (id: string) => Promise<string | null>

function setBirdbrain(getThumbnail: GetThumbnail): (id: string) => Promise<string | null> {
  const mock = vi.fn(getThumbnail)
  fakeBridge({ captures: { getThumbnail: mock } })
  return mock
}

function setThumbnailImpl(impl: GetThumbnail) {
  return setBirdbrain(impl)
}

describe('useCaptureThumbnail', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null and not-loading when captureId is null', () => {
    const getThumbnailMock = setThumbnailImpl(async () => 'unused')
    const { result } = renderHook(() => useCaptureThumbnail(null))
    expect(result.current).toEqual({ thumbnail: null, loading: false })
    expect(getThumbnailMock).not.toHaveBeenCalled()
  })

  it('loads and base64-decorates the thumbnail for a captureId', async () => {
    setThumbnailImpl(async () => 'AAAA')
    const { result } = renderHook(() => useCaptureThumbnail('cap-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.thumbnail).toBe('data:image/jpeg;base64,AAAA')
  })

  it('keeps thumbnail null when the IPC returns no data', async () => {
    setThumbnailImpl(async () => null)
    const { result } = renderHook(() => useCaptureThumbnail('cap-2'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.thumbnail).toBeNull()
  })

  it('logs and stops loading when the IPC rejects', async () => {
    setThumbnailImpl(async () => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useCaptureThumbnail('cap-3'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.thumbnail).toBeNull()
    expect(console.error).toHaveBeenCalledWith('Failed to load thumbnail:', expect.any(Error))
  })

  it('ignores a resolution that arrives after the captureId changed', async () => {
    const first = deferred<string | null>()
    const getThumbnail = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('SECOND')
    fakeBridge({ captures: { getThumbnail } })

    const { result, rerender } = renderHook(({ id }) => useCaptureThumbnail(id), {
      initialProps: { id: 'cap-a' }
    })

    // Switch to a new capture before the first request resolves.
    rerender({ id: 'cap-b' })
    await waitFor(() => expect(result.current.thumbnail).toBe('data:image/jpeg;base64,SECOND'))

    // Now the stale first request resolves — it must be ignored.
    await act(async () => {
      first.resolve('FIRST')
      await first.promise
    })
    expect(result.current.thumbnail).toBe('data:image/jpeg;base64,SECOND')
  })

  it('resets to null/false when captureId transitions to null', async () => {
    setThumbnailImpl(async () => 'AAAA')
    const { result, rerender } = renderHook(({ id }) => useCaptureThumbnail(id), {
      initialProps: { id: 'cap-1' as string | null }
    })
    await waitFor(() => expect(result.current.thumbnail).toBe('data:image/jpeg;base64,AAAA'))

    rerender({ id: null })
    expect(result.current).toEqual({ thumbnail: null, loading: false })
  })
})
