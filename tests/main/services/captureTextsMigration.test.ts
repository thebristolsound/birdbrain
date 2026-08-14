import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { getCaptureTextContent, searchCaptures } from '@main/services/db/captureRepo'

describe('migration v25: capture_texts', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-mig25-'))
    dbPath = join(dir, 'test.db')
    const raw = new Database(dbPath)
    // Minimal pre-v25 schema: standalone FTS shape, user_version pinned to 24.
    // searchCaptures does SELECT c.* and asserts on id only, so captures needs
    // only the columns exercised here. `notes` is present but unused: every
    // migration from 25 onwards runs against this fixture, and v26 alters it.
    raw.exec(`
      CREATE TABLE cases (id TEXT PRIMARY KEY, name TEXT, description TEXT, type TEXT,
        created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0);
      CREATE TABLE captures (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        url TEXT, title TEXT, html_path TEXT, screenshot_path TEXT, hash TEXT, timestamp TEXT,
        headers TEXT, created_at TEXT);
      CREATE TABLE notes (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, capture_id TEXT,
        title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', source_url TEXT,
        screenshot_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE captures_fts USING fts5(title, url, content);
    `)
    raw.prepare(`INSERT INTO cases VALUES ('case1','C','','custom','2026-01-01','2026-01-01',0)`).run()
    raw
      .prepare(
        `INSERT INTO captures (id, case_id, url, title) VALUES ('cap1','case1','https://a.example','Alpha')`
      )
      .run()
    raw
      .prepare(
        `INSERT INTO captures (id, case_id, url, title) VALUES ('cap2','case1','https://b.example','Beta')`
      )
      .run()
    const rowid1 = (raw.prepare(`SELECT rowid FROM captures WHERE id='cap1'`).get() as {
      rowid: number
    }).rowid
    raw
      .prepare(
        `INSERT INTO captures_fts (rowid, title, url, content) VALUES (?, 'Alpha', 'https://a.example', 'needle text body')`
      )
      .run(rowid1)
    // cap2 deliberately has NO fts row (legacy '' case from migration 12)
    raw.pragma('user_version = 24')
    raw.close()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  })

  it('copies existing FTS content into capture_texts and preserves search', async () => {
    await initDatabase(dbPath)
    expect(getCaptureTextContent('cap1')).toBe('needle text body')
    const hits = searchCaptures('needle')
    expect(hits.map((c) => c.id)).toEqual(['cap1'])
  })

  it('gives legacy captures without an FTS row an empty capture_texts row', async () => {
    await initDatabase(dbPath)
    // getCaptureTextContent keeps its pre-v25 contract: empty text reads as null
    expect(getCaptureTextContent('cap2')).toBeNull()
    const row = getDb()
      .prepare(`SELECT title, url, content FROM capture_texts WHERE capture_id = 'cap2'`)
      .get() as { title: string; url: string; content: string }
    expect(row).toEqual({ title: 'Beta', url: 'https://b.example', content: '' })
  })
})
