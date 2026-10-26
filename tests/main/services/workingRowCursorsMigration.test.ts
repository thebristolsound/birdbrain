import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, deleteCase } from '@main/services/db/caseRepo'
import { createNote } from '@main/services/db/noteRepo'
import { maxAuthorVersionInCase, recordAuthorRowCursor } from '@main/services/db/workingRowRepo'

describe('migration v42 (verified working-row progress)', () => {
  let root: string
  let dbPath: string
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-row-cursors-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Cursor upgrade' }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  it('upgrades v41 without changing existing working rows', async () => {
    createNote({ caseId, title: 'Kept on upgrade' })
    const before = getDb().prepare('SELECT * FROM notes').all()
    getDb().exec('DROP TABLE working_row_cursors')
    getDb().pragma('user_version = 41')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(getDb().prepare('SELECT * FROM notes').all()).toEqual(before)
    expect(getDb().prepare('SELECT * FROM working_row_cursors').all()).toEqual([])
    expect(getDb().pragma('foreign_key_check')).toEqual([])
  })

  it('reruns the migration without discarding recorded progress', async () => {
    recordAuthorRowCursor(caseId, 'member', 7)
    getDb().pragma('user_version = 41')
    closeDatabase()
    await initDatabase(dbPath)
    expect(maxAuthorVersionInCase(caseId, 'member')).toBe(7)
  })

  it('keeps progress per author and Case, increases it only, and deletes it with the Case', () => {
    const other = createCase({ name: 'Other Case' }).id
    recordAuthorRowCursor(caseId, 'member', 7)
    recordAuthorRowCursor(caseId, 'member', 2)
    expect(maxAuthorVersionInCase(caseId, 'member')).toBe(7)
    expect(maxAuthorVersionInCase(other, 'member')).toBe(0)
    expect(maxAuthorVersionInCase(caseId, 'other-member')).toBe(0)
    expect(() => recordAuthorRowCursor(caseId, 'other-member', -1)).toThrow('CHECK')
    deleteCase(caseId)
    expect(getDb().prepare('SELECT * FROM working_row_cursors').all()).toEqual([])
  })

  it('restores progress with the database instead of skipping rows after a restore', async () => {
    recordAuthorRowCursor(caseId, 'member', 3)
    closeDatabase()
    const backup = join(root, 'saved.db')
    copyFileSync(dbPath, backup)
    await initDatabase(dbPath)
    recordAuthorRowCursor(caseId, 'member', 9)
    expect(maxAuthorVersionInCase(caseId, 'member')).toBe(9)
    closeDatabase()
    copyFileSync(backup, dbPath)
    await initDatabase(dbPath)
    expect(maxAuthorVersionInCase(caseId, 'member')).toBe(3)
  })
})
