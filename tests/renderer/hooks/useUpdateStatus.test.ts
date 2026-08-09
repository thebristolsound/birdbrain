// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { fakeBridge } from '../fakeBridge'
import { useUpdateStatus } from '@renderer/hooks/useUpdateStatus'

const idle = { state: 'idle', currentVersion: '1.0.0' }
const available = { state: 'available', currentVersion: '1.0.0', version: '1.1.0' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useUpdateStatus', () => {
  it('seeds from the mount snapshot', async () => {
    fakeBridge({ updates: { getStatus: vi.fn(async () => idle) } })

    const { result } = renderHook(() => useUpdateStatus())

    await waitFor(() => expect(result.current.status).toEqual(idle))
  })

  it('leaves the card usable when the snapshot fetch rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBridge({ updates: { getStatus: vi.fn(async () => Promise.reject(new Error('no ipc'))) } })

    const { result } = renderHook(() => useUpdateStatus())

    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(result.current.status).toBeNull()
  })

  it('folds a manual check result into the status', async () => {
    fakeBridge({
      updates: { getStatus: vi.fn(async () => idle), check: vi.fn(async () => available) }
    })

    const { result } = renderHook(() => useUpdateStatus())
    await waitFor(() => expect(result.current.status).toEqual(idle))

    await act(async () => {
      await result.current.check()
    })

    expect(result.current.status).toEqual(available)
  })

  it('swallows a rejected check rather than leaving the button stuck', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBridge({
      updates: {
        getStatus: vi.fn(async () => idle),
        check: vi.fn(async () => Promise.reject(new Error('offline')))
      }
    })

    const { result } = renderHook(() => useUpdateStatus())
    await act(async () => {
      await result.current.check()
    })

    expect(error).toHaveBeenCalled()
    expect(result.current.status).toEqual(idle)
  })

  // download/install only kick the main process — completion arrives on the
  // event channel, so neither writes status locally.
  it('kicks download and install and reports their failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const download = vi.fn(async () => undefined)
    const install = vi.fn(async () => Promise.reject(new Error('not staged')))
    fakeBridge({ updates: { getStatus: vi.fn(async () => idle), download, install } })

    const { result } = renderHook(() => useUpdateStatus())

    await act(async () => {
      await result.current.download()
      await result.current.install()
    })

    expect(download).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Failed to install update', expect.any(Error))
  })
})
