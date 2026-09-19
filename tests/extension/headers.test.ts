import { describe, it, expect } from 'vitest'
import {
  normalizeResponseHeaders,
  responseFactsForCapture
} from '../../extension/src/utils/headers'

describe('normalizeResponseHeaders (#119)', () => {
  it('returns an empty object for undefined', () => {
    expect(normalizeResponseHeaders(undefined)).toEqual({})
  })

  it('lowercases header keys', () => {
    expect(normalizeResponseHeaders([{ name: 'Content-Type', value: 'text/html' }])).toEqual({
      'content-type': 'text/html'
    })
  })

  it('joins repeated headers with ", " in order', () => {
    expect(
      normalizeResponseHeaders([
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'set-cookie', value: 'b=2' }
      ])
    ).toEqual({ 'set-cookie': 'a=1, b=2' })
  })

  it('treats a missing value as empty string', () => {
    expect(normalizeResponseHeaders([{ name: 'X-Empty' }])).toEqual({ 'x-empty': '' })
  })

  it('skips entries without a string name', () => {
    expect(
      normalizeResponseHeaders([
        { name: undefined as unknown as string, value: 'v' },
        { name: 'Server', value: 'nginx' }
      ])
    ).toEqual({ server: 'nginx' })
  })
})

describe('responseFactsForCapture (#797)', () => {
  const cached = {
    url: 'https://example.test/page',
    headers: { server: 'nginx' },
    status: 404
  }

  it('hands over the status and headers of the response being captured', () => {
    expect(responseFactsForCapture(cached, 'https://example.test/page')).toEqual({
      headers: { server: 'nginx' },
      httpStatus: 404
    })
  })

  it('hands over nothing when the tab has navigated since the response', () => {
    // Another page's status is worse than no status: the app anchors what it
    // is sent into the signed manifest entry.
    expect(responseFactsForCapture(cached, 'https://example.test/other')).toEqual({})
  })

  it('hands over nothing when no response was seen for the tab', () => {
    expect(responseFactsForCapture(undefined, 'https://example.test/page')).toEqual({})
  })

  it('omits each fact the cached response lacks, rather than inventing one', () => {
    expect(
      responseFactsForCapture(
        { url: 'https://example.test/page', headers: {} },
        'https://example.test/page'
      )
    ).toEqual({})
    expect(
      responseFactsForCapture(
        { url: 'https://example.test/page', headers: {}, status: 301 },
        'https://example.test/page'
      )
    ).toEqual({ httpStatus: 301 })
    expect(
      responseFactsForCapture(
        {
          url: 'https://example.test/page',
          headers: { server: 'nginx' },
          status: Number.NaN
        },
        'https://example.test/page'
      )
    ).toEqual({ headers: { server: 'nginx' } })
  })
})
