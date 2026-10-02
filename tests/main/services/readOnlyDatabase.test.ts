import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import {
  initDatabase,
  closeDatabase,
  getDb,
  openDatabaseReadOnly,
  LATEST_SCHEMA_VERSION
} from '@main/services/db/core'
import { createCase, listCases } from '@main/services/db/caseRepo'

describe('openDatabaseReadOnly (ADR-0036)', () => {
  let dir: string
  let dbPath: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-readonly-db-'))
    dbPath = join(dir, 'birdbrain.db')
    await initDatabase(dbPath)
    createCase({ name: 'Read me' })
    closeDatabase()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves the repos from a migrated database', () => {
    openDatabaseReadOnly(dbPath)

    expect(listCases().map((c) => c.name)).toEqual(['Read me'])
  })

  it('refuses every write', () => {
    openDatabaseReadOnly(dbPath)

    expect(() => createCase({ name: 'Write me' })).toThrow(
      expect.objectContaining({ code: 'SQLITE_READONLY' })
    )
  })

  it('refuses a schema version this build does not read', () => {
    const conn = new Database(dbPath)
    conn.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    conn.close()

    expect(() => openDatabaseReadOnly(dbPath)).toThrow(
      `Database schema version is ${LATEST_SCHEMA_VERSION + 1}; this build reads only version ${LATEST_SCHEMA_VERSION}`
    )
    expect(() => getDb()).toThrow('Database not initialized')
  })

  it('refuses a path with no database rather than creating one', () => {
    expect(() => openDatabaseReadOnly(join(dir, 'absent.db'))).toThrow()
    expect(() => getDb()).toThrow('Database not initialized')
  })
})
