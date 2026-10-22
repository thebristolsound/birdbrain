import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { DEMO_CASE_ARCHIVE_FILENAME, DEMO_CASE_OPERATOR_NAME } from '@shared/constants'
import { closeDatabase, getDb } from '@main/services/db/core'
import { deleteCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote, listNotes, updateNote } from '@main/services/db/noteRepo'
import { insertExhibit } from '@main/services/db/exhibitRepo'
import {
  addTagToCapture,
  addTagToCaptures,
  addTagToNote,
  createTag,
  getTagsForCapture,
  deleteTag,
  listTags,
  mergeTags,
  updateTag
} from '@main/services/db/tagRepo'
import { getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { readStoredZip } from '@main/services/zipRead'
import { createStoredZip } from '@main/services/zip'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  maxLocalVersion,
  ownUnsignedRowsInCase,
  readRow,
  SYNCED_TABLES,
  type RowKey,
  type SyncedTable
} from '@main/services/db/workingRowRepo'
import { addMember, revokeMember, shareCase } from '@main/services/sharing/membership'
import { SharingService } from '@main/services/sharing/sharingService'
import { MemoryHub } from '@main/services/sharing/transport'
import { signLocalRow, toWireRows, verifyWireRow } from '@main/services/sharing/workingRows'
import {
  SYNC_STATE_FILENAME,
  readSyncStateFile,
  resetSyncStateMemory,
  writeSyncStateFile
} from '@main/services/sharing/syncState'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  activate,
  addCapture,
  addDocument,
  caseDirOf,
  createPeer,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  TIME,
  type Peer
} from '../../../helpers/syncPeers'

// The Owner's rows written before rows were signed (#1910, rulings of 21 and 22 October 2026):
// the first share signs this installation's unsigned notes, tag applications, annotation layers
// and pins of the Case that are provably its own, in the transaction that writes the Owner's
// roster row from its `member-add`, each at a fresh version, so a member's first sync receives
// them. An older tag is never signed, so an older application of it stays local too, and so
// do rows on a Capture or Exhibit no member can hold. Content is invented.

interface Written {
  captureId: string
  noteId: string
  tagId: string
  pinId: string
}

// One of each synced row on a Capture, written through the app on the active peer: a note
// linking the Capture, a tag applied to the Capture and to the note, a layer and a pin.
function writeRows(caseId: string, captureId: string, label: string): Written {
  const note = createNote({
    caseId,
    captureId,
    title: `${label} note`,
    body: `${label} wrote this before rows were signed`
  })
  const tag = createTag({ name: `${label} tag` })
  addTagToCapture({ captureId, tagId: tag.id })
  addTagToNote({ noteId: note.id, tagId: tag.id })
  saveAnnotations({ captureId, shapes: [], imageWidth: 800, imageHeight: 600 })
  const pin = upsertPin({ captureId, body: `${label} pin` })
  return { captureId, noteId: note.id, tagId: tag.id, pinId: pin.id }
}

// The six rows in SYNCED_TABLES order.
function keysOf(w: Written): Array<{ table: SyncedTable; key: RowKey }> {
  return [
    { table: 'notes', key: { id: w.noteId } },
    { table: 'tags', key: { id: w.tagId } },
    { table: 'exhibit_tags', key: { exhibit_id: w.captureId, tag_id: w.tagId } },
    { table: 'note_tags', key: { note_id: w.noteId, tag_id: w.tagId } },
    { table: 'annotations', key: { capture_id: w.captureId } },
    { table: 'annotation_pins', key: { id: w.pinId } }
  ]
}

// A tag and its applications: an older tag is never signed, so its older applications stay
// local with it.
const TAG_TABLES: SyncedTable[] = ['tags', 'exhibit_tags', 'note_tags']
const tagRows = (w: Written) => keysOf(w).filter(({ table }) => TAG_TABLES.includes(table))
const otherRows = (w: Written) => keysOf(w).filter(({ table }) => !TAG_TABLES.includes(table))

const where = (key: RowKey): string =>
  Object.keys(key)
    .map((column) => `${column} = @${column}`)
    .join(' AND ')

// Puts this installation's rows back as a build before row signing left them: version 0, no
// signature.
function unsign(keys: Array<{ table: SyncedTable; key: RowKey }>): void {
  for (const { table, key } of keys) {
    const { changes } = getDb()
      .prepare(
        `UPDATE ${table} SET version = 0, row_signature = NULL
          WHERE ${where(key)} AND author_installation_id IS NULL`
      )
      .run(key)
    expect(changes, `${table} ${JSON.stringify(key)}`).toBe(1)
  }
}

// One author's row as stored, with its rowid: what a row the share must not touch is
// compared by.
function raw(table: SyncedTable, key: RowKey, author: string | null = null): unknown {
  return getDb()
    .prepare(
      `SELECT rowid AS stored_rowid, * FROM ${table}
        WHERE ${where(key)} AND COALESCE(author_installation_id, '') = COALESCE(@author, '')`
    )
    .get({ ...key, author })
}

function syncColumns(table: SyncedTable, key: RowKey): { version: number; signature: unknown } {
  const row = readRow(table, key, null)
  expect(row, `${table} ${JSON.stringify(key)}`).toBeDefined()
  return { version: row!.version, signature: row!.signature }
}

function expectUnsigned(keys: Array<{ table: SyncedTable; key: RowKey }>): void {
  for (const { table, key } of keys) {
    expect(syncColumns(table, key), `${table} ${JSON.stringify(key)}`).toEqual({
      version: 0,
      signature: null
    })
  }
}

