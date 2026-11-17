import { describe, expect, it } from 'vitest'
import { finishFields } from '../inventory'
import type { FinishedParts } from '../inventory'
import type { PresentRecord } from '../record'
import { CaptureInventorySchema } from '@shared/schemas'

// The inventory and the ingest's fields from the parts a Capture Method finished with.

const SCREENSHOT = {
  scaled: false,
  truncated: true,
  trimmed: false,
  contentWidth: 100,
  contentHeight: 200,
  width: 100,
  height: 150
}

const RECORD_PART = {
  present: true as const,
  exchanges: 1,
  cached: 0,
  cancelled: 0,
  failed: 0,
  inFlight: 0,
  finishedWithoutResponse: 0,
  bodiesOmitted: 0,
  incompleteRequestBodies: 0,
  webSockets: 0,
  recordedTargets: 1,
  unrecordedTargets: 0,
  replacedHeaders: [],
  budget: { totalBytes: 1_000, resourceBytes: 300 }
}

const BOUND_TLS = {
  protocol: 'TLS 1.3',
  keyExchange: '',
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

const WARC = Buffer.from('warc')
const PDF = Buffer.from('%PDF-1.4')
const RECORD: PresentRecord = {
  present: true,
  warcGz: WARC,
  inventory: RECORD_PART,
  boundTls: BOUND_TLS
}

const parts = (overrides: Partial<FinishedParts> = {}): FinishedParts => ({
  mhtml: { present: true, pinnedImages: 3, pinnedImagesNotLoaded: 1 },
  screenshot: SCREENSHOT,
  transactionRecord: RECORD,
  pdf: { present: true, bytes: PDF, inventory: { present: true, afterCollection: true } },
  ...overrides
})

describe('finishFields', () => {
  it('signs each part as the method supplied it, with the record, its details and the PDF', () => {
    const fields = finishFields(parts())
    expect(fields).toEqual({
      inventory: {
        mhtml: { present: true, pinnedImages: 3, pinnedImagesNotLoaded: 1 },
        transactionRecord: RECORD_PART,
        screenshot: { present: true, ...SCREENSHOT },
        pdf: { present: true, afterCollection: true }
      },
      transactionRecord: WARC,
      boundTls: BOUND_TLS,
      pdf: PDF
    })
    expect(Object.keys(fields)).toEqual(['inventory', 'transactionRecord', 'boundTls', 'pdf'])
    expect(Object.keys(fields.inventory)).toEqual([
      'mhtml',
      'transactionRecord',
      'screenshot',
      'pdf'
    ])
    expect(CaptureInventorySchema.safeParse(fields.inventory).success).toBe(true)
  })

  it('hands on why a present record has no details', () => {
    const { present, warcGz, inventory } = RECORD
    const fields = finishFields(
      parts({ transactionRecord: { present, warcGz, inventory, boundTlsAbsent: 'not-https' } })
    )
    expect(Object.keys(fields)).toEqual(['inventory', 'transactionRecord', 'boundTlsAbsent', 'pdf'])
    expect(fields.boundTlsAbsent).toBe('not-https')
  })

  it.each(['failed', 'page-not-recorded', 'back-forward-cache'] as const)(
    'signs an absent record with its reason, %s, and its details not-recorded',
    (reason) => {
      const fields = finishFields(
        parts({ transactionRecord: { present: false, reason, error: new Error('never signed') } })
      )
      expect(fields.inventory.transactionRecord).toEqual({ present: false, reason })
      expect(Object.keys(fields)).toEqual(['inventory', 'boundTlsAbsent', 'pdf'])
      expect(fields.boundTlsAbsent).toBe('not-recorded')
      expect(CaptureInventorySchema.safeParse(fields.inventory).success).toBe(true)
    }
  )

  it('signs a failed PDF absent, and hands the ingest none', () => {
    const fields = finishFields(
      parts({ pdf: { present: false, reason: 'failed', error: new Error('never signed') } })
    )
    expect(fields.inventory.pdf).toEqual({ present: false, reason: 'failed' })
    expect(Object.keys(fields)).toEqual(['inventory', 'transactionRecord', 'boundTls'])
  })
})
