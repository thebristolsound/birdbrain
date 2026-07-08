import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AsnConvert } from '@peculiar/asn1-schema'
import {
  ContentInfo,
  SignedData,
  EncapsulatedContentInfo,
  DigestAlgorithmIdentifiers,
  SignerInfos,
  id_signedData,
  id_data
} from '@peculiar/asn1-cms'
import { id_ct_tstInfo } from '@peculiar/asn1-tsp'
import {
  parseTimestampToken,
  extractTimestampTokenCertificatesPem
} from '@shared/verify/timestampToken'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

// verify-core RFC 3161 structural reads (#122). These cover the adversarial /
// malformed-token branches: a CMS envelope that does NOT wrap a TSTInfo, and a
// certificate extractor handed a non-signed-data blob. Both must throw or return
// empty rather than surface a bogus imprint. Canonical TSA auth stays with
// `openssl ts -verify` (the DigiCert fixture), not these unit tests.

const FIXTURES = join(__dirname, '../../fixtures/timestamp')

// A CMS ContentInfo/SignedData whose encapsulated content is NOT a TSTInfo (or
// is absent). Exercises the `eContentType !== id_ct_tstInfo || !eContent` guard.
function buildNonTstSignedData(opts: { withEContentType: boolean }): Buffer {
  const sd = new SignedData({
    version: 3,
    digestAlgorithms: new DigestAlgorithmIdentifiers([]),
    encapContentInfo: new EncapsulatedContentInfo({
      // Either the wrong content type (id-data) or a TSTInfo type with NO
      // eContent — both trip the guard on different sub-conditions.
      eContentType: opts.withEContentType ? id_data : id_ct_tstInfo
    }),
    signerInfos: new SignerInfos([])
  })
  return Buffer.from(
    AsnConvert.serialize(new ContentInfo({ contentType: id_signedData, content: AsnConvert.serialize(sd) }))
  )
}

// A CMS ContentInfo whose contentType is id-data (a DER NULL payload), i.e. NOT
// signed-data. Both parse paths must reject it as an unexpected contentType.
function buildNonSignedDataContentInfo(): Buffer {
  const notSignedData = new ContentInfo({
    contentType: id_data,
    content: new Uint8Array([0x05, 0x00]).buffer // DER NULL
  })
  return Buffer.from(AsnConvert.serialize(notSignedData))
}

describe('parseTimestampToken (malformed structures)', () => {
  it('throws when the CMS envelope is not signed-data', () => {
    const der = buildNonSignedDataContentInfo()
    expect(() => parseTimestampToken(der)).toThrow('Unexpected token contentType')
  })

  it('throws when signed-data encapsulates the wrong content type (not TSTInfo)', () => {
    const der = buildNonTstSignedData({ withEContentType: true })
    expect(() => parseTimestampToken(der)).toThrow('does not encapsulate a TSTInfo')
  })

  it('throws when signed-data has no eContent to parse', () => {
    const der = buildNonTstSignedData({ withEContentType: false })
    expect(() => parseTimestampToken(der)).toThrow('does not encapsulate a TSTInfo')
  })

  it('throws on bytes that are not ASN.1 at all', () => {
    expect(() => parseTimestampToken(Buffer.from('definitely not DER'))).toThrow()
  })
})

describe('extractTimestampTokenCertificatesPem', () => {
  it('returns an empty string for a token carrying no certificates', () => {
    // The synthetic token has an empty SignerInfos and no certificates field.
    const token = buildSyntheticToken({
      contentHash: 'a'.repeat(64),
      genTime: new Date('2026-05-30T10:00:00.000Z')
    })
    expect(extractTimestampTokenCertificatesPem(token)).toBe('')
  })

  it('throws when handed a CMS envelope that is not signed-data', () => {
    const der = buildNonSignedDataContentInfo()
    expect(() => extractTimestampTokenCertificatesPem(der)).toThrow('Unexpected token contentType')
  })

  it('extracts PEM certificate blocks from a real DigiCert token', () => {
    const token = readFileSync(join(FIXTURES, 'digicert-token.der'))
    const pem = extractTimestampTokenCertificatesPem(token)
    expect(pem).toContain('-----BEGIN CERTIFICATE-----')
    expect(pem).toContain('-----END CERTIFICATE-----')
  })
})