// The row as this peer serves it, verified under the Owner's key, with the Case it names.
function expectSignedBy(peer: Peer, table: SyncedTable, key: RowKey, caseId: string | null): void {
  const stored = readRow(table, key, null)
  expect(stored?.signature, `${table} ${JSON.stringify(key)} is signed`).toEqual(expect.any(String))
  const [wire] = toWireRows([stored!], peer.installationId)
  expect(wire.caseId, `${table} names its Case`).toBe(caseId)
  expect(verifyWireRow(wire, peer.publicKeyPem), `${table} verifies`).toBe(true)
}

// A note copied from another under a new id, with the sync columns given.
function cloneNote(
  fromId: string,
  id: string,
  sync: { author: string | null; version: number; signature: string | null }
): void {
  getDb()
    .prepare(
      `INSERT INTO notes (id, case_id, capture_id, title, body, body_doc, anchor_kind,
         anchor_json, source_url, screenshot_path, created_at, updated_at,
         author_installation_id, version, row_signature)
       SELECT @id, case_id, capture_id, 'Copied ' || title, body, body_doc, anchor_kind,
         anchor_json, source_url, screenshot_path, created_at, updated_at,
         @author, @version, @signature
         FROM notes WHERE id = @fromId`
    )
    .run({ id, fromId, ...sync })
}

const memberOfB = (B: Peer) => ({
  installationId: B.installationId,
  publicKeyPem: B.publicKeyPem,
  operatorName: B.operatorName,
  nodeId: `node-${B.name}`,
  memberCode: B.memberCode
})

const lifecycle = () =>
  createCaptureLifecycle({
    selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
  })

// A refusal's detail without the author and version it names.
const refusedAs = (errors: Array<{ detail: string }>): string[] =>
  errors.map(({ detail }) => detail.replace(/ of [^:]* at version \d+:/, ':')).sort()

const DEMO_ARCHIVE = resolve(__dirname, '../../../../resources', DEMO_CASE_ARCHIVE_FILENAME)
// The demo Case's tag "nightjar", under the one id every installation seeds it with.
const NIGHTJAR = '6790fc42-c957-473e-87ed-5d3ced33d282'

const highWater = (caseId: string): number =>
  readSyncStateFile(caseDirOf(caseId)).localVersionHighWater

