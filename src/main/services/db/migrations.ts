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
                 coalesce(c.title, ''),
                 coalesce(c.url, ''),
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

  if (version < 26) {
    db.transaction(() => {
      // Rich-text note bodies. `body` keeps its meaning — the plain text the
      // notes_fts triggers index — and is derived in main from body_doc at
      // write time. Nothing is backfilled: a legacy note has body_doc = NULL
      // and is still a valid note, so notes_fts needs no rebuild.
      db.exec(`ALTER TABLE notes ADD COLUMN body_doc TEXT`)
      db.pragma('user_version = 26')
    })()
  }

  if (version < 27) {
    db.transaction(() => {
      // Anchors. `anchor_json` is the payload; `anchor_kind` is derived from it
      // in main and stored alongside so anchors can be counted and filtered
      // without parsing every row. Both NULL means an unanchored note, which
      // stays valid — nothing is backfilled.
      db.exec(`
        ALTER TABLE notes ADD COLUMN anchor_kind TEXT;
        ALTER TABLE notes ADD COLUMN anchor_json TEXT;
        CREATE INDEX IF NOT EXISTS idx_notes_anchor_kind ON notes(anchor_kind);
      `)
      db.pragma('user_version = 27')
    })()
  }

  if (version < 28) {
    db.transaction(() => {
      // References index over note Mentions (#389), derived from body_doc in
      // main on every note-body write. FK to notes only: a deleted TARGET must
      // stay representable as a broken reference, so target rows are resolved
      // at read time rather than constrained here. (note_id, ord) as the
      // primary key preserves document order and duplicate mentions.
      // Create-only, no backfill, and this is a declared deviation from spike
      // constraint 7 rather than an oversight. Every validated write path
      // (noteRepo, the Case Archive import) put body_doc through parseNoteDoc,
      // which rejected unknown node types, and `mention` was not in the schema
      // before this version — so none of them can have stored one. Only the
      // Database Admin hatch, which did not parse body_doc, could, and a
      // backfill would have to call extractNoteMentions on every row: that
      // throws on an unparseable body_doc, and a throw here aborts
      // runMigrations, which initDatabase turns into a database the app cannot
      // open. The backfill would break on exactly the drifted rows it exists
      // to repair.
      //
      // A hand-written mention-shaped node therefore stays unindexed, and
      // there is no repair surface for it yet: rebuildForCase exists but has
      // no production caller, and note_references is not in dbAdmin's
      // ALLOWED_TABLES, so it cannot be read or fixed from the interface.
      // Tracked in #662.
      db.exec(`
        CREATE TABLE note_references (
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          ord INTEGER NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          PRIMARY KEY (note_id, ord)
        );
        CREATE INDEX idx_note_references_target ON note_references(target_type, target_id);
      `)
      db.pragma('user_version = 28')
    })()
  }

  if (version < 29) {
    db.transaction(() => {
      // Selector provenance (#395): where the pattern came from, stamped once
      // at creation and never edited after. Nullable with no default and no
      // backfill — NULL means the row predates provenance recording, and the
      // interface renders nothing for it. A default of 'manual' was rejected
      // deliberately: it would claim by hand for every selector the extension
      // created before this migration, which is a false provenance claim in an
      // evidence tool. No index: nothing queries or filters on origin, it is
      // read only through the existing SELECT * paths.
      db.exec(`
        ALTER TABLE selectors ADD COLUMN origin TEXT;
      `)
      db.pragma('user_version = 29')
    })()
  }

  if (version < 30) {
    db.transaction(() => {
      // Per-case auto-capture exclusions (#400): the patterns this case never
      // captures, and whether they stack on the operator's global ignore list
      // or replace it for this case.
      //
      // Two columns on `cases` rather than a `case_exclusions` table, ruled
      // 2026-08-21. The list is read and written whole, one case at a time by
      // primary key, so relational storage buys nothing here and costs five
      // archive edit sites; this way `caseRepo.importCaseRow` is the only one.
      // JSON-in-TEXT is already the house pattern (notes.body_doc, annotations
      // shapes_json, anchor_json).
      //
      // Both nullable with no DEFAULT, and NULL is the legacy behaviour: no
      // case exclusions, stacking on the global list. So every existing case is
      // already correct after this migration and no backfill runs — the
      // alternative, writing '[]'/'stack' into every row, would claim an
      // operator decision nobody made. No index: one row, by primary key.
      db.exec(`
        ALTER TABLE cases ADD COLUMN exclusions TEXT;
        ALTER TABLE cases ADD COLUMN exclusion_mode TEXT;
      `)
      db.pragma('user_version = 30')
    })()
  }

  if (version < 31) {
    db.transaction(() => {
      // Case number and demo flag (#399, ADR-0010; demo flag ruled onto this
      // migration by the #405 ruling of 2026-08-23).
      //
      // `case_number` follows the v29/v30 precedent exactly: nullable with no
      // default, because NULL means the operator never assigned one and ''
      // would be a claim nobody made.
      //
      // `is_demo` takes the opposite treatment (the v23 precedent): backfilling
      // every pre-existing case with 0 is a TRUE claim — nothing before this
      // migration was ever seeded as a demonstration case — and NOT NULL gives
      // readers a total field rather than a tri-state. The flag exists so an
      // exported demo case is stated as fixture data in the Certification and
      // the export dialog, never handed over as evidence by accident (#405).
      //
      // No index: both are read through the existing SELECT * paths.
      db.exec(`
        ALTER TABLE cases ADD COLUMN case_number TEXT;
        ALTER TABLE cases ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
      `)
      db.pragma('user_version = 31')
    })()
  }

  if (version < 32) {
    db.transaction(() => {
      // Note-level tags (#391, ruling R9 of 2026-08-24). A tag raised from a
      // passage of a Note attaches to the Note itself, and additionally to the
      // Note's Capture when it is anchored to one — so the relation the app
      // lacked has to exist before the action can be honest about what it did.
      //
      // Shaped on `capture_tags` (v1) deliberately: a composite primary key
      // over the two foreign keys, no surrogate id, both sides cascading. That
      // makes re-tagging idempotent via INSERT OR IGNORE, deleting a note or a
      // tag clean up after itself, and keeps the table out of
      // `ID_PROBE_TABLES` — like `capture_tags`, it has no id of its own to
      // collide on and follows the note/tag remapping on archive import.
      //
      // The index mirrors `idx_capture_tags_tag_id` (v8): the PK already
      // serves note_id lookups, and the tag_id direction is what a
      // "which notes carry this tag" read needs.
      db.exec(`
        CREATE TABLE IF NOT EXISTS note_tags (
          note_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (note_id, tag_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);
      `)
      db.pragma('user_version = 32')
    })()
  }

  if (version < 33) {
    db.transaction(() => {
      // Duplication provenance (#827). Follows the v23 recapture precedent
      // exactly — `supersedes_capture_id` is the same shape of link — because a
      // duplicate is the same kind of fact: this row's bytes came from that
      // row, and the pair must stay legible after either one is opened.
      //
      // Nullable with no default: NULL means the capture is not a duplicate,
      // which is true of every row that existed before this migration. A
      // backfilled value would be a claim nobody made.
      //
      // No index: read through the existing SELECT * paths, and a case holds
      // captures in the thousands, not the millions.
      db.exec(`ALTER TABLE captures ADD COLUMN duplicate_of_capture_id TEXT;`)
      db.pragma('user_version = 33')
    })()
  }

  if (version < 34) {
    db.transaction(() => {
      // The Exhibit model (#1147, ADR-0023 / ADR-0024, ruling X35). An Exhibit
      // is the unit of evidence and a Capture is one kind of it, so `captures`
      // is untouched — `text_hash` and `screenshot_hash` stay there — and every
      // Capture gains an `exhibits` row with the SAME id. Kind and origin
      // columns on `captures` were rejected in X35: they would make every
      // capture column nullable for the kinds that lack it, and turn the
      // inventory query into a per-kind special case.
      //
      // `kind` and `origin` are plain TEXT, not CHECK-constrained, for the same
      // reason the Manifest schema keeps them open strings: a vocabulary this
      // build has never heard of is a row a newer build wrote, and refusing it
      // at the storage layer would be a false verdict on valid data. The
      // writer's vocabulary is fixed at commit time by the app (X43).
      //
      // `path` and `size_bytes` are nullable because a legacy Capture may
      // record neither; '' and 0 would be claims nobody made. `manifest_seq`
      // nullable IS the anchoring axis: NULL means the Exhibit carries no
      // Manifest Entry (a pre-v11 `html` Capture, X41), and its Exhibit Number
      // is then a citation aid and never an anchoring claim.
      db.exec(`
        CREATE TABLE exhibits (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          origin TEXT NOT NULL,
          exhibit_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          path TEXT,
          size_bytes INTEGER,
          committed_at TEXT NOT NULL,
          manifest_seq INTEGER,
          UNIQUE (case_id, exhibit_number),
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_exhibits_case_id ON exhibits(case_id);
      `)

      // The `renumber` half of the migration (X18, X41), in SQL because the
      // ordering it needs is already on the `captures` row: `manifest_index`
      // for an anchored Capture, `timestamp` for a legacy one. Numbers are a
      // per-Case RANK starting at 1, not the manifest index itself — the index
      // counts deletion, timestamp and export entries too, so using it directly
      // would leave gaps that read as missing Exhibits.
      //
      // Anchored Captures come first in manifest order and unanchored ones
      // after them all in capture order, which is X41 exactly: `manifest_index
      // IS NULL` sorts 0 before 1. `id` breaks a tie so the assignment is
      // deterministic across a rebuild rather than dependent on scan order.
      //
      // The matching `renumber` Manifest Entry is NOT written here. Appending
      // to the chain needs the signing key, the storage root and the operator
      // identity, none of which are initialised when `runMigrations` runs
      // (see `initDatabase`'s call site in `src/main/index.ts`). The entry is
      // appended by the post-init backfill in `exhibitBackfill.ts`, which is
      // idempotent and reconciles against the rows written here.
      db.exec(`
        INSERT INTO exhibits (
          id, case_id, kind, origin, exhibit_number, name,
          content_hash, path, size_bytes, committed_at, manifest_seq
        )
        SELECT
          id,
          case_id,
          'capture',
          COALESCE(method, 'extension'),
          ROW_NUMBER() OVER (
            PARTITION BY case_id
            ORDER BY (manifest_index IS NULL), manifest_index, timestamp, id
          ),
          COALESCE(NULLIF(title, ''), url),
          hash,
          COALESCE(mhtml_path, html_path),
          size_bytes,
          COALESCE(created_at, timestamp),
          manifest_index
        FROM captures;
      `)

      // Derived Files (X3, X17). `manifest_seq` is nullable for the reason X34
      // gives: a legacy thumbnail whose screenshot is missing or fails
      // verification is RECORDED but not anchored, because hashing the bytes
      // found on disk would anchor a file that could have been swapped. The
      // column is not in the ticket's column list; without it the inventory
      // cannot say "unanchored" about a Derived File, which the acceptance
      // criteria require it to say.
      //
      // No Exhibit Number: a Derived File is cited by its parent and its
      // derivation name (X31).
      db.exec(`
        CREATE TABLE derived_files (
          id TEXT PRIMARY KEY,
          exhibit_id TEXT NOT NULL,
          derivation TEXT NOT NULL,
          tool_version TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          manifest_seq INTEGER,
          FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_derived_files_exhibit_id ON derived_files(exhibit_id);
      `)

      // The Staging Pool (ADR-0024). Created here, populated by `803p`, so the
      // inventory query has a stable shape from the first read path rather than
      // gaining a second branch when the pool arrives.
      //
      // `source_url` and `source_claims` are what the operator or an external
      // service SAID about the bytes' provenance, and are unverified by
      // construction (X5, X22): the app attests only the bytes it received and
      // when. `source_claims` is JSON-in-TEXT, the house pattern already used
      // by notes.body_doc and annotations.shapes_json.
      db.exec(`
        CREATE TABLE staging_files (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          origin TEXT NOT NULL,
          name TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          arrived_at TEXT NOT NULL,
          source_url TEXT,
          source_claims TEXT,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_staging_files_case_id ON staging_files(case_id);
      `)

      // `exhibit_tags` replaces `capture_tags` (X19, ADR-0023): classification
      // is Tags, and Tags have to reach every kind. A Capture's Exhibit id IS
      // its capture id, so this is a rename plus an FK retarget over the same
      // rows — and it must be a rebuild, not `ALTER TABLE ... RENAME`, because
      // a rename carries the old foreign key to `captures` with it.
      //
      // The copy runs AFTER the `exhibits` backfill above so every referenced
      // id already exists: `foreign_keys` is ON for the whole connection and
      // checked per statement, so the opposite order would abort the migration
      // and, through `initDatabase`, leave the app unable to open the database.
      //
      // Index mirrors the dropped `idx_capture_tags_tag_id` (v8): the primary
      // key already serves the exhibit_id direction.
      db.exec(`
        CREATE TABLE exhibit_tags (
          exhibit_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (exhibit_id, tag_id),
          FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        INSERT INTO exhibit_tags (exhibit_id, tag_id)
          SELECT capture_id, tag_id FROM capture_tags;
        DROP TABLE capture_tags;
        CREATE INDEX idx_exhibit_tags_tag_id ON exhibit_tags(tag_id);
      `)
      db.pragma('user_version = 34')
    })()
  }

  if (version < 35) {
    db.transaction(() => {
      // The Persona registry (ADR-0030, #1497): a signed-in browser identity,
      // registered per install like a Tag. Soft delete: `deleted_at` hides a
      // row from pickers while historic Captures keep the label they were
      // stamped with (phase 2). The cookie values themselves never touch this
      // table; only the import count and time do, so a row says when the
      // partition was last seeded and nothing about what it holds.
      db.exec(`
        CREATE TABLE personas (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          last_import_at TEXT,
          last_import_count INTEGER,
          deleted_at TEXT
        );
      `)
      db.pragma('user_version = 35')
    })()
  }

  if (version < 36) {
    // `foreign_keys` is ON for the connection, and with it ON a DROP TABLE runs
    // an implicit DELETE that cascades: dropping `exhibits` below would take
    // every `derived_files` and `exhibit_tags` row with it. The pragma is a
    // no-op inside a transaction, so it is switched around the transaction and
    // the rebuilt table is checked before the keys come back on.
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        // Shared Cases, step 2 (#1510, docs/specs/2026-09-19-collaborative-cases-
        // design.md "Database"). Storage only: nothing here makes a Case shared,
        // and no row is rewritten. NULL in every new column means "this
        // installation", which is true of every row that existed before now.
        //
        // `case_members` caches the roster the Owner's chain carries in its
        // `member-add` and `member-revoke` entries. Derived, never authoritative:
        // verify-core rebuilds it from the chain and the cache is what the
        // screens read.
        db.exec(`
          CREATE TABLE case_members (
            case_id TEXT NOT NULL,
            installation_id TEXT NOT NULL,
            public_key_pem TEXT NOT NULL,
            member_code TEXT NOT NULL,
            operator_name TEXT NOT NULL,
            node_id TEXT NOT NULL,
            role TEXT NOT NULL,
            added_at_index INTEGER NOT NULL,
            revoked_at_index INTEGER,
            PRIMARY KEY (case_id, installation_id),
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
          );
        `)

        // Exhibit Numbers are per member in a Shared Case (decision 7), so the
        // uniqueness rule widens from (case, number) to (case, author, number).
        // SQLite cannot alter a table constraint, so the table is rebuilt the way
        // v34 rebuilt the tag relation; the copy keeps every row's id and number.
        //
        // The rule is a unique index over COALESCE(author_installation_id, ''),
        // not a table UNIQUE: SQLite treats NULLs as distinct inside a unique
        // constraint, so `UNIQUE (case_id, author_installation_id,
        // exhibit_number)` would let two local Exhibits share a number the moment
        // the author column went nullable. The index is what keeps the v34 test
        // "refuses a second Exhibit with the same number in a case" true.
        db.exec(`
          CREATE TABLE exhibits_new (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            origin TEXT NOT NULL,
            exhibit_number INTEGER NOT NULL,
            name TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            path TEXT,
            size_bytes INTEGER,
            committed_at TEXT NOT NULL,
            manifest_seq INTEGER,
            member_code TEXT,
            author_installation_id TEXT,
            FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
          );
          INSERT INTO exhibits_new (
            id, case_id, kind, origin, exhibit_number, name,
            content_hash, path, size_bytes, committed_at, manifest_seq
          )
            SELECT id, case_id, kind, origin, exhibit_number, name,
                   content_hash, path, size_bytes, committed_at, manifest_seq
              FROM exhibits;
          DROP TABLE exhibits;
          ALTER TABLE exhibits_new RENAME TO exhibits;
          CREATE INDEX idx_exhibits_case_id ON exhibits(case_id);
          CREATE UNIQUE INDEX idx_exhibits_author_number
            ON exhibits(case_id, COALESCE(author_installation_id, ''), exhibit_number);
        `)

        // Working-layer rows (notes, annotations, tags and both tag relations)
        // are per author and synced append-only with tombstones (decision 9).
        // `version` is monotonic per author and starts at 0 for every row this
        // installation wrote before it could sign one; `row_signature` stays NULL
        // until the sync step signs local rows on write.
        for (const table of ['notes', 'annotations', 'tags', 'exhibit_tags', 'note_tags']) {
          db.exec(`
            ALTER TABLE ${table} ADD COLUMN author_installation_id TEXT;
            ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE ${table} ADD COLUMN deleted_at TEXT;
            ALTER TABLE ${table} ADD COLUMN row_signature TEXT;
          `)
        }

        // `shared_at` is when the Case became shared and `owner_installation_id`
        // whose chain carries the roster. Both NULL for a Case nobody shared.
        db.exec(`
          ALTER TABLE cases ADD COLUMN shared_at TEXT;
          ALTER TABLE cases ADD COLUMN owner_installation_id TEXT;
        `)

        const violations = db.pragma('foreign_key_check') as unknown[]
        if (violations.length > 0) {
          throw new Error(`Migration 36 left ${violations.length} foreign key violation(s)`)
        }
        db.pragma('user_version = 36')
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  if (version < 37) {
    db.transaction(() => {
      // Imported Captures kept the source Case's artifact paths (#1592): the
      // import wrote each file under the new case and id but copied the path
      // columns verbatim. Every path this app writes is
      // `<caseId>/<captureId>.<ext>`, so a first segment other than the row's
      // own case id marks one of those rows, and the rewrite points it where
      // the import put the file. The stored verification result on those rows
      // is cleared: it was computed against the wrong path, either missing or
      // another Case's bytes, and says nothing about this Capture's file.
      const reroot = (path: string | null, caseId: string, id: string): string | null => {
        if (!path) return path
        const segments = path.split(/[\\/]/)
        if (segments[0] === caseId) return path
        const name = segments[segments.length - 1]
        const dot = name.lastIndexOf('.')
        return `${caseId}/${id}${dot === -1 ? '' : name.slice(dot)}`
      }
      const captures = db
        .prepare('SELECT id, case_id, html_path, screenshot_path, mhtml_path FROM captures')
        .all() as Array<{
        id: string
        case_id: string
        html_path: string | null
        screenshot_path: string | null
        mhtml_path: string | null
      }>
      const updateCapture = db.prepare(
        `UPDATE captures
            SET html_path = ?, screenshot_path = ?, mhtml_path = ?,
                last_verified_at = NULL, last_verified_hash = NULL, last_verified_status = NULL
          WHERE id = ?`
      )
      for (const row of captures) {
        const html = reroot(row.html_path, row.case_id, row.id)
        const screenshot = reroot(row.screenshot_path, row.case_id, row.id)
        const mhtml = reroot(row.mhtml_path, row.case_id, row.id)
        if (
          html !== row.html_path ||
          screenshot !== row.screenshot_path ||
          mhtml !== row.mhtml_path
        ) {
          updateCapture.run(html, screenshot, mhtml, row.id)
        }
      }

      // A pre-schema-6 archive, the demo case among them (#1521), has its
      // Capture Exhibits backfilled from those rows, so they carry the same
      // stale path. A Capture's Exhibit id is its capture id.
      const exhibits = db
        .prepare(
          `SELECT e.id, e.case_id, e.path, COALESCE(c.mhtml_path, c.html_path) AS capture_path
             FROM exhibits e JOIN captures c ON c.id = e.id
            WHERE e.kind = 'capture' AND e.path IS NOT NULL`
        )
        .all() as Array<{ id: string; case_id: string; path: string; capture_path: string | null }>
      const updateExhibit = db.prepare('UPDATE exhibits SET path = ? WHERE id = ?')
      for (const row of exhibits) {
        if (row.path.split(/[\\/]/)[0] === row.case_id || !row.capture_path) continue
        updateExhibit.run(row.capture_path, row.id)
      }
      db.pragma('user_version = 37')
    })()
  }
}
