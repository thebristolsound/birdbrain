-- The investigation record DDL of docs/plans/2026-10-10-case-investigation-engine.md, E1,
-- copied as written. investigationRecordsMigration.test.ts builds it in a scratch database
-- and checks that migration 40 created the same tables, columns, keys and indexes.
-- Subjects and Joints
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- person, pseudonym, account, document, ...; Operator-extensible
  bound_exhibit_id TEXT,           -- a document Subject's one Exhibit (no foreign key)
  bound_identifier TEXT,           -- an identifier Subject: kind, platform and comparison key
  created_by_run_id TEXT,          -- NULL when the Operator added it
  kept_at TEXT,                    -- set when the Operator keeps it by hand
  created_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_subjects_case ON subjects(case_id, kind);
CREATE UNIQUE INDEX idx_subjects_document ON subjects(
  case_id, bound_exhibit_id, COALESCE(author_installation_id, '')
) WHERE bound_exhibit_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE joints (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  claim_hash TEXT NOT NULL,
  subject_a_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,  -- NULL: about one Subject
  producer_kind TEXT NOT NULL,     -- 'rule' | 'operator'; 'provider' arrives with the AI layer
  producer TEXT NOT NULL,          -- the rule's name, or 'operator'
  producer_version TEXT NOT NULL,  -- the rule's version; '' for the Operator
  identity_hash TEXT NOT NULL,     -- claim hash, Subject bindings, producer at its version
  from_note_id TEXT,               -- started from a Note passage (no foreign key)
  from_note_passage TEXT,          -- JSON: offsets into the Note body as the run read it
  from_span_decision_id TEXT,      -- started by a same-name choice
  created_by_run_id TEXT,          -- NULL when a same-name choice started it
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE UNIQUE INDEX idx_joints_identity ON joints(
  case_id, identity_hash, COALESCE(author_installation_id, '')
) WHERE deleted_at IS NULL;
CREATE INDEX idx_joints_subjects ON joints(subject_a_id, subject_b_id);

-- Spans: a pointer into a stored Exhibit, on a Joint or waiting on a same-name choice
CREATE TABLE joint_spans (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL REFERENCES joints(id) ON DELETE CASCADE,
  side TEXT,                       -- 'a' | 'b'; NULL on a Joint about one Subject
  exhibit_id TEXT NOT NULL,        -- no foreign key (see the shape rules)
  content_hash TEXT NOT NULL,      -- the Exhibit's Content Hash when the span was cited
  representation TEXT NOT NULL,    -- 'html-part' | 'text' | 'capture-url'
  field TEXT NOT NULL,             -- 'header.from', 'link.href', 'text.passage', ...
  locator TEXT NOT NULL,           -- JSON: part, decoder, extractor version, start and end
  value TEXT NOT NULL,             -- the span as stored, for lists; the inspector re-reads it
  span_key TEXT NOT NULL,          -- hash of exhibit_id, content_hash, representation, locator
  reading TEXT NOT NULL,           -- the base layer writes 'supports' or 'unclear'
  created_by_run_id TEXT,          -- NULL only for the span a same-name choice cites
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_joint_spans_joint ON joint_spans(joint_id, span_key);
CREATE INDEX idx_joint_spans_exhibit ON joint_spans(case_id, exhibit_id);

CREATE TABLE subject_spans (       -- one row per candidate Subject; one choice resolves all
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  representation TEXT NOT NULL,
  field TEXT NOT NULL,
  locator TEXT NOT NULL,
  value TEXT NOT NULL,
  span_key TEXT NOT NULL,
  created_by_run_id TEXT,
  created_at TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_subject_spans_key ON subject_spans(case_id, span_key);

-- Decisions: insert-only; a reversal is a new row listing the author's head it replaces (E2)
CREATE TABLE joint_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL REFERENCES joints(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,          -- 'accept' | 'reject' | 'restore' (back to proposed)
  reason TEXT,
  assumptions TEXT,                -- acceptance context; NULL shows and exports as "not recorded"
  confidence TEXT,                 -- the Operator's own words, never a score
  alternatives TEXT,
  basis_run_id TEXT,               -- the run whose proposal the decision was made on
  basis_as_of TEXT,                -- that run's start time, for the "Case as of" label
  basis_proposal_hash TEXT,        -- that run's proposal hash, for export lineage
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: the author's earlier head on this Joint
  decided_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_joint_decisions_joint ON joint_decisions(joint_id);

CREATE TABLE span_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  joint_span_id TEXT REFERENCES joint_spans(id) ON DELETE CASCADE,
  subject_span_id TEXT REFERENCES subject_spans(id) ON DELETE CASCADE,
  action TEXT NOT NULL,            -- Joint span: 'add-support' | 'add-conflict' | 'dismiss' | 'undo'
                                   -- same-name span: 'choose' | 'none' | 'undo'
  chosen_subject_id TEXT,          -- with 'choose'
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: the author's earlier head on this span
  decided_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT,
  CHECK ((joint_span_id IS NULL) <> (subject_span_id IS NULL))
);
CREATE INDEX idx_span_decisions_joint_span ON span_decisions(joint_span_id);
CREATE INDEX idx_span_decisions_subject_span ON span_decisions(subject_span_id);

-- Exhibit-level marks: insert-only, each listing the rows it replaces (E2)
CREATE TABLE source_class_marks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  value TEXT NOT NULL,             -- original | contemporaneous | later-copy | commercial
                                   -- | ai-origin | unclassified; no row reads as unclassified
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',  -- JSON: ids of the rows this one supersedes
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_source_class_marks_exhibit ON source_class_marks(case_id, exhibit_id);

CREATE TABLE copy_marks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  copy_exhibit_id TEXT NOT NULL,
  original_exhibit_id TEXT NOT NULL,
  marked INTEGER NOT NULL,         -- 1: the pair counts as one source; 0: the mark undone
  reason TEXT,
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_copy_marks_pair ON copy_marks(case_id, copy_exhibit_id, original_exhibit_id);

CREATE TABLE withheld_flags (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exhibit_id TEXT NOT NULL,
  holder_installation_id TEXT,     -- whose flag; NULL: the row's author (E2)
  action TEXT NOT NULL,            -- 'set' | 'clear'
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_withheld_flags_exhibit ON withheld_flags(case_id, exhibit_id);

CREATE TABLE own_identifiers (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  holder_installation_id TEXT,     -- whose entry; NULL: the row's author (E2)
  kind TEXT NOT NULL,              -- mail | handle | domain | link | message-id | tracking | ...
  platform TEXT,                   -- for a kind compared by platform
  value TEXT NOT NULL,             -- as stored; each installation normalizes it with its own rules
  persona_id TEXT,                 -- local only: never synced, never in a Case Archive
  marked INTEGER NOT NULL,         -- 1: marked; 0: the mark removed
  replaces TEXT NOT NULL DEFAULT '[]',
  acted_at TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  author_installation_id TEXT, version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT, row_signature TEXT
);
CREATE INDEX idx_own_identifiers_case ON own_identifiers(case_id, kind);

-- Run records: local to this installation, never synced
CREATE TABLE investigation_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  started_from TEXT NOT NULL,      -- 'inquiry' | 'note-claim' | 'find-more'
  inquiry TEXT,
  joint_id TEXT,                   -- the Joint, for Find more material
  status TEXT NOT NULL,            -- 'running' | 'stored' | 'canceled' | 'invalidated' | 'failed'
  status_reason TEXT,
  start_generation TEXT NOT NULL,
  start_counter INTEGER NOT NULL,
  start_head_index INTEGER,        -- NULL with an empty Manifest
  start_head_hash TEXT,
  stored_generation TEXT,          -- the revision the run's one write produced
  stored_counter INTEGER,
  stored_head_index INTEGER,
  stored_head_hash TEXT,
  layers TEXT NOT NULL,            -- JSON: ["base"] in the first slice
  versions TEXT NOT NULL,          -- JSON: rule, normalizer, extractor and parameter versions
  params TEXT NOT NULL,            -- JSON: follow depth and the thresholds in force
  counts TEXT,                     -- JSON: read, withheld, not read by reason, candidates, proposals
  started_at TEXT NOT NULL,
  ended_at TEXT,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL
);
CREATE INDEX idx_investigation_runs_case ON investigation_runs(case_id, started_at);

CREATE TABLE investigation_run_basis (   -- what travelled with the run
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- starting-subject | withheld | note | selector | own-identifier
  ref_id TEXT NOT NULL,
  snapshot TEXT,                   -- the Note passage as the run read it; NULL for other kinds
  snapshot_hash TEXT,
  PRIMARY KEY (run_id, kind, ref_id)
);

CREATE TABLE investigation_run_candidates (  -- candidate locators and their check outcomes
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  rule TEXT NOT NULL,
  group_key TEXT,                  -- a passage group's passage hash
  exhibit_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  field TEXT NOT NULL,
  locator TEXT NOT NULL,
  joint_span_id TEXT,              -- set when the run cited this candidate
  text_check TEXT,                 -- 'present' | 'absent' | 'cannot-check', from CI-11 on
  text_basis TEXT,                 -- 'hash-verified' | 'unattested'
  check_reason TEXT,
  PRIMARY KEY (run_id, ord)
);

CREATE TABLE investigation_run_proposals (
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  joint_id TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,     -- claim, Subjects, producer, and the spans this run cited
  created INTEGER NOT NULL,        -- 1: this run's write created the Joint; 0: a further sighting
  PRIMARY KEY (run_id, joint_id)
);

-- The Case revision (E3)
CREATE TABLE case_revisions (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE case_change_log (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT,                  -- ids and kinds only, never text
  PRIMARY KEY (case_id, counter)
);

-- Eligibility for analysis (E8)
CREATE VIEW analysis_eligible_exhibits AS
  SELECT e.* FROM exhibits e
   WHERE NOT EXISTS (
     SELECT 1 FROM withheld_flags w
      WHERE w.case_id = e.case_id AND w.exhibit_id = e.id
        AND w.action = 'set' AND w.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM withheld_flags s, json_each(s.replaces) r
           WHERE s.case_id = w.case_id AND s.deleted_at IS NULL AND r.value = w.id));
