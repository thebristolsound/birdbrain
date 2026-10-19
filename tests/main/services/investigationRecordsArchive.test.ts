import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, getDb, ID_PROBE_TABLES, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { createNote } from '@main/services/db/noteRepo'
import { ALLOWED_TABLES } from '@main/services/db/dbAdmin'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import {
  CASE_ARCHIVE_SCHEMA_VERSION,
  collectCaseData,
  exportCaseArchive,
  importCaseArchive
} from '@main/services/caseArchive'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import { canonicalStringify } from '@shared/verify'
import { IMPORT_ID_MAP_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import * as subjects from '@main/services/db/investigationSubjectRepo'
import * as decisions from '@main/services/db/investigationDecisionRepo'
import * as marks from '@main/services/db/exhibitMarkRepo'
import * as runs from '@main/services/db/investigationRunRepo'

// The investigation records in repositories and Case Archives (#1909; engine
// plan E5). Frozen here:
//
//   1. REPOSITORIES. Each table's insert and list store and return a row as
//      written, and the withheld read follows the eligibility view.
//   2. ROUND TRIP. Every record crosses an archive into a fresh database with
//      its references intact, `persona_id` left behind, and an author-less row
//      stamped with the source installation (ruling 62).
//   3. COLLISIONS. A second import remaps every id, `replaces` included.
//   4. WHAT STAYS. The change log and the Case revision never travel; an
//      imported run keeps a generation its new Case does not have.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

type Row = Record<string, unknown>

const NOW = '2026-10-17T00:00:00.000Z'
const OP = { operatorId: 'op-1', operatorName: 'Operator' }
const REMOTE = 'installation-remote-0001'
// An Exhibit the records name that the archive does not hold; its id crosses
// unchanged.
const ELSEWHERE = 'exhibit-not-in-this-case'

const RECORD_TABLES = [
  'subjects',
  'joints',
  'joint_spans',
  'subject_spans',
  'joint_decisions',
  'span_decisions',
  'source_class_marks',
  'copy_marks',
  'withheld_flags',
  'own_identifiers',
  'investigation_runs',
  'investigation_run_basis',
  'investigation_run_candidates',
  'investigation_run_proposals'
]
const RUN_CHILDREN = RECORD_TABLES.slice(11)
const SYNCED = RECORD_TABLES.slice(0, 10)

function rowsOf(table: string, caseId: string): Row[] {
  const where = RUN_CHILDREN.includes(table)
    ? 'run_id IN (SELECT id FROM investigation_runs WHERE case_id = ?)'
    : 'case_id = ?'
  return getDb()
    .prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`)
    .all(caseId) as Row[]
}

function generationOf(caseId: string): string {
  return (
    getDb().prepare('SELECT generation FROM case_revisions WHERE case_id = ?').get(caseId) as {
      generation: string
    }
  ).generation
}

// Rewrites data.json and repairs the header's digests, so verification still
// passes (as caseArchive.test.ts does).
function rewriteDataJson(archivePath: string, mutate: (data: Row) => Row): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const data = JSON.parse(entries.get('data.json')!.toString('utf-8')) as Row
  const mutated = Buffer.from(JSON.stringify(mutate(data), null, 2))
  entries.set('data.json', mutated)
  const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
  const hash = createHash('sha256').update(mutated).digest('hex')
  header.artifacts = header.artifacts.map((a: { path: string }) =>
    a.path === 'data.json' ? { path: 'data.json', sha256: hash, sizeBytes: mutated.length } : a
  )
  const sorted = [...header.artifacts].sort((a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  header.packageHash = createHash('sha256')
    .update(Buffer.from(canonicalStringify(sorted), 'utf-8'))
    .digest('hex')
  entries.set('package.json', Buffer.from(JSON.stringify(header, null, 2)))
  writeFileSync(
    archivePath,
    createStoredZip([...entries.entries()].map(([name, bytes]) => ({ name, data: bytes })))
  )
}

function dataJson(archivePath: string): Row {
  return JSON.parse(readStoredZip(readFileSync(archivePath)).get('data.json')!.toString('utf-8'))
}

function packageJson(archivePath: string): Row {
  return JSON.parse(readStoredZip(readFileSync(archivePath)).get('package.json')!.toString('utf-8'))
}

describe('investigation record repositories', () => {
  let caseId: string

  beforeEach(async () => {
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Records' }).id
  })

  afterEach(() => closeDatabase())

  it('stores and lists each table as written, `replaces` and the authors included', () => {
    const author = { authorInstallationId: REMOTE }
    const subject = subjects.insertSubject({
      caseId,
      name: 'Rowan Pike',
      kind: 'person',
      createdAt: NOW,
      ...OP,
      ...author
    })
    const joint = subjects.insertJoint({
      caseId,
      claim: 'used the address',
      claimHash: 'claim',
      subjectAId: subject.id,
      producerKind: 'rule',
      producer: 'shared-identifier',
      producerVersion: '1',
      identityHash: 'identity',
      createdAt: NOW
    })
    const span = {
      caseId,
      exhibitId: 'exhibit-1',
      contentHash: 'a'.repeat(64),
      representation: 'text',
      field: 'text.passage',
      locator: '{}',
      value: 'the passage',
      spanKey: 'key',
      createdAt: NOW
    }
    const jointSpan = subjects.insertJointSpan({ ...span, jointId: joint.id, reading: 'supports' })
    const subjectSpan = subjects.insertSubjectSpan({ ...span, subjectId: subject.id })
    const first = decisions.insertJointDecision({
      caseId,
      jointId: joint.id,
      decision: 'accept',
      decidedAt: NOW,
      ...OP
    })
    const second = decisions.insertJointDecision({
      caseId,
      jointId: joint.id,
      decision: 'reject',
      decidedAt: NOW,
      replaces: [first.id],
      ...OP
    })
    const spanDecision = decisions.insertSpanDecision({
      caseId,
      jointSpanId: jointSpan.id,
      action: 'dismiss',
      decidedAt: NOW,
      ...OP
    })
    const mark = { caseId, actedAt: NOW, ...OP }
    const sourceClass = marks.insertSourceClassMark({
      ...mark,
      exhibitId: 'exhibit-1',
      value: 'original'
    })
    const copy = marks.insertCopyMark({
      ...mark,
      copyExhibitId: 'exhibit-1',
      originalExhibitId: 'exhibit-2',
      marked: 1
    })
    const flag = marks.insertWithheldFlag({
      ...mark,
      exhibitId: 'exhibit-1',
      action: 'set',
      holderInstallationId: REMOTE,
      ...author
    })
    const own = marks.insertOwnIdentifier({
      ...mark,
      kind: 'mail',
      value: 'calloway@harrow.example.net',
      marked: 1,
      personaId: 'persona-1'
    })
    const run = runs.insertInvestigationRun({
      caseId,
      startedFrom: 'inquiry',
      status: 'stored',
      startGeneration: 'g',
      startCounter: 0,
      layers: '["base"]',
      versions: '{}',
      params: '{}',
      startedAt: NOW,
      ...OP
    })
    const basis = runs.insertInvestigationRunBasis({
      runId: run.id,
      kind: 'starting-subject',
      refId: subject.id
    })
    const candidate = runs.insertInvestigationRunCandidate({
      runId: run.id,
      ord: 0,
      rule: 'shared-identifier',
      exhibitId: 'exhibit-1',
      contentHash: 'a'.repeat(64),
      field: 'header.from',
      locator: '{}'
    })
    const proposal = runs.insertInvestigationRunProposal({
      runId: run.id,
      jointId: joint.id,
      proposalHash: 'p',
      created: 1
    })

    expect(subject).toMatchObject({
      caseId,
      name: 'Rowan Pike',
      authorInstallationId: REMOTE,
      version: 0
    })
    expect(second.replaces).toEqual([first.id])
    expect(first.replaces).toEqual([])
    expect(flag).toMatchObject({ holderInstallationId: REMOTE, authorInstallationId: REMOTE })
    expect(own.personaId).toBe('persona-1')
    const lists: Array<[unknown[], unknown[]]> = [
      [subjects.listSubjects(caseId), [subject]],
      [subjects.listJoints(caseId), [joint]],
      [subjects.listJointSpans(caseId), [jointSpan]],
      [subjects.listSubjectSpans(caseId), [subjectSpan]],
      [decisions.listJointDecisions(caseId), [first, second]],
      [decisions.listSpanDecisions(caseId), [spanDecision]],
      [marks.listSourceClassMarks(caseId), [sourceClass]],
      [marks.listCopyMarks(caseId), [copy]],
      [marks.listWithheldFlags(caseId), [flag]],
      [marks.listOwnIdentifiers(caseId), [own]],
      [runs.listInvestigationRuns(caseId), [run]],
      [runs.listInvestigationRunBasis(run.id), [basis]],
      [runs.listInvestigationRunCandidates(run.id), [candidate]],
      [runs.listInvestigationRunProposals(run.id), [proposal]]
    ]
    for (const [listed, written] of lists) expect(listed).toEqual(written)
  })

  it('refuses a column the table does not have', () => {
    expect(() =>
      marks.insertWithheldFlag({
        caseId,
        exhibitId: 'exhibit-1',
        action: 'set',
        actedAt: NOW,
        ...OP,
        ...({ notAColumn: 1 } as object)
      })
    ).toThrow(/no column not_a_column/)
  })

  it('refuses a `replaces` that is not a list of ids', () => {
    expect(() =>
      marks.insertWithheldFlag({
        caseId,
        exhibitId: 'exhibit-1',
        action: 'set',
        actedAt: NOW,
        ...OP,
        replaces: [1] as unknown as string[]
      })
    ).toThrow(/withheld_flags.replaces is not a list of ids/)
  })

  it('reads an Exhibit as withheld while a live withheld head is set, whoever holds it', () => {
    for (const [n, id] of ['unflagged', 'cleared', 'withheld', 'held-elsewhere'].entries()) {
      getDb()
        .prepare(
          `INSERT INTO exhibits (id, case_id, kind, origin, exhibit_number, name, content_hash, committed_at)
           VALUES (?, ?, 'document', 'upload', ?, ?, ?, ?)`
        )
        .run(id, caseId, n + 1, id, 'a'.repeat(64), NOW)
    }
    const mark = { caseId, actedAt: NOW, ...OP }
    const set = marks.insertWithheldFlag({ ...mark, exhibitId: 'cleared', action: 'set' })
    marks.insertWithheldFlag({ ...mark, exhibitId: 'cleared', action: 'clear', replaces: [set.id] })
    marks.insertWithheldFlag({ ...mark, exhibitId: 'withheld', action: 'set' })
    marks.insertWithheldFlag({
      ...mark,
      exhibitId: 'held-elsewhere',
      action: 'set',
      authorInstallationId: REMOTE
    })

    expect(marks.withheldExhibitIds(caseId)).toEqual(['held-elsewhere', 'withheld'])
  })
})

describe('investigation records in a Case Archive', () => {
  let tempDir: string
  let sourceCaseId: string
  let sourceInstallation: string
  let archive: string
  let source: Record<string, Row[]>

  async function open(name: string): Promise<void> {
    initStorage(join(tempDir, name, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
  }

  // One Capture, a Note, and a row in every record table, every reference
  // between them filled.
  async function populate(caseId: string): Promise<void> {
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'source', 'captures', caseId))
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    const { capture } = await lifecycle.ingest({
      caseId,
      url: 'https://harrow.example.net/',
      title: 'Harrow',
      timestamp: NOW,
      stream: Readable.from([Buffer.from('capture body')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'capture body',
      headers: {},
      browserVersion: 'Chrome/120',
      userAgent: 'Mozilla/5.0',
      httpStatus: 200,
      ...OP,
      toolVersion: '0.1.0'
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const exhibitId = capture.id
    const note = createNote({ caseId, title: 'N', body: 'text' })
    const runFields = {
      caseId,
      startedFrom: 'inquiry',
      status: 'stored',
      startGeneration: generationOf(caseId),
      startCounter: 0,
      storedGeneration: generationOf(caseId),
      layers: '["base"]',
      versions: '{}',
      params: '{}',
      startedAt: NOW,
      ...OP
    }
    const run = runs.insertInvestigationRun(runFields)
    const pike = subjects.insertSubject({
      caseId,
      name: 'Rowan Pike',
      kind: 'person',
      createdByRunId: run.id,
      createdAt: NOW,
      ...OP
    })
    const document = subjects.insertSubject({
      caseId,
      name: 'Harrow page',
      kind: 'document',
      boundExhibitId: exhibitId,
      createdAt: NOW,
      ...OP
    })
    const span = {
      caseId,
      exhibitId,
      contentHash: 'a'.repeat(64),
      representation: 'text',
      field: 'text.name',
      locator: '{}',
      value: 'Rowan Pike',
      createdAt: NOW
    }
    const sameName = subjects.insertSubjectSpan({
      ...span,
      subjectId: pike.id,
      spanKey: 'same-name',
      createdByRunId: run.id
    })
    const choice = decisions.insertSpanDecision({
      caseId,
      subjectSpanId: sameName.id,
      action: 'choose',
      chosenSubjectId: pike.id,
      decidedAt: NOW,
      ...OP
    })
    const joint = subjects.insertJoint({
      caseId,
      claim: 'wrote the page',
      claimHash: 'claim',
      subjectAId: pike.id,
      subjectBId: document.id,
      producerKind: 'rule',
      producer: 'shared-identifier',
      producerVersion: '1',
      identityHash: 'identity',
      fromNoteId: note.id,
      fromSpanDecisionId: choice.id,
      createdByRunId: run.id,
      createdAt: NOW
    })
    const jointSpan = subjects.insertJointSpan({
      ...span,
      jointId: joint.id,
      spanKey: 'cited',
      reading: 'supports',
      createdByRunId: run.id
    })
    const accept = decisions.insertJointDecision({
      caseId,
      jointId: joint.id,
      decision: 'accept',
      basisRunId: run.id,
      decidedAt: NOW,
      ...OP
    })
    decisions.insertJointDecision({
      caseId,
      jointId: joint.id,
      decision: 'reject',
      replaces: [accept.id],
      decidedAt: NOW,
      ...OP
    })
    const dismiss = decisions.insertSpanDecision({
      caseId,
      jointSpanId: jointSpan.id,
      action: 'dismiss',
      decidedAt: NOW,
      ...OP
    })
    decisions.insertSpanDecision({
      caseId,
      jointSpanId: jointSpan.id,
      action: 'undo',
      replaces: [dismiss.id],
      decidedAt: NOW,
      ...OP
    })
    const mark = { caseId, actedAt: NOW, ...OP }
    const original = marks.insertSourceClassMark({ ...mark, exhibitId, value: 'original' })
    marks.insertSourceClassMark({
      ...mark,
      exhibitId,
      value: 'later-copy',
      replaces: [original.id]
    })
    const copy = marks.insertCopyMark({
      ...mark,
      copyExhibitId: exhibitId,
      originalExhibitId: ELSEWHERE,
      marked: 1
    })
    marks.insertCopyMark({
      ...mark,
      copyExhibitId: exhibitId,
      originalExhibitId: ELSEWHERE,
      marked: 0,
      replaces: [copy.id]
    })
    const set = marks.insertWithheldFlag({ ...mark, exhibitId, action: 'set' })
    marks.insertWithheldFlag({ ...mark, exhibitId, action: 'clear', replaces: [set.id] })
    marks.insertWithheldFlag({
      ...mark,
      exhibitId,
      action: 'set',
      holderInstallationId: REMOTE,
      authorInstallationId: REMOTE
    })
    const own = marks.insertOwnIdentifier({
      ...mark,
      kind: 'mail',
      value: 'calloway@harrow.example.net',
      personaId: 'persona-1',
      marked: 1
    })
    marks.insertOwnIdentifier({
      ...mark,
      kind: 'mail',
      value: 'calloway@harrow.example.net',
      marked: 0,
      replaces: [own.id]
    })
    runs.insertInvestigationRun({ ...runFields, jointId: joint.id, startedFrom: 'find-more' })
    runs.insertInvestigationRunBasis({ runId: run.id, kind: 'note', refId: note.id })
    runs.insertInvestigationRunBasis({ runId: run.id, kind: 'starting-subject', refId: pike.id })
    runs.insertInvestigationRunCandidate({
      runId: run.id,
      ord: 0,
      rule: 'shared-identifier',
      exhibitId,
      contentHash: 'a'.repeat(64),
      field: 'text.name',
      locator: '{}',
      jointSpanId: jointSpan.id
    })
    runs.insertInvestigationRunProposal({
      runId: run.id,
      jointId: joint.id,
      proposalHash: 'p',
      created: 1
    })
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-records-archive-'))
    resetInstallationId()
    initInstallationId(tempDir)
    sourceInstallation = getInstallationId()
    await open('source')
    sourceCaseId = createCase({ name: 'Records' }).id
    await populate(sourceCaseId)
    source = Object.fromEntries(RECORD_TABLES.map((t) => [t, rowsOf(t, sourceCaseId)]))
    archive = join(tempDir, 'records.birdbrain')
    await exportCaseArchive(sourceCaseId, archive)
    closeDatabase()
    // The importer is another installation, so a stamped author is visibly not its own.
    resetInstallationId()
    const importerId = join(tempDir, 'importer-id')
    mkdirSync(importerId)
    initInstallationId(importerId)
    await open('importer')
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('declares the new archive version and carries every record table, without the revision', () => {
    expect(packageJson(archive).schemaVersion).toBe(CASE_ARCHIVE_SCHEMA_VERSION)
    const data = dataJson(archive)
    for (const table of RECORD_TABLES) {
      const key = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      expect((data[key] as Row[]).length, table).toBe(source[table].length)
      expect(source[table].length, table).toBeGreaterThan(0)
    }
    expect(Object.keys(data)).not.toContain('caseRevisions')
    expect(Object.keys(data)).not.toContain('caseChangeLog')
    expect((data.ownIdentifiers as Row[]).map((row) => row.persona_id)).toEqual([null, null])
    expect(ID_PROBE_TABLES).not.toContain('case_revisions')
    expect(ID_PROBE_TABLES).not.toContain('case_change_log')
    expect(ALLOWED_TABLES).not.toContain('subjects')
  })

  it('round-trips every record into a fresh database, stamping author-less rows', async () => {
    const { newCaseId } = await importCaseArchive(archive)

    expect(getInstallationId()).not.toBe(sourceInstallation)
    for (const table of RECORD_TABLES) {
      const expected = source[table].map((row) => {
        const out: Row = { ...row }
        if ('case_id' in out) out.case_id = newCaseId
        if ('persona_id' in out) out.persona_id = null
        if (SYNCED.includes(table)) out.author_installation_id ??= sourceInstallation
        return out
      })
      expect(rowsOf(table, newCaseId), table).toEqual(expected)
    }
    // A row that had an author keeps it.
    expect(rowsOf('withheld_flags', newCaseId).map((r) => r.author_installation_id)).toEqual([
      sourceInstallation,
      sourceInstallation,
      REMOTE
    ])
  })

  it('remaps every id on a second import, `replaces` included', async () => {
    const first = (await importCaseArchive(archive)).newCaseId
    const second = (await importCaseArchive(archive)).newCaseId
    const firstIds = new Set(RECORD_TABLES.flatMap((t) => rowsOf(t, first).map((r) => r.id)))

    // Every reference names a row of the second import, or the Exhibit the
    // archive never held.
    const idsIn = (table: string): Set<unknown> =>
      new Set(
        (
          getDb().prepare(`SELECT id FROM ${table} WHERE case_id = ?`).all(second) as Array<{
            id: unknown
          }>
        ).map((r) => r.id)
      )
    const targets: Record<string, string> = {
      exhibit_id: 'exhibits',
      bound_exhibit_id: 'exhibits',
      copy_exhibit_id: 'exhibits',
      subject_id: 'subjects',
      subject_a_id: 'subjects',
      subject_b_id: 'subjects',
      chosen_subject_id: 'subjects',
      joint_id: 'joints',
      joint_span_id: 'joint_spans',
      subject_span_id: 'subject_spans',
      from_note_id: 'notes',
      from_span_decision_id: 'span_decisions',
      basis_run_id: 'investigation_runs',
      created_by_run_id: 'investigation_runs',
      run_id: 'investigation_runs'
    }
    let checked = 0
    for (const table of RECORD_TABLES) {
      for (const row of rowsOf(table, second)) {
        if ('id' in row) expect(firstIds.has(row.id), `${table}.id`).toBe(false)
        for (const [column, target] of Object.entries(targets)) {
          if (row[column] === undefined || row[column] === null) continue
          expect(idsIn(target).has(row[column]), `${table}.${column}`).toBe(true)
          checked++
        }
        if (typeof row.replaces === 'string') {
          for (const id of JSON.parse(row.replaces) as string[]) {
            expect(idsIn(table).has(id), `${table}.replaces`).toBe(true)
            checked++
          }
        }
      }
      expect(rowsOf(table, second).length, table).toBe(source[table].length)
    }
    const basis = rowsOf('investigation_run_basis', second)
    expect(basis.map((r) => idsIn(r.kind === 'note' ? 'notes' : 'subjects').has(r.ref_id))).toEqual(
      [true, true]
    )
    expect(rowsOf('copy_marks', second).map((r) => r.original_exhibit_id)).toEqual([
      ELSEWHERE,
      ELSEWHERE
    ])
    expect(checked).toBeGreaterThan(30)
  })

  it('writes the remapped record ids into the id map the import entry signs', async () => {
    await importCaseArchive(archive)
    const { newCaseId } = await importCaseArchive(archive)
    const payload = readFileSync(
      join(tempDir, 'importer', 'captures', newCaseId, IMPORT_ID_MAP_FILENAME),
      'utf-8'
    )
    const { remapped } = JSON.parse(payload) as { remapped: Record<string, string> }
    for (const table of ['subjects', 'joint_decisions', 'withheld_flags', 'investigation_runs']) {
      for (const row of source[table]) {
        expect(remapped[row.id as string], table).toBe(
          rowsOf(table, newCaseId)[source[table].indexOf(row)].id
        )
      }
    }
    const lines = readFileSync(
      join(tempDir, 'importer', 'captures', newCaseId, 'manifest.jsonl'),
      'utf-8'
    )
      .trim()
      .split('\n')
    const entry = JSON.parse(lines.at(-1)!) as { type: string; idMapSha256: string }
    expect(entry.type).toBe('import')
    expect(entry.idMapSha256).toBe(
      createHash('sha256')
        .update(Buffer.from(canonicalStringify(JSON.parse(payload)), 'utf-8'))
        .digest('hex')
    )
  })

  it('imports a persona_id an edited archive carries as null', async () => {
    rewriteDataJson(archive, (data) => ({
      ...data,
      ownIdentifiers: (data.ownIdentifiers as Row[]).map((row) => ({
        ...row,
        persona_id: 'persona-from-elsewhere'
      }))
    }))
    const { newCaseId } = await importCaseArchive(archive)
    expect(rowsOf('own_identifiers', newCaseId).map((r) => r.persona_id)).toEqual([null, null])
  })

  it('starts the new Case a log of its own rows, and leaves its runs a stale generation', async () => {
    const { newCaseId } = await importCaseArchive(archive)

    const inputs = [
      'notes',
      'extracted_data',
      'selectors',
      'exhibits',
      'exhibit_search_builds',
      ...SYNCED
    ]
    const inserted = inputs.reduce(
      (sum, table) =>
        sum +
        (
          getDb()
            .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE case_id = ?`)
            .get(newCaseId) as {
            n: number
          }
        ).n,
      0
    )
    const counters = (
      getDb()
        .prepare('SELECT counter FROM case_change_log WHERE case_id = ? ORDER BY counter')
        .all(newCaseId) as Array<{ counter: number }>
    ).map((r) => r.counter)
    expect(counters).toEqual(Array.from({ length: inserted }, (_, n) => n + 1))
    expect(
      (
        getDb().prepare('SELECT counter FROM case_revisions WHERE case_id = ?').get(newCaseId) as {
          counter: number
        }
      ).counter
    ).toBe(inserted)

    const [stored] = rowsOf('investigation_runs', newCaseId)
    expect(stored.stored_generation).toBe(source.investigation_runs[0].stored_generation)
    expect(stored.stored_generation).not.toBe(generationOf(newCaseId))
  })

  it('imports a version-9 archive, which has no records, with the record tables empty', async () => {
    rewriteDataJson(archive, (data) =>
      Object.fromEntries(
        Object.entries(data).filter(
          ([key]) =>
            !RECORD_TABLES.map((t) =>
              t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
            ).includes(key)
        )
      )
    )
    const entries = readStoredZip(readFileSync(archive))
    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    entries.set(
      'package.json',
      Buffer.from(JSON.stringify({ ...header, schemaVersion: 9 }, null, 2))
    )
    writeFileSync(
      archive,
      createStoredZip([...entries.entries()].map(([name, bytes]) => ({ name, data: bytes })))
    )

    const { newCaseId, report } = await importCaseArchive(archive)

    expect(report.schemaVersion).toBe(9)
    expect(report.verification.overallValid).toBe(true)
    for (const table of RECORD_TABLES) expect(rowsOf(table, newCaseId), table).toEqual([])
    expect(collectCaseData(newCaseId).notes).toHaveLength(1)
  })
})
