import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'zlib'
import { boundTlsOf, finishRecord } from '../record'
import type { Recording } from '../record'
import type { Exchange, TransactionRecordCounts } from '../../transaction-record/collector'
import type { WriterInput } from '../../transaction-record/writer'

// The record finish over a recording a test hands it (the two Capture Methods' own suites pin it
// against their recordings): its order, its inventory part, and what each failure records.

const DETAILS = {
  protocol: 'TLS 1.3',
  keyExchange: '',
  keyExchangeGroup: 'X25519',
  cipher: 'AES_128_GCM',
  subjectName: '127.0.0.1',
  sanList: ['127.0.0.1'],
  issuer: 'Birdbrain Test CA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  signedCertificateTimestampList: [],
  certificateTransparencyCompliance: 'unknown' as const,
  encryptedClientHello: false
}

const document = (url = 'https://127.0.0.1/', securityDetails = DETAILS): Exchange => ({
  requestId: 'doc',
  hop: 0,
  state: 'complete',
  complete: true,
  startedAt: '2026-10-26T12:00:00.000Z',
  type: 'Document',
  request: { method: 'GET', url, headers: { Cookie: 'sid=SECRET' } },
  response: {
    url,
    status: 200,
    statusText: 'OK',
    mimeType: 'text/html',
    headers: {},
    securityDetails
  },
  responseBody: { data: '<p>known</p>', base64Encoded: false }
})

// Each count differs, so one signed under another's name shows.
const COUNTS: TransactionRecordCounts = {
  exchanges: 11,
  cached: 2,
  cancelled: 3,
  failed: 4,
  finishedWithoutResponse: 5,
  inFlight: 6,
  bodiesOmitted: 7,
  incompleteRequestBodies: 8,
  webSockets: 9,
  recordedTargets: 10,
  unrecordedTargets: 1
}

const WRITER = {
  captureId: 'capture-1929',
  birdbrainVersion: '1.0.1-test',
  browserVersion: 'Chrome/152.0.0.0',
  userAgent: 'Test/1.0',
  egress: 'direct' as const,
  date: '2026-10-26T12:00:00.000Z'
}

// A recording that collects one document and writes at once, with the steps it saw in order.
function recording(overrides: Partial<Recording> = {}) {
  const steps: string[] = []
  const handed: WriterInput[] = []
  const main = document()
  const value: Recording = {
    collect: async () => {
      steps.push('collect')
      return { exchanges: [main], counts: COUNTS, mainDocument: main, methodFacts: {} }
    },
    boundWrite: (writing) => {
      steps.push('boundWrite')
      return writing
    },
    writer: WRITER,
    committedUrl: 'https://127.0.0.1/',
    budget: { totalBytes: 1_000, resourceBytes: 300 },
    write: async (input) => {
      steps.push('write')
      handed.push(input)
      return { bytes: Buffer.from('warc'), replacedHeaders: ['cookie', 'x-not-a-credential'] }
    },
    ...overrides
  }
  return { value, steps, handed, main }
}

const PART = {
  present: true,
  exchanges: 11,
  cached: 2,
  cancelled: 3,
  failed: 4,
  inFlight: 6,
  finishedWithoutResponse: 5,
  bodiesOmitted: 7,
  incompleteRequestBodies: 8,
  webSockets: 9,
  recordedTargets: 10,
  unrecordedTargets: 1,
  replacedHeaders: ['cookie'],
  budget: { totalBytes: 1_000, resourceBytes: 300 }
}

