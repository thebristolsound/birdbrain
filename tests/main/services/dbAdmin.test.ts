import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase } from '@main/services/database'
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow
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
  })

  describe('ALLOWED_TABLES', () => {
    it('includes all expected tables', () => {
      expect(ALLOWED_TABLES).toContain('cases')
      expect(ALLOWED_TABLES).toContain('captures')
      expect(ALLOWED_TABLES).toContain('tags')
      expect(ALLOWED_TABLES).toContain('notes')
      expect(ALLOWED_TABLES).toContain('captures_fts')
    })
  })

  describe('createRow', () => {
    it('inserts a row and returns it', () => {
      const row = createRow('tags', { id: 'tag-1', name: 'Evidence', color: '#ff0000' })
      expect(row).toMatchObject({ id: 'tag-1', name: 'Evidence', color: '#ff0000' })
    })

    it('throws for FTS tables', () => {
      expect(() => createRow('captures_fts', { title: 'x' })).toThrow('FTS virtual tables')
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
      expect(() => deleteRow('captures_fts', { rowid: '1' })).toThrow('FTS virtual tables')
    })
  })
})