describe('older rows at first share (#1910)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-older-rows-'))
    B = await createPeer(root, 'bob', 'Bob Member', 'BM')
    A = await createPeer(root, 'alice', 'Alice Owner', 'AO')
    caseId = createCase({ name: 'Older' }).id
    mkdirSync(caseDirOf(caseId), { recursive: true })
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  // A Capture ingested before the share, so its `capture` entry sits ahead of the Owner's
  // `member-add`, with one of each row on it, all put back to unsigned. Leaves Alice active.
  async function olderRows(id = caseId, n = 1): Promise<Written> {
    await activate(A)
    const { captureId } = await addCapture(id, A, n)
    const written = writeRows(id, captureId, `Alice ${n}`)
    unsign(keysOf(written))
    return written
  }

  it("a member's first sync receives the Owner's notes, annotations and pins written before signing, and no older tag or application of it", async () => {
    const w = await olderRows()
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    expectUnsigned(tagRows(w))
    const fromAlice = recordSource(caseId, A)
    expect((fromAlice.rows.get(A.installationId) ?? []).map((row) => row.table).sort()).toEqual([
      'annotation_pins',
      'annotations',
      'notes'
    ])

    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(caseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(result.capturesApplied).toBe(1)
    expect(result.rowsApplied).toBe(3)
    expect(listNotes(caseId).map((note) => [note.id, note.title])).toEqual([
      [w.noteId, 'Alice 1 note']
    ])
    expect(listTags()).toEqual([])
    const { annotations, pins } = getAnnotations(w.captureId)
    expect(annotations).not.toBeNull()
    expect(pins.map((pin) => pin.body)).toEqual(['Alice 1 pin'])
    for (const { table, key } of otherRows(w)) {
      const held = readRow(table, key, A.installationId)
      expect(held, `${table} landed under Alice`).toBeDefined()
      const [wire] = toWireRows([held!], B.installationId)
      expect(verifyWireRow(wire, A.publicKeyPem), `${table} verifies under Alice`).toBe(true)
    }
  })

  it('the first share signs each unsigned row of the Owner in the Case, each at its own version above the mark', async () => {
    const w = await olderRows()
    const otherId = createCase({ name: 'Shared before' }).id
    await shareCase(otherId, { nodeId: `node-${A.name}` })
    writeSyncStateFile(caseDirOf(otherId), {
      ...readSyncStateFile(caseDirOf(otherId)),
      localVersionHighWater: 40
    })
    const first = Math.max(maxLocalVersion(), 40) + 1
    expect(ownUnsignedRowsInCase(caseId).map(({ table }) => table)).toEqual([...SYNCED_TABLES])

    await shareCase(caseId, { nodeId: `node-${A.name}` })

    expect(parsedChain(ownChainText(caseId)).map((e) => e.type)).toEqual(['capture', 'member-add'])
    expect(getCase(caseId)!.sharedAt).toEqual(expect.any(String))
    const versions = otherRows(w).map(({ table, key }) => {
      expectSignedBy(A, table, key, caseId)
      return syncColumns(table, key).version
    })
    expect(versions).toEqual([0, 1, 2].map((i) => first + i))
    expect(highWater(caseId)).toBe(first + 2)
    expect(highWater(otherId)).toBe(first + 2)
    expect(ownUnsignedRowsInCase(caseId).map(({ table }) => table)).toEqual(TAG_TABLES)
  })

  it.each([
    [
      'signing',
      `CREATE TRIGGER refuse_sign BEFORE UPDATE OF row_signature ON annotation_pins
        BEGIN SELECT RAISE(ABORT, 'sign refused'); END`,
      'refuse_sign',
      /sign refused/
    ],
    [
      'the roster row',
      `CREATE TRIGGER roster_busy BEFORE INSERT ON case_members
        BEGIN SELECT RAISE(ABORT, 'busy'); END`,
      'roster_busy',
      /busy/
    ]
  ])(
    'rolls the signatures, shared_at and the member-add back when %s fails',
    async (_what, trigger, name, message) => {
      const w = await olderRows()
      const chain = ownChainText(caseId)
      getDb().exec(trigger)
      try {
        await expect(shareCase(caseId, { nodeId: `node-${A.name}` })).rejects.toThrow(message)
      } finally {
        getDb().exec(`DROP TRIGGER ${name}`)
      }
      expect(ownChainText(caseId)).toBe(chain)
      expect(getCase(caseId)!.sharedAt).toBeUndefined()
      expect(getCase(caseId)!.ownerInstallationId).toBeUndefined()
      expect(listCaseMembers(caseId)).toEqual([])
      expectUnsigned(keysOf(w))

      await shareCase(caseId, { nodeId: `node-${A.name}` })
      for (const { table, key } of otherRows(w)) expectSignedBy(A, table, key, caseId)
      expectUnsigned(tagRows(w))
    }
  )

  it("leaves received rows, other Cases' rows, signed rows and every older tag as they were", async () => {
    const w = await olderRows()
    const otherId = createCase({ name: 'Never shared' }).id
    mkdirSync(caseDirOf(otherId), { recursive: true })
    const other = await olderRows(otherId, 2)
    // T2 is applied in both Cases, T3 in this one only through a note, T4 nowhere. T5 was
    // written after signing; its older application here is signed with the note it names.
    const t2 = createTag({ name: 'Both Cases' })
    addTagToCapture({ captureId: w.captureId, tagId: t2.id })
    addTagToCapture({ captureId: other.captureId, tagId: t2.id })
    const t3 = createTag({ name: 'On a note' })
    addTagToNote({ noteId: w.noteId, tagId: t3.id })
    const t4 = createTag({ name: 'Never applied' })
    const t5 = createTag({ name: 'Signed since' })
    addTagToNote({ noteId: w.noteId, tagId: t5.id })
    const tagKeys: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'tags', key: { id: t2.id } },
      { table: 'exhibit_tags', key: { exhibit_id: w.captureId, tag_id: t2.id } },
      { table: 'exhibit_tags', key: { exhibit_id: other.captureId, tag_id: t2.id } },
      { table: 'tags', key: { id: t3.id } },
      { table: 'note_tags', key: { note_id: w.noteId, tag_id: t3.id } },
      { table: 'tags', key: { id: t4.id } }
    ]
    const t5Application = { note_id: w.noteId, tag_id: t5.id }
    unsign([...tagKeys, { table: 'note_tags', key: t5Application }])
    // Written after signing on write: already signed.
    const signedNote = createNote({ caseId, title: 'Signed at write', body: 'signed' })
    // A received note and tag application, and an own note carrying a foreign signature.
    cloneNote(w.noteId, 'received-note', { author: 'peer-x', version: 7, signature: 'sig-x' })
    getDb()
      .prepare(
        `INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id, version, row_signature)
         VALUES (?, ?, 'peer-x', 7, 'sig-x')`
      )
      .run(w.captureId, w.tagId)
    cloneNote(w.noteId, 'foreign-signed', { author: null, version: 3, signature: 'sig-other' })

    const untouched: Array<[SyncedTable, RowKey, string | null]> = [
      ['notes', { id: signedNote.id }, null],
      ['notes', { id: 'received-note' }, 'peer-x'],
      ['exhibit_tags', { exhibit_id: w.captureId, tag_id: w.tagId }, 'peer-x'],
      ['notes', { id: 'foreign-signed' }, null],
      ...[...keysOf(other), ...tagRows(w), ...tagKeys].map(
        ({ table, key }): [SyncedTable, RowKey, null] => [table, key, null]
      ),
      ['tags', { id: t5.id }, null]
    ]
    const before = untouched.map(([table, key, author]) => raw(table, key, author))
    expect(before.every((row) => row !== undefined)).toBe(true)

    await shareCase(caseId, { nodeId: `node-${A.name}` })

    expect(untouched.map(([table, key, author]) => raw(table, key, author))).toEqual(before)
    for (const { table, key } of otherRows(w)) expectSignedBy(A, table, key, caseId)
    expectSignedBy(A, 'note_tags', t5Application, caseId)
    expect(
      ownUnsignedRowsInCase(caseId).filter(({ table }) => !TAG_TABLES.includes(table))
    ).toEqual([])
  })

  it('a later invite signs nothing, even a row the first share never saw', async () => {
    await olderRows()
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    await revokeMember(caseId, B.installationId)
    const [anyNote] = listNotes(caseId)
    cloneNote(anyNote.id, 'raw-unsigned', { author: null, version: 0, signature: null })
    const snapshot = (): unknown[] =>
      SYNCED_TABLES.map((table) =>
        getDb().prepare(`SELECT rowid, version, row_signature FROM ${table} ORDER BY rowid`).all()
      )
    const rows = snapshot()
    const mark = highWater(caseId)
    const chain = parsedChain(ownChainText(caseId)).map((e) => e.type)

    await shareCase(caseId, { nodeId: `node-${A.name}` })
    const service = new SharingService({
      receivedCaptures: createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
    })
    const hub = new MemoryHub({ chunkSize: 256 })
    service.setTransportProvider(async () => hub.createTransport('alice-node'))
    try {
      await service.createInvite(caseId)
    } finally {
      await service.close()
    }

    expect(chain).toEqual(['capture', 'member-add', 'member-add', 'member-revoke'])
    expect(parsedChain(ownChainText(caseId)).map((e) => e.type)).toEqual(chain)
    expect(snapshot()).toEqual(rows)
    expect(highWater(caseId)).toBe(mark)
    expectUnsigned([{ table: 'notes', key: { id: 'raw-unsigned' } }])
  })

  // No writer of the app leaves a Case marked shared without the Owner's `member-add`; the
  // state is built by hand. The call that appends the entry does not set `shared_at`, so it
  // signs nothing, as for any invite after the first.
  it('an invite that appends the member-add to a Case already marked shared signs nothing', async () => {
    const w = await olderRows()
    getDb()
      .prepare(
        "UPDATE cases SET shared_at = '2026-10-20T00:00:00.000Z', owner_installation_id = ? WHERE id = ?"
      )
      .run(A.installationId, caseId)

    await shareCase(caseId, { nodeId: `node-${A.name}` })

    expect(parsedChain(ownChainText(caseId)).map((e) => e.type)).toEqual(['capture', 'member-add'])
    expect(getCase(caseId)!.sharedAt).toBe('2026-10-20T00:00:00.000Z')
    expectUnsigned(keysOf(w))
  })

  it('the invite that repairs a share left unrecorded signs the rows above the Case’s recorded mark', async () => {
    const w = await olderRows()
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    const chain = ownChainText(caseId)
    // The crash between the chain append and the database commit: nothing of the share's
    // rows landed.
    getDb()
      .prepare('UPDATE cases SET shared_at = NULL, owner_installation_id = NULL WHERE id = ?')
      .run(caseId)
    getDb().prepare('DELETE FROM case_members WHERE case_id = ?').run(caseId)
    unsign(keysOf(w))
    writeSyncStateFile(caseDirOf(caseId), {
      ...readSyncStateFile(caseDirOf(caseId)),
      localVersionHighWater: 500
    })

    await shareCase(caseId, { nodeId: `node-${A.name}` })

    expect(ownChainText(caseId)).toBe(chain)
    expect(getCase(caseId)!.sharedAt).toEqual(expect.any(String))
    for (const { table, key } of otherRows(w)) {
      expectSignedBy(A, table, key, caseId)
      expect(syncColumns(table, key).version).toBeGreaterThan(500)
    }
    expectUnsigned(tagRows(w))
  })

  it('a Case nobody shares keeps its older rows unsigned while another Case is shared', async () => {
    await olderRows()
    const otherId = createCase({ name: 'Never shared' }).id
    mkdirSync(caseDirOf(otherId), { recursive: true })
    const other = await olderRows(otherId, 2)
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    recordSource(caseId, A)

    expectUnsigned(keysOf(other))
    expect(getCase(otherId)!.sharedAt).toBeUndefined()
    expect(existsSync(join(caseDirOf(otherId), SYNC_STATE_FILENAME))).toBe(false)
  })

  // #1877 (PR #1950): an own live row on a Capture recorded as deleted cannot exist at a first
  // share by the app's writers; built here by hand. Where a member can hold the Capture, the
  // share signs it through the rule a new write meets, which refuses a live row there and
  // signs a tombstone; where no member can, the row is not signed at all.
  it('a live row on a deleted Capture members can hold fails the share closed; a tombstone on one is signed', async () => {
    const w = await olderRows()
    const { captureId: goneId } = await addCapture(caseId, A, 2)
    expect(deleteCapture(goneId, true)).toBe(true)
    const record = getDb().prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)')
    record.run(goneId, caseId)
    record.run('not-in-any-chain', caseId)
    const copyLayer = getDb().prepare(
      `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
         image_height, updated_at, updated_by)
       SELECT ?, schema_version, shapes_json, image_width, image_height, updated_at, updated_by
         FROM annotations WHERE capture_id = ? AND author_installation_id IS NULL`
    )
    copyLayer.run(goneId, w.captureId)
    copyLayer.run('not-in-any-chain', w.captureId)
    const chain = ownChainText(caseId)

    await expect(shareCase(caseId, { nodeId: `node-${A.name}` })).rejects.toThrow(
      new RegExp(`FOREIGN KEY constraint failed: annotations row names Capture ${goneId}`)
    )
    expect(ownChainText(caseId)).toBe(chain)
    expect(getCase(caseId)!.sharedAt).toBeUndefined()
    expectUnsigned([...keysOf(w), { table: 'annotations', key: { capture_id: goneId } }])

    getDb()
      .prepare(
        `UPDATE annotations SET deleted_at = '2026-10-20T00:00:00.000Z'
          WHERE capture_id = ? AND author_installation_id IS NULL`
      )
      .run(goneId)
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    expectSignedBy(A, 'annotations', { capture_id: goneId }, caseId)
    expect(readRow('annotations', { capture_id: goneId }, null)?.deletedAt).toBe(
      '2026-10-20T00:00:00.000Z'
    )
    expectUnsigned([{ table: 'annotations', key: { capture_id: 'not-in-any-chain' } }])
  })

  // Nothing an import records proves who wrote the rows it brought: the header that names the
  // exporter is unsigned, and the chain does not cover the rows. So a Case imported from this
  // installation's own archive is read as any imported Case is, and its loose older note stays
  // local.
  it("a Case imported from this installation's own archive keeps its loose older note unsigned and imported signatures as they were", async () => {
    await activate(A)
    const sourceId = createCase({ name: 'Source' }).id
    mkdirSync(caseDirOf(sourceId), { recursive: true })
    await addCapture(sourceId, A, 1)
    const older = createNote({ caseId: sourceId, title: 'Older', body: 'before signing' })
    unsign([{ table: 'notes', key: { id: older.id } }])
    const signed = createNote({ caseId: sourceId, title: 'Signed', body: 'signed at write' })
    const signedSync = syncColumns('notes', { id: signed.id })
    const archive = join(root, 'source.birdbrain')
    await exportCaseArchive(sourceId, archive)
    const { newCaseId } = await importCaseArchive(archive)
    const byTitle = new Map(listNotes(newCaseId).map((note) => [note.title, note.id]))

    await shareCase(newCaseId, { nodeId: `node-${A.name}` })

    expectUnsigned([{ table: 'notes', key: { id: byTitle.get('Older')! } }])
    expect(syncColumns('notes', { id: byTitle.get('Signed')! })).toEqual(signedSync)
  })

  // An archive's header is not signed, so another installation can name this one as the
  // exporter and the chain still verifies under its own key. Its loose older note stays local.
  it("an archive whose unsigned header names the Owner's installation keeps the exporter's loose older note unsigned", async () => {
    await createPeer(root, 'xavier', 'Xavier Exporter', 'XE')
    const sourceId = createCase({ name: 'Exported by Xavier' }).id
    mkdirSync(caseDirOf(sourceId), { recursive: true })
    const loose = createNote({ caseId: sourceId, title: 'Xavier loose note', body: 'no link' })
    unsign([{ table: 'notes', key: { id: loose.id } }])
    const archive = join(root, 'xavier.birdbrain')
    await exportCaseArchive(sourceId, archive)
    const entries = readStoredZip(readFileSync(archive))
    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    header.source.installationId = A.installationId
    entries.set('package.json', Buffer.from(JSON.stringify(header, null, 2)))
    writeFileSync(archive, createStoredZip([...entries].map(([name, data]) => ({ name, data }))))

    await activate(A)
    const { newCaseId, report } = await importCaseArchive(archive)
    expect(report.verification.overallValid).toBe(true)
    const imports = parsedChain(ownChainText(newCaseId)).filter((e) => e.type === 'import')
    expect(imports.map((e) => e.type === 'import' && e.sourceInstallationId)).toEqual([
      A.installationId
    ])
    const looseId = listNotes(newCaseId).find((note) => note.title === 'Xavier loose note')!.id

    await shareCase(newCaseId, { nodeId: `node-${A.name}` })

    expectUnsigned([{ table: 'notes', key: { id: looseId } }])
  })

  // A legacy html Capture has no chain entry, so no member's copy can hold it (#1877): the
  // rows on it stay local and unsigned, and the rest of the Case's older rows, other than its
  // older tags and their applications, reach the joiner.
  it('rows on a legacy html Capture stay local and unsigned, and the joiner receives the rest', async () => {
    const fresh = await olderRows()
    const legacyId = insertCapture({
      caseId,
      url: 'https://example.com/legacy',
      title: 'Legacy page',
      hash: 'l'.repeat(64),
      timestamp: TIME,
      format: 'html'
    }).id
    const legacy = writeRows(caseId, legacyId, 'Legacy')
    unsign(keysOf(legacy))

    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)

    expectUnsigned([...keysOf(legacy), ...tagRows(fresh)])
    for (const { table, key } of otherRows(fresh)) expectSignedBy(A, table, key, caseId)
    const fromAlice = recordSource(caseId, A)
    const offered = fromAlice.rows.get(A.installationId) ?? []
    expect(offered.filter((row) => Object.values(row.fields).includes(legacyId))).toEqual([])
    expect(offered.some((row) => row.fields.note_id === legacy.noteId)).toBe(false)

    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(caseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(listNotes(caseId).map((note) => note.title)).toEqual(['Alice 1 note'])
    expect(getAnnotations(fresh.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 1 pin'])
    expect(listTags()).toEqual([])
  })

  // A Capture whose entry sits before the chain's `import` never reaches a member (#1877), so
  // a row on it would make every member's session refuse its rows: it stays local and
  // unsigned, and the rest of the Case's older rows other than its older tags travel.
  it('rows on an imported Capture stay local and unsigned, and the joiner receives the rest', async () => {
    await activate(A)
    const sourceId = createCase({ name: 'Before import' }).id
    mkdirSync(caseDirOf(sourceId), { recursive: true })
    await addCapture(sourceId, A, 1)
    const archive = join(root, 'before-import.birdbrain')
    await exportCaseArchive(sourceId, archive)
    const { newCaseId } = await importCaseArchive(archive)
    const [{ id: importedId }] = listCaptures(newCaseId)
    const local = writeRows(newCaseId, importedId, 'Imported')
    unsign(keysOf(local))
    const fresh = await olderRows(newCaseId, 2)

    await shareCase(newCaseId, { nodeId: `node-${A.name}` })
    await addMember(newCaseId, memberOfB(B))
    const roster = listCaseMembers(newCaseId)

    expectUnsigned([...keysOf(local), ...tagRows(fresh)])
    for (const { table, key } of otherRows(fresh)) expectSignedBy(A, table, key, newCaseId)
    const fromAlice = recordSource(newCaseId, A)
    const offered = fromAlice.rows.get(A.installationId) ?? []
    expect(offered.filter((row) => Object.values(row.fields).includes(importedId))).toEqual([])
    expect(offered.some((row) => row.fields.note_id === local.noteId)).toBe(false)

    await activate(B)
    seedSharedCase(newCaseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(newCaseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(listNotes(newCaseId).map((note) => note.title)).toEqual(['Alice 2 note'])
    expect(getAnnotations(fresh.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 2 pin'])
    expect(listTags()).toEqual([])
  })

  // An archive another installation exported carries that installation's own rows with no
  // author, so here they read as this installation's. Only a row that needs a Capture or
  // Exhibit this installation created after the import is known to be its own; the rest stay
  // unsigned, and so does a tag application whose tag stays unsigned.
  it("a Case imported from another installation's archive signs only the Owner's rows on Captures created since", async () => {
    const X = await createPeer(root, 'xavier', 'Xavier Exporter', 'XE')
    const sourceId = createCase({ name: 'Exported by Xavier' }).id
    mkdirSync(caseDirOf(sourceId), { recursive: true })
    const { captureId: xCapture } = await addCapture(sourceId, X, 1)
    const xs = writeRows(sourceId, xCapture, 'Xavier')
    const loose = createNote({ caseId: sourceId, title: 'Xavier loose note', body: 'no link' })
    addTagToNote({ noteId: loose.id, tagId: xs.tagId })
    unsign([
      ...keysOf(xs),
      { table: 'notes', key: { id: loose.id } },
      { table: 'note_tags', key: { note_id: loose.id, tag_id: xs.tagId } }
    ])
    const archive = join(root, 'xavier.birdbrain')
    await exportCaseArchive(sourceId, archive)

    await activate(A)
    const { newCaseId } = await importCaseArchive(archive)
    const fresh = await olderRows(newCaseId, 2)
    const looseId = listNotes(newCaseId).find((note) => note.title === 'Xavier loose note')!.id
    const xTagId = listTags().find((tag) => tag.name === 'Xavier tag')!.id
    await shareCase(newCaseId, { nodeId: `node-${A.name}` })
    await addMember(newCaseId, memberOfB(B))
    const roster = listCaseMembers(newCaseId)

    expectUnsigned([
      { table: 'notes', key: { id: looseId } },
      { table: 'tags', key: { id: xTagId } },
      { table: 'note_tags', key: { note_id: looseId, tag_id: xTagId } },
      ...keysOf(fresh).filter(({ table }) => ['tags', 'exhibit_tags', 'note_tags'].includes(table))
    ])
    for (const { table, key } of keysOf(fresh)) {
      if (!['tags', 'exhibit_tags', 'note_tags'].includes(table)) {
        expectSignedBy(A, table, key, newCaseId)
      }
    }

    const fromAlice = recordSource(newCaseId, A)
    await activate(B)
    seedSharedCase(newCaseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(newCaseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(listNotes(newCaseId).map((note) => note.title)).toEqual(['Alice 2 note'])
    expect(getAnnotations(fresh.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 2 pin'])
    expect(listTags()).toEqual([])
  })

  // A tag from before row signing, the Owner's own or one an archive brought, applied in an
  // imported Case nobody shared yet: the application is signed at write and the tag is not.
  // Whoever wrote the tag cannot be known, so the first share leaves it unsigned.
  it('in an imported Case, an older tag stays unsigned even when a signed application of the Owner names it', async () => {
    const X = await createPeer(root, 'xavier', 'Xavier Exporter', 'XE')
    const sourceId = createCase({ name: 'Exported by Xavier' }).id
    mkdirSync(caseDirOf(sourceId), { recursive: true })
    const { captureId: xCapture } = await addCapture(sourceId, X, 1)
    const xavierTag = createTag({ name: 'Xavier tag' })
    addTagToCapture({ captureId: xCapture, tagId: xavierTag.id })
    unsign([
      { table: 'tags', key: { id: xavierTag.id } },
      { table: 'exhibit_tags', key: { exhibit_id: xCapture, tag_id: xavierTag.id } }
    ])
    const archive = join(root, 'xavier.birdbrain')
    await exportCaseArchive(sourceId, archive)

    await activate(A)
    const important = createTag({ name: 'Important' })
    unsign([{ table: 'tags', key: { id: important.id } }])
    const { newCaseId } = await importCaseArchive(archive)
    const xTagId = listTags().find((tag) => tag.name === 'Xavier tag')!.id
    const { captureId } = await addCapture(newCaseId, A, 2)
    const note = createNote({ caseId: newCaseId, captureId, title: 'Fresh note', body: 'body' })
    addTagToCapture({ captureId, tagId: important.id })
    addTagToNote({ noteId: note.id, tagId: xTagId })
    expectUnsigned([
      { table: 'tags', key: { id: important.id } },
      { table: 'tags', key: { id: xTagId } }
    ])

    await shareCase(newCaseId, { nodeId: `node-${A.name}` })
    await addMember(newCaseId, memberOfB(B))
    expectUnsigned([
      { table: 'tags', key: { id: important.id } },
      { table: 'tags', key: { id: xTagId } }
    ])
    const offered = recordSource(newCaseId, A).rows.get(A.installationId) ?? []
    expect(offered.some(({ table }) => table === 'tags')).toBe(false)
  })

  // A row of the Owner signed after the upgrade can carry a signature that no longer covers
  // it: deleting a Capture from a Case nobody shared clears a note's link and re-signs nothing
  // (#1877), and a row edited outside the app's writers keeps its old signature. A member
  // refuses that row, so an older tag application naming it would land without it and fail
  // the deferred key, refusing every row of the session: it stays local and unsigned.
  it('an older tag application whose note or tag carries a stale signature stays unsigned, and the joiner receives the rest', async () => {
    const w = await olderRows()
    const { captureId: goneId } = await addCapture(caseId, A, 2)
    const edited = createNote({ caseId, captureId: goneId, title: 'Edited', body: 'older' })
    const onEdited = createTag({ name: 'On the edited note' })
    addTagToNote({ noteId: edited.id, tagId: onEdited.id })
    const recoloured = createTag({ name: 'Recoloured' })
    addTagToCapture({ captureId: w.captureId, tagId: recoloured.id })
    const children: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'note_tags', key: { note_id: edited.id, tag_id: onEdited.id } },
      { table: 'exhibit_tags', key: { exhibit_id: w.captureId, tag_id: recoloured.id } }
    ]
    unsign([
      { table: 'notes', key: { id: edited.id } },
      { table: 'tags', key: { id: recoloured.id } },
      ...children
    ])
    updateNote({ id: edited.id, body: 'edited after the upgrade' })
    expect(await lifecycle().delete(goneId)).toBe(true)
    expect(readRow('notes', { id: edited.id }, null)?.fields.capture_id).toBeNull()
    signLocalRow('tags', { id: recoloured.id })
    getDb().prepare("UPDATE tags SET color = '#123456' WHERE id = ?").run(recoloured.id)

    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)

    expectUnsigned([...children, ...tagRows(w)])
    for (const { table, key } of otherRows(w)) expectSignedBy(A, table, key, caseId)

    const fromAlice = recordSource(caseId, A)
    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(caseId, fromAlice)
    expect(refusedAs(result.errors)).toEqual([
      'notes row: invalid signature',
      'tags row: invalid signature'
    ])
    expect(listNotes(caseId).map((note) => note.title)).toEqual(['Alice 1 note'])
    expect(listTags().map((tag) => tag.name)).toEqual(['On the edited note'])
    expect(getTagsForCapture(w.captureId)).toEqual([])
    expect(getAnnotations(w.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 1 pin'])
  })

  // An application older than signing whose tag was written since, and so signed, is the
  // Owner's and reaches the joiner; one naming an older tag stays local with that tag.
  it('an older tag application on a Document Exhibit reaches the joiner when its tag is signed', async () => {
    await activate(A)
    const doc = addDocument(caseId, A, 1)
    insertExhibit({
      id: doc.exhibitId,
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: `${doc.exhibitId}.pdf`,
      contentHash: doc.contentHash,
      path: doc.path,
      committedAt: TIME,
      manifestSeq: doc.index,
      exhibitNumber: 1
    })
    const tag = createTag({ name: 'On a document' })
    const olderTag = createTag({ name: 'Older on a document' })
    addTagToCapture({ captureId: doc.exhibitId, tagId: tag.id })
    addTagToCapture({ captureId: doc.exhibitId, tagId: olderTag.id })
    const application = { exhibit_id: doc.exhibitId, tag_id: tag.id }
    const olderKeys: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'tags', key: { id: olderTag.id } },
      { table: 'exhibit_tags', key: { exhibit_id: doc.exhibitId, tag_id: olderTag.id } }
    ]
    unsign([{ table: 'exhibit_tags', key: application }, ...olderKeys])

    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    expectSignedBy(A, 'tags', { id: tag.id }, null)
    expectSignedBy(A, 'exhibit_tags', application, caseId)
    expectUnsigned(olderKeys)

    const fromAlice = recordSource(caseId, A)
    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(caseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(getTagsForCapture(doc.exhibitId).map(({ name }) => name)).toEqual(['On a document'])
  })

  // A tag from before row signing stays unsigned when this installation applies it later in a
  // Shared Case, by any apply path, as before #1910: its writer cannot be known. Each
  // application is signed at write, as any new write is.
  it('applying an unsigned tag of this installation in a Shared Case leaves the tag unsigned', async () => {
    await activate(A)
    const { captureId } = await addCapture(caseId, A, 1)
    const note = createNote({ caseId, title: 'Tagged later', body: 'body' })
    const [onCapture, onNote, inBatch, mergedInto] = [
      'On a capture',
      'On a note',
      'In a batch',
      'Merged into'
    ].map((name) => createTag({ name }))
    const olderTags = [onCapture, onNote, inBatch, mergedInto].map(({ id }) => ({
      table: 'tags' as const,
      key: { id }
    }))
    unsign(olderTags)
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    const source = createTag({ name: 'Merged away' })
    addTagToNote({ noteId: note.id, tagId: source.id })

    addTagToCapture({ captureId, tagId: onCapture.id })
    addTagToNote({ noteId: note.id, tagId: onNote.id })
    addTagToCaptures([captureId], inBatch.id)
    mergeTags({ sourceId: source.id, targetId: mergedInto.id })

    expectUnsigned(olderTags)
    expectSignedBy(A, 'exhibit_tags', { exhibit_id: captureId, tag_id: onCapture.id }, caseId)
    expectSignedBy(A, 'exhibit_tags', { exhibit_id: captureId, tag_id: inBatch.id }, caseId)
    expectSignedBy(A, 'note_tags', { note_id: note.id, tag_id: onNote.id }, caseId)
    expectSignedBy(A, 'note_tags', { note_id: note.id, tag_id: mergedInto.id }, caseId)
  })

  // Every installation seeds the demo Case from one archive, so its tags carry the same ids on
  // every copy, with no author and no signature. Signed under the Owner's key, such a tag
  // would land on a member who seeded the demo Case too beside that member's own row of the
  // same id, and every session would roll back (ruling of 22 October 2026).
  // Seeds the demo Case on the peer, leaving it active, and returns its stored "nightjar".
  async function seedDemo(peer: Peer): Promise<unknown> {
    await activate(peer)
    await importCaseArchive(DEMO_ARCHIVE, { operatorName: DEMO_CASE_OPERATOR_NAME })
    expect(listTags().find((tag) => tag.name === 'nightjar')?.id).toBe(NIGHTJAR)
    expect(readRow('tags', { id: NIGHTJAR }, null)?.signature).toBeNull()
    return raw('tags', { id: NIGHTJAR })
  }

  it("an older tag both peers seeded from the demo Case stays unsigned, and the member's sessions succeed", async () => {
    const bobsNightjar = await seedDemo(B)
    await seedDemo(A)
    const { captureId } = await addCapture(caseId, A, 1)
    const note = createNote({ caseId, captureId, title: 'Nightjar at dusk', body: 'older' })
    addTagToNote({ noteId: note.id, tagId: NIGHTJAR })
    const older: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'notes', key: { id: note.id } },
      { table: 'note_tags', key: { note_id: note.id, tag_id: NIGHTJAR } }
    ]
    unsign(older)

    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    expectSignedBy(A, 'notes', { id: note.id }, caseId)
    expectUnsigned([older[1]])
    expect(readRow('tags', { id: NIGHTJAR }, null)?.signature).toBeNull()
    const first = recordSource(caseId, A)
    expect((first.rows.get(A.installationId) ?? []).map(({ table }) => table)).toEqual(['notes'])

    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    expect((await pull(caseId, first)).errors).toEqual([])
    expect(listNotes(caseId).map(({ title }) => title)).toEqual(['Nightjar at dusk'])

    // Applied after the share, the application is signed at write and the tag still is not.
    await activate(A)
    addTagToCapture({ captureId, tagId: NIGHTJAR })
    expect(readRow('tags', { id: NIGHTJAR }, null)?.signature).toBeNull()
    const second = recordSource(caseId, A)
    expect((second.rows.get(A.installationId) ?? []).some(({ table }) => table === 'tags')).toBe(
      false
    )

    await activate(B)
    expect((await pull(caseId, second)).errors).toEqual([])
    expect(getTagsForCapture(captureId).map(({ name }) => name)).toEqual(['nightjar'])
    expect(raw('tags', { id: NIGHTJAR })).toEqual(bobsNightjar)
    expect(raw('tags', { id: NIGHTJAR }, A.installationId)).toBeUndefined()
  })

  // No later write signs an older tag either (ruling of 22 October 2026): a rename, a recolour,
  // a deletion or a merge leaves it unsigned, so it never lands beside a member's own row of its
  // id. Its unsigned applications are removed outright; where a Shared Case still applies it,
  // it keeps an unsigned tombstone, and naming it again restores it unsigned.
  it("editing, deleting or merging an older tag leaves it unsigned, and the member's sessions succeed", async () => {
    const bobsNightjar = await seedDemo(B)
    await seedDemo(A)
    const { captureId } = await addCapture(caseId, A, 1)
    const note = createNote({ caseId, captureId, title: 'Nightjar at dusk', body: 'older' })
    addTagToNote({ noteId: note.id, tagId: NIGHTJAR })
    const older = createTag({ name: 'Older' })
    addTagToCapture({ captureId, tagId: older.id })
    const olderApplications: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'note_tags', key: { note_id: note.id, tag_id: NIGHTJAR } },
      { table: 'exhibit_tags', key: { exhibit_id: captureId, tag_id: older.id } }
    ]
    unsign([
      { table: 'notes', key: { id: note.id } },
      { table: 'tags', key: { id: older.id } },
      ...olderApplications
    ])
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    addTagToCapture({ captureId, tagId: NIGHTJAR })

    updateTag({ id: NIGHTJAR, color: '#000000' })
    updateTag({ id: older.id, name: 'Older renamed' })

    const olderTags = [NIGHTJAR, older.id].map((id) => ({ table: 'tags' as const, key: { id } }))
    expectUnsigned(olderTags)
    const first = recordSource(caseId, A)
    expect((first.rows.get(A.installationId) ?? []).some(({ table }) => table === 'tags')).toBe(
      false
    )
    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    expect((await pull(caseId, first)).errors).toEqual([])

    await activate(A)
    const target = createTag({ name: 'Merged into' })
    expect(deleteTag(NIGHTJAR)).toBe(true)
    mergeTags({ sourceId: older.id, targetId: target.id })

    // "nightjar" keeps a tombstone for its signed application; nothing applies "Older" now.
    expectUnsigned([olderTags[0]])
    expect(readRow('tags', { id: NIGHTJAR }, null)?.deletedAt).not.toBeNull()
    expect(readRow('tags', { id: older.id }, null)).toBeUndefined()
    for (const { table, key } of olderApplications)
      expect(readRow(table, key, null)).toBeUndefined()
    const second = recordSource(caseId, A)
    const offeredTags = (second.rows.get(A.installationId) ?? []).filter(
      ({ table }) => table === 'tags'
    )
    expect(offeredTags.map(({ fields }) => fields.id)).toEqual([target.id])
    await activate(B)
    expect((await pull(caseId, second)).errors).toEqual([])
    expect(getTagsForCapture(captureId).map(({ name }) => name)).toEqual(['Merged into'])
    expect(raw('tags', { id: NIGHTJAR })).toEqual(bobsNightjar)

    await activate(A)
    expect(createTag({ name: 'nightjar' }).id).toBe(NIGHTJAR)
    expect(readRow('tags', { id: NIGHTJAR }, null)).toMatchObject({
      deletedAt: null,
      signature: null
    })
  })
})
