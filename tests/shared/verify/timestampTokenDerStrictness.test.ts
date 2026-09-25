import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AsnConvert } from '@peculiar/asn1-schema'
import { TimeStampResp } from '@peculiar/asn1-tsp'
import { Attribute, ContentInfo, SignedData } from '@peculiar/asn1-cms'
import { checkDerStrictness, checkTimestampTokenDerStrictness } from '@shared/verify/derStrictness'
import { parseTimestampToken } from '@shared/verify/timestampToken'

// Known-answer test for DER strictness per fixture (#1142).
//
// The claim being pinned: the default authority's tokens carry a `SET` that is
// not in DER order, which is why a strict-DER third-party library refuses to
// parse them, and tokens from another real authority in the same corpus do not.
// Nothing here changes a verification verdict — the checker is diagnostic, and
// the parse assertions below show the in-app parser reads both kinds alike.

const FIXTURES = join(__dirname, '../../fixtures/timestamp')

function tokenFromResponse(file: string): Buffer {
  const resp = AsnConvert.parse(readFileSync(join(FIXTURES, file)), TimeStampResp)
  if (!resp.timeStampToken) throw new Error(`${file}: response carries no token`)
  return Buffer.from(AsnConvert.serialize(resp.timeStampToken))
}

/** Re-encodes a token with its embedded certificates sorted the way DER requires. */
function withCertificatesSorted(token: Buffer): Buffer {
  const contentInfo = AsnConvert.parse(token, ContentInfo)
  const signedData = AsnConvert.parse(contentInfo.content, SignedData)
  const { certificates } = signedData
  if (!certificates) throw new Error('token embeds no certificates')
  const sorted = [...certificates].sort((a, b) => {
    const left = Buffer.from(AsnConvert.serialize(a))
    const right = Buffer.from(AsnConvert.serialize(b))
    return Buffer.compare(left, right)
  })
  certificates.splice(0, certificates.length, ...sorted)
  contentInfo.content = AsnConvert.serialize(signedData)
  return Buffer.from(AsnConvert.serialize(contentInfo))
}

/** Re-encodes a token with the given unsigned attributes on its first signer. */
function withUnsignedAttrs(token: Buffer, attrs: Attribute[]): Buffer {
  const contentInfo = AsnConvert.parse(token, ContentInfo)
  const signedData = AsnConvert.parse(contentInfo.content, SignedData)
  signedData.signerInfos[0].unsignedAttrs = attrs
  contentInfo.content = AsnConvert.serialize(signedData)
  return Buffer.from(AsnConvert.serialize(contentInfo))
}

const der = (...bytes: number[]): Buffer => Buffer.from(bytes)

/** A DER NULL, as a standalone ArrayBuffer — an attribute value has to be something. */
const derNull = (): ArrayBuffer => new Uint8Array([0x05, 0x00]).buffer

describe('DER strictness of the packaged timestamp tokens', () => {
  it('reports the DigiCert token as not strict DER, at the certificates set', () => {
    const token = readFileSync(join(FIXTURES, 'digicert-token.der'))
    const report = checkTimestampTokenDerStrictness(token)

    expect(report.strict).toBe(false)
    expect(report.deviations.every((d) => d.kind === 'set-order')).toBe(true)
    expect(new Set(report.deviations.map((d) => d.path))).toEqual(
      new Set(['SignedData.certificates'])
    )
    // Three embedded certificates, two of which sort before their predecessor.
    expect(report.deviations).toHaveLength(2)
  })

  it('finds the same deviation in the token carried by the DigiCert response', () => {
    const report = checkTimestampTokenDerStrictness(tokenFromResponse('digicert-response.tsr'))

    expect(report.strict).toBe(false)
    expect(report.deviations.map((d) => d.path)).toEqual([
      'SignedData.certificates',
      'SignedData.certificates'
    ])
  })

  it.each([['identrust-response.tsr'], ['identrust-response-2.tsr'], ['sinpe-response.tsr']])(
    'reports %s as strict DER',
    (file) => {
      const report = checkTimestampTokenDerStrictness(tokenFromResponse(file))

      expect(report.deviations).toEqual([])
      expect(report.strict).toBe(true)
      // A clean report over no sets would say nothing, so the walk is pinned too.
      expect(report.setsChecked).toBeGreaterThan(0)
    }
  )

  it('reports the DigiCert token as strict DER once its certificates are sorted', () => {
    const original = readFileSync(join(FIXTURES, 'digicert-token.der'))
    const sorted = withCertificatesSorted(original)

    expect(sorted.equals(original)).toBe(false)
    expect(checkTimestampTokenDerStrictness(sorted).strict).toBe(true)
    // The deviation is an ordering one only: the same token, same parse result.
    expect(parseTimestampToken(sorted)).toEqual(parseTimestampToken(original))
  })

  // The route the issue's brief names first. It is recorded as a measurement
  // because it is the reason `derStrictness.ts` reads the bytes instead.
  it('cannot be detected by re-encoding, because the serializer round-trips the bytes', () => {
    const original = readFileSync(join(FIXTURES, 'digicert-token.der'))
    const reEncoded = Buffer.from(AsnConvert.serialize(AsnConvert.parse(original, ContentInfo)))

    expect(reEncoded.equals(original)).toBe(true)
  })

  it('reads the DigiCert token unchanged despite the deviation', () => {
    const token = readFileSync(join(FIXTURES, 'digicert-token.der'))

    expect(parseTimestampToken(token).tsaName).toBe(
      'DigiCert SHA256 RSA4096 Timestamp Responder 2025 1'
    )
  })

  // `certificates` is not the only implicitly tagged SET OF a token can carry,
  // and a responder that emits unsigned attributes out of order would fail a
  // strict parser the same way. No fixture has any, so the case is constructed.
  it('names an out-of-order unsigned-attributes set on the signer', () => {
    const token = withUnsignedAttrs(tokenFromResponse('identrust-response.tsr'), [
      new Attribute({ attrType: '1.2.840.113549.1.9.4', attrValues: [derNull()] }),
      new Attribute({ attrType: '1.2.840.113549.1.9.3', attrValues: [derNull()] })
    ])
    const report = checkTimestampTokenDerStrictness(token)

    expect(report.deviations.map((d) => ({ kind: d.kind, path: d.path }))).toEqual([
      { kind: 'set-order', path: 'SignerInfo[0].unsignedAttrs' }
    ])
  })

  it('throws on bytes that are not a CMS signed-data token', () => {
    // A bare DER INTEGER: well-formed ASN.1, not a ContentInfo.
    expect(() => checkTimestampTokenDerStrictness(der(0x02, 0x01, 0x01))).toThrow()
  })

  it('throws on a ContentInfo that wraps something other than signed data', () => {
    // ContentInfo { contentType id-data, content [0] { OCTET STRING "" } }.
    const idDataContentInfo = Buffer.from('300f06092a864886f70d010701a0020400', 'hex')

    expect(() => checkTimestampTokenDerStrictness(idDataContentInfo)).toThrow(
      /Unexpected token contentType/
    )
  })
})

