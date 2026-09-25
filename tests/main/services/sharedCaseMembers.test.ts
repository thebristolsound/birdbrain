import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { addTagToCapture, createTag, getTagsForCapture, listTags } from '@main/services/db/tagRepo'
import { insertDerivedFile, listDerivedFilesForExhibit } from '@main/services/db/derivedFileRepo'
import {
  getExhibit,
  importExhibitRows,
  insertExhibit,
  listExhibits,
  nextExhibitNumber
} from '@main/services/db/exhibitRepo'
import {
  exhibitCitationResolver,
  listCaseMembers,
  memberCodeProblem,
  upsertCaseMember
} from '@main/services/db/caseMemberRepo'
import { getCaseInventory } from '@main/services/exhibits'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import type { CaseMember, ExportOptions } from '@shared/types'

// Shared Cases, step 2 (#1510): the roster cache, the widened Exhibit Number
// rule and the read-time citation. Three answers are frozen here:
//
//   1. MIGRATION. A v35 database reaches v36 with every Exhibit keeping its
//      number and null member columns, and — because the rebuild drops the
//      old `exhibits` table — every Derived File and tag application still
//      attached. Losing those rows would be silent evidence loss.
//   2. UNIQUENESS. `NK-12` and `MB-12` coexist in one Case; a second `12`
//      from one author, including two local rows, is refused.
//   3. CITATION. A one-member Case cites bare in the app and prefixed in an
//      export; a two-member Case cites prefixed everywhere; a remote row keeps
//      the code it was received under.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const REMOTE_ID = 'installation-remote-0001'

function member(caseId: string, overrides: Partial<CaseMember> = {}): CaseMember {
  return {
    caseId,
    installationId: getInstallationId(),
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nlocal\n-----END PUBLIC KEY-----',
    memberCode: 'NK',
    operatorName: 'Nadia K',
    nodeId: 'node-local',
    role: 'owner',
    addedAtIndex: 0,
    revokedAtIndex: null,
    ...overrides
  }
}

function remoteMember(caseId: string, overrides: Partial<CaseMember> = {}): CaseMember {
  return member(caseId, {
    installationId: REMOTE_ID,
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nremote\n-----END PUBLIC KEY-----',
    memberCode: 'MB',
    operatorName: 'Marcus B',
    nodeId: 'node-remote',
    role: 'member',
    addedAtIndex: 1,
    ...overrides
  })
}

function remoteExhibit(caseId: string, exhibitNumber: number, id = `remote-${exhibitNumber}`) {
  getDb()
    .prepare(
      `INSERT INTO exhibits (
         id, case_id, kind, origin, exhibit_number, name, content_hash, path,
         size_bytes, committed_at, manifest_seq, member_code, author_installation_id
       ) VALUES (?, ?, 'capture', 'extension', ?, ?, ?, NULL, NULL, '2026-09-01T00:00:00.000Z',
                 NULL, 'MB', ?)`
    )
    .run(id, caseId, exhibitNumber, `Remote ${exhibitNumber}`, 'r'.repeat(64), REMOTE_ID)
}

