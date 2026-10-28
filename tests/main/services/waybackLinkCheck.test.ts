import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  egressRouteMatches,
  lookupLinkSnapshots,
  runLinkBatch,
  WAYBACK_LINK_BATCH_PAUSE_MS,
  type LinkBatchUpdate
} from '@main/services/waybackLinkCheck'

// #1737: the lookup for one link counts archive.org's rows on their way through, so the
// answer can say when its count of versions is only a minimum. Every response here is a
// fake; nothing contacts archive.org.

const PAGE_AT = '2026-08-01T12:00:00.000Z'
const HEADER = ['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length']

function row(i: number, digest: string): string[] {
  const ts = `202607${String(10 + (i % 18)).padStart(2, '0')}12${String(i % 60).padStart(2, '0')}00`
  return [ts, 'https://elsewhere.example/a', '200', 'text/html', digest, '100']
}

function cdx(rows: unknown[][]) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(rows.length ? [HEADER, ...rows] : []))
  )
}

function rows(n: number): string[][] {
  return Array.from({ length: n }, (_, i) => row(i, i % 2 ? 'B' : 'A'))
}

describe('lookupLinkSnapshots', () => {
  it('asks through the fetch it is given, for 20 rows of the link', async () => {
    const fetchImpl = cdx(rows(3))
    await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const asked = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(asked.searchParams.get('url')).toBe('https://elsewhere.example/a')
    expect(asked.searchParams.get('limit')).toBe('20')
    expect(asked.searchParams.get('closest')).toBe('20260801120000')
  })

  it('gives an exact count when fewer rows came back than were asked for', async () => {
    const answer = await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, cdx(rows(3)))
    expect(answer.snapshots).toHaveLength(3)
    expect(answer.countIsMinimum).toBe(false)
  })

  it('marks the count a minimum when the row limit was reached', async () => {
    const answer = await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, cdx(rows(20)))
    expect(answer.snapshots).toHaveLength(20)
    expect(answer.countIsMinimum).toBe(true)
  })

  it('keeps the count a minimum when a malformed row is dropped below the limit', async () => {
    const twenty = rows(20)
    twenty[5] = ['not-a-timestamp', 'https://elsewhere.example/a', '200', 'text/html', 'C', '1']
    const answer = await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, cdx(twenty))
    expect(answer.snapshots).toHaveLength(19)
    expect(answer.countIsMinimum).toBe(true)
  })

  it('marks the count a minimum when any row was dropped', async () => {
    const three = rows(3)
    three[1] = ['bad', '', '200', 'text/html', 'C', '1']
    const answer = await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, cdx(three))
    expect(answer.snapshots).toHaveLength(2)
    expect(answer.countIsMinimum).toBe(true)
  })

  it('answers an empty result exactly', async () => {
    const answer = await lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, cdx([]))
    expect(answer).toMatchObject({ snapshots: [], closestIndex: null, countIsMinimum: false })
  })

  it('fails with the status archive.org answered', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('busy', { status: 503, statusText: 'Service Unavailable' })
    ) as unknown as typeof fetch
    await expect(
      lookupLinkSnapshots('https://elsewhere.example/a', PAGE_AT, fetchImpl)
    ).rejects.toThrow('Wayback CDX responded 503 Service Unavailable')
  })
})

