import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { createNote, deleteNote, searchNotes } from '@main/services/db/noteRepo'
import { addTagToCapture, createTag } from '@main/services/db/tagRepo'
import { saveAnnotations, upsertPin } from '@main/services/annotations'
import { windBackToV40 } from '../../helpers/windBackToV40'

// Migration 41 (#1877): the keys from annotations, annotation_pins and
// exhibit_tags to the Capture or Exhibit they name, and notes.capture_id's
// SET NULL, move to application code, so another member's rows on a deleted
// Capture can be kept as signed. Frozen here:
//
//   1. UPGRADE. A populated v40 database reaches v41 with every row and rowid,
//      index and trigger kept, notes_fts still aligned, the change log
//      untouched, and no key left to captures or exhibits.
//   2. FAIL-CLOSED. A dangling reference the dropped keys would have caught
//      stops the upgrade before anything changes.
//   3. RE-RUN. A migrated copy marked v40 runs the block again and changes
//      nothing.

const TABLES = ['notes', 'annotations', 'annotation_pins', 'exhibit_tags'] as const

type Row = Record<string, unknown>

interface Shape {
  columns: unknown[]
  keys: unknown[]
  rows: unknown[]
  sql: unknown[]
}

function shapeOf(conn: Database.Database): Record<string, Shape> {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      {
        columns: conn.pragma(`table_info(${table})`) as unknown[],
        keys: (conn.pragma(`foreign_key_list(${table})`) as Row[]).map(
          ({ table: parent, from, to, on_delete }) => ({ parent, from, to, on_delete })
        ),
        rows: conn.prepare(`SELECT rowid AS stored_rowid, * FROM ${table} ORDER BY rowid`).all(),
        sql: conn
          .prepare(
            `SELECT type, name, sql FROM sqlite_master
              WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL
              ORDER BY type, name`
          )
          .all(table)
      }
    ])
  )
}

const revisions = (conn: Database.Database) => ({
  counters: conn.prepare('SELECT case_id, counter FROM case_revisions ORDER BY case_id').all(),
  log: (conn.prepare('SELECT COUNT(*) AS n FROM case_change_log').get() as { n: number }).n
})

describe('migration v41 (Capture references checked in code)', () => {
  let tempDir: string
  let dbPath: string
  let caseId: string
  let captureId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-migration-41-'))
    dbPath = join(tempDir, 'capture-references.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Upgrade' }).id
    const capture = (n: number) =>
      insertCapture({
        caseId,
        url: `https://example.com/${n}`,
        title: `Page ${n}`,
        hash: String(n).repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      }).id
    captureId = capture(1)
    const other = capture(2)
    createNote({ caseId, captureId, title: 'Harbour ledger', body: 'brackwater depot' })
    // A removed note leaves a gap in the rowids the copy must keep.
    const gone = createNote({ caseId, title: 'Gone', body: 'removed' }).id
    createNote({ caseId, title: 'Unlinked', body: 'no capture here' })
    deleteNote(gone)
    saveAnnotations({ captureId, shapes: [], imageWidth: 800, imageHeight: 600 }, 'Op')
    upsertPin({ captureId, body: 'first pin' })
    upsertPin({ captureId: other, body: 'second pin' })
    const tag = createTag({ name: 'Evidence' })
    addTagToCapture({ captureId, tagId: tag.id })
    addTagToCapture({ captureId: other, tagId: tag.id })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Marks the closed database v40, wound back to the v40 shape when `windBack`
  // is set, and runs `also` on it before it closes.
  function markV40(windBack: boolean, also: (raw: Database.Database) => void = () => {}): void {
    closeDatabase()
    const raw = new Database(dbPath)
    raw.pragma('foreign_keys = OFF')
    if (windBack) windBackToV40(raw)
    also(raw)
    raw.pragma('user_version = 40')
    raw.close()
  }

  function read<T>(fn: (conn: Database.Database) => T): T {
    const conn = new Database(dbPath, { readonly: true })
    try {
      return fn(conn)
    } finally {
      conn.close()
    }
  }

  it('upgrades a populated v40 database with every row, rowid, index and trigger kept and no key to captures or exhibits', async () => {
    const current = shapeOf(getDb())
    markV40(true)
    const before = read(shapeOf)
    const revisedBefore = read(revisions)
    expect(before.notes.keys).toContainEqual({
      parent: 'captures',
      from: 'capture_id',
      to: 'id',
      on_delete: 'SET NULL'
    })
    expect(read((conn) => conn.pragma('table_info(deleted_captures)'))).toEqual([])

    await initDatabase(dbPath)
    const db = getDb()
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])
    const after = shapeOf(db)
    for (const table of TABLES) {
      expect(after[table].columns, table).toEqual(before[table].columns)
      expect(after[table].rows, table).toEqual(before[table].rows)
      expect(after[table].sql, table).toEqual(before[table].sql)
      expect(after[table], table).toEqual(current[table])
    }
    expect(after.notes.rows.map((r) => (r as Row).stored_rowid)).toEqual([1, 3])
    expect(after.annotations.keys).toEqual([])
    expect(after.annotation_pins.keys).toEqual([])
    expect(after.exhibit_tags.keys).toEqual([
      { parent: 'tags', from: 'tag_id', to: 'id', on_delete: 'CASCADE' }
    ])
    expect(after.notes.keys).toEqual([
      { parent: 'cases', from: 'case_id', to: 'id', on_delete: 'CASCADE' }
    ])
    expect(() =>
      db.exec("INSERT INTO notes_fts(notes_fts) VALUES ('integrity-check')")
    ).not.toThrow()
    expect(searchNotes(caseId, 'brackwater').map((n) => n.title)).toEqual(['Harbour ledger'])
    expect(revisions(db)).toEqual(revisedBefore)
    expect(db.prepare('SELECT * FROM deleted_captures').all()).toEqual([])

    const later = createNote({ caseId, title: 'After', body: 'logged' })
    expect(
      db
        .prepare("SELECT case_id FROM case_change_log WHERE kind = 'note' AND target_id = ?")
        .all(later.id)
    ).toContainEqual({ case_id: caseId })
    expect(searchNotes(caseId, 'logged').map((n) => n.title)).toEqual(['After'])
  })

  it('stops on a dangling annotation and leaves the v40 database as it was', async () => {
    markV40(true, (raw) =>
      raw
        .prepare(
          `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
             image_height, updated_at) VALUES ('gone', 1, '[]', 1, 1, '2026-01-01')`
        )
        .run()
    )
    const before = read(shapeOf)

    await expect(initDatabase(dbPath)).rejects.toThrow(
      'Migration 41 found 1 foreign key violation(s)'
    )

    expect(read((conn) => conn.pragma('user_version', { simple: true }))).toBe(40)
    expect(read(shapeOf)).toEqual(before)
    expect(read((conn) => conn.pragma('table_info(deleted_captures)'))).toEqual([])
  })

  it('runs again over its own tables without changing them', async () => {
    const before = shapeOf(getDb())
    markV40(false)
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(shapeOf(getDb())).toEqual(before)
  })
})
