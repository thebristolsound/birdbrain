import { AsnConvert, OctetString } from '@peculiar/asn1-schema'
import { AlgorithmIdentifier, GeneralName } from '@peculiar/asn1-x509'
import {
  TSTInfo,
  TSTInfoVersion,
  MessageImprint,
  TimeStampResp,
  TimeStampToken,
  PKIStatus,
  PKIStatusInfo,
  id_ct_tstInfo
} from '@peculiar/asn1-tsp'
import {
  ContentInfo,
  SignedData,
  EncapsulatedContentInfo,
  EncapsulatedContent,
  DigestAlgorithmIdentifiers,
  SignerInfos,
  id_signedData
} from '@peculiar/asn1-cms'

const SHA256_OID = '2.16.840.1.101.3.4.2.1'

// Builds a structurally-valid (unsigned) RFC 3161 token: a CMS ContentInfo
// wrapping SignedData whose eContent is a DER TSTInfo. Exercises the in-app
// parse path hermetically. Real TSA signature verification is the `openssl
// ts -verify` path, covered by the DigiCert fixture, not these unit tests.
export function buildSyntheticToken(opts: {
  contentHash: string
  genTime: Date
  tsaDnsName?: string
}): Buffer {
  const digest = Buffer.from(opts.contentHash, 'hex')
  const tst = new TSTInfo({
    version: TSTInfoVersion.v1,
    policy: '1.2.3.4.5',
    messageImprint: new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_OID }),
      hashedMessage: new OctetString(digest)
    }),
    serialNumber: new Uint8Array([0x2a]).buffer,
    genTime: opts.genTime,
    ...(opts.tsaDnsName ? { tsa: new GeneralName({ dNSName: opts.tsaDnsName }) } : {})
  })
  const sd = new SignedData({
    version: 3,
    digestAlgorithms: new DigestAlgorithmIdentifiers([]),
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: id_ct_tstInfo,
      eContent: new EncapsulatedContent({ single: new OctetString(AsnConvert.serialize(tst)) })
    }),
    signerInfos: new SignerInfos([])
  })
  const ci = new ContentInfo({ contentType: id_signedData, content: AsnConvert.serialize(sd) })
  return Buffer.from(AsnConvert.serialize(ci))
}

// Wraps a synthetic token in a granted TimeStampResp — the DER body a TSA
// returns on the wire (Content-Type: application/timestamp-reply).
export function buildTimestampResponse(tokenDer: Buffer, status = PKIStatus.granted): Buffer {
  const resp = new TimeStampResp({
    status: new PKIStatusInfo({ status }),
    ...(status === PKIStatus.granted || status === PKIStatus.grantedWithMods
      ? { timeStampToken: AsnConvert.parse(tokenDer, TimeStampToken) }
      : {})
  })
  return Buffer.from(AsnConvert.serialize(resp))
}