// #1738, plan S4: a batch of link lookups, one at a time, through a fake fetch.
describe('runLinkBatch', () => {
  const URLS = ['https://a.example/', 'https://b.example/', 'https://c.example/']

  afterEach(() => {
    vi.useRealTimers()
  })

  function asked(fetchImpl: { mock: { calls: unknown[][] } }): string[] {
    return fetchImpl.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('url')!)
  }

  function run(
    fetchImpl: typeof fetch,
    {
      urls = URLS,
      signal = new AbortController().signal,
      routeHolds = () => true,
      pauseMs = 0
    }: {
      urls?: string[]
      signal?: AbortSignal
      routeHolds?: () => boolean
      pauseMs?: number
    } = {}
  ) {
    const updates: LinkBatchUpdate[] = []
    const done = runLinkBatch({
      urls,
      pageCapturedAt: PAGE_AT,
      fetchImpl,
      signal,
      routeHolds,
      onUpdate: (update) => updates.push(update),
      pauseMs
    })
    return { done, updates }
  }

  const states = (updates: LinkBatchUpdate[]) => updates.map(({ url, state }) => `${state} ${url}`)

  it('waits 2 s between requests by default', () => {
    expect(WAYBACK_LINK_BATCH_PAUSE_MS).toBe(2_000)
  })

  it('sends one request at a time, in order, and answers each address', async () => {
    let inFlight = 0
    let most = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return new Response(JSON.stringify([HEADER, ...rows(2)]))
    })
    const { done, updates } = run(fetchImpl)
    expect(await done).toEqual({ answered: 3, failed: 0, notChecked: 0, stopped: null })
    expect(most).toBe(1)
    expect(asked(fetchImpl)).toEqual(URLS)
    expect(states(updates)).toEqual([
      'checking https://a.example/',
      'answered https://a.example/',
      'checking https://b.example/',
      'answered https://b.example/',
      'checking https://c.example/',
      'answered https://c.example/'
    ])
  })

  it('pauses the fixed time between requests, and not before the first', async () => {
    vi.useFakeTimers()
    const fetchImpl = cdx(rows(1))
    const { done } = run(fetchImpl, { pauseMs: 2_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect((await done).answered).toBe(3)
  })

  it.each([
    [429, 'Too Many Requests'],
    [503, 'Service Unavailable']
  ])('stops on %i, keeps the answers received and counts the rest', async (status, text) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([HEADER, ...rows(1)])))
      .mockResolvedValueOnce(new Response('slow down', { status, statusText: text }))
    const { done, updates } = run(fetchImpl)
    expect(await done).toEqual({
      answered: 1,
      failed: 0,
      notChecked: 2,
      stopped: 'rate-limited',
      status
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(states(updates)).toEqual([
      'checking https://a.example/',
      'answered https://a.example/',
      'checking https://b.example/',
      'not-checked https://b.example/'
    ])
    expect(updates[1]).toMatchObject({ result: { snapshots: [expect.any(Object)] } })
  })

  it('reports another failure on its address and goes on', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('gone', { status: 500, statusText: 'Server Error' }))
      .mockRejectedValueOnce(new Error('proxy refused the connection'))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
    const { done, updates } = run(fetchImpl)
    expect(await done).toEqual({ answered: 1, failed: 2, notChecked: 0, stopped: null })
    expect(updates.filter(({ state }) => state === 'failed')).toEqual([
      {
        url: 'https://a.example/',
        state: 'failed',
        error: 'Wayback CDX responded 500 Server Error'
      },
      { url: 'https://b.example/', state: 'failed', error: 'proxy refused the connection' }
    ])
  })

  it('stops before the next request on cancel, keeping the answer in flight', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort()
      return new Response(JSON.stringify([HEADER, ...rows(1)]))
    })
    const { done, updates } = run(fetchImpl, { signal: controller.signal })
    expect(await done).toEqual({ answered: 1, failed: 0, notChecked: 2, stopped: 'cancelled' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(updates.at(-1)).toMatchObject({ url: 'https://a.example/', state: 'answered' })
  })

  it('ends the pause at once on cancel', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchImpl = cdx(rows(1))
    const { done } = run(fetchImpl, { signal: controller.signal, pauseMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await done).toMatchObject({ answered: 1, notChecked: 2, stopped: 'cancelled' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends nothing more once the route no longer holds', async () => {
    let holds = true
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      holds = false
      return new Response(JSON.stringify([]))
    })
    const { done } = run(fetchImpl, { routeHolds: () => holds })
    expect(await done).toEqual({ answered: 1, failed: 0, notChecked: 2, stopped: 'route-changed' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends nothing at all when the route fails before the first request', async () => {
    const fetchImpl = cdx([])
    const { done, updates } = run(fetchImpl, { routeHolds: () => false })
    expect(await done).toMatchObject({ answered: 0, notChecked: 3, stopped: 'route-changed' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })
})

describe('egressRouteMatches', () => {
  const proxy = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Tunnel' } as const

  it.each([
    [{ kind: 'direct' }, { kind: 'direct' }, true],
    [proxy, proxy, true],
    [{ ...proxy, label: 'Renamed' }, proxy, true],
    [{ ...proxy, proxyUrl: 'socks5://127.0.0.1:9050' }, proxy, false],
    [{ ...proxy, kind: 'tor' }, proxy, false],
    [{ kind: 'direct' }, proxy, false],
    [proxy, { kind: 'direct' }, false],
    [{ kind: 'unavailable' }, { kind: 'direct' }, false]
  ] as const)('%j against the confirmed %j: %s', (current, confirmed, expected) => {
    expect(egressRouteMatches(current, confirmed)).toBe(expected)
  })
})
