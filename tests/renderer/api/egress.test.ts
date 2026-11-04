import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { VPN_STATUS_POLL_MS, vpnStatusQueryOptions } from '@renderer/lib/api/egress'
import { queryKeys } from '@renderer/lib/api/keys'

describe('vpnStatusQueryOptions', () => {
  it('reads the VPN check under its key, polling and on focus', async () => {
    const vpnStatus = vi.fn(async () => ({ vpnSeen: true }))
    fakeBridge({ egress: { vpnStatus } })

    expect(vpnStatusQueryOptions.queryKey).toEqual(queryKeys.vpnStatus)
    expect(vpnStatusQueryOptions.refetchInterval).toBe(VPN_STATUS_POLL_MS)
    expect(vpnStatusQueryOptions.refetchOnWindowFocus).toBe(true)
    await expect(vpnStatusQueryOptions.queryFn?.({} as never)).resolves.toEqual({ vpnSeen: true })
  })
})
