import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AsnConvert } from '@peculiar/asn1-schema'
import { TimeStampResp } from '@peculiar/asn1-tsp'
import { ContentInfo, SignedData } from '@peculiar/asn1-cms'
import {
  parseTimestampToken,
  extractTimestampTokenCertificatesPem
} from '@shared/verify/timestampToken'

// Known-answer reads of real tokens from authorities other than DigiCert
// (#1142). The three responses come from bellingcat/auto-archiver's test corpus
// (see the fixture README for provenance).
//
// What this pins: the verify-core parser is not shaped around DigiCert's token
// layout alone. IdenTrust is strict-DER clean where DigiCert is not, and is a
// candidate second authority for #587; SINPE chains to a root no bundled trust
// store carries, which is the `tsaTrust` unbundled path.

const FIXTURES = join(__dirname, '../../fixtures/timestamp')

// `identrust-response.tsr` and `sinpe-response.tsr` stamp the same message: the
// ASCII text of a SHA-256 hex digest, imprinted with SHA-512, so their expected
// imprint is derived rather than read from a file.
const STAMPED_MESSAGE = '4b7b4e39f12b8c725e6e603e6d4422500316df94211070682ef10260ff5759ef'
const EXPECTED_IMPRINT = createHash('sha512').update(STAMPED_MESSAGE, 'ascii').digest('hex')

// `identrust-response-2.tsr` stamps a different message, and upstream kept no
// preimage for it, so its imprint is pinned as the literal SHA-512 read off the
// token rather than derived.
const EXPECTED_IMPRINT_2 =
  '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7' +
  '2323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043'

function tokenFromResponse(file: string): Buffer {
  const resp = AsnConvert.parse(readFileSync(join(FIXTURES, file)), TimeStampResp)
  if (!resp.timeStampToken) throw new Error(`${file}: response carries no token`)
  return Buffer.from(AsnConvert.serialize(resp.timeStampToken))
}

// Re-encodes a token with its embedded certificates in reverse order. Every real
// fixture on hand puts the responder certificate first, so the out-of-order
// layout has to be constructed to be tested.
function withCertificatesReversed(token: Buffer): Buffer {
  const contentInfo = AsnConvert.parse(token, ContentInfo)
  const signedData = AsnConvert.parse(contentInfo.content, SignedData)
  const { certificates } = signedData
  if (!certificates || certificates.length < 2) {
    throw new Error('token embeds fewer than two certificates')
  }
  certificates.reverse()
  contentInfo.content = AsnConvert.serialize(signedData)
  return Buffer.from(AsnConvert.serialize(contentInfo))
}

function certificateCount(pem: string): number {
  return pem.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0
}

describe('parseTimestampToken against real non-DigiCert authorities', () => {
  it('reads an IdenTrust token (imprint, time, responder identity)', () => {
    const token = tokenFromResponse('identrust-response.tsr')
    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(EXPECTED_IMPRINT)
    expect(parsed.stampedAt.toISOString()).toBe('2025-03-11T10:43:58.000Z')
    expect(parsed.tsaName).toBe('TrustID Timestamp Authority')
    // Responder plus issuing CA; the IdenTrust Commercial Root CA 1 is not embedded.
    expect(certificateCount(extractTimestampTokenCertificatesPem(token))).toBe(2)
  })

  it('reads a second IdenTrust token over a different message', () => {
    const token = tokenFromResponse('identrust-response-2.tsr')
    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(EXPECTED_IMPRINT_2)
    expect(parsed.stampedAt.toISOString()).toBe('2025-03-11T08:52:08.000Z')
    expect(parsed.tsaName).toBe('TrustID Timestamp Authority')
    expect(certificateCount(extractTimestampTokenCertificatesPem(token))).toBe(2)
  })

  it('reads a SINPE token whose chain ends at an unbundled national root', () => {
    const token = tokenFromResponse('sinpe-response.tsr')
    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(EXPECTED_IMPRINT)
    expect(parsed.stampedAt.toISOString()).toBe('2025-03-24T11:38:16.000Z')
    expect(parsed.tsaName).toBe('TSA SINPE v3')
    // Only the responder certificate travels in the token.
    expect(certificateCount(extractTimestampTokenCertificatesPem(token))).toBe(1)
  })

  // RFC 5652 leaves the `certificates` SET unordered, so a responder that emits
  // the issuing CA first is conformant. `signerCommonName` locates the signer by
  // the SignerInfo's issuer and serial, and this pins that it does not instead
  // read whichever certificate happens to be first.
  it('reads the same identity when the embedded certificates are out of chain order', () => {
    const original = tokenFromResponse('identrust-response.tsr')
    const token = withCertificatesReversed(original)
    // Guards the helper: if the reordering were a no-op this test would restate
    // the first case rather than exercise the out-of-order layout.
    expect(extractTimestampTokenCertificatesPem(token)).not.toBe(
      extractTimestampTokenCertificatesPem(original)
    )

    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(EXPECTED_IMPRINT)
    expect(parsed.stampedAt.toISOString()).toBe('2025-03-11T10:43:58.000Z')
    expect(parsed.tsaName).toBe('TrustID Timestamp Authority')
    expect(certificateCount(extractTimestampTokenCertificatesPem(token))).toBe(2)
  })
})
