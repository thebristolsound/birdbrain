import { describe, it, expect } from 'vitest'
import { resolveEntrySignatures, resolveExhibitEntrySignatures } from '@main/services/export'
import type { Capture, Exhibit } from '@shared/types'

// #1472: a row an import renamed is looked up under the id its chain carries,
// and the returned map stays keyed by row id for report.html and the
// certification to read.

const TIME = '2026-09-30T10:00:00.000Z'
const H = 'a'.repeat(64)

function capture(id: string): Capture {
  return {
    id,
    caseId: 'case',
    url: 'https://example.com/page',
    title: id,
    hash: H,
    timestamp: TIME,
    createdAt: TIME,
    format: 'mhtml',
    method: 'extension',
    manifestIndex: 0
  }
}

function exhibit(id: string): Exhibit {
  return {
    id,
    caseId: 'case',
    kind: 'document',
    origin: 'manual-upload',
    exhibitNumber: 1,
    memberCode: null,
    authorInstallationId: null,
    name: `${id}.pdf`,
    contentHash: H,
    path: `case/documents/${id}.pdf`,
    sizeBytes: 1,
    committedAt: TIME,
    manifestSeq: 0
  }
}

const signed = { schemaVersion: 2, signature: 'c2lnbmF0dXJl' }
const captureEntry = (captureId: string, signature = signed) => ({
  type: 'capture',
  captureId,
  ...signature
})
const exhibitEntry = (exhibitId: string, signature = signed) => ({
  type: 'exhibit',
  exhibitId,
  ...signature
})

const identity = (id: string): string => id
const renamed =
  (names: Record<string, string>) =>
  (id: string): string =>
    names[id] ?? id

describe('resolveEntrySignatures (#1472)', () => {
  it('reads a renamed capture under the id its chain carries', () => {
    const statuses = resolveEntrySignatures(
      [capture('new-capture')],
      [captureEntry('old-capture')],
      renamed({ 'new-capture': 'old-capture' })
    )
    expect(statuses.get('new-capture')).toBe('signed')
  })

  it('states no entry for a capture whose chain id has none', () => {
    const statuses = resolveEntrySignatures(
      [capture('new-capture')],
      [captureEntry('someone-else')],
      renamed({ 'new-capture': 'old-capture' })
    )
    expect(statuses.get('new-capture')).toBe('no-entry')
  })

  it('folds entries by their own ids under an identity chain name', () => {
    const statuses = resolveEntrySignatures(
      [capture('signed'), capture('legacy'), capture('unchained')],
      [captureEntry('signed'), captureEntry('legacy', { schemaVersion: 1, signature: '' })],
      identity
    )
    expect(statuses).toEqual(
      new Map([
        ['signed', 'signed'],
        ['legacy', 'unsigned-legacy'],
        ['unchained', 'no-entry']
      ])
    )
  })
})

describe('resolveExhibitEntrySignatures (#1472)', () => {
  it('reads a renamed exhibit under the id its chain carries', () => {
    const statuses = resolveExhibitEntrySignatures(
      [exhibit('new-doc')],
      [exhibitEntry('old-doc')],
      renamed({ 'new-doc': 'old-doc' })
    )
    expect(statuses.get('new-doc')).toBe('signed')
  })

  it('states no entry for an exhibit whose chain id has none', () => {
    const statuses = resolveExhibitEntrySignatures(
      [exhibit('new-doc')],
      [exhibitEntry('someone-else')],
      renamed({ 'new-doc': 'old-doc' })
    )
    expect(statuses.get('new-doc')).toBe('no-entry')
  })

  it('folds entries by their own ids under an identity chain name', () => {
    const statuses = resolveExhibitEntrySignatures(
      [exhibit('signed'), exhibit('legacy'), exhibit('unchained')],
      [exhibitEntry('signed'), exhibitEntry('legacy', { schemaVersion: 1, signature: '' })],
      identity
    )
    expect(statuses).toEqual(
      new Map([
        ['signed', 'signed'],
        ['legacy', 'unsigned-legacy'],
        ['unchained', 'no-entry']
      ])
    )
  })
})
