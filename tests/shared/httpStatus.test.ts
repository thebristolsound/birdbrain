import { describe, it, expect } from 'vitest'
import { recordedHttpStatus } from '@shared/httpStatus'

// One derivation feeds three consumers (R7, #797): the signed manifest entry,
// report.html and the PDF cover. What this function rejects is therefore both
// unanchored and unprinted, which is the property that stops a reader being
// shown a status the chain does not attest.
describe('recordedHttpStatus (#797)', () => {
  it('returns a status the origin actually sent', () => {
    expect(recordedHttpStatus(200)).toBe(200)
    expect(recordedHttpStatus(404)).toBe(404)
    expect(recordedHttpStatus(100)).toBe(100)
    expect(recordedHttpStatus(599)).toBe(599)
  })

  it('reads 0 as unrecorded, not as a status', () => {
    // 0 is what the capture-upload schema coerces a missing httpStatus field
    // to, and what a capture with no HTTP transaction at all carries.
    expect(recordedHttpStatus(0)).toBeUndefined()
  })

  it('reads an absent value as unrecorded', () => {
    expect(recordedHttpStatus(undefined)).toBeUndefined()
    expect(recordedHttpStatus(null)).toBeUndefined()
  })

  it('refuses anything outside the three-digit status range', () => {
    expect(recordedHttpStatus(99)).toBeUndefined()
    expect(recordedHttpStatus(600)).toBeUndefined()
    expect(recordedHttpStatus(-200)).toBeUndefined()
  })

  it('refuses a non-integer', () => {
    expect(recordedHttpStatus(200.5)).toBeUndefined()
    expect(recordedHttpStatus(Number.NaN)).toBeUndefined()
    expect(recordedHttpStatus(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})
