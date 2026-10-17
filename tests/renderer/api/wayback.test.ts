import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import {
  waybackLinkLookupQueryOptions,
  waybackLookupQueryOptions
} from '@renderer/lib/api/wayback'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'

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

const SHOWN = { snapshots: [], closestIndex: null, checkedAt: '2026-10-17T09:00:00.000Z' }
const lookup = vi.fn(async () => ({ ...SHOWN, checkedAt: '2026-10-17T10:00:00.000Z' }))

function warning(warn: boolean) {
  return vi.fn(async () => ({ caseId: 'case-a', warn, canMute: true }))
}

// Runs the lookup and answers the warning, if one comes up, with `outcome`.
async function runLookup(client: QueryClient, outcome: 'continue' | 'dismiss') {
  const pending = client.fetchQuery({ ...waybackLookupQueryOptions('cap-1'), staleTime: 0 })
  if (outcome === 'dismiss') {
    await vi.waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    settleVpnWarning('dismiss')
  }
  return pending
}

describe('waybackLookupQueryOptions', () => {
  beforeEach(() => {
    lookup.mockClear()
    useVpnWarningStore.setState({ open: false, request: null, settle: null })
  })

  it("passes the VPN warning for the Capture's Case before asking archive.org", async () => {
    const checkVpnWarning = warning(false)
    fakeBridge({ wayback: { lookup }, egress: { checkVpnWarning } })

    const result = await runLookup(new QueryClient(), 'continue')
    expect(checkVpnWarning).toHaveBeenCalledWith({ captureId: 'cap-1' })
    expect(lookup).toHaveBeenCalledWith('cap-1')
    expect(result?.checkedAt).toBe('2026-10-17T10:00:00.000Z')
  })

  it('sends nothing when stopped at the warning, and keeps the result shown', async () => {
    fakeBridge({ wayback: { lookup }, egress: { checkVpnWarning: warning(true) } })
    const client = new QueryClient()

    expect(await runLookup(client, 'dismiss')).toBeNull()
    client.setQueryData(waybackLookupQueryOptions('cap-1').queryKey, SHOWN)
    expect(await runLookup(client, 'dismiss')).toEqual(SHOWN)
    expect(lookup).not.toHaveBeenCalled()
  })
})
