import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { AsnConvert } from '@peculiar/asn1-schema'
import { TimeStampReq, MessageImprint, PKIStatus } from '@peculiar/asn1-tsp'
import {
  buildTimestampRequest,
  parseTimestampToken,
  requestTimestamp
} from '@main/services/timestamp'
import { buildSyntheticToken, buildTimestampResponse } from '../../helpers/timestampFixtures'

const SHA256_OID = '2.16.840.1.101.3.4.2.1'

function contentHashHex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

describe('buildTimestampRequest', () => {
  it('produces a DER TimeStampReq whose imprint is the SHA-256 of the contentHash', () => {
    const contentHash = contentHashHex('hello world')
    const der = buildTimestampRequest(contentHash)

    const req = AsnConvert.parse(der, TimeStampReq)
    expect(req.messageImprint).toBeInstanceOf(MessageImprint)
    expect(req.messageImprint.hashAlgorithm.algorithm).toBe(SHA256_OID)

    const imprint = Buffer.from(AsnConvert.serialize(req.messageImprint.hashedMessage))
    // hashedMessage is the raw 32-byte digest; compare its hex to contentHash.
    expect(Buffer.from(req.messageImprint.hashedMessage.buffer).toString('hex')).toBe(contentHash)
    expect(imprint.length).toBeGreaterThan(32)
  })

  it('requests the TSA certificate (certReq=true) so the token is self-contained', () => {
    const der = buildTimestampRequest(contentHashHex('x'))
    const req = AsnConvert.parse(der, TimeStampReq)
    expect(req.certReq).toBe(true)
  })
})

describe('parseTimestampToken', () => {
  it('extracts the message imprint, stamped-at time, and TSA identity', () => {
    const contentHash = contentHashHex('evidence bytes')
    const genTime = new Date('2026-05-30T10:00:00.000Z')
    const token = buildSyntheticToken({
      contentHash,
      genTime,
      tsaDnsName: 'tsa.example.com'
    })

    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(contentHash)
    expect(parsed.stampedAt.toISOString()).toBe(genTime.toISOString())
    expect(parsed.tsaName).toBe('tsa.example.com')
  })

  it('omits TSA identity when the token has no tsa field', () => {
    const contentHash = contentHashHex('no-tsa')
    const token = buildSyntheticToken({
      contentHash,
      genTime: new Date('2026-05-30T11:00:00.000Z')
    })

    const parsed = parseTimestampToken(token)

    expect(parsed.messageImprintHex).toBe(contentHash)
    expect(parsed.tsaName).toBeUndefined()
  })

  it('throws on a token that is not a CMS signed-data structure', () => {
    expect(() => parseTimestampToken(Buffer.from('not a token'))).toThrow()
  })
})

describe('requestTimestamp', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs an RFC 3161 query and returns the token DER on a granted response', async () => {
    const contentHash = contentHashHex('over the wire')
    const token = buildSyntheticToken({
      contentHash,
      genTime: new Date('2026-05-30T12:00:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    const responseBody = buildTimestampResponse(token)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: { 'content-type': 'application/timestamp-reply' }
      })
    )

    const result = await requestTimestamp(contentHash, 'http://tsa.example.com')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://tsa.example.com')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/timestamp-query' })
    // The returned token round-trips through the parser to the right imprint.
    expect(parseTimestampToken(result).messageImprintHex).toBe(contentHash)
  })

  it('rejects when the TSA returns a non-granted status', async () => {
    const token = buildSyntheticToken({
      contentHash: contentHashHex('x'),
      genTime: new Date('2026-05-30T12:00:00.000Z')
    })
    const responseBody = buildTimestampResponse(token, PKIStatus.rejection)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(responseBody, { status: 200 }))

    await expect(requestTimestamp(contentHashHex('x'), 'http://tsa.example.com')).rejects.toThrow()
  })

  it('rejects on a non-2xx HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('busy', { status: 503 }))
    await expect(requestTimestamp(contentHashHex('y'), 'http://tsa.example.com')).rejects.toThrow()
  })
})
