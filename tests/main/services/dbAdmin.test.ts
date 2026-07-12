import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture,
  updateCase,
  listCases,
  getCaptureTextContent
} from '@main/services/database'
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow,
  vacuumDb,
  rebuildFts,
  purgeArchived,
  findOrphans,
  exportTableData
} from '@main/services/dbAdmin'

describe('dbAdmin', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  describe('getDbStats', () => {
    it('returns schema version and table row counts', () => {
      createCase({ name: 'Test' })
      const stats = getDbStats(':memory:')
      expect(stats.schemaVersion).toBeGreaterThanOrEqual(9)
      expect(stats.tables.length).toBeGreaterThan(0)
      const casesTable = stats.tables.find((t) => t.name === 'cases')
      expect(casesTable).toBeDefined()
      expect(casesTable!.rowCount).toBe(1)
    })
  })

  describe('getTableColumns', () => {
    it('returns column info for a valid table', () => {
      const cols = getTableColumns('cases')
      expect(cols.length).toBeGreaterThan(0)
      const idCol = cols.find((c) => c.name === 'id')
      expect(idCol).toBeDefined()
      expect(idCol!.pk).toBe(true)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableColumns('evil_table')).toThrow('not allowed')
    })
  })

  describe('getTableRows', () => {
    it('returns paginated rows', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 0, limit: 2 })
      expect(result.rows).toHaveLength(2)
      expect(result.total).toBe(3)
      expect(result.columns.length).toBeGreaterThan(0)
    })

    it('respects offset', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 2, limit: 10 })
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(3)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableRows({ table: 'nope', offset: 0, limit: 10 })).toThrow('not allowed')
    })

    it('clamps invalid pagination values', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: -10, limit: -1 })
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(3)
    })
  })

  describe('ALLOWED_TABLES', () => {
    it('includes all expected tables', () => {
      expect(ALLOWED_TABLES).toContain('cases')
      expect(ALLOWED_TABLES).toContain('captures')
      expect(ALLOWED_TABLES).toContain('tags')
      expect(ALLOWED_TABLES).toContain('notes')
    })

    it('excludes derived FTS indexes from admin editing', () => {
      expect(ALLOWED_TABLES).not.toContain('captures_fts')
      expect(ALLOWED_TABLES).not.toContain('notes_fts')
    })
  })

  describe('createRow', () => {
    it('inserts a row and returns it', () => {
      const row = createRow('tags', { id: 'tag-1', name: 'Evidence', color: '#ff0000' })
      expect(row).toMatchObject({ id: 'tag-1', name: 'Evidence', color: '#ff0000' })
    })

    it('throws for FTS tables', () => {
      expect(() => createRow('captures_fts', { title: 'x' })).toThrow('not allowed')
    })

    it('throws for invalid column names', () => {
      expect(() => createRow('tags', { id: 'x', name: 'x', evil: 'yes' })).toThrow(
        'does not exist'
      )
    })
  })

  describe('updateRow', () => {
    it('updates a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Old', color: '#000' })
      const result = updateRow('tags', { id: 'tag-1' }, { name: 'New' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows[0]).toMatchObject({ name: 'New' })
    })

    it('returns false for non-existent row', () => {
      const result = updateRow('tags', { id: 'nope' }, { name: 'x' })
      expect(result).toBe(false)
    })

    it('returns false when no fields are provided', () => {
      createRow('tags', { id: 'tag-1', name: 'Old', color: '#000' })
      const result = updateRow('tags', { id: 'tag-1' }, {})
      expect(result).toBe(false)
    })
  })

  describe('deleteRow', () => {
    it('deletes a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Test' })
      const result = deleteRow('tags', { id: 'tag-1' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows).toHaveLength(0)
    })

    it('returns false for non-existent row', () => {
      const result = deleteRow('tags', { id: 'nope' })
      expect(result).toBe(false)
    })

    it('throws for FTS tables', () => {
      expect(() => deleteRow('captures_fts', { rowid: '1' })).toThrow('not allowed')
    })
  })

  describe('vacuum', () => {
    it('runs without error and returns a result', () => {
      const result = vacuumDb(':memory:')
      expect(result).toHaveProperty('freedBytes')
      expect(typeof result.freedBytes).toBe('number')
    })
  })

  describe('rebuildFts', () => {
    it('rebuilds FTS indexes and preserves capture text content', () => {
      const c = createCase({ name: 'Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc123',
        timestamp: new Date().toISOString(),
        textContent: 'hello world'
      })
      const result = rebuildFts({ readArtifact: () => null } as never)
      expect(result.rowsIndexed).toBeGreaterThanOrEqual(1)
      // no sidecar on disk → the DB copy of the text survives the rebuild
      expect(getCaptureTextContent(cap.id)).toBe('hello world')
    })
  })

  describe('purgeArchived', () => {
    it('deletes archived cases and returns counts', () => {
      const active = createCase({ name: 'Active' })
      const archived = createCase({ name: 'Archived' })
      updateCase({ id: archived.id, archived: true })

      const result = purgeArchived()
      expect(result.casesDeleted).toBe(1)
      const remaining = listCases()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(active.id)
    })
  })

  describe('findOrphans', () => {
    it('returns empty report when no orphans exist', () => {
      const result = findOrphans()
      expect(result.dbOrphans).toHaveLength(0)
      expect(result.fileOrphans).toHaveLength(0)
    })
  })

  describe('exportTableData', () => {
    it('exports table as CSV string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      createRow('tags', { id: 'tag-2', name: 'Review', color: null })
      const csv = exportTableData('tags', 'csv')
      expect(csv).toContain('id,name,color')
      expect(csv).toContain('tag-1')
      expect(csv).toContain('Urgent')
    })

    it('exports table as JSON string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      const json = exportTableData('tags', 'json')
      const parsed = JSON.parse(json)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('Urgent')
    })
  })
})
