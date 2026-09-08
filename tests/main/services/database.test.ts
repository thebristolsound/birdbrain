import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import {
  listCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  getAutoCapturePolicy,
  setAutoCapturePolicy
} from '@main/services/db/caseRepo'
import {
  listCaptures,
  getCapture,
  insertCapture,
  deleteCapture,
  getCaptureCount,
  searchCaptures,
  setCaptureTrustedTime,
  listPendingTimestampCaptures,
  getCapturesByIds,
  setFavoriteMany,
  isFavorite
} from '@main/services/db/captureRepo'
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  addTagToCapture,
  removeTagFromCapture,
  getTagsForCapture,
  getTagCountForCase,
  getTagUsageCountsForCase,
  getTagCaptureMatrix,
  addTagToCaptures,
  addTagToNote,
  getTagsForNote,
  mergeTags
} from '@main/services/db/tagRepo'
import {
  getSelectorCoverage,
  createSelector,
  matchSelectorAgainstCaptures,
  listActiveSelectors,
  listSelectors,
  bulkCreateSelectors,
  getSelectorMatchesForExport,
  getSelectorCaptureMatrix
} from '@main/services/db/selectorRepo'
import {
  createNote,
  getNote,
  listNotes,
  deleteNote,
  getNoteCount,
  updateNote,
  searchNotes
} from '@main/services/db/noteRepo'
import {
  insertExtractedData,
  getExtractedCategories,
  getExtractedSubcategories,
  getExtractedItems,
  searchExtractedData,
  getExtractedDataCountForCase,
  deleteExtractedDataForCapture
} from '@main/services/db/extractedDataRepo'
import { SELECTOR_ORIGINS, type SelectorOrigin } from '@shared/types'

