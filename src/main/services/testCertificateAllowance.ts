import { app } from 'electron'
import type { Request } from 'electron'
import { createHash } from 'crypto'

// The Transaction Record e2e spec serves a page over TLS with a certificate from a test
// authority it makes, to check Bound TLS Details against a known certificate (step 9 of
// docs/plans/2026-10-10-capture-engine-first-slice.md; renderer spike, question 6). Like CE-2's
// loopback allowance (`E2E_LOOPBACK_SWITCH`), only an unpackaged build reads this switch, so no
// installed copy of Birdbrain can turn it on. Its value is the SHA-256 of one leaf certificate's
// DER bytes, in hex; the render accepts that leaf and leaves every other certificate to Chromium.
export const E2E_TRUSTED_CERT_SWITCH = 'BIRDBRAIN_E2E_TRUST_CERT_SHA256'

// The results `setCertificateVerifyProc` takes: accept, or use Chromium's own verdict.
const ACCEPT = 0
const CHROMIUM_VERDICT = -3

function derSha256(pem: string): string {
  const base64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
}

export type CertificateVerifyProc = (
  request: Pick<Request, 'certificate'>,
  callback: (verificationResult: number) => void
) => void

/**
 * The verify proc a render installs on its session, or null when the switch is off or the build
 * is packaged, in which case the render installs none and Chromium verifies every certificate.
 */
export function testCertificateAllowance(): CertificateVerifyProc | null {
  const pinned = process.env[E2E_TRUSTED_CERT_SWITCH]?.trim().toLowerCase()
  if (app?.isPackaged !== false || !pinned) return null
  return ({ certificate }, callback) => {
    callback(derSha256(certificate.data) === pinned ? ACCEPT : CHROMIUM_VERDICT)
  }
}
