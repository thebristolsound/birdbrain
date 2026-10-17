import { describe, expect, it } from 'vitest'
import { toBoundTls } from '../boundTls'
import type { SecurityDetails } from '../boundTls'
import { spikeStream } from './fixtures/streams'

// The main document's securityDetails exactly as step 0 recorded it on Chromium 152.
const recorded = (run: string): SecurityDetails => {
  const event = spikeStream(run).find(
    ({ method, params }) =>
      method === 'Network.responseReceived' && (params as { type: string }).type === 'Document'
  )
  return (event?.params as { response: { securityDetails: SecurityDetails } }).response
    .securityDetails
}

const sct = {
  status: 'Verified',
  origin: 'Embedded in certificate',
  logDescription: 'Example log',
  logId: 'AB01',
  timestamp: 1791751656123,
  hashAlgorithm: 'SHA-256',
  signatureAlgorithm: 'ECDSA',
  signatureData: 'CD02'
}

describe('toBoundTls', () => {
  it('converts a recorded TLS 1.3 securityDetails to the D7 shape', () => {
    expect(toBoundTls(recorded('q6-tls13'))).toEqual({
      protocol: 'TLS 1.3',
      keyExchange: '',
      keyExchangeGroup: 'X25519',
      cipher: 'AES_256_GCM',
      subjectName: 'localhost',
      sanList: ['localhost', '127.0.0.1'],
      issuer: 'Spike Test CA',
      validFrom: '2026-10-11T20:47:36.000Z',
      validTo: '2026-10-13T20:47:36.000Z',
      signedCertificateTimestampList: [],
      certificateTransparencyCompliance: 'unknown',
      serverSignatureAlgorithm: 2052,
      encryptedClientHello: false
    })
  })

  it('keeps mac only where the cipher has one, and drops certificateId everywhere', () => {
    const cbc = toBoundTls(recorded('q6-tls12-cbc'))
    const gcm = toBoundTls(recorded('q6-tls12-gcm'))
    expect(cbc).toMatchObject({ keyExchange: 'ECDHE_RSA', cipher: 'AES_128_CBC', mac: 'HMAC-SHA1' })
    expect(gcm).not.toHaveProperty('mac')
    for (const details of [cbc, gcm, toBoundTls(recorded('q6-tls13'))]) {
      expect(details).not.toHaveProperty('certificateId')
      expect(Object.values(details).filter((value) => typeof value === 'number')).toEqual([2052])
    }
  })

  it('writes each signed certificate timestamp with its time as ISO 8601', () => {
    const details = toBoundTls({ ...recorded('q6-tls13'), signedCertificateTimestampList: [sct] })
    expect(details.signedCertificateTimestampList).toEqual([
      { ...sct, timestamp: '2026-10-11T20:47:36.123Z' }
    ])
  })

  it('copies only the fields D7 names', () => {
    const input = {
      ...recorded('q6-tls13'),
      futureField: 1.5,
      signedCertificateTimestampList: [{ ...sct, futureField: 'x' }]
    }
    const details = toBoundTls(input)
    expect(details).not.toHaveProperty('futureField')
    expect(details.signedCertificateTimestampList[0]).not.toHaveProperty('futureField')
  })

  it('leaves out the optional fields a connection did not report', () => {
    const input: SecurityDetails = { ...recorded('q6-tls13') }
    delete input.keyExchangeGroup
    delete input.serverSignatureAlgorithm
    const details = toBoundTls(input)
    expect(details).not.toHaveProperty('keyExchangeGroup')
    expect(details).not.toHaveProperty('serverSignatureAlgorithm')
  })

  it('refuses a serverSignatureAlgorithm that is not a non-negative integer', () => {
    for (const serverSignatureAlgorithm of [2052.5, -1]) {
      expect(() => toBoundTls({ ...recorded('q6-tls13'), serverSignatureAlgorithm })).toThrow(
        RangeError
      )
    }
  })

  it('refuses a time that is not a number of seconds', () => {
    expect(() => toBoundTls({ ...recorded('q6-tls13'), validFrom: Number.NaN })).toThrow(RangeError)
  })
})
