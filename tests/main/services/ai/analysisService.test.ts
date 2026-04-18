import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase, insertCapture } from '@main/services/database'
import { saveAnalysis, getAnalysis } from '@main/services/ai/analysisService'
import type { CaptureAnalysis } from '@shared/types'

function makeAnalysis(
  overrides: Partial<CaptureAnalysis> & Pick<CaptureAnalysis, 'captureId' | 'caseId'>
): CaptureAnalysis {
  const now = new Date().toISOString()
  return {
    id: 'a1',
    content: 'first',
    model: 'test/model-a',
    tokenUsage: { prompt: 1, completion: 2, total: 3 },
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('ai/analysisService', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  describe('saveAnalysis (upsert semantics)', () => {
    it('inserts a new row when none exists for the captureId', () => {
      const c = createCase({ name: 'Case A' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })

      saveAnalysis(makeAnalysis({ captureId: cap.id, caseId: c.id }))

      const row = getAnalysis(cap.id)
      expect(row).not.toBeNull()
      expect(row!.content).toBe('first')
      expect(row!.model).toBe('test/model-a')
      expect(row!.tokenUsage).toEqual({ prompt: 1, completion: 2, total: 3 })
    })

    it('updates content, model, and tokenUsage when called again for the same captureId', () => {
      const c = createCase({ name: 'Case B' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'h2',
        timestamp: new Date().toISOString()
      })

      saveAnalysis(makeAnalysis({ captureId: cap.id, caseId: c.id }))
      const firstId = getAnalysis(cap.id)!.id

      saveAnalysis(
        makeAnalysis({
          captureId: cap.id,
          caseId: c.id,
          id: 'a2-ignored',
          content: 'second',
          model: 'test/model-b',
          tokenUsage: { prompt: 10, completion: 20, total: 30 },
          updatedAt: new Date(Date.now() + 1000).toISOString()
        })
      )

      const row = getAnalysis(cap.id)
      expect(row).not.toBeNull()
      expect(row!.content).toBe('second')
      expect(row!.model).toBe('test/model-b')
      expect(row!.tokenUsage).toEqual({ prompt: 10, completion: 20, total: 30 })
      // Original id is preserved — ON CONFLICT(capture_id) keeps the existing row
      expect(row!.id).toBe(firstId)
    })

    it('keeps rows isolated per captureId', () => {
      const c = createCase({ name: 'Case C' })
      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://a.example.com',
        title: 'A',
        hash: 'h3',
        timestamp: new Date().toISOString()
      })
      const cap2 = insertCapture({
        caseId: c.id,
        url: 'https://b.example.com',
        title: 'B',
        hash: 'h4',
        timestamp: new Date().toISOString()
      })

      saveAnalysis(makeAnalysis({ id: 'iso-1', captureId: cap1.id, caseId: c.id, content: 'one' }))
      saveAnalysis(makeAnalysis({ id: 'iso-2', captureId: cap2.id, caseId: c.id, content: 'two' }))

      expect(getAnalysis(cap1.id)!.content).toBe('one')
      expect(getAnalysis(cap2.id)!.content).toBe('two')
    })
  })

  describe('getAnalysis', () => {
    it('returns null when no analysis exists', () => {
      expect(getAnalysis('does-not-exist')).toBeNull()
    })
  })
})
