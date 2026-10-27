import { describe, it, expect, vi } from 'vitest'
import { lookupLinkSnapshots } from '@main/services/waybackLinkCheck'

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
