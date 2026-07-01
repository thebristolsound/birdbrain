import { describe, it, expect } from 'vitest'
import { lookupSnapshots, isPersistableSnapshot } from '@main/services/waybackMachine'

// Minimal fake fetch returning a Response-like object with a json() method.
function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => body
    }) as unknown as Response) as unknown as typeof fetch
}

const CDX_HEADER = ['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length']

describe('lookupSnapshots', () => {
  it('parses CDX rows into snapshots with ISO timestamps and snapshot URLs', async () => {
    const body = [
      CDX_HEADER,
      ['20200115120000', 'https://example.com/', '200', 'text/html', 'ABC', '1234']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T12:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0]).toMatchObject({
      timestamp: '2020-01-15T12:00:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
      originalUrl: 'https://example.com/',
      statusCode: 200,
      mimeType: 'text/html',
      digest: 'ABC'
    })
    expect(result.closestIndex).toBe(0)
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('selects the snapshot closest to the capture timestamp', async () => {
    const body = [
      CDX_HEADER,
      ['20180101000000', 'https://example.com/', '200', 'text/html', 'A', '1'],
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1'],
      ['20220101000000', 'https://example.com/', '200', 'text/html', 'C', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.closestIndex).toBe(1) // 2020-01-10 is nearest 2020-01-15
  })

  it('returns empty result with null closestIndex when CDX has no rows', async () => {
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
      fetchImpl: fakeFetch([])
    })
    expect(result.snapshots).toEqual([])
    expect(result.closestIndex).toBeNull()
  })

  it('throws a typed error when archive.org responds non-2xx', async () => {
    await expect(
      lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
        fetchImpl: fakeFetch(null, false, 503)
      })
    ).rejects.toThrow(/503/)
  })

  it('tolerates malformed rows by skipping them', async () => {
    const body = [
      CDX_HEADER,
      ['notadate', 'https://example.com/', '200', 'text/html', 'A', '1'],
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-10T00:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].digest).toBe('B')
  })

  it('returns null closestIndex when the capture timestamp is unparseable', async () => {
    const body = [
      CDX_HEADER,
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', 'not-a-date', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots).toHaveLength(1)
    expect(result.closestIndex).toBeNull()
  })

  it('re-sorts closest-ranked CDX rows into a chronological timeline', async () => {
    // The server may return rows ranked by proximity (sort=closest); the tab
    // presents a timeline, so snapshots come back ascending by time.
    const body = [
      CDX_HEADER,
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1'],
      ['20220101000000', 'https://example.com/', '200', 'text/html', 'C', '1'],
      ['20180101000000', 'https://example.com/', '200', 'text/html', 'A', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots.map((s) => s.digest)).toEqual(['A', 'B', 'C'])
    expect(result.closestIndex).toBe(1) // 2020-01-10 nearest 2020-01-15, index 1 after sort
  })

  it('requests closest-ranked exact matches from the CDX server', async () => {
    let requestedUrl = ''
    const fetchImpl = (async (input: string) => {
      requestedUrl = input
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => []
      } as unknown as Response
    }) as unknown as typeof fetch
    await lookupSnapshots('https://example.com/', '2020-01-15T12:00:00.000Z', { fetchImpl })
    expect(requestedUrl).toContain('sort=closest')
    expect(requestedUrl).toContain('matchType=exact')
    expect(requestedUrl).toContain('closest=20200115120000')
  })
})

describe('isPersistableSnapshot', () => {
  const valid = {
    timestamp: '2020-01-15T12:00:00.000Z',
    snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
    originalUrl: 'https://example.com/',
    statusCode: 200
  }

  it('accepts a well-formed, internally consistent snapshot', () => {
    expect(isPersistableSnapshot(valid, '2026-06-30T00:00:00.000Z')).toBe(true)
  })

  it('rejects a snapshotUrl that is not a web.archive.org replay URL', () => {
    expect(
      isPersistableSnapshot(
        { ...valid, snapshotUrl: 'https://evil.example/web/20200115120000/https://example.com/' },
        '2026-06-30T00:00:00.000Z'
      )
    ).toBe(false)
  })

  it('rejects when the embedded timestamp does not match the snapshot timestamp', () => {
    expect(
      isPersistableSnapshot(
        { ...valid, snapshotUrl: 'https://web.archive.org/web/20990101000000/https://example.com/' },
        '2026-06-30T00:00:00.000Z'
      )
    ).toBe(false)
  })

  it('rejects when the embedded original URL does not match originalUrl', () => {
    expect(
      isPersistableSnapshot(
        { ...valid, snapshotUrl: 'https://web.archive.org/web/20200115120000/https://other.example/' },
        '2026-06-30T00:00:00.000Z'
      )
    ).toBe(false)
  })

  it('rejects a non-ISO checkedAt', () => {
    expect(isPersistableSnapshot(valid, 'not-a-date')).toBe(false)
  })
})