describe('checkDerStrictness over hand-built encodings', () => {
  it('accepts a SET whose elements ascend', () => {
    const report = checkDerStrictness(der(0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02))

    expect(report).toEqual({ strict: true, deviations: [], setsChecked: 1 })
  })

  it('accepts a SET whose elements are equal', () => {
    const report = checkDerStrictness(der(0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01))

    expect(report.strict).toBe(true)
  })

  it('flags a SET whose elements descend', () => {
    const report = checkDerStrictness(der(0x31, 0x06, 0x02, 0x01, 0x02, 0x02, 0x01, 0x01))

    expect(report.strict).toBe(false)
    expect(report.deviations).toEqual([
      { kind: 'set-order', path: 'SET', offset: 5, detail: 'element 1 sorts before element 0' }
    ])
  })

  // X.690 §11.6 compares the encodings as octet strings with the shorter padded
  // with trailing zeros, so `04 01 01` precedes `04 02 01 00` rather than
  // following it on length.
  it('pads the shorter element with zeros when comparing', () => {
    const ascending = der(0x31, 0x07, 0x04, 0x01, 0x01, 0x04, 0x02, 0x01, 0x00)
    const descending = der(0x31, 0x07, 0x04, 0x02, 0x01, 0x00, 0x04, 0x01, 0x01)

    expect(checkDerStrictness(ascending).strict).toBe(true)
    expect(checkDerStrictness(descending).strict).toBe(false)
  })

  it('flags an indefinite length and does not descend into it', () => {
    const report = checkDerStrictness(der(0x30, 0x80, 0x31, 0x03, 0x02, 0x01, 0x01, 0x00, 0x00))

    expect(report.deviations).toEqual([
      {
        kind: 'indefinite-length',
        path: 'SEQUENCE',
        offset: 0,
        detail: 'indefinite-length form is BER only; DER requires a definite length'
      }
    ])
    expect(report.setsChecked).toBe(0)
  })

  it('flags a long-form length used for a short element', () => {
    const report = checkDerStrictness(der(0x30, 0x81, 0x03, 0x02, 0x01, 0x01))

    expect(report.deviations).toEqual([
      {
        kind: 'non-minimal-length',
        path: 'SEQUENCE',
        offset: 0,
        detail: 'length is not in the shortest form DER requires'
      }
    ])
  })

  it('flags a length carrying a leading zero octet', () => {
    const report = checkDerStrictness(der(0x30, 0x82, 0x00, 0x03, 0x02, 0x01, 0x01))

    expect(report.deviations.map((d) => d.kind)).toEqual(['non-minimal-length'])
  })

  it('names nested elements by tag and position', () => {
    // SEQUENCE { [1] { SET { INTEGER 2, INTEGER 1 } } }
    const report = checkDerStrictness(
      der(0x30, 0x0a, 0xa1, 0x08, 0x31, 0x06, 0x02, 0x01, 0x02, 0x02, 0x01, 0x01)
    )

    expect(report.deviations.map((d) => d.path)).toEqual(['SEQUENCE/[1][0]/SET[0]'])
  })

  // The generic scan has no schema, so an implicitly tagged SET OF looks like any
  // other constructed field to it. This is exactly the gap the CMS naming in
  // `checkTimestampTokenDerStrictness` closes.
  it('does not order-check an implicitly tagged constructed field', () => {
    const report = checkDerStrictness(der(0xa0, 0x06, 0x02, 0x01, 0x02, 0x02, 0x01, 0x01))

    expect(report).toEqual({ strict: true, deviations: [], setsChecked: 0 })
  })

  it('throws on a truncated element', () => {
    expect(() => checkDerStrictness(der(0x30, 0x05, 0x02, 0x01))).toThrow(/runs past the end/)
  })

  it('throws on a truncated length', () => {
    expect(() => checkDerStrictness(der(0x30, 0x82, 0x00))).toThrow(/Truncated DER length/)
  })
})
