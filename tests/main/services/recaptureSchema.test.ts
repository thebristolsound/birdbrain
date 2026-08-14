import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCapture } from '@main/services/db/captureRepo'

describe('recapture schema (migration v23)', () => {
  let caseId: string

  beforeEach(async () => {
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Recapture Schema' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  it('stores and reads method and supersedesCaptureId', () => {
    const original = insertCapture({
      caseId,
      url: 'https://example.com/a',
      title: 'A',
      hash: 'h1',
      timestamp: '2026-07-03T00:00:00.000Z'
    })
    const recap = insertCapture({
      caseId,
      url: 'https://example.com/a',
      title: 'A again',
      hash: 'h2',
      timestamp: '2026-07-03T01:00:00.000Z',
      method: 'background',
      supersedesCaptureId: original.id
    })
    const read = getCapture(recap.id)!
    expect(read.method).toBe('background')
    expect(read.supersedesCaptureId).toBe(original.id)
  })

  it('defaults method to extension and supersedesCaptureId to undefined', () => {
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/b',
      title: 'B',
      hash: 'h3',
      timestamp: '2026-07-03T00:00:00.000Z'
    })
    const read = getCapture(cap.id)!
    expect(read.method).toBe('extension')
    expect(read.supersedesCaptureId).toBeUndefined()
  })
})
