import { describe, it, expect } from 'vitest'
import { normalizeResponseHeaders } from '../../extension/src/utils/headers'

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
