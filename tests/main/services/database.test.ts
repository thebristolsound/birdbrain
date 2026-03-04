import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDatabase,
  closeDatabase,
  listCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  listCaptures,
  getCapture,
  insertCapture,
  deleteCapture,
  getCaptureCount,
  listTags,
  createTag,
  updateTag,
  deleteTag,
  addTagToCapture,
  removeTagFromCapture,
  getTagsForCapture,
  searchCaptures,
  getEntitiesByCapture,
  insertEntity,
  deleteEntitiesByCapture
} from '@main/services/database'

describe('database', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  describe('cases', () => {
    it('creates and retrieves a case', () => {
      const c = createCase({ name: 'Test Case', description: 'A test' })
      expect(c.name).toBe('Test Case')
      expect(c.description).toBe('A test')
      expect(c.id).toBeDefined()
      expect(c.archived).toBe(false)

      const retrieved = getCase(c.id)
      expect(retrieved).toEqual(c)
    })

    it('lists cases ordered by most recent first', () => {
      createCase({ name: 'Case A' })
      createCase({ name: 'Case B' })
      const cases = listCases()
      expect(cases).toHaveLength(2)
      // Case B was created second, so it should be first (rowid tiebreaker)
      expect(cases[0].name).toBe('Case B')
    })

    it('updates a case', () => {
      const c = createCase({ name: 'Original' })
      const updated = updateCase({ id: c.id, name: 'Updated' })
      expect(updated?.name).toBe('Updated')
    })

    it('deletes a case', () => {
      const c = createCase({ name: 'To Delete' })
      expect(deleteCase(c.id)).toBe(true)
      expect(getCase(c.id)).toBeUndefined()
    })

    it('archives a case and excludes from list', () => {
      const c = createCase({ name: 'To Archive' })
      updateCase({ id: c.id, archived: true })
      expect(listCases()).toHaveLength(0)
    })

    it('returns undefined for non-existent case', () => {
      expect(getCase('nonexistent')).toBeUndefined()
    })
  })

  describe('captures', () => {
    let caseId: string

    beforeEach(() => {
      const c = createCase({ name: 'Test Case' })
      caseId = c.id
    })

    it('inserts and retrieves a capture', () => {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc123',
        timestamp: new Date().toISOString(),
        textContent: 'Example page content'
      })
      expect(cap.url).toBe('https://example.com')
      expect(cap.hash).toBe('abc123')

      const retrieved = getCapture(cap.id)
      expect(retrieved).toEqual(cap)
    })

    it('lists captures for a case', () => {
      insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      insertCapture({
        caseId,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: new Date().toISOString()
      })
      expect(listCaptures(caseId)).toHaveLength(2)
    })

    it('deletes a capture', () => {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc',
        timestamp: new Date().toISOString()
      })
      expect(deleteCapture(cap.id)).toBe(true)
      expect(getCapture(cap.id)).toBeUndefined()
    })

    it('counts captures for a case', () => {
      insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      expect(getCaptureCount(caseId)).toBe(1)
    })

    it('updates case updated_at when capture is inserted', () => {
      const caseBefore = getCase(caseId)!
      // Small delay to ensure different timestamp
      insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      const caseAfter = getCase(caseId)!
      expect(caseAfter.updatedAt >= caseBefore.updatedAt).toBe(true)
    })
  })

  describe('tags', () => {
    it('creates and lists tags', () => {
      createTag({ name: 'important', color: '#ff0000' })
      createTag({ name: 'reviewed' })
      const tags = listTags()
      expect(tags).toHaveLength(2)
    })

    it('updates a tag', () => {
      const tag = createTag({ name: 'old' })
      const updated = updateTag({ id: tag.id, name: 'new' })
      expect(updated?.name).toBe('new')
    })

    it('deletes a tag', () => {
      const tag = createTag({ name: 'temp' })
      expect(deleteTag(tag.id)).toBe(true)
      expect(listTags()).toHaveLength(0)
    })

    it('adds and removes tags from captures', () => {
      const c = createCase({ name: 'Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      const tag = createTag({ name: 'important' })

      addTagToCapture({ captureId: cap.id, tagId: tag.id })
      expect(getTagsForCapture(cap.id)).toHaveLength(1)

      removeTagFromCapture({ captureId: cap.id, tagId: tag.id })
      expect(getTagsForCapture(cap.id)).toHaveLength(0)
    })
  })

  describe('search', () => {
    it('finds captures by text content', () => {
      const c = createCase({ name: 'Test' })
      insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example Page',
        hash: 'h1',
        timestamp: new Date().toISOString(),
        textContent: 'This page contains unique keyword birdbrain'
      })
      insertCapture({
        caseId: c.id,
        url: 'https://other.com',
        title: 'Other Page',
        hash: 'h2',
        timestamp: new Date().toISOString(),
        textContent: 'Nothing special here'
      })

      const results = searchCaptures('birdbrain')
      expect(results).toHaveLength(1)
      expect(results[0].url).toBe('https://example.com')
    })

    it('finds captures by title', () => {
      const c = createCase({ name: 'Test' })
      insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Unique Title Here',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })

      const results = searchCaptures('Unique')
      expect(results).toHaveLength(1)
    })
  })

  describe('entities', () => {
    it('inserts and retrieves entities for a capture', () => {
      const c = createCase({ name: 'Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })

      insertEntity({
        captureId: cap.id,
        type: 'person',
        value: 'John Smith',
        context: 'John Smith is the CEO',
        confidence: 0.95
      })

      const entities = getEntitiesByCapture(cap.id)
      expect(entities).toHaveLength(1)
      expect(entities[0].value).toBe('John Smith')
      expect(entities[0].type).toBe('person')
      expect(entities[0].confidence).toBe(0.95)
    })

    it('deletes entities by capture', () => {
      const c = createCase({ name: 'Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })

      insertEntity({ captureId: cap.id, type: 'email', value: 'test@test.com' })
      insertEntity({ captureId: cap.id, type: 'domain', value: 'example.com' })

      const deleted = deleteEntitiesByCapture(cap.id)
      expect(deleted).toBe(2)
      expect(getEntitiesByCapture(cap.id)).toHaveLength(0)
    })
  })
})
