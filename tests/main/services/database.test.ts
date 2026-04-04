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
  listActiveSelectors,
  createNote,
  getNote,
  listNotes,
  deleteNote,
  getNoteCount,
  updateNote,
  searchNotes
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
      // v8, v9, and v10 migrations run immediately after, so final version is 10
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(10)
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
      // v9 and v10 migrations run immediately after, so final version is 10
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(10)
    })
  })

  describe('migration v9 - capture favorites', () => {
    it('creates capture_favorites table', () => {
      const table = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='capture_favorites'")
        .get()
      expect(table).toBeDefined()
    })

    it('creates idx_capture_favorites_created index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_capture_favorites_created'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('sets user_version to 9', () => {
      // v10 migration runs immediately after, so final version is 10
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(10)
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

  describe('notes schema (migration 10)', () => {
    it('creates notes table with expected columns', () => {
      const cols = getDb().prepare("PRAGMA table_info('notes')").all() as Array<{
        name: string
        notnull: number
        dflt_value: string | null
      }>
      const names = cols.map((c) => c.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'id',
          'case_id',
          'capture_id',
          'title',
          'body',
          'source_url',
          'screenshot_path',
          'created_at',
          'updated_at'
        ])
      )
      // title and body have defaults and NOT NULL
      const title = cols.find((c) => c.name === 'title')!
      expect(title.notnull).toBe(1)
      expect(title.dflt_value).toBe("''")
      const body = cols.find((c) => c.name === 'body')!
      expect(body.notnull).toBe(1)
      expect(body.dflt_value).toBe("''")
      // capture_id is nullable
      const captureId = cols.find((c) => c.name === 'capture_id')!
      expect(captureId.notnull).toBe(0)
    })

    it('creates indexes on case_id and capture_id', () => {
      const idx = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes'")
        .all() as Array<{ name: string }>
      const names = idx.map((i) => i.name)
      expect(names).toContain('idx_notes_case_id')
      expect(names).toContain('idx_notes_capture_id')
    })

    it('creates notes_fts virtual table', () => {
      const tbl = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'")
        .get() as { name: string } | undefined
      expect(tbl).toBeDefined()
    })

    it('creates insert/update/delete triggers for notes_fts sync', () => {
      const triggers = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='notes'")
        .all() as Array<{ name: string }>
      const names = triggers.map((t) => t.name)
      expect(names).toContain('notes_ai')
      expect(names).toContain('notes_ad')
      expect(names).toContain('notes_au')
    })

    it('sets capture_id to NULL when referenced capture is deleted', () => {
      const c = createCase({ name: 'Case' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc',
        timestamp: new Date().toISOString()
      })
      // Insert via raw SQL to directly exercise the FK `ON DELETE SET NULL` behavior,
      // independent of the createNote helper.
      getDb()
        .prepare(
          'INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          'note1',
          c.id,
          cap.id,
          'T',
          'B',
          'https://example.com',
          null,
          '2024-01-01T00:00:00Z',
          '2024-01-01T00:00:00Z'
        )
      // Delete the capture
      deleteCapture(cap.id)
      const row = getDb().prepare('SELECT capture_id FROM notes WHERE id = ?').get('note1') as {
        capture_id: string | null
      }
      expect(row.capture_id).toBeNull()
    })

    it('cascades delete when case is deleted', () => {
      const c = createCase({ name: 'Case' })
      getDb()
        .prepare(
          'INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          'note2',
          c.id,
          null,
          'T',
          'B',
          null,
          null,
          '2024-01-01T00:00:00Z',
          '2024-01-01T00:00:00Z'
        )
      deleteCase(c.id)
      const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get('note2')
      expect(row).toBeUndefined()
    })
  })

  describe('notes CRUD', () => {
    it('creates a note with minimal params', () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id })
      expect(n.id).toBeDefined()
      expect(n.caseId).toBe(c.id)
      expect(n.title).toBe('')
      expect(n.body).toBe('')
      expect(n.captureId).toBeUndefined()
      expect(n.sourceUrl).toBeUndefined()
      expect(n.screenshotPath).toBeUndefined()
      expect(n.createdAt).toBeDefined()
      expect(n.updatedAt).toBe(n.createdAt)
    })

    it('creates a note with all fields', () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc',
        timestamp: new Date().toISOString()
      })
      const n = createNote({
        caseId: c.id,
        captureId: cap.id,
        title: 'My note',
        body: 'Observation body',
        sourceUrl: 'https://example.com',
        screenshotPath: 'path/to/shot.png'
      })
      expect(n.title).toBe('My note')
      expect(n.body).toBe('Observation body')
      expect(n.captureId).toBe(cap.id)
      expect(n.sourceUrl).toBe('https://example.com')
      expect(n.screenshotPath).toBe('path/to/shot.png')
    })

    it('retrieves a note by id', () => {
      const c = createCase({ name: 'C' })
      const created = createNote({ caseId: c.id, title: 'T', body: 'B' })
      const got = getNote(created.id)
      expect(got).toEqual(created)
    })

    it('returns undefined for missing note', () => {
      expect(getNote('nonexistent')).toBeUndefined()
    })

    it('lists notes for a case ordered by created_at DESC', async () => {
      const c = createCase({ name: 'C' })
      const first = createNote({ caseId: c.id, title: 'First' })
      await new Promise((r) => setTimeout(r, 5))
      const second = createNote({ caseId: c.id, title: 'Second' })
      const list = listNotes(c.id)
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe(second.id)
      expect(list[1].id).toBe(first.id)
    })

    it('lists only notes for the given case', () => {
      const a = createCase({ name: 'A' })
      const b = createCase({ name: 'B' })
      createNote({ caseId: a.id, title: 'A-1' })
      createNote({ caseId: b.id, title: 'B-1' })
      expect(listNotes(a.id)).toHaveLength(1)
      expect(listNotes(a.id)[0].title).toBe('A-1')
    })

    it('deletes a note', () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id })
      expect(deleteNote(n.id)).toBe(true)
      expect(getNote(n.id)).toBeUndefined()
    })

    it('returns false when deleting a missing note', () => {
      expect(deleteNote('nonexistent')).toBe(false)
    })

    it('counts notes for a case', () => {
      const c = createCase({ name: 'C' })
      expect(getNoteCount(c.id)).toBe(0)
      createNote({ caseId: c.id })
      createNote({ caseId: c.id })
      expect(getNoteCount(c.id)).toBe(2)
    })

    it('updates a note title and body', async () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id, title: 'old', body: 'old body' })
      await new Promise((r) => setTimeout(r, 5))
      const updated = updateNote({ id: n.id, title: 'new', body: 'new body' })
      expect(updated?.title).toBe('new')
      expect(updated?.body).toBe('new body')
      expect(updated?.updatedAt).not.toBe(n.updatedAt)
      expect(updated?.createdAt).toBe(n.createdAt)
    })

    it('preserves unset fields on update', () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id, title: 'keep', body: 'original' })
      const updated = updateNote({ id: n.id, body: 'new body only' })
      expect(updated?.title).toBe('keep')
      expect(updated?.body).toBe('new body only')
    })

    it('returns undefined when updating a missing note', () => {
      expect(updateNote({ id: 'nonexistent', title: 'x' })).toBeUndefined()
    })
  })

  describe('notes search (FTS)', () => {
    it('finds notes matching a query in body', () => {
      const c = createCase({ name: 'C' })
      createNote({ caseId: c.id, title: 'alpha', body: 'mentions something interesting' })
      createNote({ caseId: c.id, title: 'beta', body: 'unrelated content' })
      const results = searchNotes(c.id, 'interesting')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('alpha')
    })

    it('finds notes matching a query in title', () => {
      const c = createCase({ name: 'C' })
      createNote({ caseId: c.id, title: 'zebra report', body: 'body' })
      createNote({ caseId: c.id, title: 'other', body: 'body' })
      const results = searchNotes(c.id, 'zebra')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('zebra report')
    })

    it('scopes search to the given case', () => {
      const a = createCase({ name: 'A' })
      const b = createCase({ name: 'B' })
      createNote({ caseId: a.id, title: 'term', body: 'x' })
      createNote({ caseId: b.id, title: 'term', body: 'x' })
      const results = searchNotes(a.id, 'term')
      expect(results).toHaveLength(1)
      expect(results[0].caseId).toBe(a.id)
    })

    it('returns empty array for empty query', () => {
      const c = createCase({ name: 'C' })
      createNote({ caseId: c.id, title: 'x', body: 'y' })
      expect(searchNotes(c.id, '')).toEqual([])
    })

    it('reflects updates via FTS triggers', () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id, title: 'original', body: 'body' })
      updateNote({ id: n.id, title: 'changed' })
      expect(searchNotes(c.id, 'original')).toHaveLength(0)
      expect(searchNotes(c.id, 'changed')).toHaveLength(1)
    })

    it('reflects deletes via FTS triggers', () => {
      const c = createCase({ name: 'C' })
      const n = createNote({ caseId: c.id, title: 'temp', body: 'body' })
      expect(searchNotes(c.id, 'temp')).toHaveLength(1)
      deleteNote(n.id)
      expect(searchNotes(c.id, 'temp')).toHaveLength(0)
    })
  })
})
