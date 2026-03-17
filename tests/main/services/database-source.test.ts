import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, insertEntity, getEntitiesByCapture, getEntitiesByCaptureAndSource, deleteEntitiesByCaptureAndSource, createCase, insertCapture } from '../../../src/main/services/database'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('database source column', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-test-'))
    initDatabase(join(tempDir, 'test.db'))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('insertEntity stores and returns source field', () => {
    const cs = createCase({ name: 'Test Case' })
    const cap = insertCapture({
      caseId: cs.id,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })

    const entity = insertEntity({
      captureId: cap.id,
      type: 'email',
      value: 'test@example.com',
      source: 'rule'
    })
    expect(entity.source).toBe('rule')

    const entities = getEntitiesByCapture(cap.id)
    expect(entities[0].source).toBe('rule')
  })

  it('defaults source to ai for entities without explicit source', () => {
    const cs = createCase({ name: 'Test Case' })
    const cap = insertCapture({
      caseId: cs.id,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })

    const entity = insertEntity({
      captureId: cap.id,
      type: 'email',
      value: 'test@example.com'
    })
    expect(entity.source).toBe('ai')
  })

  it('deleteEntitiesByCaptureAndSource only deletes matching source', () => {
    const cs = createCase({ name: 'Test Case' })
    const cap = insertCapture({
      caseId: cs.id,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })

    insertEntity({ captureId: cap.id, type: 'email', value: 'rule@example.com', source: 'rule' })
    insertEntity({ captureId: cap.id, type: 'email', value: 'ai@example.com', source: 'ai' })

    const deleted = deleteEntitiesByCaptureAndSource(cap.id, 'ai')
    expect(deleted).toBe(1)

    const remaining = getEntitiesByCapture(cap.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].value).toBe('rule@example.com')
  })

  it('getEntitiesByCaptureAndSource filters by source', () => {
    const cs = createCase({ name: 'Test Case' })
    const cap = insertCapture({
      caseId: cs.id,
      url: 'https://example.com',
      title: 'Test',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })

    insertEntity({ captureId: cap.id, type: 'email', value: 'rule@example.com', source: 'rule' })
    insertEntity({ captureId: cap.id, type: 'email', value: 'ai@example.com', source: 'ai' })

    const ruleEntities = getEntitiesByCaptureAndSource(cap.id, 'rule')
    expect(ruleEntities).toHaveLength(1)
    expect(ruleEntities[0].value).toBe('rule@example.com')
  })
})
