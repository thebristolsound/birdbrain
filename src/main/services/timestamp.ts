import { randomBytes } from 'crypto'
import { AsnConvert, OctetString } from '@peculiar/asn1-schema'
import { AlgorithmIdentifier, GeneralName, Name } from '@peculiar/asn1-x509'
import {
  TimeStampReq,
  TimeStampReqVersion,
  MessageImprint,
  TimeStampResp,
  PKIStatus,
  TSTInfo,
  id_ct_tstInfo
} from '@peculiar/asn1-tsp'
import { ContentInfo, SignedData, id_signedData } from '@peculiar/asn1-cms'

// RFC 3161 trusted timestamping (#120). This module is intentionally pure
// ASN.1 + HTTP: it builds a TimeStampReq over a capture's server-computed
// contentHash, sends it to an RFC 3161 TSA, and parses the returned token's
// structural fields. The CANONICAL court verification path remains
// `openssl ts -verify` against the TSA chain (decision D5/#113) — this code
// never hand-rolls CMS signature crypto; in-app it confirms only that the
// token's message imprint matches the capture hash.

// NIST SHA-256 OID. The server-computed contentHash is a SHA-256 digest, so the
// imprint algorithm is fixed to match. Per RFC 5754 the AlgorithmIdentifier
// parameters are absent (not NULL) for SHA-2.
const SHA256_OID = '2.16.840.1.101.3.4.2.1'

// Upper bound on a single TSA round-trip. Off the capture's critical path, but
// a stalled connection must not pin the retry worker.
const TSA_REQUEST_TIMEOUT_MS = 30000

// Builds a DER-encoded RFC 3161 TimeStampReq whose message imprint is the
// capture's contentHash (already a SHA-256 hex digest). certReq=true asks the
// TSA to embed its signing certificate so the token is self-contained and
// verifiable offline with `openssl ts -verify`.
export function buildTimestampRequest(contentHash: string): Buffer {
  const digest = Buffer.from(contentHash, 'hex')
  const req = new TimeStampReq({
    version: TimeStampReqVersion.v1,
    messageImprint: new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_OID }),
      hashedMessage: new OctetString(digest)
    }),
    // 64-bit random nonce for replay protection; the TSA echoes it in TSTInfo.
    nonce: new Uint8Array(randomBytes(8)).buffer,
    certReq: true
  })
  return Buffer.from(AsnConvert.serialize(req))
}

// Sends a timestamp query to an RFC 3161 TSA over HTTP and returns the raw
// TimeStampToken (CMS SignedData) DER on success. Throws on transport failure,
// a non-2xx response, or a non-granted PKIStatus. The caller is responsible for
// keeping this OFF the capture's critical path (it may block on the network).
export async function requestTimestamp(contentHash: string, tsaUrl: string): Promise<Buffer> {
  const reqBody = buildTimestampRequest(contentHash)
  const res = await fetch(tsaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/timestamp-query' },
    body: reqBody,
    // Bound the wait: undici's default header timeout is multi-minute, which
    // would pin the retry worker on a stalled TSA. On abort the capture simply
    // stays pending for the next retry.
    signal: AbortSignal.timeout(TSA_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) {
    throw new Error(`TSA responded ${res.status} ${res.statusText}`)
  }
  const respDer = Buffer.from(await res.arrayBuffer())
  const resp = AsnConvert.parse(respDer, TimeStampResp)
  if (
    resp.status.status !== PKIStatus.granted &&
    resp.status.status !== PKIStatus.grantedWithMods
  ) {
    const detail = resp.status.statusString ? Array.from(resp.status.statusString).join('; ') : ''
    throw new Error(
      `TSA rejected request (status ${resp.status.status})${detail ? ': ' + detail : ''}`
    )
  }
  if (!resp.timeStampToken) {
    throw new Error('TSA granted request but returned no token')
  }
  return Buffer.from(AsnConvert.serialize(resp.timeStampToken))
}

export interface ParsedTimestampToken {
  // Hex of the TSTInfo message imprint; equals the capture's contentHash when
  // the token belongs to that capture.
  messageImprintHex: string
  // The trusted time asserted by the TSA ("the content existed no later than").
  stampedAt: Date
  // Human-readable TSA identity, when the token carries one.
  tsaName?: string
}

const COMMON_NAME_OID = '2.5.4.3'

// Best-effort human-readable name for a TSTInfo `tsa` GeneralName. Prefers the
// simple string CHOICEs; falls back to the commonName of a directoryName
// (what DigiCert and most commercial TSAs populate).
function generalNameToString(name: GeneralName): string | undefined {
  if (name.dNSName) return name.dNSName
  if (name.rfc822Name) return name.rfc822Name
  if (name.uniformResourceIdentifier) return name.uniformResourceIdentifier
  if (name.directoryName) return commonNameOf(name.directoryName)
  return undefined
}

function commonNameOf(dirName: Name): string | undefined {
  for (const rdn of dirName) {
    for (const attr of rdn) {
      // attr.value is a parsed DirectoryString; toString() yields the text.
      if (attr.type === COMMON_NAME_OID) return attr.value.toString() || undefined
    }
  }
  return undefined
}

function bufToHex(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('hex')
}

// Falls back to the signing certificate's subject CN for the TSA identity. Many
// commercial TSAs (DigiCert included) leave TSTInfo's optional `tsa` field
// unspecified and instead identify themselves through the embedded responder
// certificate, located here via the SignerInfo's issuer+serial.
function signerCommonName(signedData: SignedData): string | undefined {
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
