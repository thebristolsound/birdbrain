import { AsnConvert } from '@peculiar/asn1-schema'
import { GeneralName, Name } from '@peculiar/asn1-x509'
import { TSTInfo, id_ct_tstInfo } from '@peculiar/asn1-tsp'
import { ContentInfo, SignedData, id_signedData } from '@peculiar/asn1-cms'

// RFC 3161 token parsing (verify-core). Pure ASN.1 structural reads — the
// CANONICAL court verification path remains `openssl ts -verify` against the
// TSA chain (decision D5/#113); this code never hand-rolls CMS signature
// crypto. The network half (building/sending a TimeStampReq) stays in
// `src/main/services/timestamp.ts`.

// NIST SHA-256 OID. The server-computed contentHash is a SHA-256 digest, so the
// imprint algorithm is fixed to match. Per RFC 5754 the AlgorithmIdentifier
// parameters are absent (not NULL) for SHA-2.
export const SHA256_OID = '2.16.840.1.101.3.4.2.1'

export const COMMON_NAME_OID = '2.5.4.3'

export interface ParsedTimestampToken {
  // Hex of the TSTInfo message imprint; equals the capture's contentHash when
  // the token belongs to that capture.
  messageImprintHex: string
  // The trusted time asserted by the TSA ("the content existed no later than").
  stampedAt: Date
  // Human-readable TSA identity, when the token carries one.
  tsaName?: string
}

export function derToPem(label: string, der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

// Best-effort human-readable name for a TSTInfo `tsa` GeneralName. Prefers the
// simple string CHOICEs; falls back to the commonName of a directoryName
// (what DigiCert and most commercial TSAs populate).
export function generalNameToString(name: GeneralName): string | undefined {
  if (name.dNSName) return name.dNSName
  if (name.rfc822Name) return name.rfc822Name
  if (name.uniformResourceIdentifier) return name.uniformResourceIdentifier
  if (name.directoryName) return commonNameOf(name.directoryName)
  return undefined
}

export function commonNameOf(dirName: Name): string | undefined {
  for (const rdn of dirName) {
    for (const attr of rdn) {
      // attr.value is a parsed DirectoryString; toString() yields the text.
      if (attr.type === COMMON_NAME_OID) return attr.value.toString() || undefined
    }
  }
  return undefined
}

export function bufToHex(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('hex')
}

// Falls back to the signing certificate's subject CN for the TSA identity. Many
// commercial TSAs (DigiCert included) leave TSTInfo's optional `tsa` field
// unspecified and instead identify themselves through the embedded responder
// certificate, located here via the SignerInfo's issuer+serial.
export function signerCommonName(signedData: SignedData): string | undefined {
  const sid = signedData.signerInfos[0]?.sid?.issuerAndSerialNumber
  if (!sid || !signedData.certificates) return undefined
  const targetSerial = bufToHex(sid.serialNumber)
  for (const choice of signedData.certificates) {
    const cert = choice.certificate
    if (cert && bufToHex(cert.tbsCertificate.serialNumber) === targetSerial) {
      return commonNameOf(cert.tbsCertificate.subject)
    }
  }
  return undefined
}

// Parses an RFC 3161 timestamp token (a CMS SignedData over a TSTInfo) and
// returns its structural fields. Does NOT verify the TSA signature — that is the
// canonical `openssl ts -verify` path (D5). Throws if the bytes are not a CMS
// signed-data structure wrapping a TSTInfo.
export function parseTimestampToken(tokenDer: Buffer): ParsedTimestampToken {
  const contentInfo = AsnConvert.parse(tokenDer, ContentInfo)
  if (contentInfo.contentType !== id_signedData) {
    throw new Error(`Unexpected token contentType: ${contentInfo.contentType}`)
  }
  const signedData = AsnConvert.parse(contentInfo.content, SignedData)
  const encap = signedData.encapContentInfo
  if (encap.eContentType !== id_ct_tstInfo || !encap.eContent) {
    throw new Error('Token does not encapsulate a TSTInfo')
  }
  const inner = encap.eContent.single?.buffer ?? encap.eContent.any
  if (!inner) throw new Error('Token has empty eContent')

  const tstInfo = AsnConvert.parse(inner, TSTInfo)
  const messageImprintHex = Buffer.from(tstInfo.messageImprint.hashedMessage.buffer).toString('hex')
  const tsaName =
    (tstInfo.tsa ? generalNameToString(tstInfo.tsa) : undefined) ?? signerCommonName(signedData)

  return { messageImprintHex, stampedAt: tstInfo.genTime, tsaName }
}

export function extractTimestampTokenCertificatesPem(tokenDer: Buffer): string {
  const contentInfo = AsnConvert.parse(tokenDer, ContentInfo)
  if (contentInfo.contentType !== id_signedData) {
    throw new Error(`Unexpected token contentType: ${contentInfo.contentType}`)
  }
  const signedData = AsnConvert.parse(contentInfo.content, SignedData)
  if (!signedData.certificates) return ''

  return signedData.certificates
    .map((choice) => choice.certificate)
    .filter((cert) => cert !== undefined)
    .map((cert) => derToPem('CERTIFICATE', Buffer.from(AsnConvert.serialize(cert))))
    .join('\n')
}
