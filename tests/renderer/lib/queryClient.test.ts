import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@renderer/lib/notify', () => ({ notify: { error: vi.fn(), warn: vi.fn() } }))

import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { failureMessage, queryClient } from '@renderer/lib/queryClient'
import { notify } from '@renderer/lib/notify'
import { ContactStoppedError } from '@renderer/lib/vpnWarning'

describe('failureMessage', () => {
  it('uses the action from mutation meta', () => {
    expect(failureMessage({ options: { meta: { action: 'save note' } } })).toBe(
      "Couldn't save note."
    )
  })

  it('falls back to a generic message when meta is absent', () => {
    expect(failureMessage({ options: {} })).toBe('Something went wrong. Please try again.')
  })
})

// A paused call never settles, so each check races it against a short timer.
function settledOrPaused<T>(promise: Promise<T>): Promise<T | 'paused'> {
  return Promise.race([
    promise,
    new Promise<'paused'>((resolve) => setTimeout(() => resolve('paused'), 200))
  ])
}

describe('shared client while the network is down (#1665)', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
    queryClient.clear()
  })

  it('still runs a query', async () => {
    onlineManager.setOnline(false)
    const queryFn = vi.fn(async () => 'local row')

    const result = await settledOrPaused(
      queryClient.fetchQuery({ queryKey: ['offline-read'], queryFn })
    )

    expect(result).toBe('local row')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('still commits a mutation', async () => {
    onlineManager.setOnline(false)
    const mutationFn = vi.fn(async (title: string) => ({ title }))
    const observer = new MutationObserver(queryClient, { mutationFn })

    const result = await settledOrPaused(observer.mutate('Offline title'))

    expect(result).toEqual({ title: 'Offline title' })
    expect(mutationFn).toHaveBeenCalledTimes(1)
  })
})

// A contact the Operator stopped at the VPN warning sent nothing, so nothing failed.
describe('a contact stopped at the VPN warning', () => {
  afterEach(() => {
    queryClient.clear()
    vi.mocked(notify.error).mockClear()
  })

  it('does not toast a stopped mutation, and still toasts a failed one', async () => {
    const stopped = new MutationObserver(queryClient, {
      mutationFn: async () => {
        throw new ContactStoppedError()
      }
    })
    await stopped.mutate().catch(() => undefined)
    expect(notify.error).not.toHaveBeenCalled()

    const failed = new MutationObserver(queryClient, {
      mutationFn: async () => {
        throw new Error('disk full')
      }
    })
    await failed.mutate().catch(() => undefined)
    expect(notify.error).toHaveBeenCalledOnce()
  })
})
