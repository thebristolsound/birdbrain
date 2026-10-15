import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSign, generateKeyPairSync } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import {
  createNote,
  deleteNote,
  getNote,
  getNoteCount,
  listNotes,
  searchNotes,
  updateNote
} from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  addTagToCaptures,
  addTagToNote,
  createTag,
  deleteTag,
  getTag,
  getTagsForCapture,
  getTagsForNote,
  getTagUsageCountsForCase,
  listTags,
  mergeTags,
  removeTagFromCapture,
  updateTag
} from '@main/services/db/tagRepo'
import {
  deleteAnnotations,
  deletePin,
  getAnnotations,
  saveAnnotations,
  upsertPin
} from '@main/services/annotations'
import { referencesForNote } from '@main/services/db/noteReferenceRepo'
import {
  maxAuthorVersionInCase,
  maxLocalVersion,
  ROWS_PAGE_LIMIT,
  rowsOfAuthorByTable,
  readRow,
  rowsOfAuthorSince,
  type RowFields,
  type SyncedTable
} from '@main/services/db/workingRowRepo'
import {
  allocateLocalVersion,
  applyRemoteRows,
  offerPage,
  rowDigest,
  toWireRows,
  verifyWireRow
} from '@main/services/sharing/workingRows'
import type { WireRow } from '@main/services/sharing/messages'
import { initStorage } from '@main/services/storage'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import type { CaseMember } from '@shared/types'

// Working-layer rows as evidence of who wrote what (#1512). Frozen here: every
// local write is signed by this installation over the row's canonical
// envelope with a version above every earlier one; a delete in a Shared Case
// tombstones the row and re-signs it while a delete elsewhere removes it;
// readers skip tombstones; only the author edits a row; and a remote row is
// applied only under its author's roster key and above the stored version.

const REMOTE_ID = 'installation-remote-0001'
const REMOTE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const signRemote = (hex: string): string =>
  createSign('sha256').update(hex).sign(REMOTE_KEY.privateKey, 'base64')

interface RawRow {
  author_installation_id: string | null
  version: number
  deleted_at: string | null
  row_signature: string | null
}