describe('shared case members (#1510)', () => {
  let tempDir: string
  let caseId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-shared-case-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Nadia K' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Shared' }).id
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('migration v36', () => {
    // A real v35 database: the same schema this build creates, wound back by
    // dropping what v36 added and rebuilding `exhibits` with the v35 UNIQUE.
    function windBackToV35(dbPath: string): void {
      const raw = new Database(dbPath)
      raw.pragma('foreign_keys = OFF')
      raw.exec('DROP TABLE case_members')
      for (const table of ['notes', 'annotations', 'tags', 'exhibit_tags', 'note_tags']) {
        for (const column of ['author_installation_id', 'version', 'deleted_at', 'row_signature']) {
          raw.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
        }
      }
      raw.exec('ALTER TABLE cases DROP COLUMN shared_at')
      raw.exec('ALTER TABLE cases DROP COLUMN owner_installation_id')
      raw.exec(`
        CREATE TABLE exhibits_v35 (
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
        INSERT INTO exhibits_v35
          SELECT id, case_id, kind, origin, exhibit_number, name, content_hash, path,
                 size_bytes, committed_at, manifest_seq FROM exhibits;
        DROP TABLE exhibits;
        ALTER TABLE exhibits_v35 RENAME TO exhibits;
        CREATE INDEX idx_exhibits_case_id ON exhibits(case_id);
      `)
      raw.pragma('user_version = 35')
      raw.close()
    }

    it('keeps every Exhibit, its Derived Files and its tags across the rebuild', async () => {
      closeDatabase()
      const dbPath = join(tempDir, 'v35.db')
      await initDatabase(dbPath)
      const migrated = createCase({ name: 'Migrated' }).id
      const first = insertCapture({
        caseId: migrated,
        url: 'https://example.com/1',
        title: 'One',
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      const second = insertCapture({
        caseId: migrated,
        url: 'https://example.com/2',
        title: 'Two',
        hash: 'b'.repeat(64),
        timestamp: '2026-01-02T00:00:00.000Z'
      })
      const tag = createTag({ name: 'evidence', color: '#22c55e' })
      addTagToCapture({ captureId: first.id, tagId: tag.id })
      insertDerivedFile({
        id: 'thumb-1',
        exhibitId: first.id,
        derivation: 'thumbnail',
        toolVersion: '1',
        contentHash: 'c'.repeat(64),
        path: `${migrated}/thumbnails/${first.id}.png`,
        createdAt: '2026-01-01T00:00:01.000Z',
        manifestSeq: null
      })
      closeDatabase()

      windBackToV35(dbPath)
      await initDatabase(dbPath)

      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
      expect(listExhibits(migrated).map((e) => [e.id, e.exhibitNumber])).toEqual([
        [first.id, 1],
        [second.id, 2]
      ])
      expect(getExhibit(first.id)).toMatchObject({ memberCode: null, authorInstallationId: null })
      expect(listDerivedFilesForExhibit(first.id).map((d) => d.id)).toEqual(['thumb-1'])
      expect(getTagsForCapture(first.id).map((t) => t.name)).toEqual(['evidence'])
      expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1)

      // Bare citations: a Case nobody shared has no roster and no prefix.
      expect(listCaptures(migrated).map((c) => c.exhibitCitation)).toEqual(['2', '1'])
      expect(getCase(migrated)?.sharedAt).toBeUndefined()

      const columns = (name: string): string[] =>
        (getDb().pragma(`table_info(${name})`) as Array<{ name: string }>).map((c) => c.name)
      expect(columns('case_members')).toEqual([
        'case_id',
        'installation_id',
        'public_key_pem',
        'member_code',
        'operator_name',
        'node_id',
        'role',
        'added_at_index',
        'revoked_at_index'
      ])
      for (const table of ['notes', 'annotations', 'tags', 'exhibit_tags', 'note_tags']) {
        expect(columns(table), table).toEqual(
          expect.arrayContaining([
            'author_installation_id',
            'version',
            'deleted_at',
            'row_signature'
          ])
        )
      }
      expect(columns('cases')).toEqual(
        expect.arrayContaining(['shared_at', 'owner_installation_id'])
      )
      closeDatabase()
      rmSync(dbPath, { force: true })
    })
  })

  describe('uniqueness (decision 7)', () => {
    it('lets two members use one number and refuses a second within one author', () => {
      const local = insertCapture({
        caseId,
        url: 'https://example.com/12',
        title: 'Twelve',
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      const twelve = getExhibit(local.id)!.exhibitNumber
      expect(() => remoteExhibit(caseId, twelve)).not.toThrow()
      expect(() => remoteExhibit(caseId, twelve, 'remote-again')).toThrow(/UNIQUE/i)
    })

    it('still refuses two local Exhibits with one number, the author column being NULL', () => {
      insertCapture({
        caseId,
        url: 'https://example.com/a',
        title: 'A',
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      expect(() =>
        insertExhibit({
          id: 'local-dup',
          caseId,
          kind: 'attachment',
          origin: 'manual-upload',
          name: 'dup',
          contentHash: 'd'.repeat(64),
          committedAt: '2026-01-01T00:00:00.000Z',
          exhibitNumber: 1
        })
      ).toThrow(/UNIQUE/i)
    })

    // A member joining a Case the Owner has numbered to 20 starts its own
    // sequence at 1: remote rows carry their author and are not this
    // installation's to count.
    it('allocates the next local number from local rows only', () => {
      remoteExhibit(caseId, 20)
      expect(nextExhibitNumber(caseId)).toBe(1)
      const local = insertCapture({
        caseId,
        url: 'https://example.com/first',
        title: 'First',
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      expect(getExhibit(local.id)!.exhibitNumber).toBe(1)
      expect(nextExhibitNumber(caseId)).toBe(2)
    })
  })

  describe('archive import', () => {
    const ctx = () => ({
      newCaseId: caseId,
      mapId: (id: string) => id,
      mapTag: (id: string) => id,
      getText: () => ''
    })
    const row = (memberCode: string | null) => ({
      id: 'imported-1',
      kind: 'attachment',
      origin: 'manual-upload',
      exhibit_number: 1,
      name: 'imported',
      content_hash: 'c'.repeat(64),
      path: null,
      committed_at: '2026-01-01T00:00:00.000Z',
      member_code: memberCode,
      author_installation_id: REMOTE_ID
    })

    it('keeps a well-formed Member Code and refuses one the roster rule would refuse', () => {
      expect(() => importExhibitRows([row('<b>x</b>')], ctx())).toThrow(/invalid Member Code/)
      expect(() => importExhibitRows([row('ABCD')], ctx())).toThrow(/invalid Member Code/)
      expect(() => importExhibitRows([{ ...row(null), member_code: 7 }], ctx())).toThrow(
        /invalid Member Code/
      )
      expect(getExhibit('imported-1')).toBeUndefined()
      importExhibitRows([row('MB')], ctx())
      expect(getExhibit('imported-1')).toMatchObject({ memberCode: 'MB' })
    })

    it('imports a pre-#1510 row with no member columns as this installation’s', () => {
      const legacy: Record<string, unknown> = row(null)
      delete legacy.member_code
      delete legacy.author_installation_id
      importExhibitRows([legacy], ctx())
      expect(getExhibit('imported-1')).toMatchObject({
        memberCode: null,
        authorInstallationId: null
      })
    })
  })

  describe('roster', () => {
    it('validates a Member Code by shape and by uniqueness within the Case', () => {
      upsertCaseMember(member(caseId))
      expect(memberCodeProblem(caseId, 'nk', REMOTE_ID)).toMatch(/one to three characters/)
      expect(memberCodeProblem(caseId, 'ABCD', REMOTE_ID)).toMatch(/one to three characters/)
      expect(memberCodeProblem(caseId, '', REMOTE_ID)).toMatch(/one to three characters/)
      expect(memberCodeProblem(caseId, 'NK', REMOTE_ID)).toMatch(/already used/)
      // A member's own code is not a collision with itself.
      expect(memberCodeProblem(caseId, 'NK', getInstallationId())).toBeNull()
      expect(memberCodeProblem(caseId, 'MB', REMOTE_ID)).toBeNull()
      expect(() => upsertCaseMember(remoteMember(caseId, { memberCode: 'NK' }))).toThrow(
        /already used/
      )
    })

    it('upserts by installation and lists in chain order', () => {
      upsertCaseMember(remoteMember(caseId))
      upsertCaseMember(member(caseId))
      upsertCaseMember(remoteMember(caseId, { operatorName: 'Marcus Bell', revokedAtIndex: 9 }))
      expect(listCaseMembers(caseId)).toEqual([
        expect.objectContaining({ memberCode: 'NK', role: 'owner', addedAtIndex: 0 }),
        expect.objectContaining({
          memberCode: 'MB',
          operatorName: 'Marcus Bell',
          revokedAtIndex: 9
        })
      ])
      expect(listCaseMembers('nowhere')).toEqual([])
    })

    it('keeps the sync columns out of the Tag wire shape', () => {
      const tag = createTag({ name: 'shared', color: '#000000' })
      expect(listTags()).toEqual([{ id: tag.id, name: 'shared', color: '#000000' }])
    })
  })

  describe('read-time citation (decision 7)', () => {
    let localId: string

    beforeEach(() => {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com/local',
        title: 'Local',
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })
      localId = capture.id
    })

    it('cites bare with no roster, in the app and in an export', () => {
      const exhibit = getExhibit(localId)!
      expect(exhibitCitationResolver(caseId, 'app')(exhibit)).toBe('1')
      expect(exhibitCitationResolver(caseId, 'export')(exhibit)).toBe('1')
    })

    it('hides the prefix in the app while the Case has one member, shows it in an export', () => {
      upsertCaseMember(member(caseId))
      const exhibit = getExhibit(localId)!
      expect(exhibitCitationResolver(caseId, 'app')(exhibit)).toBe('1')
      expect(exhibitCitationResolver(caseId, 'export')(exhibit)).toBe('NK-1')
    })

    it('prefixes everywhere once a second member is on the roster', () => {
      upsertCaseMember(member(caseId))
      upsertCaseMember(remoteMember(caseId))
      remoteExhibit(caseId, 1)
      const cite = exhibitCitationResolver(caseId, 'app')
      expect(cite(getExhibit(localId)!)).toBe('NK-1')
      // A remote row keeps the code it was received under.
      expect(cite(getExhibit('remote-1')!)).toBe('MB-1')
    })

    it('counts a revoked member out of the prefix rule', () => {
      upsertCaseMember(member(caseId))
      upsertCaseMember(remoteMember(caseId, { revokedAtIndex: 4 }))
      expect(exhibitCitationResolver(caseId, 'app')(getExhibit(localId)!)).toBe('1')
      expect(exhibitCitationResolver(caseId, 'export')(getExhibit(localId)!)).toBe('NK-1')
    })

    it('carries the citation on the capture list, the single read and the inventory', () => {
      upsertCaseMember(member(caseId))
      upsertCaseMember(remoteMember(caseId))
      expect(listCaptures(caseId).map((c) => [c.exhibitNumber, c.exhibitCitation])).toEqual([
        [1, 'NK-1']
      ])
      expect(getCapture(localId)).toMatchObject({ exhibitNumber: 1, exhibitCitation: 'NK-1' })
      const rows = getCaseInventory(caseId).rows.filter((r) => r.entity === 'exhibit')
      expect(rows.map((r) => r.citation)).toEqual(['NK-1'])
    })
  })

  describe('report', () => {
    async function exportReport(): Promise<string> {
      const captureLifecycle = {
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      }
      const outputPath = join(tempDir, 'report.html')
      const options: ExportOptions = {
        format: 'html',
        include: {
          captures: true,
          screenshots: false,
          auditTrail: false,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      }
      const { createCaptureLifecycle } = await import('@main/services/captureLifecycle')
      await generateReport(caseId, options, createCaptureLifecycle(captureLifecycle))
      return readFileSync(outputPath, 'utf-8')
    }

    beforeEach(async () => {
      ensureCaseDir(caseId)
      initManifest(join(tempDir, 'captures', caseId))
      const payload = 'From: <Saved by Chrome>\n\nshared bytes'
      const result = await ingestMhtmlCapture({
        caseId,
        url: 'https://example.com/shared',
        title: 'Shared page',
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([Buffer.from(payload)]) as unknown as ReadableStream<Uint8Array>,
        textContent: payload,
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op',
        operatorName: 'Nadia K',
        toolVersion: '0.1.0'
      })
      expect(result.capture).toBeDefined()
    })

    it('cites every Exhibit by Member Code in a Shared Case export', async () => {
      upsertCaseMember(member(caseId))
      const html = await exportReport()
      expect(html).toContain('Exhibit NK-1')
      expect(html).toContain('(Exhibits NK-1)')
      expect(html).not.toMatch(/Exhibit 1\b/)
      expect(createHash('sha256').update(html).digest('hex')).toHaveLength(64)
    })

    // A Member Code is a recorded string like a title or a URL, and a row
    // stored before import validation existed can hold anything.
    it('escapes a citation in every HTML context it reaches', async () => {
      upsertCaseMember(member(caseId))
      getDb().prepare('UPDATE exhibits SET member_code = ? WHERE case_id = ?').run('<i>', caseId)
      const html = await exportReport()
      expect(html).not.toContain('<i>-1')
      expect(html).toContain('Exhibit &lt;i&gt;-1')
      expect(html).toContain('(Exhibits &lt;i&gt;-1)')
    })
  })
})