describe('database', () => {
  beforeEach(async () => {
    await initDatabase(':memory:')
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

    it('getCapturesByIds loads a snapshot in one query, skipping ids with no row (#394)', () => {
      const a = insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: 't'
      })
      const b = insertCapture({
        caseId,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: 't'
      })
      const rows = getCapturesByIds([a.id, 'missing', b.id, a.id])
      expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
      expect(getCapturesByIds([])).toEqual([])
    })

    it('setFavoriteMany is an idempotent SET in one transaction (#394)', () => {
      const a = insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: 't'
      })
      const b = insertCapture({
        caseId,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: 't'
      })
      expect(setFavoriteMany([a.id], true)).toBe(1)
      // Already-favorited ids still count as applied: every id ends in the requested state.
      expect(setFavoriteMany([a.id, b.id], true)).toBe(2)
      expect(isFavorite(a.id)).toBe(true)
      expect(isFavorite(b.id)).toBe(true)
      expect(setFavoriteMany([a.id, b.id], false)).toBe(2)
      expect(isFavorite(a.id)).toBe(false)
      expect(isFavorite(b.id)).toBe(false)
      expect(setFavoriteMany([], true)).toBe(0)
    })

    it('setFavoriteMany applies nothing when one id violates the foreign key (#394)', () => {
      const a = insertCapture({
        caseId,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: 't'
      })
      expect(() => setFavoriteMany([a.id, 'ghost'], true)).toThrow()
      expect(isFavorite(a.id)).toBe(false)
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

    it('inserts and retrieves MHTML capture with all forensic fields', () => {
      const caseId = createCase({ name: 'Forensic Case' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'a'.repeat(64),
        timestamp: new Date().toISOString(),
        format: 'mhtml',
        mhtmlPath: 'case-id/cap-id.mhtml',
        sizeBytes: 12345,
        manifestIndex: 0,
        prevHash: '',
        entryHash: 'b'.repeat(64),
        toolVersion: '0.1.0',
        extensionVersion: '0.1.0',
        browserVersion: 'Chrome/120',
        userAgent: 'Mozilla/5.0',
        httpStatus: 200,
        operatorId: '11111111-1111-1111-1111-111111111111',
        operatorName: 'Det. Smith'
      })

      const retrieved = getCapture(cap.id)!
      expect(retrieved.format).toBe('mhtml')
      expect(retrieved.mhtmlPath).toBe('case-id/cap-id.mhtml')
      expect(retrieved.sizeBytes).toBe(12345)
      expect(retrieved.manifestIndex).toBe(0)
      expect(retrieved.entryHash).toBe('b'.repeat(64))
      expect(retrieved.toolVersion).toBe('0.1.0')
      expect(retrieved.operatorName).toBe('Det. Smith')
    })

    it('defaults legacy captures to format=html', () => {
      const caseId = createCase({ name: 'Legacy Case' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'c'.repeat(64),
        timestamp: new Date().toISOString()
      })
      expect(getCapture(cap.id)!.format).toBe('html')
    })

    it('persists and reads back consentSuppression (round-trip)', () => {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'd'.repeat(64),
        timestamp: new Date().toISOString(),
        consentSuppression: 'filter-list'
      })
      expect(getCapture(cap.id)!.consentSuppression).toBe('filter-list')
    })

    it('leaves consentSuppression undefined for captures without it', () => {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'e'.repeat(64),
        timestamp: new Date().toISOString()
      })
      expect(getCapture(cap.id)!.consentSuppression).toBeUndefined()
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

    it('addTagToCaptures applies a tag to many captures idempotently in one transaction (#394)', () => {
      const c = createCase({ name: 'Test' })
      const a = insertCapture({
        caseId: c.id,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: 't'
      })
      const b = insertCapture({
        caseId: c.id,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: 't'
      })
      const tag = createTag({ name: 'batch' })

      addTagToCapture({ captureId: a.id, tagId: tag.id })
      expect(addTagToCaptures([a.id, b.id], tag.id)).toBe(2)
      expect(getTagsForCapture(a.id)).toHaveLength(1)
      expect(getTagsForCapture(b.id)).toHaveLength(1)
      expect(addTagToCaptures([], tag.id)).toBe(0)

      // A missing tag fails the whole batch: neither capture gains a dangling row.
      expect(() => addTagToCaptures([a.id, b.id], 'no-such-tag')).toThrow()
      expect(getTagsForCapture(a.id)).toHaveLength(1)
    })
  })

  // Known-answer suite for the merge (#828): a fixed seed, one merge, and the
  // exact final rows asserted — including the dedupe collision the join
  // tables' primary keys would turn into a constraint error under a plain
  // UPDATE, and the leftover source rows ON DELETE CASCADE must clear.
  describe('mergeTags (#828)', () => {
    function seed() {
      const c = createCase({ name: 'Merge case' })
      const a = insertCapture({
        caseId: c.id,
        url: 'https://a.com',
        title: 'A',
        hash: 'h1',
        timestamp: 't'
      })
      const b = insertCapture({
        caseId: c.id,
        url: 'https://b.com',
        title: 'B',
        hash: 'h2',
        timestamp: 't'
      })
      const n1 = createNote({ caseId: c.id, title: 'N1', body: 'one' })
      const n2 = createNote({ caseId: c.id, title: 'N2', body: 'two' })
      const source = createTag({ name: 'osint', color: '#ef4444' })
      const target = createTag({ name: 'evidence', color: '#22c55e' })
      const bystander = createTag({ name: 'other', color: '#3b82f6' })
      // Capture B and note N2 already carry the target: the collision rows.
      addTagToCapture({ captureId: a.id, tagId: source.id })
      addTagToCapture({ captureId: b.id, tagId: source.id })
      addTagToCapture({ captureId: b.id, tagId: target.id })
      addTagToCapture({ captureId: a.id, tagId: bystander.id })
      addTagToNote({ noteId: n1.id, tagId: source.id })
      addTagToNote({ noteId: n2.id, tagId: source.id })
      addTagToNote({ noteId: n2.id, tagId: target.id })
      return { a, b, n1, n2, source, target, bystander }
    }

    it('re-points capture and note links, dedupes collisions and deletes the source', () => {
      const { a, b, n1, n2, source, target, bystander } = seed()

      const result = mergeTags({ sourceId: source.id, targetId: target.id })

      // The survivor keeps its own identity, name and colour.
      expect(result).toEqual({
        target: { id: target.id, name: 'evidence', color: '#22c55e' },
        captureLinks: 2,
        noteLinks: 2
      })

      // Exact final join rows: one row per (capture, tag) — the collision on B
      // collapsed to a single row rather than violating the primary key.
      const captureRows = getDb()
        .prepare('SELECT exhibit_id AS capture_id, tag_id FROM exhibit_tags ORDER BY 1, 2')
        .all()
      expect(captureRows).toEqual(
        [
          { capture_id: a.id, tag_id: target.id },
          { capture_id: a.id, tag_id: bystander.id },
          { capture_id: b.id, tag_id: target.id }
        ].sort((x, y) =>
          x.capture_id === y.capture_id
            ? x.tag_id.localeCompare(y.tag_id)
            : x.capture_id.localeCompare(y.capture_id)
        )
      )
      const noteRows = getDb()
        .prepare('SELECT note_id, tag_id FROM note_tags ORDER BY note_id, tag_id')
        .all()
      expect(noteRows).toEqual(
        [
          { note_id: n1.id, tag_id: target.id },
          { note_id: n2.id, tag_id: target.id }
        ].sort((x, y) => x.note_id.localeCompare(y.note_id))
      )

      // The source tag is gone; the survivor and the bystander remain.
      expect(listTags().map((t) => t.name)).toEqual(['evidence', 'other'])
      expect(getTagsForNote(n1.id).map((t) => t.id)).toEqual([target.id])
      expect(getTagsForNote(n2.id).map((t) => t.id)).toEqual([target.id])
    })

    // Load-bearing, not defensive: without the guard the inserts would no-op
    // and the delete would destroy the tag and every link it holds.
    it('refuses a self-merge and leaves every row standing', () => {
      const { a, source } = seed()

      expect(mergeTags({ sourceId: source.id, targetId: source.id })).toBeUndefined()

      expect(listTags().map((t) => t.name)).toEqual(['evidence', 'osint', 'other'])
      expect(getTagsForCapture(a.id).map((t) => t.name)).toEqual(['osint', 'other'])
    })

    it('returns undefined without writing when either tag is missing', () => {
      const { a, source, target } = seed()

      expect(mergeTags({ sourceId: 'no-such-tag', targetId: target.id })).toBeUndefined()
      expect(mergeTags({ sourceId: source.id, targetId: 'no-such-tag' })).toBeUndefined()

      expect(listTags()).toHaveLength(3)
      expect(getTagsForCapture(a.id).map((t) => t.name)).toEqual(['osint', 'other'])
    })

    // Tags are app-global (no case_id column), so a merge invoked from one
    // case's Signals screen rewrites links in every case that used the source.
    // Pinned so the reach is a recorded fact rather than a surprise.
    it('reaches captures in other cases', () => {
      const { source, target } = seed()
      const elsewhere = createCase({ name: 'Other case' })
      const far = insertCapture({
        caseId: elsewhere.id,
        url: 'https://far.com',
        title: 'Far',
        hash: 'h3',
        timestamp: 't'
      })
      addTagToCapture({ captureId: far.id, tagId: source.id })

      const result = mergeTags({ sourceId: source.id, targetId: target.id })

      expect(getTagsForCapture(far.id).map((t) => t.id)).toEqual([target.id])
      // The reported totals are global for the same reason.
      expect(result?.captureLinks).toBe(3)
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
      // v8..latest migrations run immediately after, so final version matches the schema version
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(LATEST_SCHEMA_VERSION)
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

    // v34 rebuilt `capture_tags` as `exhibit_tags` (ADR-0023), which drops the
    // v8 index with the table it belonged to and recreates it on the new one.
    it('creates the tag_id index on the tag join table', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_exhibit_tags_tag_id'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('sets user_version to 8', () => {
      // v9..latest migrations run immediately after, so final version matches the schema version
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(LATEST_SCHEMA_VERSION)
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
      // v10..latest migrations run immediately after, so final version matches the schema version
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(LATEST_SCHEMA_VERSION)
    })
  })

  describe('migration v15 - capture analyses', () => {
    it('creates capture_analyses table', () => {
      const table = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='capture_analyses'")
        .get()
      expect(table).toBeDefined()
    })

    it('enforces UNIQUE(capture_id) on capture_analyses', () => {
      const db = getDb()
      const columns = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='capture_analyses'")
        .get() as { sql: string } | undefined
      expect(columns?.sql).toBeDefined()
      expect(columns!.sql).toMatch(/capture_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i)
    })

    it('creates idx_capture_analyses_capture index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_capture_analyses_capture'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('rejects duplicate analyses for the same capture', () => {
      const db = getDb()
      const c = createCase({ name: 'Analyses Unique Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Analyses Capture',
        hash: 'analyses-h1',
        timestamp: new Date().toISOString()
      })
      const now = new Date().toISOString()
      const insert = db.prepare(
        `INSERT INTO capture_analyses (id, capture_id, case_id, content, model, token_usage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      insert.run('analysis-1', cap.id, c.id, 'first', 'test/model', '{}', now, now)
      expect(() =>
        insert.run('analysis-2', cap.id, c.id, 'second', 'test/model', '{}', now, now)
      ).toThrow(/UNIQUE/i)
    })

    it('cascades delete when capture is deleted', () => {
      const db = getDb()
      const c = createCase({ name: 'Analyses Cascade Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Analyses Capture',
        hash: 'analyses-h2',
        timestamp: new Date().toISOString()
      })
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO capture_analyses (id, capture_id, case_id, content, model, token_usage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('analysis-c1', cap.id, c.id, 'content', 'test/model', '{}', now, now)
      deleteCapture(cap.id)
      const row = db.prepare('SELECT * FROM capture_analyses WHERE capture_id = ?').get(cap.id)
      expect(row).toBeUndefined()
    })

    it('sets user_version to the latest schema version', () => {
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(LATEST_SCHEMA_VERSION)
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

    it('returns per-tag usage counts scoped to a case', () => {
      const caseA = createCase({ name: 'Case A' })
      const caseB = createCase({ name: 'Case B' })

      const capA1 = insertCapture({
        caseId: caseA.id,
        url: 'https://a1.com',
        title: 'A1',
        hash: 'ha1',
        timestamp: new Date().toISOString()
      })
      const capA2 = insertCapture({
        caseId: caseA.id,
        url: 'https://a2.com',
        title: 'A2',
        hash: 'ha2',
        timestamp: new Date().toISOString()
      })
      const capB1 = insertCapture({
        caseId: caseB.id,
        url: 'https://b1.com',
        title: 'B1',
        hash: 'hb1',
        timestamp: new Date().toISOString()
      })

      const tagRed = createTag({ name: 'red' })
      const tagBlue = createTag({ name: 'blue' })

      addTagToCapture({ captureId: capA1.id, tagId: tagRed.id })
      addTagToCapture({ captureId: capA2.id, tagId: tagRed.id })
      addTagToCapture({ captureId: capA1.id, tagId: tagBlue.id })
      addTagToCapture({ captureId: capB1.id, tagId: tagRed.id })

      const counts = getTagUsageCountsForCase(caseA.id)
      expect(counts[tagRed.id]).toBe(2)
      expect(counts[tagBlue.id]).toBe(1)
      // caseB's usage should not leak into caseA's counts
      expect(Object.keys(counts)).toHaveLength(2)
    })

    it('returns empty object when case has no tagged captures', () => {
      const c = createCase({ name: 'No Tags' })
      expect(getTagUsageCountsForCase(c.id)).toEqual({})
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

  describe('bulkCreateSelectors', () => {
    it('inserts all selectors in one transaction and returns them in input order', () => {
      const c = createCase({ name: 'Bulk Case' })
      const created = bulkCreateSelectors([
        { caseId: c.id, pattern: 'alpha', isRegex: false, label: 'A' },
        { caseId: c.id, pattern: 'beta', isRegex: true },
        { caseId: c.id, pattern: 'gamma', isRegex: false, label: 'C' }
      ])
      expect(created).toHaveLength(3)
      expect(created[0].pattern).toBe('alpha')
      expect(created[0].label).toBe('A')
      expect(created[1].pattern).toBe('beta')
      expect(created[1].isRegex).toBe(true)
      expect(created[2].pattern).toBe('gamma')

      const listed = listSelectors(c.id)
      expect(listed).toHaveLength(3)
    })

    it('returns empty array when given no input', () => {
      const result = bulkCreateSelectors([])
      expect(result).toEqual([])
    })

    it('rolls back all inserts if any insert fails', () => {
      const c = createCase({ name: 'Rollback Case' })
      // The second insert references a non-existent case_id, violating the foreign key.
      expect(() =>
        bulkCreateSelectors([
          { caseId: c.id, pattern: 'ok' },
          { caseId: 'does-not-exist', pattern: 'bad' }
        ])
      ).toThrow()
      // Transaction should have rolled back — no selectors inserted for the valid case either.
      expect(listSelectors(c.id)).toHaveLength(0)
    })
  })

  describe('getSelectorMatchesForExport', () => {
    it('returns joined selector+capture rows scoped to one case', () => {
      const c = createCase({ name: 'Export Case' })
      const other = createCase({ name: 'Other Case' })

      const cap1 = insertCapture({
        caseId: c.id,
        url: 'https://example.com/a',
        title: 'Page A',
        hash: 'h1',
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      const cap2 = insertCapture({
        caseId: c.id,
        url: 'https://example.com/b',
        title: 'Page B',
        hash: 'h2',
        timestamp: '2026-01-02T00:00:00.000Z'
      })
      const otherCap = insertCapture({
        caseId: other.id,
        url: 'https://other.com',
        title: 'Other',
        hash: 'oh1',
        timestamp: '2026-01-03T00:00:00.000Z'
      })

      const sel = createSelector({
        caseId: c.id,
        pattern: 'example',
        isRegex: false,
        label: 'Example matcher'
      })
      const otherSel = createSelector({ caseId: other.id, pattern: 'other' })

      matchSelectorAgainstCaptures(sel.id, [
        { captureId: cap1.id, text: 'example content' },
        { captureId: cap2.id, text: 'another example here' }
      ])
      matchSelectorAgainstCaptures(otherSel.id, [{ captureId: otherCap.id, text: 'other' }])

      const rows = getSelectorMatchesForExport(c.id)
      expect(rows).toHaveLength(2)
      // Ordered by s.pattern, then c.timestamp DESC
      expect(rows[0].selectorPattern).toBe('example')
      expect(rows[0].selectorLabel).toBe('Example matcher')
      expect(rows[0].isRegex).toBe(false)
      expect(rows[0].captureUrl).toBe('https://example.com/b')
      expect(rows[0].captureTitle).toBe('Page B')
      expect(rows[0].captureTimestamp).toBe('2026-01-02T00:00:00.000Z')
      expect(rows[1].captureUrl).toBe('https://example.com/a')
      // Other case's match must not leak in.
      expect(rows.find((r) => r.captureUrl === 'https://other.com')).toBeUndefined()
    })

    it('returns empty array when case has no matches', () => {
      const c = createCase({ name: 'No Matches' })
      expect(getSelectorMatchesForExport(c.id)).toEqual([])
    })

    // #400: the Signals rail's Export CSV is per-signal. Without the filter the
    // button would write the whole case under a label that says otherwise.
    it('scopes to one selector when a selector id is given', () => {
      const c = createCase({ name: 'Scoped Export' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com/a',
        title: 'Page A',
        hash: 'h1',
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      const wanted = createSelector({ caseId: c.id, pattern: 'alpha' })
      const unwanted = createSelector({ caseId: c.id, pattern: 'beta' })
      matchSelectorAgainstCaptures(wanted.id, [{ captureId: cap.id, text: 'alpha' }])
      matchSelectorAgainstCaptures(unwanted.id, [{ captureId: cap.id, text: 'beta' }])

      expect(getSelectorMatchesForExport(c.id)).toHaveLength(2)
      const scoped = getSelectorMatchesForExport(c.id, wanted.id)
      expect(scoped).toHaveLength(1)
      expect(scoped[0].selectorPattern).toBe('alpha')
    })

    it('scopes to nothing when the selector belongs to another case', () => {
      const c = createCase({ name: 'Scoped Export Cross' })
      const other = createCase({ name: 'Elsewhere' })
      const cap = insertCapture({
        caseId: other.id,
        url: 'https://example.com/a',
        title: 'Page A',
        hash: 'h1',
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      const foreign = createSelector({ caseId: other.id, pattern: 'alpha' })
      matchSelectorAgainstCaptures(foreign.id, [{ captureId: cap.id, text: 'alpha' }])

      expect(getSelectorMatchesForExport(c.id, foreign.id)).toEqual([])
    })
  })

  describe('coverage matrices (#400)', () => {
    // Newest first, matching listCaptures, so "the N most recent" means the
    // same thing to the query and to the strip that draws it.
    function seedCaptures(caseId: string, count: number): string[] {
      return Array.from({ length: count }, (_, i) =>
        insertCapture({
          caseId,
          url: `https://example.com/${i}`,
          title: `Page ${i}`,
          hash: `h${i}`,
          // Ascending timestamps, so index 0 is the OLDEST.
          timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
        }).id
      )
    }

    it('maps each selector to the recent captures it matched', () => {
      const c = createCase({ name: 'Selector Matrix' })
      const [cap0, cap1, cap2] = seedCaptures(c.id, 3)
      const both = createSelector({ caseId: c.id, pattern: 'both' })
      const one = createSelector({ caseId: c.id, pattern: 'one' })
      createSelector({ caseId: c.id, pattern: 'none' })
      matchSelectorAgainstCaptures(both.id, [
        { captureId: cap0, text: 'both' },
        { captureId: cap2, text: 'both' }
      ])
      matchSelectorAgainstCaptures(one.id, [{ captureId: cap1, text: 'one' }])

      const matrix = getSelectorCaptureMatrix(c.id, 24)

      expect(new Set(matrix[both.id])).toEqual(new Set([cap0, cap2]))
      expect(matrix[one.id]).toEqual([cap1])
      // A selector that matched nothing is absent, not present-and-empty.
      expect(Object.keys(matrix)).toHaveLength(2)
    })

    it('bounds the selector matrix to the most recent captures', () => {
      const c = createCase({ name: 'Bounded Selector Matrix' })
      const caps = seedCaptures(c.id, 5)
      const sel = createSelector({ caseId: c.id, pattern: 'all' })
      matchSelectorAgainstCaptures(
        sel.id,
        caps.map((captureId) => ({ captureId, text: 'all' }))
      )

      // Newest two only: caps[4] and caps[3].
      expect(new Set(getSelectorCaptureMatrix(c.id, 2)[sel.id])).toEqual(
        new Set([caps[4], caps[3]])
      )
    })

    it('keeps one case out of another case matrix', () => {
      const c = createCase({ name: 'Matrix Isolation' })
      const other = createCase({ name: 'Matrix Other' })
      const [cap] = seedCaptures(other.id, 1)
      const foreign = createSelector({ caseId: other.id, pattern: 'x' })
      matchSelectorAgainstCaptures(foreign.id, [{ captureId: cap, text: 'x' }])

      expect(getSelectorCaptureMatrix(c.id, 24)).toEqual({})
    })

    it('maps each tag to the recent captures carrying it', () => {
      const c = createCase({ name: 'Tag Matrix' })
      const [cap0, cap1] = seedCaptures(c.id, 2)
      const applied = createTag({ name: 'applied' })
      createTag({ name: 'unused' })
      addTagToCapture({ captureId: cap0, tagId: applied.id })
      addTagToCapture({ captureId: cap1, tagId: applied.id })

      const matrix = getTagCaptureMatrix(c.id, 24)

      expect(new Set(matrix[applied.id])).toEqual(new Set([cap0, cap1]))
      expect(Object.keys(matrix)).toHaveLength(1)
    })

    it('bounds the tag matrix to the most recent captures', () => {
      const c = createCase({ name: 'Bounded Tag Matrix' })
      const caps = seedCaptures(c.id, 4)
      const tag = createTag({ name: 'everywhere' })
      for (const captureId of caps) addTagToCapture({ captureId, tagId: tag.id })

      expect(getTagCaptureMatrix(c.id, 1)[tag.id]).toEqual([caps[3]])
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

  describe('annotations schema (migration 17)', () => {
    it('LATEST_SCHEMA_VERSION matches the migrated user_version', () => {
      // Bumped to 19 in #118 (screenshot_hash / text_hash sidecar columns);
      // bumped to 20 in #123 (tls_cert_chain corroboration column);
      // bumped to 21 in #wayback (capture_archive_refs table);
      // bumped to 22 (extracted_data_fts trigram search index);
      // bumped to 23 in #recapture (method / supersedesCaptureId provenance columns);
      // bumped to 24 (consent_suppression provenance column);
      // bumped to 25 (capture_texts + external-content captures_fts);
      // bumped to 26 (notes.body_doc — rich-text note bodies);
      // bumped to 27 (notes.anchor_kind / anchor_json — anchored notes);
      // bumped in #389 (note_references — mention references index);
      // bumped in #395 (selectors.origin — selector provenance);
      // bumped in #400 (cases.exclusions / cases.exclusion_mode — per-case
      // auto-capture exclusions).
      // No literal pin: three concurrent tickets each append a migration, so
      // whichever lands later renumbers — asserting the constant against the
      // migrated database checks the same invariant without the churn.
      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    })

    it('creates annotations table with expected columns', () => {
      const cols = getDb().prepare("PRAGMA table_info('annotations')").all() as Array<{
        name: string
      }>
      const names = cols.map((c) => c.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'capture_id',
          'schema_version',
          'shapes_json',
          'image_width',
          'image_height',
          'updated_at',
          'updated_by'
        ])
      )
    })

    it('creates annotation_pins table with expected columns', () => {
      const cols = getDb().prepare("PRAGMA table_info('annotation_pins')").all() as Array<{
        name: string
      }>
      const names = cols.map((c) => c.name)
      expect(names).toEqual(
        expect.arrayContaining(['id', 'capture_id', 'number', 'body', 'created_at', 'updated_at'])
      )
    })

    it('creates expected indexes on annotation_pins', () => {
      const idx = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='annotation_pins'")
        .all() as Array<{ name: string }>
      const names = idx.map((i) => i.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_annotation_pins_capture',
          'idx_annotation_pins_capture_number'
        ])
      )
    })

    it('cascades delete from captures to annotations and pins', () => {
      const c = createCase({ name: 'C' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc',
        timestamp: new Date().toISOString()
      })
      getDb()
        .prepare(
          "INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at) VALUES (?, 1, '[]', 100, 100, ?)"
        )
        .run(cap.id, new Date().toISOString())
      getDb()
        .prepare(
          'INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)'
        )
        .run('pin-1', cap.id, 'pin body', new Date().toISOString(), new Date().toISOString())

      deleteCapture(cap.id)

      const ann = getDb()
        .prepare('SELECT COUNT(*) as n FROM annotations WHERE capture_id = ?')
        .get(cap.id) as { n: number }
      const pins = getDb()
        .prepare('SELECT COUNT(*) as n FROM annotation_pins WHERE capture_id = ?')
        .get(cap.id) as { n: number }
      expect(ann.n).toBe(0)
      expect(pins.n).toBe(0)
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

  describe('migration v11 (MHTML columns)', () => {
    it('adds format column with default html', () => {
      const caseId = createCase({ name: 'Migration Case' }).id
      insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'deadbeef',
        timestamp: new Date().toISOString()
      })
      const row = getDb().prepare('SELECT format FROM captures WHERE case_id = ?').get(caseId) as {
        format: string
      }
      expect(row.format).toBe('html')
    })

    it('sets user_version to 11', () => {
      const version = getDb().pragma('user_version', { simple: true }) as number
      expect(version).toBeGreaterThanOrEqual(11)
    })

    it('has all MHTML columns', () => {
      const cols = getDb().prepare("PRAGMA table_info('captures')").all() as Array<{ name: string }>
      const names = cols.map((c) => c.name)
      const expected = [
        'format',
        'mhtml_path',
        'size_bytes',
        'manifest_index',
        'prev_hash',
        'entry_hash',
        'tool_version',
        'extension_version',
        'browser_version',
        'user_agent',
        'http_status',
        'operator_id',
        'operator_name'
      ]
      for (const col of expected) {
        expect(names).toContain(col)
      }
    })
  })

  describe('migration v19 (sidecar integrity columns, #118)', () => {
    it('adds nullable screenshot_hash and text_hash columns', () => {
      const cols = getDb().prepare("PRAGMA table_info('captures')").all() as Array<{
        name: string
        notnull: number
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      expect(byName.has('screenshot_hash')).toBe(true)
      expect(byName.has('text_hash')).toBe(true)
      // Additive/nullable so old rows survive the upgrade.
      expect(byName.get('screenshot_hash')!.notnull).toBe(0)
      expect(byName.get('text_hash')!.notnull).toBe(0)
    })

    it('reads back undefined hashes for rows inserted without them (legacy/grandfathered)', () => {
      const caseId = createCase({ name: 'Legacy' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'deadbeef',
        timestamp: new Date().toISOString()
      })
      const stored = getCapture(cap.id)
      expect(stored?.screenshotHash).toBeUndefined()
      expect(stored?.textHash).toBeUndefined()
    })

    it('round-trips screenshot/text hashes when provided', () => {
      const caseId = createCase({ name: 'Hashed' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'deadbeef',
        timestamp: new Date().toISOString(),
        screenshotHash: 'a'.repeat(64),
        textHash: 'b'.repeat(64)
      })
      const stored = getCapture(cap.id)
      expect(stored?.screenshotHash).toBe('a'.repeat(64))
      expect(stored?.textHash).toBe('b'.repeat(64))
    })
  })

  describe('migration v20 (TLS cert chain column, #123)', () => {
    it('adds a nullable tls_cert_chain column', () => {
      const cols = getDb().prepare("PRAGMA table_info('captures')").all() as Array<{
        name: string
        notnull: number
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      expect(byName.has('tls_cert_chain')).toBe(true)
      // Additive/nullable so old rows survive the upgrade.
      expect(byName.get('tls_cert_chain')!.notnull).toBe(0)
    })

    it('reads back undefined for rows inserted without a cert chain (legacy)', () => {
      const caseId = createCase({ name: 'Legacy TLS' }).id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'deadbeef',
        timestamp: new Date().toISOString()
      })
      expect(getCapture(cap.id)?.tlsCertChain).toBeUndefined()
    })

    it('round-trips a stored cert chain through JSON', () => {
      const caseId = createCase({ name: 'TLS' }).id
      const tls = {
        url: 'https://example.com',
        refetchedAt: '2026-04-05T12:00:05.000Z',
        chain: [
          {
            subject: 'CN=example.com',
            issuer: 'CN=Example CA',
            validFrom: 'Jan  1 00:00:00 2026 GMT',
            validTo: 'Jan  1 00:00:00 2027 GMT',
            fingerprint256: 'AA:BB:CC',
            serialNumber: '01',
            subjectAltNames: ['DNS:example.com']
          }
        ]
      }
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'deadbeef',
        timestamp: new Date().toISOString(),
        tlsCertChain: JSON.stringify(tls)
      })
      expect(getCapture(cap.id)?.tlsCertChain).toEqual(tls)
    })
  })

  describe('migration v29 (selector origin column, #395)', () => {
    it('adds a nullable origin column with no default', () => {
      const cols = getDb().prepare("PRAGMA table_info('selectors')").all() as Array<{
        name: string
        notnull: number
        dflt_value: string | null
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      expect(byName.has('origin')).toBe(true)
      expect(byName.get('origin')!.notnull).toBe(0)
      // No DEFAULT: a stamped-by-default column would claim a provenance the
      // database never recorded.
      expect(byName.get('origin')!.dflt_value).toBeNull()
    })

    it('leaves origin NULL for a selector created without one', () => {
      const c = createCase({ name: 'Legacy Origin' })
      const sel = createSelector({ caseId: c.id, pattern: 'legacy' })

      expect(sel.origin).toBeUndefined()
      const row = getDb().prepare('SELECT origin FROM selectors WHERE id = ?').get(sel.id) as {
        origin: string | null
      }
      expect(row.origin).toBeNull()
    })

    it('persists and reads back each recorded origin', () => {
      const c = createCase({ name: 'Origins' })
      for (const origin of SELECTOR_ORIGINS) {
        const sel = createSelector({ caseId: c.id, pattern: `p-${origin}`, origin })
        expect(sel.origin).toBe(origin)
      }
    })

    it('stores an unrecognised origin as NULL rather than as a provenance claim', () => {
      const c = createCase({ name: 'Bogus Origin' })
      const sel = createSelector({
        caseId: c.id,
        pattern: 'bogus',
        // The IPC surface has no Zod validation and the column is plain TEXT,
        // so the repo boundary is what keeps a junk value out.
        origin: 'smuggled' as SelectorOrigin
      })

      expect(sel.origin).toBeUndefined()
      const row = getDb().prepare('SELECT origin FROM selectors WHERE id = ?').get(sel.id) as {
        origin: string | null
      }
      expect(row.origin).toBeNull()
    })

    it('reads a hand-edited unrecognised origin back as absent', () => {
      const c = createCase({ name: 'Hand Edited' })
      const sel = createSelector({ caseId: c.id, pattern: 'edited', origin: 'manual' })
      // Database Admin can edit the column directly, bypassing the repo.
      getDb().prepare('UPDATE selectors SET origin = ? WHERE id = ?').run('nonsense', sel.id)

      expect(listSelectors(c.id).find((s) => s.id === sel.id)?.origin).toBeUndefined()
    })

    it('carries per-item origin through bulkCreateSelectors', () => {
      const c = createCase({ name: 'Bulk Origins' })
      const created = bulkCreateSelectors([
        { caseId: c.id, pattern: 'a', origin: 'extension' },
        { caseId: c.id, pattern: 'b', origin: 'note' },
        { caseId: c.id, pattern: 'c' }
      ])

      expect(created.map((s) => s.origin)).toEqual(['extension', 'note', undefined])
    })
  })

  describe('migration v30 (per-case auto-capture exclusions, #400)', () => {
    it('adds two nullable columns with no defaults', () => {
      const cols = getDb().prepare("PRAGMA table_info('cases')").all() as Array<{
        name: string
        notnull: number
        dflt_value: string | null
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      for (const name of ['exclusions', 'exclusion_mode']) {
        expect(byName.has(name)).toBe(true)
        expect(byName.get(name)!.notnull).toBe(0)
        // No DEFAULT: NULL already means "no exclusions, stack on global", so a
        // written-in default would record an operator decision nobody made.
        expect(byName.get(name)!.dflt_value).toBeNull()
      }
    })

    it('reads a case that has never set a policy as empty and stacking', () => {
      const c = createCase({ name: 'No Policy' })

      expect(getAutoCapturePolicy(c.id)).toEqual({ exclusions: [], mode: 'stack' })
      const row = getDb()
        .prepare('SELECT exclusions, exclusion_mode FROM cases WHERE id = ?')
        .get(c.id) as { exclusions: string | null; exclusion_mode: string | null }
      expect(row.exclusions).toBeNull()
      expect(row.exclusion_mode).toBeNull()
    })

    it('round-trips a policy through the columns', () => {
      const c = createCase({ name: 'Policy' })

      const saved = setAutoCapturePolicy(c.id, {
        exclusions: ['*.bank.com', 'mail.google.com', '/\\.gov(\\.|\\/|$)/'],
        mode: 'override'
      })

      expect(saved).toEqual({
        exclusions: ['*.bank.com', 'mail.google.com', '/\\.gov(\\.|\\/|$)/'],
        mode: 'override'
      })
      expect(getAutoCapturePolicy(c.id)).toEqual(saved)
    })

    it('trims patterns and drops blank ones on write', () => {
      const c = createCase({ name: 'Trim' })

      setAutoCapturePolicy(c.id, { exclusions: ['  a.com  ', '', '   '], mode: 'stack' })

      expect(getAutoCapturePolicy(c.id).exclusions).toEqual(['a.com'])
    })

    it('does not touch updated_at, so an exclusion edit is not a case edit', () => {
      const c = createCase({ name: 'Timestamps' })
      const before = getCase(c.id)!.updatedAt

      setAutoCapturePolicy(c.id, { exclusions: ['a.com'], mode: 'stack' })

      expect(getCase(c.id)!.updatedAt).toBe(before)
    })

    it('returns undefined for a case that does not exist', () => {
      expect(setAutoCapturePolicy('no-such-case', { exclusions: [], mode: 'stack' })).toBeUndefined()
      expect(getAutoCapturePolicy('no-such-case')).toEqual({ exclusions: [], mode: 'stack' })
    })

    // Both columns are plain TEXT and the Database Admin hatch edits them
    // directly, so every read is re-checked. Degrading to the empty policy is
    // visible on the screen; trusting the value would put junk in the matcher.
    it.each([
      ['malformed JSON', 'not json at all'],
      ['a JSON object', '{"a":1}'],
      ['a JSON string', '"a.com"']
    ])('reads a hand-edited %s exclusion list as empty', (_name, raw) => {
      const c = createCase({ name: 'Hand Edited List' })
      getDb().prepare('UPDATE cases SET exclusions = ? WHERE id = ?').run(raw, c.id)

      expect(getAutoCapturePolicy(c.id).exclusions).toEqual([])
    })

    it('drops non-string entries from a hand-edited exclusion list', () => {
      const c = createCase({ name: 'Mixed List' })
      getDb()
        .prepare('UPDATE cases SET exclusions = ? WHERE id = ?')
        .run(JSON.stringify(['a.com', 42, null, '', 'b.com']), c.id)

      expect(getAutoCapturePolicy(c.id).exclusions).toEqual(['a.com', 'b.com'])
    })

    it('reads an unrecognised mode as stack, the safer of the two', () => {
      const c = createCase({ name: 'Bogus Mode' })
      getDb().prepare('UPDATE cases SET exclusion_mode = ? WHERE id = ?').run('nonsense', c.id)

      // stack, not override: an unreadable mode must not silently bypass the
      // operator's global ignore list for this case.
      expect(getAutoCapturePolicy(c.id).mode).toBe('stack')
    })
  })

  describe('migration v31 (case number + demo flag, #399/#405)', () => {
    it('adds a nullable case_number column with no default', () => {
      const cols = getDb().prepare("PRAGMA table_info('cases')").all() as Array<{
        name: string
        notnull: number
        dflt_value: string | null
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      expect(byName.has('case_number')).toBe(true)
      expect(byName.get('case_number')!.notnull).toBe(0)
      // No DEFAULT: NULL means "never assigned"; '' would be a claim nobody made.
      expect(byName.get('case_number')!.dflt_value).toBeNull()
    })

    it('adds is_demo as NOT NULL DEFAULT 0', () => {
      const cols = getDb().prepare("PRAGMA table_info('cases')").all() as Array<{
        name: string
        notnull: number
        dflt_value: string | null
      }>
      const byName = new Map(cols.map((c) => [c.name, c]))
      expect(byName.has('is_demo')).toBe(true)
      // Backfilling 0 is a TRUE claim: nothing before this migration was ever
      // seeded as a demo case, so the total field is warranted (v23 precedent).
      expect(byName.get('is_demo')!.notnull).toBe(1)
      expect(byName.get('is_demo')!.dflt_value).toBe('0')
    })

    it('reads a case that never set either as un-numbered and not a demo', () => {
      const c = createCase({ name: 'Plain Case' })

      expect(c.caseNumber).toBeUndefined()
      expect(c.isDemo).toBe(false)
      const row = getDb()
        .prepare('SELECT case_number, is_demo FROM cases WHERE id = ?')
        .get(c.id) as { case_number: string | null; is_demo: number }
      expect(row.case_number).toBeNull()
      expect(row.is_demo).toBe(0)
    })

    it('round-trips a case number through updateCase', () => {
      const c = createCase({ name: 'Numbered' })

      const updated = updateCase({ id: c.id, caseNumber: 'CPS 2026/114' })
      expect(updated?.caseNumber).toBe('CPS 2026/114')
      expect(getCase(c.id)?.caseNumber).toBe('CPS 2026/114')
    })

    it('leaves the case number untouched when the update omits it', () => {
      const c = createCase({ name: 'Keep Number' })
      updateCase({ id: c.id, caseNumber: 'REF-1' })

      updateCase({ id: c.id, name: 'Keep Number Renamed' })

      expect(getCase(c.id)?.caseNumber).toBe('REF-1')
    })

    it('clears the case number to NULL on a blank submission, never storing an empty string', () => {
      const c = createCase({ name: 'Cleared' })
      updateCase({ id: c.id, caseNumber: 'REF-2' })

      updateCase({ id: c.id, caseNumber: '   ' })

      expect(getCase(c.id)?.caseNumber).toBeUndefined()
      const row = getDb().prepare('SELECT case_number FROM cases WHERE id = ?').get(c.id) as {
        case_number: string | null
      }
      expect(row.case_number).toBeNull()
    })

    it('reads a hand-set demo flag back as isDemo true', () => {
      const c = createCase({ name: 'Demo' })
      getDb().prepare('UPDATE cases SET is_demo = 1 WHERE id = ?').run(c.id)

      expect(getCase(c.id)?.isDemo).toBe(true)
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

  describe('migration v16 - extracted data', () => {
    it('creates extracted_data table', () => {
      const table = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='extracted_data'")
        .get()
      expect(table).toBeDefined()
    })

    it('creates idx_extracted_data_case_id index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_extracted_data_case_id'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('creates idx_extracted_data_unique index', () => {
      const idx = getDb()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_extracted_data_unique'"
        )
        .get()
      expect(idx).toBeDefined()
    })

    it('sets user_version to 16', () => {
      const version = getDb().pragma('user_version', { simple: true })
      expect(version).toBe(LATEST_SCHEMA_VERSION)
    })
  })

  describe('extracted data', () => {
    let caseId: string
    let captureId: string

    beforeEach(() => {
      const c = createCase({ name: 'Extraction Test' })
      caseId = c.id
      const cap = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Test Capture',
        hash: 'hash-extract',
        timestamp: new Date().toISOString()
      })
      captureId = cap.id
    })

    it('inserts and retrieves extracted categories', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' },
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'G-ABCDEFGHIJ' },
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'test@example.com' }
      ])

      const categories = getExtractedCategories(caseId)
      expect(categories).toHaveLength(2)
      const tracking = categories.find((c) => c.category === 'Tracking Code')
      expect(tracking?.count).toBe(2)
      const infra = categories.find((c) => c.category === 'Infrastructure')
      expect(infra?.count).toBe(1)
    })

    it('retrieves subcategories for a category', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' },
        { category: 'Tracking Code', subcategory: 'Google Tag Manager', value: 'GTM-ABCD' }
      ])

      const subcategories = getExtractedSubcategories(caseId, 'Tracking Code')
      expect(subcategories).toHaveLength(2)
      const ga = subcategories.find((s) => s.subcategory === 'Google Analytics')
      expect(ga?.count).toBe(1)
    })

    it('retrieves items with page counts and source URLs', () => {
      const cap2 = insertCapture({
        caseId,
        url: 'https://other.com',
        title: 'Other',
        hash: 'hash-other',
        timestamp: new Date().toISOString()
      })

      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])
      insertExtractedData(cap2.id, caseId, 'https://other.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])

      const items = getExtractedItems(caseId, 'Tracking Code', 'Google Analytics')
      expect(items).toHaveLength(1)
      expect(items[0].value).toBe('UA-12345-1')
      expect(items[0].pageCount).toBe(2)
      expect(items[0].sourceUrls).toContain('https://example.com')
      expect(items[0].sourceUrls).toContain('https://other.com')
    })

    it('deduplicates same value in same capture', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' },
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])

      const items = getExtractedItems(caseId, 'Tracking Code', 'Google Analytics')
      expect(items).toHaveLength(1)
    })

    it('ignores duplicate inserts (INSERT OR IGNORE)', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])
      // Second insert of the same data should not throw or duplicate
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])

      const count = getExtractedDataCountForCase(caseId)
      expect(count).toBe(1)
    })

    it('returns total count for case', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' },
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'a@b.com' }
      ])
      expect(getExtractedDataCountForCase(caseId)).toBe(2)
    })

    it('returns 0 for case with no extracted data', () => {
      expect(getExtractedDataCountForCase(caseId)).toBe(0)
    })

    it('deletes extracted data for a capture', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])
      deleteExtractedDataForCapture(captureId)
      expect(getExtractedDataCountForCase(caseId)).toBe(0)
    })

    it('cascades deletion when capture is deleted', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'UA-12345-1' }
      ])
      deleteCapture(captureId)
      expect(getExtractedDataCountForCase(caseId)).toBe(0)
    })

    it('finds items by substring of value across categories', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' },
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'bar@yahoo.com' },
        { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'gmail-ua-1' }
      ])

      const results = searchExtractedData(caseId, 'gmail')
      const values = results.map((r) => r.value).sort()
      expect(values).toEqual(['foo@gmail.com', 'gmail-ua-1'])
      const email = results.find((r) => r.value === 'foo@gmail.com')!
      expect(email.category).toBe('Infrastructure')
      expect(email.subcategory).toBe('Email Address')
      expect(email.pageCount).toBe(1)
    })

    it('finds items by substring of source url', () => {
      insertExtractedData(captureId, caseId, 'https://tracker.example.net/page', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' }
      ])

      const results = searchExtractedData(caseId, 'tracker.example')
      expect(results.map((r) => r.value)).toContain('foo@gmail.com')
    })

    it('scopes search to the given case', () => {
      const otherCase = createCase({ name: 'Other' })
      const otherCap = insertCapture({
        caseId: otherCase.id,
        url: 'https://other.com',
        title: 'Other',
        hash: 'hash-other-search',
        timestamp: new Date().toISOString()
      })
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'shared@gmail.com' }
      ])
      insertExtractedData(otherCap.id, otherCase.id, 'https://other.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'shared@gmail.com' }
      ])

      expect(searchExtractedData(caseId, 'gmail')).toHaveLength(1)
    })

    it('falls back to LIKE for queries shorter than 3 characters', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'ab@x.com' }
      ])
      expect(searchExtractedData(caseId, 'ab').map((r) => r.value)).toEqual(['ab@x.com'])
    })

    it('returns [] for an empty query', () => {
      insertExtractedData(captureId, caseId, 'https://example.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' }
      ])
      expect(searchExtractedData(caseId, '   ')).toEqual([])
    })

    it('aggregates page count and source urls across captures', () => {
      const cap2 = insertCapture({
        caseId,
        url: 'https://example.com/2',
        title: 'Page 2',
        hash: 'hash-2-search',
        timestamp: new Date().toISOString()
      })
      insertExtractedData(captureId, caseId, 'https://a.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'dup@gmail.com' }
      ])
      insertExtractedData(cap2.id, caseId, 'https://b.com', [
        { category: 'Infrastructure', subcategory: 'Email Address', value: 'dup@gmail.com' }
      ])

      const [result] = searchExtractedData(caseId, 'dup@gmail')
      expect(result.pageCount).toBe(2)
      expect(result.sourceUrls).toEqual(['https://a.com', 'https://b.com'])
    })
  })

  describe('trusted-time mirror column', () => {
    let caseId: string

    beforeEach(() => {
      caseId = createCase({ name: 'Timestamp Case' }).id
    })

    it('migration 18 adds the trusted_time_status column and its index', () => {
      const cols = (
        getDb().prepare("PRAGMA table_info('captures')").all() as Array<{ name: string }>
      ).map((c) => c.name)
      expect(cols).toContain('trusted_time_status')
      const idx = (
        getDb()
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='captures'")
          .all() as Array<{ name: string }>
      ).map((i) => i.name)
      expect(idx).toContain('idx_captures_trusted_time')
    })

    function insertCap(hash: string): string {
      return insertCapture({
        caseId,
        url: 'https://example.com/' + hash,
        title: hash,
        hash,
        timestamp: new Date().toISOString(),
        format: 'mhtml'
      }).id
    }

    it('persists and reads back the trusted-time status', () => {
      const id = insertCap('h-rfc')
      setCaptureTrustedTime(id, 'rfc3161')
      expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
    })

    it('lists only captures still pending a timestamp', () => {
      const pendingId = insertCap('h-pending')
      const stampedId = insertCap('h-stamped')
      setCaptureTrustedTime(pendingId, 'pending')
      setCaptureTrustedTime(stampedId, 'rfc3161')

      const pending = listPendingTimestampCaptures()
      expect(pending.map((c) => c.id)).toContain(pendingId)
      expect(pending.map((c) => c.id)).not.toContain(stampedId)
      // The queue carries what the worker needs to re-stamp.
      const entry = pending.find((c) => c.id === pendingId)
      expect(entry).toMatchObject({ caseId, hash: 'h-pending' })
    })
  })
})
