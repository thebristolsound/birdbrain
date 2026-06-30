import { describe, it, expect } from 'vitest'
import { lookupSnapshots } from '@main/services/waybackMachine'

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
})
