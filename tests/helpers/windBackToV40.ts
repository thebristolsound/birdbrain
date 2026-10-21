import type Database from 'better-sqlite3'

// Puts the four tables migration 41 rebuilt back in their v40 shape, with the
// keys to `captures` and `exhibits` that v41 moved to application code, and
// drops `deleted_captures`, on a connection the caller opened with
// `foreign_keys = OFF`. Every row keeps its rowid, which notes_fts is keyed
// on, and each table's indexes and triggers come back from their stored SQL,
// as v41 itself does. The user_version is the caller's to set.
export function windBackToV40(raw: Database.Database): void {
  const sync = `author_installation_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      row_signature TEXT`
  const rebuild = (table: string, definition: string): void => {
    const saved = raw
      .prepare(
        `SELECT sql FROM sqlite_master
          WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL`
      )
      .all(table) as Array<{ sql: string }>
    const columns = (raw.pragma(`table_info(${table})`) as Array<{ name: string }>)
      .map(({ name }) => name)
      .join(', ')
    raw.exec(`
      CREATE TABLE ${table}_v40 (${definition});
      INSERT INTO ${table}_v40 (rowid, ${columns}) SELECT rowid, ${columns} FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${table}_v40 RENAME TO ${table};
    `)
    for (const { sql } of saved) raw.exec(sql)
  }
  rebuild(
    'notes',
    `id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      capture_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      screenshot_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      body_doc TEXT,
      anchor_kind TEXT,
      anchor_json TEXT,
      ${sync},
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL`
  )
  rebuild(
    'annotations',
    `capture_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      shapes_json TEXT NOT NULL,
      image_width INTEGER NOT NULL,
      image_height INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      ${sync},
      FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE`
  )
  rebuild(
    'annotation_pins',
    `id TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ${sync},
      FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE`
  )
  rebuild(
    'exhibit_tags',
    `exhibit_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      ${sync},
      FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE`
  )
  raw.exec('DROP TABLE IF EXISTS deleted_captures')
}
