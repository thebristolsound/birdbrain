import type Database from 'better-sqlite3'

export function runMigrations(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number

  if (version < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS captures (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT,
          html_path TEXT,
          screenshot_path TEXT,
          hash TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          headers TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT
        );

        CREATE TABLE IF NOT EXISTS capture_tags (
          capture_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (capture_id, tag_id),
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
          title,
          url,
          content
        );

        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          context TEXT,
          confidence REAL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
      `)
      db.pragma('user_version = 1')
    })()
  }

  if (version < 2) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS case_analyses (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          model_used TEXT,
          result TEXT NOT NULL,
          token_usage INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
      `)
      db.pragma('user_version = 2')
    })()
  }

  if (version < 3) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS selectors (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          pattern TEXT NOT NULL,
          is_regex INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          label TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_selectors_case_id ON selectors(case_id);
      `)
      db.pragma('user_version = 3')
    })()
  }

  if (version < 4) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE entities ADD COLUMN source TEXT NOT NULL DEFAULT 'ai';
        CREATE INDEX IF NOT EXISTS idx_entities_capture_source ON entities(capture_id, source);
      `)
      db.pragma('user_version = 4')
    })()
  }

  if (version < 5) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS selector_matches (
          selector_id TEXT NOT NULL,
          capture_id TEXT NOT NULL,
          PRIMARY KEY (selector_id, capture_id),
          FOREIGN KEY (selector_id) REFERENCES selectors(id) ON DELETE CASCADE,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_selector_matches_capture ON selector_matches(capture_id);
      `)
      db.pragma('user_version = 5')
    })()
  }

  if (version < 6) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE cases ADD COLUMN type TEXT DEFAULT 'custom';
      `)
      db.pragma('user_version = 6')
    })()
  }

  if (version < 7) {
    db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS idx_entities_capture_source;
        DROP TABLE IF EXISTS entities;
        DROP TABLE IF EXISTS case_analyses;
      `)
      db.pragma('user_version = 7')
    })()
  }

  if (version < 8) {
    db.transaction(() => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_captures_case_id ON captures(case_id);
        CREATE INDEX IF NOT EXISTS idx_capture_tags_tag_id ON capture_tags(tag_id);
      `)
      db.pragma('user_version = 8')
    })()
  }

  if (version < 9) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capture_favorites (
          capture_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_capture_favorites_created ON capture_favorites(created_at DESC);
      `)
      db.pragma('user_version = 9')
    })()
  }

  if (version < 10) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          capture_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          source_url TEXT,
          screenshot_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_case_id ON notes(case_id);
        CREATE INDEX IF NOT EXISTS idx_notes_capture_id ON notes(capture_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          body,
          content=notes,
          content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
      `)
      db.pragma('user_version = 10')
    })()
  }

  if (version < 11) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE captures ADD COLUMN format TEXT NOT NULL DEFAULT 'html';
        ALTER TABLE captures ADD COLUMN mhtml_path TEXT;
        ALTER TABLE captures ADD COLUMN size_bytes INTEGER;
        ALTER TABLE captures ADD COLUMN manifest_index INTEGER;
        ALTER TABLE captures ADD COLUMN prev_hash TEXT;
        ALTER TABLE captures ADD COLUMN entry_hash TEXT;
        ALTER TABLE captures ADD COLUMN tool_version TEXT;
        ALTER TABLE captures ADD COLUMN extension_version TEXT;
        ALTER TABLE captures ADD COLUMN browser_version TEXT;
        ALTER TABLE captures ADD COLUMN user_agent TEXT;
        ALTER TABLE captures ADD COLUMN http_status INTEGER;
        ALTER TABLE captures ADD COLUMN operator_id TEXT;
        ALTER TABLE captures ADD COLUMN operator_name TEXT;
        CREATE INDEX IF NOT EXISTS idx_captures_format ON captures(format);
        CREATE INDEX IF NOT EXISTS idx_captures_manifest_index ON captures(case_id, manifest_index);
      `)
      db.pragma('user_version = 11')
    })()
  }

  if (version < 12) {
    db.transaction(() => {
      // Rebuild captures_fts to purge stale entries left by CASCADE deletes
      db.exec(`DELETE FROM captures_fts`)
      const rows = db.prepare('SELECT rowid, title, url FROM captures').all() as Array<{
        rowid: number
        title: string
        url: string
      }>
      const insert = db.prepare(
        'INSERT INTO captures_fts (rowid, title, url, content) VALUES (?, ?, ?, ?)'
      )
      for (const row of rows) {
        insert.run(row.rowid, row.title ?? '', row.url, '')
      }
      db.pragma('user_version = 12')
    })()
  }

  if (version < 13) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE captures ADD COLUMN last_verified_at TEXT;
        ALTER TABLE captures ADD COLUMN last_verified_hash TEXT;
        ALTER TABLE captures ADD COLUMN last_verified_status TEXT;
      `)
      db.pragma('user_version = 13')
    })()
  }

  if (version < 14) {
    // Purge orphaned captures_fts entries whose rowids no longer exist in captures.
    // These orphans caused "constraint failed" on new capture inserts because the FTS
    // INSERT tried to reuse a rowid that was still present in the standalone FTS table.
    // Root cause: dbAdmin.deleteRow() and cleanOrphans() deleted capture rows without
    // cleaning the corresponding FTS entries (now fixed).
    db.transaction(() => {
      db.prepare('DELETE FROM captures_fts WHERE rowid NOT IN (SELECT rowid FROM captures)').run()
      db.pragma('user_version = 14')
    })()
  }

  if (version < 15) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capture_analyses (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          model TEXT NOT NULL,
        token_usage TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
        CREATE INDEX IF NOT EXISTS idx_capture_analyses_capture ON capture_analyses(capture_id);
      `)
      db.pragma('user_version = 15')
    })()
  }

  if (version < 16) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS extracted_data (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          case_id TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT NOT NULL,
          value TEXT NOT NULL,
          source_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_extracted_data_case_id ON extracted_data(case_id);
        CREATE INDEX IF NOT EXISTS idx_extracted_data_case_category ON extracted_data(case_id, category);
        CREATE INDEX IF NOT EXISTS idx_extracted_data_capture_id ON extracted_data(capture_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_data_unique ON extracted_data(capture_id, category, subcategory, value);
      `)
      db.pragma('user_version = 16')
    })()
  }

  if (version < 17) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS annotations (
          capture_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          shapes_json TEXT NOT NULL,
          image_width INTEGER NOT NULL,
          image_height INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS annotation_pins (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          number INTEGER NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_annotation_pins_capture ON annotation_pins(capture_id);
        CREATE INDEX IF NOT EXISTS idx_annotation_pins_capture_number ON annotation_pins(capture_id, number);
      `)
      db.pragma('user_version = 17')
    })()
  }

  if (version < 18) {
    db.transaction(() => {
      // Mirror of the manifest-authoritative trusted-time axis (#120). NULL for
      // existing rows; a startup rebuild (rebuildable from the manifest alone)
      // populates eligible v2 captures to 'pending' and legacy to 'none'.
      db.exec(`
        ALTER TABLE captures ADD COLUMN trusted_time_status TEXT;
        CREATE INDEX IF NOT EXISTS idx_captures_trusted_time ON captures(trusted_time_status);
      `)
      db.pragma('user_version = 18')
    })()
  }

  if (version < 19) {
    db.transaction(() => {
      // Content-addressed integrity for the screenshot and extracted-text
      // sidecars (#118). NULL for existing rows; the manifest remains the
      // authority — these mirror the hashes recorded in the v2+ capture entry so
      // verify can re-bind sidecars without re-reading the manifest. Old rows
      // read back as undefined and are simply not sidecar-checked.
      db.exec(`
        ALTER TABLE captures ADD COLUMN screenshot_hash TEXT;
        ALTER TABLE captures ADD COLUMN text_hash TEXT;
      `)
      db.pragma('user_version = 19')
    })()
  }

  if (version < 20) {
    db.transaction(() => {
      // Corroboration-only TLS cert chain re-fetched after storage (#123). Holds
      // the JSON-serialized TlsCertChainResult (chain or fail-soft error marker).
      // NULL for existing rows; the manifest remains the authority — this mirrors
      // the value anchored in the v2+ capture entry. Old rows read back undefined.
      db.exec(`
        ALTER TABLE captures ADD COLUMN tls_cert_chain TEXT;
      `)
      db.pragma('user_version = 20')
    })()
  }

  if (version < 21) {
    db.transaction(() => {
      // Pinned Wayback Machine corroboration references (#wayback). Corroboration
      // only — NOT part of the capture hash chain (cf. TLS cert chain, #123).
      // contentPath/contentHash/manifestIndex are reserved for the future
      // download-later phase and added then; references are metadata-only now.
      db.exec(`
        CREATE TABLE IF NOT EXISTS capture_archive_refs (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          snapshot_timestamp TEXT NOT NULL,
          snapshot_url TEXT NOT NULL,
          original_url TEXT NOT NULL,
          digest TEXT,
          status_code INTEGER,
          mime_type TEXT,
          checked_at TEXT NOT NULL,
          pinned_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_archive_refs_capture ON capture_archive_refs(capture_id);
      `)
      db.pragma('user_version = 21')
    })()
  }

  if (version < 22) {
    db.transaction(() => {
      // FTS5 trigram index over extracted_data for substring search on the Data
      // page. External-content table kept in sync by INSERT/DELETE triggers;
      // extracted rows are immutable (insert-or-ignore / delete-by-capture) so no
      // UPDATE trigger is needed.
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS extracted_data_fts USING fts5(
          value,
          source_url,
          content='extracted_data',
          content_rowid='rowid',
          tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS extracted_data_ai AFTER INSERT ON extracted_data BEGIN
          INSERT INTO extracted_data_fts(rowid, value, source_url)
          VALUES (new.rowid, new.value, new.source_url);
        END;

        CREATE TRIGGER IF NOT EXISTS extracted_data_ad AFTER DELETE ON extracted_data BEGIN
          INSERT INTO extracted_data_fts(extracted_data_fts, rowid, value, source_url)
          VALUES ('delete', old.rowid, old.value, old.source_url);
        END;

        INSERT INTO extracted_data_fts(rowid, value, source_url)
        SELECT rowid, value, source_url FROM extracted_data;
      `)
      db.pragma('user_version = 22')
    })()
  }

  if (version < 23) {
    db.transaction(() => {
      // Recapture provenance (#recapture): how the capture was produced, and
      // the linked-sibling pointer for "Recapture this capture" jobs.
      db.exec(`
        ALTER TABLE captures ADD COLUMN method TEXT NOT NULL DEFAULT 'extension';
        ALTER TABLE captures ADD COLUMN supersedes_capture_id TEXT;
      `)
      db.pragma('user_version = 23')
    })()
  }

  if (version < 24) {
    db.transaction(() => {
      // Consent-overlay suppression provenance for background recaptures.
      // Mirrors the value anchored in the manifest capture entry; NULL for
      // existing rows and operator-witnessed captures.
      db.exec(`
        ALTER TABLE captures ADD COLUMN consent_suppression TEXT;
      `)
      db.pragma('user_version = 24')
    })()
  }

  if (version < 25) {
    db.transaction(() => {
      // Split text storage from the search index: capture_texts holds the DB
      // copy of Extracted Text (explicit INTEGER PK — vacuum-safe, unlike
      // captures.rowid), and captures_fts becomes an external-content index
      // over it, maintained by triggers. Kills the manual-sync invariant that
      // caused the migration-12 and migration-14 bug classes.
      db.exec(`
        CREATE TABLE capture_texts (
          id INTEGER PRIMARY KEY,
          capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT ''
        );

        INSERT INTO capture_texts (capture_id, title, url, content)
          SELECT c.id,
                 coalesce(f.title, coalesce(c.title, '')),
                 coalesce(f.url, coalesce(c.url, '')),
                 coalesce(f.content, '')
          FROM captures c
          LEFT JOIN captures_fts f ON f.rowid = c.rowid;

        DROP TABLE captures_fts;

        CREATE VIRTUAL TABLE captures_fts USING fts5(
          title,
          url,
          content,
          content=capture_texts,
          content_rowid=id
        );

        INSERT INTO captures_fts(captures_fts) VALUES ('rebuild');

        CREATE TRIGGER capture_texts_ai AFTER INSERT ON capture_texts BEGIN
          INSERT INTO captures_fts(rowid, title, url, content)
          VALUES (new.id, new.title, new.url, new.content);
        END;
        CREATE TRIGGER capture_texts_ad AFTER DELETE ON capture_texts BEGIN
          INSERT INTO captures_fts(captures_fts, rowid, title, url, content)
          VALUES('delete', old.id, old.title, old.url, old.content);
        END;
        CREATE TRIGGER capture_texts_au AFTER UPDATE ON capture_texts BEGIN
          INSERT INTO captures_fts(captures_fts, rowid, title, url, content)
          VALUES('delete', old.id, old.title, old.url, old.content);
          INSERT INTO captures_fts(rowid, title, url, content)
          VALUES (new.id, new.title, new.url, new.content);
        END;
      `)
      db.pragma('user_version = 25')
    })()
  }
}
