import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AsnConvert } from '@peculiar/asn1-schema'
import { TimeStampResp } from '@peculiar/asn1-tsp'
import {
  parseTimestampToken,
  extractTimestampTokenCertificatesPem
} from '@shared/verify/timestampToken'

// Known-answer reads of real tokens from authorities other than DigiCert
// (#1142). The three responses come from bellingcat/auto-archiver's test corpus
// (see the fixture README for provenance). They all stamp the same message: the
// ASCII text of a SHA-256 hex digest, imprinted with SHA-512, which is why the
// expected imprint below is derived rather than read from `content-hash.txt`.
//
// What this pins: the verify-core parser is not shaped around DigiCert's token
// layout alone. IdenTrust is strict-DER clean where DigiCert is not, and is a
// candidate second authority for #587; SINPE chains to a root no bundled trust
// store carries, which is the `tsaTrust` unbundled path.

const FIXTURES = join(__dirname, '../../fixtures/timestamp')

const STAMPED_MESSAGE = '4b7b4e39f12b8c725e6e603e6d4422500316df94211070682ef10260ff5759ef'
const EXPECTED_IMPRINT = createHash('sha512').update(STAMPED_MESSAGE, 'ascii').digest('hex')

function tokenFromResponse(file: string): Buffer {
  const resp = AsnConvert.parse(readFileSync(join(FIXTURES, file)), TimeStampResp)
  if (!resp.timeStampToken) throw new Error(`${file}: response carries no token`)
  return Buffer.from(AsnConvert.serialize(resp.timeStampToken))
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

  it('reads the same identity when the embedded certificates are out of chain order', () => {
    const token = tokenFromResponse('identrust-response-unordered-certs.tsr')
    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).not.toBe(EXPECTED_IMPRINT)
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
})
