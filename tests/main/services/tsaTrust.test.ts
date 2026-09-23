import { describe, it, expect } from 'vitest'
import { X509Certificate } from 'crypto'
import { DIGICERT_TRUSTED_ROOT_G4_SHA256, getTsaTrustBundle } from '@main/services/tsaTrust'
import { DEFAULT_TSA_URL } from '@shared/constants'
import { PACKAGE_ROOT_FILES } from '../../../src/packages/evidence-package-layout/index'

describe('getTsaTrustBundle', () => {
  it('returns the bundled DigiCert root for the default TSA url', () => {
    const bundle = getTsaTrustBundle(DEFAULT_TSA_URL)
    expect(bundle.bundled).toBe(true)
    expect(bundle.pem).toContain('BEGIN CERTIFICATE')
    expect(bundle.pem).toContain('END CERTIFICATE')
    expect(bundle.rootSha256).toBe(DIGICERT_TRUSTED_ROOT_G4_SHA256)
    expect(bundle.note).toContain(PACKAGE_ROOT_FILES.tsaRoot)
    expect(bundle.note).toContain(DIGICERT_TRUSTED_ROOT_G4_SHA256)
  })

  // The fingerprint VERIFY.md tells a third party to check is a literal; this
  // pins it to the certificate actually shipped so the two cannot drift.
  it('published fingerprint matches the bundled self-signed root', () => {
    const cert = new X509Certificate(getTsaTrustBundle(DEFAULT_TSA_URL).pem)
    expect(cert.subject).toBe(cert.issuer)
    expect(cert.fingerprint256).toBe(DIGICERT_TRUSTED_ROOT_G4_SHA256)
  })

  it('returns an un-bundled placeholder with guidance for a custom TSA url', () => {
    const customUrl = 'https://tsa.example.org/timestamp'
    const bundle = getTsaTrustBundle(customUrl)
    expect(bundle.bundled).toBe(false)
    expect(bundle.pem).toContain(customUrl)
    expect(bundle.pem).not.toContain('BEGIN CERTIFICATE')
    expect(bundle.rootSha256).toBeUndefined()
    expect(bundle.note).toMatch(/offline trust anchor/i)
  })
})
