import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { UNDATED_TAG_CREATED_AT } from '@main/services/db/migrations'
import { createCase } from '@main/services/db/caseRepo'
import { deleteCapture, insertCapture } from '@main/services/db/captureRepo'
import { createNote } from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  addTagToNote,
  createTag,
  deleteTag,
  findOrCreateTagByName,
  findTagIdByNameExact,
  findTagIdByNameInsensitive,
  getTagsForCapture,
  getTagsForNote
} from '@main/services/db/tagRepo'
import { getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import { windBackToV38 } from '../../helpers/windBackToV38'

// Migration 39 (#1512): the working-layer keys gain the author, so a teammate's
// row that shares a local row's key is accepted, while two local rows still
// collide exactly as they did at v38. Frozen here:
//
//   1. UPGRADE. A populated v38 database reaches v39 with every tag, tag
//      application, annotation layer and pin intact, and the foreign keys on.
//   2. KEYS. One row per author: a second local row is refused or ignored as
//      before, and a remote row with the same key is accepted.
//   3. RE-RUN. A migrated copy marked v38 runs the block again and changes
//      nothing.
const REMOTE = 'installation-remote-0001'

type Row = Record<string, unknown>

describe('migration v39 (per-author working-layer keys)', () => {
  let tempDir: string
  let dbPath: string
  let caseId: string
  let captureId: string
  let noteId: string
  let tagIds: { upper: string; lower: string }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-migration-39-'))
    dbPath = join(tempDir, 'working-layer.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Upgrade' }).id
    captureId = insertCapture({
      caseId,
      url: 'https://example.com/1',
      title: 'One',
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z'
    }).id
    noteId = createNote({ caseId, title: 'N', body: 'text' }).id
    // Both spellings, which the v38 UNIQUE allowed for its BINARY comparison.
    tagIds = {
      upper: createTag({ name: 'Evidence', color: '#22c55e' }).id,
      lower: createTag({ name: 'evidence' }).id
    }
    addTagToCapture({ captureId, tagId: tagIds.upper })
    addTagToNote({ noteId, tagId: tagIds.lower })
    saveAnnotations({ captureId, shapes: [], imageWidth: 800, imageHeight: 600 }, 'Op')
    upsertPin({ captureId, body: 'first pin' })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function rows(table: string): Row[] {
    return getDb().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[]
  }

  // Marks the closed database v38, in the v38 shape when `windBack` is set
  // and as a migrated copy marked one version back when it is not, and
  // returns its annotation_pins columns as the reopen will find them.
  function markV38(windBack: boolean): string[] {
    closeDatabase()
    const raw = new Database(dbPath)
    raw.pragma('foreign_keys = OFF')
    if (windBack) windBackToV38(raw)
    raw.pragma('user_version = 38')
    const pinColumns = (raw.pragma('table_info(annotation_pins)') as Row[]).map((c) => c.name)
    raw.close()
    return pinColumns as string[]
  }

  function insertRemoteTag(id: string, name: string): void {
    getDb()
      .prepare('INSERT INTO tags (id, name, author_installation_id) VALUES (?, ?, ?)')
      .run(id, name, REMOTE)
  }

  it('upgrades a populated v38 database with every row kept', async () => {
    const before = {
      tags: rows('tags'),
      exhibitTags: rows('exhibit_tags'),
      noteTags: rows('note_tags'),
      annotations: rows('annotations'),
      pins: rows('annotation_pins')
    }
    expect(markV38(true)).not.toContain('author_installation_id')
    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1)
    expect(getDb().pragma('foreign_key_check')).toEqual([])
    expect(rows('tags')).toEqual(
      before.tags.map((t) => ({ ...t, created_at: UNDATED_TAG_CREATED_AT }))
    )
    expect(rows('exhibit_tags')).toEqual(before.exhibitTags)
    expect(rows('note_tags')).toEqual(before.noteTags)
    expect(rows('annotations')).toEqual(before.annotations)
    expect(rows('annotation_pins')).toEqual(
      before.pins.map((p) => ({
        ...p,
        author_installation_id: null,
        version: 0,
        deleted_at: null,
        row_signature: null
      }))
    )
    expect(getTagsForCapture(captureId).map((t) => t.id)).toEqual([tagIds.upper])
    expect(getTagsForNote(noteId).map((t) => t.id)).toEqual([tagIds.lower])
    expect(getAnnotations(captureId).annotations).toMatchObject({ imageWidth: 800 })

    // A tag created after the migration sorts after every backfilled one.
    const later = createTag({ name: 'Later' })
    const { created_at } = getDb()
      .prepare('SELECT created_at FROM tags WHERE id = ?')
      .get(later.id) as { created_at: string }
    expect(created_at > UNDATED_TAG_CREATED_AT).toBe(true)
  })

  it('keeps the cascades from Captures, notes and tags', () => {
    deleteTag(tagIds.upper)
    deleteTag(tagIds.lower)
    expect(rows('exhibit_tags')).toEqual([])
    expect(rows('note_tags')).toEqual([])
    deleteCapture(captureId)
    expect(rows('annotations')).toEqual([])
    expect(rows('annotation_pins')).toEqual([])
  })

  it('makes a tag name unique per author, with the same case rule', () => {
    expect(() => createTag({ name: 'Evidence' })).toThrow(/UNIQUE/)
    insertRemoteTag('remote-evidence', 'Evidence')
    expect(() => insertRemoteTag('remote-again', 'Evidence')).toThrow(/UNIQUE/)
    insertRemoteTag('remote-lower', 'evidence')
    expect(
      (
        getDb().prepare("SELECT COUNT(*) AS n FROM tags WHERE lower(name) = 'evidence'").get() as {
          n: number
        }
      ).n
    ).toBe(4)
  })

  it('looks a name up among this installation’s tags only', () => {
    insertRemoteTag('remote-evidence', 'Evidence')
    insertRemoteTag('remote-rumour', 'Rumour')

    expect(findTagIdByNameExact('Evidence')).toBe(tagIds.upper)
    expect(findTagIdByNameExact('Evidence', REMOTE)).toBe('remote-evidence')
    expect(findTagIdByNameInsensitive('RUMOUR', REMOTE)).toBe('remote-rumour')
    expect(findTagIdByNameInsensitive('Rumour')).toBeUndefined()
    expect(findOrCreateTagByName('Evidence').id).toBe(tagIds.upper)
    const rumour = findOrCreateTagByName('Rumour')
    expect(rumour.id).not.toBe('remote-rumour')
  })

  it('keeps one annotation layer per author and reads this installation’s first', () => {
    getDb()
      .prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
           image_height, updated_at, author_installation_id)
         VALUES (?, 1, '[]', 1024, 768, '2026-10-01T00:00:00.000Z', ?)`
      )
      .run(captureId, REMOTE)
    expect(getAnnotations(captureId).annotations).toMatchObject({ imageWidth: 800 })

    const saved = saveAnnotations({ captureId, shapes: [], imageWidth: 640, imageHeight: 480 })
    expect(saved.imageWidth).toBe(640)
    expect(rows('annotations').map((a) => [a.author_installation_id, a.image_width])).toEqual([
      [null, 640],
      [REMOTE, 1024]
    ])
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
             image_height, updated_at)
           VALUES (?, 1, '[]', 1, 1, '2026-10-01T00:00:00.000Z')`
        )
        .run(captureId)
    ).toThrow(/UNIQUE/)
  })

  it('reads the lowest author’s layer when this installation has none', () => {
    const insert = getDb().prepare(
      `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
         image_height, updated_at, author_installation_id)
       VALUES (?, 1, '[]', ?, 1, '2026-10-01T00:00:00.000Z', ?)`
    )
    getDb().prepare('DELETE FROM annotations').run()
    insert.run(captureId, 2, 'installation-b')
    insert.run(captureId, 1, 'installation-a')
    expect(getAnnotations(captureId).annotations).toMatchObject({ imageWidth: 1 })
  })

  it('keys each tag application by author', () => {
    addTagToCapture({ captureId, tagId: tagIds.upper })
    addTagToNote({ noteId, tagId: tagIds.lower })
    expect(rows('exhibit_tags')).toHaveLength(1)
    expect(rows('note_tags')).toHaveLength(1)

    getDb()
      .prepare(
        'INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id) VALUES (?, ?, ?)'
      )
      .run(captureId, tagIds.upper, REMOTE)
    getDb()
      .prepare('INSERT INTO note_tags (note_id, tag_id, author_installation_id) VALUES (?, ?, ?)')
      .run(noteId, tagIds.lower, REMOTE)
    expect(rows('exhibit_tags').map((r) => r.author_installation_id)).toEqual([null, REMOTE])
    expect(rows('note_tags').map((r) => r.author_installation_id)).toEqual([null, REMOTE])
  })

  it('gives annotation pins the four sync columns', () => {
    const pin = rows('annotation_pins')[0]
    expect(pin).toMatchObject({
      author_installation_id: null,
      version: 0,
      deleted_at: null,
      row_signature: null
    })
  })

  it('runs again over its own tables without changing them', async () => {
    insertRemoteTag('remote-evidence', 'Evidence')
    const before = ['tags', 'exhibit_tags', 'note_tags', 'annotations', 'annotation_pins'].map(rows)
    expect(markV38(false)).toContain('author_installation_id')
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(
      ['tags', 'exhibit_tags', 'note_tags', 'annotations', 'annotation_pins'].map(rows)
    ).toEqual(before)
  })
})
