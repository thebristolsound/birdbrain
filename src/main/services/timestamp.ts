import { randomBytes } from 'crypto'
import { AsnConvert, OctetString } from '@peculiar/asn1-schema'
import { AlgorithmIdentifier } from '@peculiar/asn1-x509'
import {
  TimeStampReq,
  TimeStampReqVersion,
  MessageImprint,
  TimeStampResp,
  PKIStatus
} from '@peculiar/asn1-tsp'
import { SHA256_OID } from '@shared/verify'

// RFC 3161 trusted timestamping (#120) — the NETWORK half: builds a
// TimeStampReq over a capture's server-computed contentHash and sends it to an
// RFC 3161 TSA. Token PARSING is pure and lives in the shared verify-core
// (`@shared/verify`, #122) so the standalone verifier shares it. The CANONICAL
// court verification path remains `openssl ts -verify` against the TSA chain
// (decision D5/#113) — this code never hand-rolls CMS signature crypto; in-app
// it confirms only that the token's message imprint matches the capture hash.

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
