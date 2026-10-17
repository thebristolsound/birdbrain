import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  buildTrustedTimeIndexFromEntries,
  receiptStampFor,
  receiptStampsFromEntries,
  stampFor
} from '@shared/verify'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

// The receipt rule in verify-core (#1515, design decision 15): a `timestamp`
// with `subject: 'entry'` binds a `merge` entry when its token's imprint is
// that entry's Entry Hash. The records here are lenient lines, the shape both
// the app's reader and the package checker hand the rule.

const sha = (input: string): string => createHash('sha256').update(input).digest('hex')
const GEN_TIME = new Date('2026-10-17T10:00:00.000Z')
const TSA = 'tsa.example.com'

const CONTENT_HASH = sha('page bytes')
const CAPTURE_HASH = sha('capture entry')
const MERGE_HASH = sha('merge entry')
const OTHER_MERGE_HASH = sha('another merge entry')

const token = (hash: string): string =>
  buildSyntheticToken({ contentHash: hash, genTime: GEN_TIME, tsaDnsName: TSA }).toString('base64')

const capture = {
  type: 'capture',
  index: 0,
  contentHash: CONTENT_HASH,
  entryHash: CAPTURE_HASH,
  schemaVersion: 2
}
const merge = { type: 'merge', index: 1, entryHash: MERGE_HASH, schemaVersion: 4 }
const receipt = (fields: Record<string, unknown> = {}) => ({
  type: 'timestamp',
  index: 2,
  subject: 'entry',
  captureContentHash: MERGE_HASH,
  tsaToken: token(MERGE_HASH),
  entryHash: sha('receipt entry'),
  schemaVersion: 4,
  ...fields
})

describe('receiptStampFor', () => {
  it('resolves rfc3161 with the TSA name and time the token states', () => {
    expect(receiptStampFor(receipt(), MERGE_HASH)).toEqual({
      trustedTime: 'rfc3161',
      tsaName: TSA,
      stampedAt: GEN_TIME.toISOString()
    })
  })

  it('returns undefined for a content stamp, a wrong imprint, a bad token and a missing token', () => {
    expect(receiptStampFor(receipt({ subject: undefined }), MERGE_HASH)).toBeUndefined()
    expect(
      receiptStampFor(receipt({ tsaToken: token(OTHER_MERGE_HASH) }), MERGE_HASH)
    ).toBeUndefined()
    expect(receiptStampFor(receipt({ tsaToken: 'AAAA' }), MERGE_HASH)).toBeUndefined()
    expect(receiptStampFor(receipt({ tsaToken: undefined }), MERGE_HASH)).toBeUndefined()
    expect(receiptStampFor(receipt(), OTHER_MERGE_HASH)).toBeUndefined()
  })

  it('is never a content stamp, and a content stamp is never a receipt', () => {
    expect(stampFor(receipt(), MERGE_HASH)).toBeUndefined()
    const content = {
      type: 'timestamp',
      captureContentHash: CONTENT_HASH,
      tsaToken: token(CONTENT_HASH)
    }
    expect(stampFor(content, CONTENT_HASH)?.trustedTime).toBe('rfc3161')
    expect(receiptStampFor(content, CONTENT_HASH)).toBeUndefined()
  })
})

describe('receiptStampsFromEntries', () => {
  it('reports a merge stamped by the receipt over its Entry Hash', () => {
    const report = receiptStampsFromEntries([capture, merge, receipt()])
    expect(report).toEqual({
      merges: [
        {
          mergeIndex: 1,
          entryHash: MERGE_HASH,
          stamp: {
            index: 2,
            trustedTime: 'rfc3161',
            tsaName: TSA,
            stampedAt: GEN_TIME.toISOString()
          }
        }
      ],
      unbound: []
    })
  })

  it('leaves a merge unstamped and lists the stamp when its token does not bind it', () => {
    for (const bad of [
      { tsaToken: token(OTHER_MERGE_HASH) },
      { tsaToken: 'not a token' },
      { tsaToken: undefined }
    ]) {
      const report = receiptStampsFromEntries([capture, merge, receipt(bad)])
      expect(report.merges).toEqual([{ mergeIndex: 1, entryHash: MERGE_HASH }])
      expect(report.unbound).toEqual([{ index: 2, entryHash: MERGE_HASH, mergeIndex: 1 }])
    }
  })

  it('lists a receipt naming a capture entry or an unknown hash as binding no merge', () => {
    const onCapture = receipt({ captureContentHash: CAPTURE_HASH, tsaToken: token(CAPTURE_HASH) })
    const onNothing = receipt({ index: 3, captureContentHash: OTHER_MERGE_HASH })
    const report = receiptStampsFromEntries([capture, merge, onCapture, onNothing])
    expect(report.merges).toEqual([{ mergeIndex: 1, entryHash: MERGE_HASH }])
    expect(report.unbound).toEqual([
      { index: 2, entryHash: CAPTURE_HASH },
      { index: 3, entryHash: OTHER_MERGE_HASH }
    ])
  })

  it('keeps the first binding stamp and reports every merge in chain order', () => {
    const second = { type: 'merge', index: 3, entryHash: OTHER_MERGE_HASH, schemaVersion: 4 }
    const again = receipt({ index: 4, entryHash: sha('second receipt') })
    const report = receiptStampsFromEntries([capture, merge, receipt(), second, again])
    expect(report.merges.map((m) => [m.mergeIndex, m.stamp?.index])).toEqual([
      [1, 2],
      [3, undefined]
    ])
    expect(report.unbound).toEqual([])
  })

  it('takes the position as the index of a lenient line carrying none', () => {
    const bare = [
      { type: 'merge', entryHash: MERGE_HASH },
      {
        type: 'timestamp',
        subject: 'entry',
        captureContentHash: MERGE_HASH,
        tsaToken: token(MERGE_HASH)
      }
    ]
    expect(receiptStampsFromEntries(bare).merges[0]).toMatchObject({
      mergeIndex: 0,
      stamp: { index: 1 }
    })
  })

  it('changes no Content Hash answer in the trusted-time index', () => {
    const contentStamp = {
      type: 'timestamp',
      index: 3,
      captureContentHash: CONTENT_HASH,
      tsaToken: token(CONTENT_HASH)
    }
    const without = buildTrustedTimeIndexFromEntries([capture, merge, contentStamp])
    const withReceipt = buildTrustedTimeIndexFromEntries([capture, merge, receipt(), contentStamp])
    expect([...withReceipt]).toEqual([...without])
    expect(withReceipt.get(CONTENT_HASH)?.trustedTime).toBe('rfc3161')
    expect(withReceipt.has(MERGE_HASH)).toBe(false)
    // Without the content stamp the capture stays pending either side too.
    expect(buildTrustedTimeIndexFromEntries([capture, merge, receipt()]).get(CONTENT_HASH)).toEqual(
      {
        trustedTime: 'pending'
      }
    )
  })
})
