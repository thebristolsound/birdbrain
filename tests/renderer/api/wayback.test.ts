import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { waybackLinkLookupQueryOptions } from '@renderer/lib/api/wayback'

afterEach(() => {
  vi.useRealTimers()
})

// #1737, acceptance criterion 8: a link's answer lives in the query cache for five
// minutes, so asking again inside that time sends nothing to archive.org.
describe('waybackLinkLookupQueryOptions', () => {
  it('keeps an answer for five minutes, then asks archive.org again', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-26T12:00:00.000Z') })
    const lookupLink = vi.fn(async () => ({
      snapshots: [],
      closestIndex: null,
      checkedAt: '2026-10-26T12:00:00.000Z',
      countIsMinimum: false
    }))
    fakeBridge({ wayback: { lookupLink } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = waybackLinkLookupQueryOptions('cap1', 'https://a.example/1')

    await client.fetchQuery(options)
    expect(lookupLink).toHaveBeenCalledExactlyOnceWith({
      captureId: 'cap1',
      url: 'https://a.example/1'
    })

    vi.setSystemTime(Date.parse('2026-10-26T12:04:59.000Z'))
    await client.fetchQuery(options)
    expect(lookupLink).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.parse('2026-10-26T12:05:01.000Z'))
    await client.fetchQuery(options)
    expect(lookupLink).toHaveBeenCalledTimes(2)
  })

  it('keys an answer by the stored page and the address, and never fetches on its own', () => {
    const options = waybackLinkLookupQueryOptions('cap1', 'https://a.example/1')
    expect(options.queryKey).toEqual(['wayback', 'linkLookup', 'cap1', 'https://a.example/1'])
    expect(options.enabled).toBe(false)
  })
})
