import { describe, it, expect } from 'vitest'
import { getTsaTrustBundle } from '@main/services/tsaTrust'
import { DEFAULT_TSA_URL } from '@shared/constants'

describe('getTsaTrustBundle', () => {
  it('returns the bundled DigiCert root for the default TSA url', () => {
    const bundle = getTsaTrustBundle(DEFAULT_TSA_URL)
    expect(bundle.bundled).toBe(true)
    expect(bundle.pem).toContain('BEGIN CERTIFICATE')
    expect(bundle.pem).toContain('END CERTIFICATE')
    expect(bundle.note).toBeUndefined()
  })

  it('returns an un-bundled placeholder with guidance for a custom TSA url', () => {
    const customUrl = 'https://tsa.example.org/timestamp'
    const bundle = getTsaTrustBundle(customUrl)
    expect(bundle.bundled).toBe(false)
    expect(bundle.pem).toContain(customUrl)
    expect(bundle.pem).not.toContain('BEGIN CERTIFICATE')
    expect(bundle.note).toMatch(/offline trust anchor/i)
  })
})