describe('finishRecord', () => {
  it('collects, starts the writer, then holds it to the bound, and signs each count by name', async () => {
    const { value, steps, handed, main } = recording()
    const outcome = await finishRecord(value)
    expect(steps).toEqual(['collect', 'write', 'boundWrite'])
    expect(handed).toEqual([{ ...WRITER, exchanges: [main] }])
    expect(outcome).toEqual({
      present: true,
      warcGz: Buffer.from('warc'),
      inventory: PART,
      boundTls: DETAILS
    })
    expect(outcome).not.toHaveProperty('boundTlsAbsent')
  })

  it("signs a method's facts as given, and none it did not state", async () => {
    const main = document()
    const collected = { exchanges: [main], counts: COUNTS, mainDocument: main }
    const stated = await finishRecord(
      recording({
        collect: async () => ({
          ...collected,
          methodFacts: {
            servedByServiceWorker: 2,
            requestBodiesWithheld: 3,
            httpCacheDisabled: true
          }
        })
      }).value
    )
    expect(stated).toMatchObject({
      inventory: {
        ...PART,
        servedByServiceWorker: 2,
        requestBodiesWithheld: 3,
        httpCacheDisabled: true
      }
    })
    const unstated = await finishRecord(recording().value)
    if (!unstated.present) throw unstated.error
    expect(Object.keys(unstated.inventory)).toEqual(Object.keys(PART))
    const one = await finishRecord(
      recording({
        collect: async () => ({ ...collected, methodFacts: { requestBodiesWithheld: 0 } })
      }).value
    )
    if (!one.present) throw one.error
    expect(Object.keys(one.inventory)).toEqual([...Object.keys(PART), 'requestBodiesWithheld'])
  })

  it('signs only the two limits of the budget it was given', async () => {
    const budget = { totalBytes: 5, resourceBytes: 4, maxEvents: 3, maxEventBytes: 2 }
    const outcome = await finishRecord(recording({ budget }).value)
    expect(outcome).toMatchObject({ inventory: { budget: { totalBytes: 5, resourceBytes: 4 } } })
    if (!outcome.present) throw outcome.error
    expect(Object.keys(outcome.inventory.budget)).toEqual(['totalBytes', 'resourceBytes'])
  })

  it('states why the details are absent in place of them, by the committed URL', async () => {
    const elsewhere = await finishRecord(recording({ committedUrl: 'about:blank' }).value)
    expect(elsewhere).toMatchObject({ present: true, boundTlsAbsent: 'not-reported' })
    expect(elsewhere).not.toHaveProperty('boundTls')
    const unknown = await finishRecord(recording({ committedUrl: undefined }).value)
    expect(unknown).toMatchObject({ present: true, boundTlsAbsent: 'not-reported' })
  })

  it('writes with the Transaction Record writer when no other is given', async () => {
    const outcome = await finishRecord(recording({ write: undefined }).value)
    if (!outcome.present) throw outcome.error
    const warc = gunzipSync(outcome.warcGz).toString()
    expect(warc).toContain('capture-id: capture-1929')
    expect(warc).toContain('<p>known</p>')
    expect(warc).not.toContain('SECRET')
    expect(outcome.inventory.replacedHeaders).toEqual(['cookie'])
  })

  const thrown = new Error('thrown by the method')
  it.each<[string, Partial<Recording>, string[]]>([
    ['the collection rejects', { collect: () => Promise.reject(thrown) }, []],
    [
      'the writer throws as it starts',
      {
        write: () => {
          throw thrown
        }
      },
      ['collect']
    ],
    ['the writer rejects', { write: () => Promise.reject(thrown) }, ['collect', 'boundWrite']],
    [
      'the bound runs out',
      {
        boundWrite: (writing) => {
          void writing
          return Promise.reject(thrown)
        }
      },
      ['collect', 'write']
    ],
    [
      'the bound throws as it is read',
      {
        boundWrite: () => {
          throw thrown
        }
      },
      ['collect', 'write']
    ]
  ])(
    'records the record failed, with the error as thrown, when %s',
    async (_name, overrides, seen) => {
      const { value, steps } = recording(overrides)
      await expect(finishRecord(value)).resolves.toEqual({
        present: false,
        reason: 'failed',
        error: thrown
      })
      expect(steps).toEqual(seen)
    }
  )

  it('records the record failed when the strict schema refuses a count or the details', async () => {
    const main = document()
    const negative = await finishRecord(
      recording({
        collect: async () => ({
          exchanges: [main],
          counts: { ...COUNTS, cached: -1 },
          mainDocument: main,
          methodFacts: {}
        })
      }).value
    )
    expect(negative).toMatchObject({ present: false, reason: 'failed' })
    expect(negative).not.toHaveProperty('warcGz')
    const refused = document('https://127.0.0.1/', { ...DETAILS, validTo: 'next year' })
    const details = await finishRecord(
      recording({
        collect: async () => ({
          exchanges: [refused],
          counts: COUNTS,
          mainDocument: refused,
          methodFacts: {}
        })
      }).value
    )
    expect(details).toMatchObject({ present: false, reason: 'failed' })
    expect(details).not.toHaveProperty('warcGz')
  })
})

describe('boundTlsOf (plan D7)', () => {
  const details = {
    protocol: 'TLS 1.3',
    keyExchange: '',
    keyExchangeGroup: 'X25519',
    cipher: 'AES_128_GCM',
    subjectName: '127.0.0.1',
    sanList: ['127.0.0.1'],
    issuer: 'Birdbrain Test CA',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z',
    signedCertificateTimestampList: [],
    certificateTransparencyCompliance: 'unknown' as const,
    encryptedClientHello: false
  }
  const main = (url: string, state: Exchange['state'], secure = true): Exchange => ({
    requestId: 'doc',
    hop: 0,
    state,
    complete: state === 'complete',
    startedAt: '2026-10-26T12:00:00.000Z',
    request: { method: 'GET', url, headers: {} },
    response: {
      url,
      status: 200,
      statusText: 'OK',
      mimeType: 'text/html',
      headers: {},
      ...(secure ? { securityDetails: details } : {})
    }
  })

  it('states the main document details over https', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete'), 'https://127.0.0.1/')).toEqual({
      boundTls: details
    })
  })

  it('states not-https for an http main document', () => {
    expect(boundTlsOf(main('http://127.0.0.1/', 'complete', false), 'http://127.0.0.1/')).toEqual({
      boundTlsAbsent: 'not-https'
    })
  })

  it('states from-cache for a cached https main document, whatever it reported', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'cached'), 'https://127.0.0.1/')).toEqual({
      boundTlsAbsent: 'from-cache'
    })
  })

  it('states not-reported for a main document whose URL does not parse', () => {
    expect(boundTlsOf(main('not a url', 'complete'), 'not a url')).toEqual({
      boundTlsAbsent: 'not-reported'
    })
  })

  it('states not-reported when the window ends on a page the main document did not produce', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete'), 'about:blank')).toEqual({
      boundTlsAbsent: 'not-reported'
    })
    expect(boundTlsOf(main('http://127.0.0.1/', 'complete', false), 'about:blank')).toEqual({
      boundTlsAbsent: 'not-reported'
    })
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete'), 'not a url')).toEqual({
      boundTlsAbsent: 'not-reported'
    })
  })

  it('states not-reported when the saved page came from no recorded request', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete'), undefined)).toEqual({
      boundTlsAbsent: 'not-reported'
    })
  })

  it('states not-reported with no details or no main document', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete', false), 'https://127.0.0.1/')).toEqual(
      {
        boundTlsAbsent: 'not-reported'
      }
    )
    expect(boundTlsOf(undefined, 'https://127.0.0.1/')).toEqual({ boundTlsAbsent: 'not-reported' })
  })
})