describe('working-layer rows (#1512)', () => {
  let tempDir: string
  let caseId: string
  let localId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-working-rows-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    localId = getInstallationId()
    caseId = createCase({ name: 'Case' }).id
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function share(): void {
    getDb()
      .prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?")
      .run(caseId)
    const base = { caseId, nodeId: 'node', revokedAtIndex: null }
    upsertCaseMember({
      ...base,
      installationId: localId,
      publicKeyPem: getPublicKeyPem(),
      memberCode: 'LO',
      operatorName: 'Local',
      role: 'owner',
      addedAtIndex: 0
    })
    upsertCaseMember({
      ...base,
      installationId: REMOTE_ID,
      publicKeyPem: REMOTE_KEY.publicKey,
      memberCode: 'RE',
      operatorName: 'Remote',
      role: 'member',
      addedAtIndex: 1
    })
  }

  const roster = (): CaseMember[] =>
    (
      getDb().prepare('SELECT * FROM case_members WHERE case_id = ?').all(caseId) as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      caseId,
      installationId: r.installation_id as string,
      publicKeyPem: r.public_key_pem as string,
      memberCode: r.member_code as string,
      operatorName: r.operator_name as string,
      nodeId: r.node_id as string,
      role: r.role as 'owner' | 'member',
      addedAtIndex: r.added_at_index as number,
      revokedAtIndex: r.revoked_at_index as number | null
    }))

  function capture(url = 'https://example.com'): string {
    return insertCapture({
      caseId,
      url,
      title: 'Page',
      hash: 'h'.repeat(64),
      timestamp: '2026-10-01T00:00:00.000Z'
    }).id
  }

  function raw(table: SyncedTable, where: string, ...params: unknown[]): RawRow | undefined {
    return getDb()
      .prepare(`SELECT * FROM ${table} WHERE ${where}`)
      .get(...params) as RawRow | undefined
  }

  // A row of the remote member, signed with its key, as the session would
  // hand it to applyRemoteRows.
  function remoteRow(
    table: SyncedTable,
    fields: RowFields,
    version: number,
    deletedAt: string | null = null
  ): WireRow {
    const signature = signRemote(
      rowDigest({ table, author: REMOTE_ID, version, deletedAt, fields })
    )
    return { table, author: REMOTE_ID, version, deletedAt, fields, signature }
  }

  const noteFields = (
    id: string,
    title: string,
    overrides: Partial<RowFields> = {}
  ): RowFields => ({
    id,
    case_id: caseId,
    capture_id: null,
    title,
    body: `${title} body`,
    body_doc: null,
    anchor_kind: null,
    anchor_json: null,
    source_url: null,
    screenshot_path: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides
  })

  it('signs every local write over its canonical envelope, with climbing versions', () => {
    const note = createNote({ caseId, title: 'First', body: 'text' })
    const stored = readRow('notes', { id: note.id }, null)!
    expect(stored.author).toBeNull()
    expect(stored.version).toBe(1)
    expect(stored.deletedAt).toBeNull()
    const [wire] = toWireRows([stored], localId)
    expect(wire.author).toBe(localId)
    expect(verifyWireRow(wire, getPublicKeyPem())).toBe(true)
    expect(verifyWireRow(wire, REMOTE_KEY.publicKey)).toBe(false)
    // The signature covers the content: an edit behind the repo's back fails it.
    getDb().prepare("UPDATE notes SET title = 'Edited' WHERE id = ?").run(note.id)
    const edited = toWireRows([readRow('notes', { id: note.id }, null)!], localId)[0]
    expect(verifyWireRow(edited, getPublicKeyPem())).toBe(false)

    const tag = createTag({ name: 'evidence', color: '#22c55e' })
    const cap = capture()
    addTagToCapture({ captureId: cap, tagId: tag.id })
    updateNote({ id: note.id, title: 'Second' })
    expect(readRow('tags', { id: tag.id }, null)!.version).toBe(2)
    expect(readRow('exhibit_tags', { exhibit_id: cap, tag_id: tag.id }, null)!.version).toBe(3)
    expect(readRow('notes', { id: note.id }, null)!.version).toBe(4)
    expect(maxLocalVersion()).toBe(4)
    expect(allocateLocalVersion()).toBe(5)
    // A batch shares one version.
    const other = capture('https://example.com/2')
    addTagToCaptures([cap, other], createTag({ name: 'batch' }).id)
    const versions = (
      getDb()
        .prepare(
          "SELECT version FROM exhibit_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'batch')"
        )
        .all() as Array<{ version: number }>
    ).map((r) => r.version)
    expect(versions).toEqual([6, 6])
  })

  it('removes a deleted row in a Case nobody shared', () => {
    const note = createNote({ caseId, title: 'Gone', body: '' })
    const tag = createTag({ name: 'gone' })
    const cap = capture()
    addTagToCapture({ captureId: cap, tagId: tag.id })
    expect(deleteNote(note.id)).toBe(true)
    expect(deleteTag(tag.id)).toBe(true)
    expect(raw('notes', 'id = ?', note.id)).toBeUndefined()
    expect(raw('tags', 'id = ?', tag.id)).toBeUndefined()
    expect(raw('exhibit_tags', 'tag_id = ?', tag.id)).toBeUndefined()
    expect(deleteNote(note.id)).toBe(false)
  })

  it('tombstones a deleted row in a Shared Case, re-signed, and every reader skips it', () => {
    share()
    const cap = capture()
    const note = createNote({ caseId, title: 'Deleted later', body: 'searchable words' })
    const tag = createTag({ name: 'tombstone' })
    addTagToCapture({ captureId: cap, tagId: tag.id })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    saveAnnotations({ captureId: cap, shapes: [], imageWidth: 10, imageHeight: 10 })
    const pin = upsertPin({ captureId: cap, body: 'pin' })

    expect(deleteNote(note.id)).toBe(true)
    const noteRow = raw('notes', 'id = ?', note.id)!
    expect(noteRow.deleted_at).not.toBeNull()
    expect(noteRow.version).toBeGreaterThan(1)
    expect(
      verifyWireRow(
        toWireRows([readRow('notes', { id: note.id }, null)!], localId)[0],
        getPublicKeyPem()
      )
    ).toBe(true)
    expect(listNotes(caseId)).toEqual([])
    expect(getNote(note.id)).toBeUndefined()
    expect(getNoteCount(caseId)).toBe(0)
    expect(searchNotes(caseId, 'searchable')).toEqual([])
    expect(updateNote({ id: note.id, title: 'x' })).toBeUndefined()
    expect(deleteNote(note.id)).toBe(false)

    expect(deleteTag(tag.id)).toBe(true)
    expect(raw('tags', 'id = ?', tag.id)!.deleted_at).not.toBeNull()
    expect(raw('exhibit_tags', 'tag_id = ?', tag.id)!.deleted_at).not.toBeNull()
    expect(raw('note_tags', 'tag_id = ?', tag.id)!.deleted_at).not.toBeNull()
    expect(listTags()).toEqual([])
    expect(getTag(tag.id)).toBeUndefined()
    expect(getTagsForCapture(cap)).toEqual([])
    expect(getTagsForNote(note.id)).toEqual([])
    expect(getTagUsageCountsForCase(caseId)).toEqual({})
    expect(updateTag({ id: tag.id, name: 'renamed' })).toBeUndefined()

    deleteAnnotations(cap)
    expect(raw('annotations', 'capture_id = ?', cap)!.deleted_at).not.toBeNull()
    deletePin(pin.id)
    expect(raw('annotation_pins', 'id = ?', pin.id)!.deleted_at).not.toBeNull()
    expect(getAnnotations(cap)).toEqual({ annotations: null, pins: [] })
  })

  it('restores a tombstoned application or tag when it is applied or named again', () => {
    share()
    const cap = capture()
    const tag = createTag({ name: 'evidence', color: '#111111' })
    addTagToCapture({ captureId: cap, tagId: tag.id })
    removeTagFromCapture({ captureId: cap, tagId: tag.id })
    const gone = raw('exhibit_tags', 'tag_id = ?', tag.id)!
    expect(gone.deleted_at).not.toBeNull()
    addTagToCapture({ captureId: cap, tagId: tag.id })
    const back = raw('exhibit_tags', 'tag_id = ?', tag.id)!
    expect(back.deleted_at).toBeNull()
    expect(back.version).toBeGreaterThan(gone.version)
    expect(getTagsForCapture(cap).map((t) => t.id)).toEqual([tag.id])
    // Applying it a third time changes nothing.
    addTagToCapture({ captureId: cap, tagId: tag.id })
    expect(raw('exhibit_tags', 'tag_id = ?', tag.id)!.version).toBe(back.version)

    deleteTag(tag.id)
    const again = createTag({ name: 'evidence', color: '#222222' })
    expect(again.id).toBe(tag.id)
    expect(getTag(tag.id)).toEqual({ id: tag.id, name: 'evidence', color: '#222222' })
    expect(raw('tags', 'id = ?', tag.id)!.deleted_at).toBeNull()

    saveAnnotations({ captureId: cap, shapes: [], imageWidth: 1, imageHeight: 1 })
    deleteAnnotations(cap)
    saveAnnotations({ captureId: cap, shapes: [], imageWidth: 2, imageHeight: 2 })
    expect(getAnnotations(cap).annotations?.imageWidth).toBe(2)
  })

  it('leaves another member rows to their author: readable, never edited or deleted here', () => {
    share()
    const cap = capture()
    const outcome = applyRemoteRows(
      [
        remoteRow('notes', noteFields('remote-note', 'Theirs'), 1),
        remoteRow(
          'tags',
          { id: 'remote-tag', name: 'theirs', color: null, created_at: '2026-10-01T00:00:00.000Z' },
          2
        ),
        remoteRow('exhibit_tags', { exhibit_id: cap, tag_id: 'remote-tag' }, 3),
        remoteRow(
          'annotations',
          {
            capture_id: cap,
            schema_version: 1,
            shapes_json: '[]',
            image_width: 5,
            image_height: 5,
            updated_at: '2026-10-01T00:00:00.000Z',
            updated_by: null
          },
          4
        ),
        remoteRow(
          'annotation_pins',
          {
            id: 'remote-pin',
            capture_id: cap,
            number: 1,
            body: 'their pin',
            created_at: '2026-10-01T00:00:00.000Z',
            updated_at: '2026-10-01T00:00:00.000Z'
          },
          5
        )
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(outcome).toEqual({ applied: 5, skipped: 0, refused: [] })
    expect(listNotes(caseId).map((n) => n.title)).toEqual(['Theirs'])
    expect(listTags().map((t) => t.name)).toEqual(['theirs'])
    expect(getTagsForCapture(cap).map((t) => t.id)).toEqual(['remote-tag'])

    expect(updateNote({ id: 'remote-note', title: 'Mine now' })).toBeUndefined()
    expect(deleteNote('remote-note')).toBe(false)
    expect(updateTag({ id: 'remote-tag', name: 'mine' })).toBeUndefined()
    expect(deleteTag('remote-tag')).toBe(false)
    expect(
      mergeTags({ sourceId: 'remote-tag', targetId: createTag({ name: 'mine' }).id })
    ).toBeUndefined()
    removeTagFromCapture({ captureId: cap, tagId: 'remote-tag' })
    expect(raw('exhibit_tags', "tag_id = 'remote-tag'")!.deleted_at).toBeNull()
    deleteAnnotations(cap)
    expect(raw('annotations', 'capture_id = ?', cap)!.deleted_at).toBeNull()
    deletePin('remote-pin')
    expect(raw('annotation_pins', "id = 'remote-pin'")!.deleted_at).toBeNull()
    expect(() => upsertPin({ id: 'remote-pin', captureId: cap, body: 'mine' })).toThrow()
    expect(getNote('remote-note')?.title).toBe('Theirs')

    // Their layer is shown while this installation has none, with their pins
    // and nobody else's; this installation's layer takes over once saved,
    // numbered within itself.
    expect(getAnnotations(cap).annotations?.imageWidth).toBe(5)
    expect(getAnnotations(cap).pins.map((p) => p.body)).toEqual(['their pin'])
    const mine = upsertPin({ captureId: cap, body: 'my pin' })
    expect(mine.number).toBe(1)
    saveAnnotations({ captureId: cap, shapes: [], imageWidth: 9, imageHeight: 9 })
    expect(getAnnotations(cap).annotations?.imageWidth).toBe(9)
    expect(getAnnotations(cap).pins.map((p) => p.body)).toEqual(['my pin'])
  })

  it('merges this installation applications only, leaving another member application alone', () => {
    share()
    const cap = capture()
    const other = capture('https://example.com/2')
    const source = createTag({ name: 'src' })
    const target = createTag({ name: 'dst', color: '#abcdef' })
    addTagToCapture({ captureId: cap, tagId: source.id })
    addTagToCapture({ captureId: other, tagId: target.id })
    const note = createNote({ caseId, title: 'n', body: '' })
    addTagToNote({ noteId: note.id, tagId: source.id })
    applyRemoteRows(
      [remoteRow('exhibit_tags', { exhibit_id: other, tag_id: source.id }, 1)],
      roster(),
      new Set([REMOTE_ID])
    )

    expect(mergeTags({ sourceId: source.id, targetId: target.id })).toEqual({
      target,
      captureLinks: 2,
      noteLinks: 1
    })
    expect(getTagsForCapture(cap).map((t) => t.id)).toEqual([target.id])
    expect(getTagsForNote(note.id).map((t) => t.id)).toEqual([target.id])
    expect(
      raw(
        'exhibit_tags',
        'exhibit_id = ? AND tag_id = ? AND author_installation_id IS NULL',
        cap,
        source.id
      )!.deleted_at
    ).not.toBeNull()
    expect(raw('tags', 'id = ?', source.id)!.deleted_at).not.toBeNull()
    const theirs = raw(
      'exhibit_tags',
      'exhibit_id = ? AND tag_id = ? AND author_installation_id = ?',
      other,
      source.id,
      REMOTE_ID
    )!
    expect(theirs.deleted_at).toBeNull()
    expect(theirs.version).toBe(1)
  })

  it('applies a remote row only above the stored version, and only under its author key', () => {
    share()
    const first = remoteRow('notes', noteFields('rn', 'v1'), 1)
    const second = remoteRow('notes', noteFields('rn', 'v2'), 2)
    expect(applyRemoteRows([second, first], roster(), new Set([REMOTE_ID]))).toEqual({
      applied: 2,
      skipped: 0,
      refused: []
    })
    expect(getNote('rn')?.title).toBe('v2')
    expect(applyRemoteRows([first, second], roster(), new Set([REMOTE_ID]))).toEqual({
      applied: 0,
      skipped: 2,
      refused: []
    })
    expect(maxAuthorVersionInCase(caseId, REMOTE_ID)).toBe(2)
    expect(maxAuthorVersionInCase(caseId, 'nobody')).toBe(0)
    const served = rowsOfAuthorSince(caseId, REMOTE_ID, 0)
    expect(served.map((r) => [r.table, r.version])).toEqual([['notes', 2]])
    expect(rowsOfAuthorSince(caseId, REMOTE_ID, 2)).toEqual([])

    const forged = {
      ...remoteRow('notes', noteFields('rn', 'v3'), 3),
      fields: noteFields('rn', 'v3 edited')
    }
    const unsigned = { ...remoteRow('notes', noteFields('rn', 'v4'), 4), signature: 'bm90' }
    const stranger = remoteRow('notes', noteFields('rn2', 'x'), 5)
    const refused = applyRemoteRows(
      [
        forged,
        unsigned,
        { ...stranger, author: 'installation-nobody' },
        remoteRow('selectors' as SyncedTable, { id: 'x' }, 6)
      ],
      roster(),
      new Set([REMOTE_ID, 'installation-nobody'])
    )
    expect(refused.applied).toBe(0)
    expect(refused.refused.map((r) => [r.kind, r.detail])).toEqual([
      ['rejected-entry', `notes row of ${REMOTE_ID} at version 3: invalid signature`],
      ['rejected-entry', `notes row of ${REMOTE_ID} at version 4: invalid signature`],
      ['rejected-entry', 'notes row of installation-nobody at version 5: author not on the roster'],
      ['rejected-entry', `selectors row of ${REMOTE_ID} at version 6: table does not sync`]
    ])
    expect(getNote('rn')?.title).toBe('v2')
    const unasked = applyRemoteRows([first], roster(), new Set())
    expect(unasked.refused[0]?.detail).toBe(
      `notes row of ${REMOTE_ID} at version 1: author not requested`
    )
  })

  it('refuses a batch whose reference is not satisfied, and one that collides with a local row', () => {
    share()
    const mine = createNote({ caseId, title: 'Mine', body: '' })
    const collision = applyRemoteRows(
      [remoteRow('notes', noteFields(mine.id, 'Taken over'), 1)],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(collision.applied).toBe(0)
    expect(collision.refused[0]?.kind).toBe('peer')
    expect(collision.refused[0]?.detail).toContain('collides with a row of this installation')
    expect(getNote(mine.id)?.title).toBe('Mine')

    const dangling = applyRemoteRows(
      [
        remoteRow('notes', noteFields('rn', 'Fine'), 2),
        remoteRow('note_tags', { note_id: 'rn', tag_id: 'no-such-tag' }, 3)
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(dangling.applied).toBe(0)
    expect(dangling.refused[0]?.kind).toBe('peer')
    expect(dangling.refused[0]?.detail).toContain('FOREIGN KEY')
    expect(getNote('rn')).toBeUndefined()

    // A reference satisfied within the batch lands whatever the order.
    const ordered = applyRemoteRows(
      [
        remoteRow('note_tags', { note_id: 'rn', tag_id: 'rt' }, 6),
        remoteRow(
          'tags',
          { id: 'rt', name: 'remote', color: null, created_at: '2026-10-01T00:00:00.000Z' },
          5
        ),
        remoteRow('notes', noteFields('rn', 'Fine'), 4)
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(ordered).toEqual({ applied: 3, skipped: 0, refused: [] })
    expect(getTagsForNote('rn').map((t) => t.name)).toEqual(['remote'])
  })

  it('indexes the Mentions of a received note and clears them on its tombstone', () => {
    share()
    const target = createNote({ caseId, title: 'Target', body: '' })
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'mention', attrs: { targetType: 'note', targetId: target.id, label: 'Target' } }
          ]
        }
      ]
    })
    applyRemoteRows(
      [remoteRow('notes', noteFields('rn', 'Citing', { body_doc: doc }), 1)],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(referencesForNote('rn').map((r) => r.targetId)).toEqual([target.id])
    applyRemoteRows(
      [
        remoteRow(
          'notes',
          noteFields('rn', 'Citing', { body_doc: doc }),
          2,
          '2026-10-02T00:00:00.000Z'
        )
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(referencesForNote('rn')).toEqual([])
    applyRemoteRows(
      [remoteRow('notes', noteFields('rn', 'Citing', { body_doc: '{"type":"not-a-doc"}' }), 3)],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(referencesForNote('rn')).toEqual([])
  })

  it('offers every reachable tag whatever the cursor, and the other tables above it only', () => {
    share()
    const cap = capture()
    applyRemoteRows(
      [
        remoteRow(
          'tags',
          { id: 'rt', name: 'remote', color: null, created_at: '2026-10-01T00:00:00.000Z' },
          1
        ),
        remoteRow('notes', noteFields('rn', 'Remote'), 2),
        remoteRow('exhibit_tags', { exhibit_id: cap, tag_id: 'rt' }, 3)
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(rowsOfAuthorSince(caseId, REMOTE_ID, 0).map((r) => [r.table, r.version])).toEqual([
      ['tags', 1],
      ['notes', 2],
      ['exhibit_tags', 3]
    ])
    expect(rowsOfAuthorSince(caseId, REMOTE_ID, 2).map((r) => [r.table, r.version])).toEqual([
      ['tags', 1],
      ['exhibit_tags', 3]
    ])
    expect(rowsOfAuthorSince(caseId, REMOTE_ID, 3).map((r) => [r.table, r.version])).toEqual([
      ['tags', 1]
    ])
    // A tag applied in another Case only is not this Case's to offer.
    const elsewhere = createCase({ name: 'Elsewhere' }).id
    const otherCapture = insertCapture({
      caseId: elsewhere,
      url: 'https://example.com/elsewhere',
      title: 'Elsewhere',
      hash: 'e'.repeat(64),
      timestamp: '2026-10-01T00:00:00.000Z'
    }).id
    applyRemoteRows(
      [
        remoteRow(
          'tags',
          { id: 'rt2', name: 'elsewhere', color: null, created_at: '2026-10-01T00:00:00.000Z' },
          4
        ),
        remoteRow('exhibit_tags', { exhibit_id: otherCapture, tag_id: 'rt2' }, 5)
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    expect(rowsOfAuthorSince(caseId, REMOTE_ID, 3).map((r) => r.table)).toEqual(['tags'])
  })

  // Review finding 5 on this PR: a page is cut from what the tables offer,
  // complete up to the version every full table reached, under a byte budget
  // at a version boundary, and never empty of progress.
  describe('offerPage', () => {
    const row = (table: string, version: number, id = `${table}-${version}`): WireRow => ({
      table,
      author: REMOTE_ID,
      version,
      deletedAt: null,
      fields: { id },
      signature: 's'
    })
    const versions = (page: WireRow[]): Array<[string, number]> =>
      page.map((r) => [r.table, r.version])

    it('stops at the version every full table is complete to', () => {
      const byTable = new Map<string, WireRow[]>([
        ['notes', [row('notes', 1), row('notes', 4), row('notes', 9)]],
        ['annotation_pins', [row('annotation_pins', 2), row('annotation_pins', 7)]],
        ['tags', [row('tags', 3)]]
      ])
      // notes returned a full page (limit 3) up to version 9; pins did not.
      const page = offerPage(byTable, 3, Number.POSITIVE_INFINITY)
      expect(versions(page.rows)).toEqual([
        ['tags', 3],
        ['notes', 1],
        ['annotation_pins', 2],
        ['notes', 4],
        ['annotation_pins', 7],
        ['notes', 9]
      ])
      expect(page.more).toBe(true)
      // With pins full at 7 and notes full at 9, nothing above 7 is complete.
      const both = offerPage(
        new Map([
          ['notes', [row('notes', 1), row('notes', 4), row('notes', 9)]],
          ['annotation_pins', [row('annotation_pins', 2), row('annotation_pins', 7)]]
        ]),
        2,
        Number.POSITIVE_INFINITY
      )
      expect(versions(both.rows)).toEqual([
        ['notes', 1],
        ['annotation_pins', 2],
        ['notes', 4],
        ['annotation_pins', 7]
      ])
      expect(both.more).toBe(true)
      const complete = offerPage(byTable, 10, Number.POSITIVE_INFINITY)
      expect(complete.rows).toHaveLength(6)
      expect(complete.more).toBe(false)
    })

    it('cuts at a version boundary under the byte budget, always carrying the first group', () => {
      const byTable = new Map<string, WireRow[]>([
        ['notes', [row('notes', 1, 'a'), row('notes', 1, 'b'), row('notes', 2), row('notes', 3)]],
        ['tags', [row('tags', 1)]]
      ])
      const size = JSON.stringify(row('notes', 1, 'a')).length
      const tight = offerPage(byTable, 100, 1)
      expect(versions(tight.rows)).toEqual([
        ['tags', 1],
        ['notes', 1],
        ['notes', 1]
      ])
      expect(tight.more).toBe(true)
      const three = offerPage(byTable, 100, size * 4 + 10)
      expect(versions(three.rows)).toEqual([
        ['tags', 1],
        ['notes', 1],
        ['notes', 1],
        ['notes', 2]
      ])
      expect(three.more).toBe(true)
      const all = offerPage(byTable, 100, size * 10)
      expect(all.rows).toHaveLength(5)
      expect(all.more).toBe(false)
      expect(offerPage(new Map(), 100, 1)).toEqual({ rows: [], more: false })
    })
  })

  it('reads at most the page limit of each cursor-bound table, and every tag', () => {
    share()
    const cap = capture()
    applyRemoteRows(
      [
        remoteRow(
          'tags',
          { id: 'rt', name: 'remote', color: null, created_at: '2026-10-01T00:00:00.000Z' },
          1
        ),
        remoteRow('exhibit_tags', { exhibit_id: cap, tag_id: 'rt' }, 2),
        remoteRow('notes', noteFields('rn1', 'one'), 3),
        remoteRow('notes', noteFields('rn2', 'two'), 4),
        remoteRow('notes', noteFields('rn3', 'three'), 5)
      ],
      roster(),
      new Set([REMOTE_ID])
    )
    const byTable = rowsOfAuthorByTable(caseId, REMOTE_ID, 0, 2)
    expect(byTable.get('notes')!.map((r) => r.version)).toEqual([3, 4])
    expect(byTable.get('tags')!.map((r) => r.version)).toEqual([1])
    expect(byTable.get('exhibit_tags')!.map((r) => r.version)).toEqual([2])
    expect(
      rowsOfAuthorByTable(caseId, REMOTE_ID, 4, 2)
        .get('notes')!
        .map((r) => r.version)
    ).toEqual([5])
    expect(ROWS_PAGE_LIMIT).toBeGreaterThan(0)
  })
})
