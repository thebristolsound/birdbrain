import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { notify } from '@renderer/lib/notify'
import { correctableMessage, failureMessage, queryClient } from '@renderer/lib/queryClient'

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

function taken(): Error {
  return Object.assign(new Error('A tag named ‘malware’ already exists'), {
    code: 'TAG_NAME_TAKEN'
  })
}

describe('correctableMessage', () => {
  it("returns main's message for a taken tag name", () => {
    expect(correctableMessage(taken())).toBe('A tag named ‘malware’ already exists')
  })

  it('returns null for any other failure, constraint codes included', () => {
    const unique = Object.assign(new Error('A record with that value already exists'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE'
    })
    expect(correctableMessage(unique)).toBeNull()
    expect(correctableMessage(new Error('gone'))).toBeNull()
    expect(correctableMessage({ code: 'TAG_NAME_TAKEN', message: 'not an Error' })).toBeNull()
  })
})

// #811: a stale tag list lets a taken name reach main; the operator reads
// main's refusal, not the could-not-create toast with its bug-report action.
describe('shared client on a failed mutation', () => {
  afterEach(() => {
    vi.mocked(notify.info).mockClear()
    vi.mocked(notify.error).mockClear()
    queryClient.clear()
  })

  it("shows main's TAG_NAME_TAKEN refusal as an info toast", async () => {
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => {
        throw taken()
      },
      meta: { action: 'create tag' }
    })

    await expect(observer.mutate()).rejects.toThrow('already exists')

    expect(notify.info).toHaveBeenCalledWith('A tag named ‘malware’ already exists')
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('reports any other failure with the action from meta', async () => {
    const cause = new Error('gone')
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => {
        throw cause
      },
      meta: { action: 'create tag' }
    })

    await expect(observer.mutate()).rejects.toThrow('gone')

    expect(notify.error).toHaveBeenCalledWith("Couldn't create tag.", {
      code: 'mutation.failed',
      cause
    })
    expect(notify.info).not.toHaveBeenCalled()
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
