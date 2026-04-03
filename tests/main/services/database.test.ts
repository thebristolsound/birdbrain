import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDatabase,
  closeDatabase,
  getDb,
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
  getTagCountForCase,
  getSelectorCoverage,
  createSelector,
  matchSelectorAgainstCaptures,
  listActiveSelectors
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

  describe('migration v7 - drop entity tables', () => {
    it('drops entities and case_analyses tables', () => {
      const tables = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities', 'case_analyses')"
        )
        .all()
      expect(tables).toHaveLength(0)
    })

    it('sets user_version to 7 after v7 migration', () => {
      // v8 migration runs immediately after, so final version is 8
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(8)
    })
  })

  describe('migration v8 - performance indexes', () => {
    it('creates idx_captures_case_id index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_captures_case_id'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('creates idx_capture_tags_tag_id index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_capture_tags_tag_id'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('sets user_version to 8', () => {
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(8)
    })
  })

  describe('case metrics', () => {
    it('counts distinct tags for a case', () => {
      const c = createCase({ name: 'Tag Count Test' })
      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: new Date().toISOString()
      })
      const cap2 = insertCapture({
        caseId: c.id,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: new Date().toISOString()
      })
      const tag1 = createTag({ name: 'important' })
      const tag2 = createTag({ name: 'reviewed' })
      addTagToCapture({ captureId: cap1.id, tagId: tag1.id })
      addTagToCapture({ captureId: cap1.id, tagId: tag2.id })
      addTagToCapture({ captureId: cap2.id, tagId: tag1.id })

      expect(getTagCountForCase(c.id)).toBe(2)
    })

    it('returns 0 for case with no tags', () => {
      const c = createCase({ name: 'No Tags' })
      expect(getTagCountForCase(c.id)).toBe(0)
    })

    it('computes selector coverage', () => {
      const c = createCase({ name: 'Coverage Test' })
      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://a.com',
        title: 'A',
        hash: 'cov1',
        timestamp: new Date().toISOString()
      })
      insertCapture({
        caseId: c.id,
        url: 'https://b.com',
        title: 'B',
        hash: 'cov2',
        timestamp: new Date().toISOString()
      })
      const sel = createSelector({ caseId: c.id, pattern: 'a\\.com', isRegex: true, label: 'test' })
      matchSelectorAgainstCaptures(sel.id, [
        { captureId: cap1.id, text: 'visit https://a.com today' }
      ])

      const cov = getSelectorCoverage(c.id)
      expect(cov.total).toBe(2)
      expect(cov.matched).toBe(1)
    })

    it('returns zero coverage for empty case', () => {
      const c = createCase({ name: 'Empty' })
      const cov = getSelectorCoverage(c.id)
      expect(cov).toEqual({ matched: 0, total: 0 })
    })
  })

  describe('listActiveSelectors', () => {
    it('returns only selectors for the specified case', () => {
      const case1 = createCase({ name: 'Case A' })
      const case2 = createCase({ name: 'Case B' })
      createSelector({ caseId: case1.id, pattern: 'alpha' })
      createSelector({ caseId: case2.id, pattern: 'beta' })

      const result = listActiveSelectors(case1.id)
      expect(result).toHaveLength(1)
      expect(result[0].caseId).toBe(case1.id)
      expect(result[0].selectors).toHaveLength(1)
      expect(result[0].selectors[0].pattern).toBe('alpha')
    })

    it('returns all enabled selectors when no caseId given', () => {
      const case1 = createCase({ name: 'Case A' })
      const case2 = createCase({ name: 'Case B' })
      createSelector({ caseId: case1.id, pattern: 'alpha' })
      createSelector({ caseId: case2.id, pattern: 'beta' })

      const result = listActiveSelectors()
      expect(result).toHaveLength(2)
    })

    it('returns empty array for unknown caseId', () => {
      const result = listActiveSelectors('nonexistent')
      expect(result).toHaveLength(0)
    })
  })

})
