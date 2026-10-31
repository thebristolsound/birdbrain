import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'

const electronApp = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('electron', () => ({ app: electronApp }))

import {
  E2E_TRUSTED_CERT_SWITCH,
  testCertificateAllowance
} from '@main/services/testCertificateAllowance'
import type { CertificateVerifyProc } from '@main/services/testCertificateAllowance'

// Invented DER bytes: the allowance compares digests and never parses a certificate.
const LEAF_DER = Buffer.from('birdbrain test leaf certificate')
const OTHER_DER = Buffer.from('a certificate from the same test authority')
const pem = (der: Buffer): string =>
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`
const LEAF_SHA256 = createHash('sha256').update(LEAF_DER).digest('hex')

const verdict = (proc: CertificateVerifyProc, der: Buffer): number => {
  const callback = vi.fn()
  proc({ certificate: { data: pem(der) } as Electron.Certificate }, callback)
  return callback.mock.calls[0][0] as number
}

describe('testCertificateAllowance', () => {
  beforeEach(() => {
    electronApp.isPackaged = true
    delete process.env[E2E_TRUSTED_CERT_SWITCH]
  })

  afterEach(() => {
    delete process.env[E2E_TRUSTED_CERT_SWITCH]
  })

  it('installs nothing in an unpackaged build without the switch', () => {
    electronApp.isPackaged = false
    expect(testCertificateAllowance()).toBeNull()
  })

  it('installs nothing in a packaged build, even with the switch set', () => {
    process.env[E2E_TRUSTED_CERT_SWITCH] = LEAF_SHA256
    expect(testCertificateAllowance()).toBeNull()
  })

  it('accepts the pinned leaf and leaves every other certificate to Chromium', () => {
    electronApp.isPackaged = false
    process.env[E2E_TRUSTED_CERT_SWITCH] = LEAF_SHA256.toUpperCase()
    const proc = testCertificateAllowance()
    if (!proc) throw new Error('expected an allowance')
    expect(verdict(proc, LEAF_DER)).toBe(0)
    expect(verdict(proc, OTHER_DER)).toBe(-3)
  })
})
