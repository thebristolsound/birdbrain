import type Database from 'better-sqlite3'

// Puts the five tables migration 39 changes back in their v38 shape, keeping
// every row, on a connection the caller opened with `foreign_keys = OFF`. The
// v38 shape is the v1, v17, v32 and v34 tables with v36's four columns
// appended; the user_version is the caller's to set. Tests that wind back
// further than v38 run this first, since v39's unique indexes name the author
// column those tests drop.
export function windBackToV38(raw: Database.Database): void {
  raw.exec(`
    CREATE TABLE tags_v38 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      author_installation_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      row_signature TEXT
    );
    INSERT INTO tags_v38
      SELECT id, name, color, author_installation_id, version, deleted_at, row_signature
        FROM tags;
    DROP TABLE tags;
    ALTER TABLE tags_v38 RENAME TO tags;

    CREATE TABLE annotations_v38 (
      capture_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      shapes_json TEXT NOT NULL,
      image_width INTEGER NOT NULL,
      image_height INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      author_installation_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      row_signature TEXT,
      FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
    );
    INSERT INTO annotations_v38
      SELECT capture_id, schema_version, shapes_json, image_width, image_height, updated_at,
             updated_by, author_installation_id, version, deleted_at, row_signature
        FROM annotations;
    DROP TABLE annotations;
    ALTER TABLE annotations_v38 RENAME TO annotations;

    ALTER TABLE annotation_pins DROP COLUMN author_installation_id;
    ALTER TABLE annotation_pins DROP COLUMN version;
    ALTER TABLE annotation_pins DROP COLUMN deleted_at;
    ALTER TABLE annotation_pins DROP COLUMN row_signature;

    CREATE TABLE exhibit_tags_v38 (
      exhibit_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      author_installation_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      row_signature TEXT,
      PRIMARY KEY (exhibit_id, tag_id),
      FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    INSERT INTO exhibit_tags_v38
      SELECT exhibit_id, tag_id, author_installation_id, version, deleted_at, row_signature
        FROM exhibit_tags;
    DROP TABLE exhibit_tags;
    ALTER TABLE exhibit_tags_v38 RENAME TO exhibit_tags;
    CREATE INDEX idx_exhibit_tags_tag_id ON exhibit_tags(tag_id);

    CREATE TABLE note_tags_v38 (
      note_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      author_installation_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      row_signature TEXT,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    INSERT INTO note_tags_v38
      SELECT note_id, tag_id, author_installation_id, version, deleted_at, row_signature
        FROM note_tags;
    DROP TABLE note_tags;
    ALTER TABLE note_tags_v38 RENAME TO note_tags;
    CREATE INDEX idx_note_tags_tag_id ON note_tags(tag_id);
  `)
}
