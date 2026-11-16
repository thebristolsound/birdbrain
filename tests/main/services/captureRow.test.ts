import { describe, it, expect } from 'vitest'
import { captureRowOf } from '@main/services/captureRow'
import type { CaptureRowLocal, MirroredCaptureEntry } from '@main/services/captureRow'
import { BoundTlsSchema, CaptureInventorySchema, ScrollToLoadRecordSchema } from '@shared/schemas'
import {
  ENGINE_BOUND_TLS,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD
} from '../../helpers/captureEnginePackage'

// The inputs a writer states beside the entry. What the entry's own fields become is pinned for
// all three writers in captureRowKnownAnswers.test.ts.

const ENTRY: MirroredCaptureEntry = {
  captureId: 'capture-1',
  url: 'https://example.com/page',
  timestamp: '2026-11-14T08:30:00.000Z',
  contentHash: 'a'.repeat(64),
  sizeBytes: 11,
  exhibitNumber: 4,
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0',
  index: 7,
  prevHash: 'b'.repeat(64),
  entryHash: 'c'.repeat(64)
}

const LOCAL: CaptureRowLocal = {
  caseId: 'case-1',
  title: 'Page',
  mhtmlPath: 'case-1/capture-1.mhtml'
}

describe('captureRowOf', () => {
  it('files the row under the local Case with the entry id, index and hashes', () => {
    expect(captureRowOf(ENTRY, LOCAL)).toMatchObject({
      id: 'capture-1',
      caseId: 'case-1',
      format: 'mhtml',
      hash: ENTRY.contentHash,
      manifestIndex: 7,
      prevHash: ENTRY.prevHash,
      entryHash: ENTRY.entryHash,
      exhibitNumber: 4
    })
  })

  it('mirrors the headers the entry signs, and none when it signs none', () => {
    expect(captureRowOf(ENTRY, LOCAL).headers).toBeUndefined()
    const signed = { ...ENTRY, headers: { server: 'nginx' } }
    expect(captureRowOf(signed, LOCAL).headers).toBe('{"server":"nginx"}')
  })

  it('keeps the headers a writer passes, an empty set included, over the entry', () => {
    expect(captureRowOf(ENTRY, { ...LOCAL, headers: {} }).headers).toBe('{}')
    const signed = { ...ENTRY, headers: { server: 'nginx' } }
    expect(captureRowOf(signed, { ...LOCAL, headers: { via: 'proxy' } }).headers).toBe(
      '{"via":"proxy"}'
    )
  })

  it('takes the user agent and browser versions from the writer, never from the entry', () => {
    const signed = { ...ENTRY, userAgent: 'signed UA' }
    expect(captureRowOf(signed, LOCAL).userAgent).toBeUndefined()
    expect(
      captureRowOf(signed, {
        ...LOCAL,
        userAgent: 'seen UA',
        browserVersion: 'Chrome/142',
        extensionVersion: '1.4.0'
      })
    ).toMatchObject({
      userAgent: 'seen UA',
      browserVersion: 'Chrome/142',
      extensionVersion: '1.4.0'
    })
  })

  it("keeps the id the entry signs for a link source unless the writer names the source's row", () => {
    const link = {
      ...ENTRY,
      linkedFromCaptureId: 'signed-source',
      linkedFromContentHash: '5'.repeat(64),
      linkHref: 'http://example.com/page'
    }
    expect(captureRowOf(link, LOCAL).linkedFromCaptureId).toBe('signed-source')
    expect(captureRowOf(link, { ...LOCAL, linkedFromRowId: 'renamed-row' })).toMatchObject({
      linkedFromCaptureId: 'renamed-row',
      linkedFromContentHash: '5'.repeat(64),
      linkHref: 'http://example.com/page'
    })
  })

  it("takes a writer's Exhibit Number over the entry's, and the entry's without one", () => {
    expect(captureRowOf(ENTRY, { ...LOCAL, exhibitNumber: 9 }).exhibitNumber).toBe(9)
    const unnumbered = { ...ENTRY, exhibitNumber: undefined }
    expect(captureRowOf(unnumbered, { ...LOCAL, exhibitNumber: 9 }).exhibitNumber).toBe(9)
    expect(captureRowOf(unnumbered, LOCAL).exhibitNumber).toBeUndefined()
  })

  const ENGINE = {
    ...ENTRY,
    inventory: CaptureInventorySchema.parse(ENGINE_INVENTORY),
    scrollToLoad: ScrollToLoadRecordSchema.parse(ENGINE_SCROLL_TO_LOAD),
    transactionRecordHash: ENGINE_HASHES.transactionRecord,
    boundTls: BoundTlsSchema.parse(ENGINE_BOUND_TLS),
    pdfHash: ENGINE_HASHES.pdf
  }
  const ENGINE_KEYS = [
    'inventory',
    'scrollToLoad',
    'transactionRecordHash',
    'boundTls',
    'boundTlsAbsent',
    'pdfHash'
  ] as const

  it('mirrors the capture engine fields the entry signs', () => {
    const row = captureRowOf(ENGINE, LOCAL)
    for (const key of ENGINE_KEYS) expect(row[key]).toEqual(ENGINE[key])
    const absent = captureRowOf({ ...ENTRY, boundTlsAbsent: 'not-https' }, LOCAL)
    expect(absent.boundTlsAbsent).toBe('not-https')
  })

  it('leaves every capture engine column empty for a writer that turns them off', () => {
    const row = captureRowOf(
      { ...ENGINE, boundTls: undefined, boundTlsAbsent: 'not-https' },
      { ...LOCAL, captureEngineFields: false }
    )
    for (const key of ENGINE_KEYS) expect(row[key]).toBeUndefined()
  })

  it("carries another member's authorship and committed time only when given", () => {
    expect(captureRowOf(ENTRY, LOCAL)).toMatchObject({ author: undefined, committedAt: undefined })
    const author = { installationId: 'alice', memberCode: 'AL' }
    expect(captureRowOf(ENTRY, { ...LOCAL, author, committedAt: ENTRY.timestamp })).toMatchObject({
      author,
      committedAt: ENTRY.timestamp
    })
  })
})
