import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'crypto'

// The TSA request follows the Egress (ADR-0032): with no fetch injected it goes
// through egressFetch, which routes it through the proxy while the Egress is not
// Direct.
const { egressFetch } = vi.hoisted(() => ({
  egressFetch: vi.fn<typeof fetch>(
    async () => new Response('refused', { status: 502, statusText: 'Bad Gateway' })
  )
}))
vi.mock('@main/services/egress', () => ({ egressFetch }))

import { requestTimestamp } from '@main/services/timestamp'

describe('requestTimestamp and the Egress', () => {
  it('sends the query through egressFetch by default', async () => {
    const hash = createHash('sha256').update('routed').digest('hex')
    await expect(requestTimestamp(hash, 'http://tsa.example.com')).rejects.toThrow(
      'TSA responded 502 Bad Gateway'
    )
    expect(egressFetch).toHaveBeenCalledTimes(1)
    expect(egressFetch.mock.calls[0][0]).toBe('http://tsa.example.com')
  })

  it('uses an injected fetch instead when one is given', async () => {
    const injected = vi.fn(async () => new Response('no', { status: 500, statusText: 'Nope' }))
    const hash = createHash('sha256').update('injected').digest('hex')
    await expect(
      requestTimestamp(hash, 'http://tsa.example.com', injected as unknown as typeof fetch)
    ).rejects.toThrow('TSA responded 500 Nope')
    expect(injected).toHaveBeenCalledTimes(1)
  })
})
