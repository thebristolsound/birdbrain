import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { deleteCapture, listCaptures } from '@main/services/db/captureRepo'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote, listNotes, updateNote } from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  addTagToCaptures,
  addTagToNote,
  createTag,
  getTagsForCapture,
  getTagsForNote,
  listTags,
  mergeTags
} from '@main/services/db/tagRepo'
import { getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
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
  caseDirOf,
  createPeer,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// The Owner's rows written before rows were signed (#1910, ruling of 21 October 2026): the
// first share signs this installation's unsigned notes, tags, tag applications, annotation
// layers and pins of the Case, in the transaction that writes the Owner's roster row from its
// `member-add`, each at a fresh version, so a member's first sync receives them. Rows on a
// Capture or Exhibit no member can hold stay local and unsigned. Content is invented.

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

  it("a member's first sync receives the Owner's notes, tags, tag applications, annotations and pins written before signing", async () => {
    const w = await olderRows()
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    const fromAlice = recordSource(caseId, A)
    expect((fromAlice.rows.get(A.installationId) ?? []).map((row) => row.table).sort()).toEqual(
      [...SYNCED_TABLES].sort()
    )

    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    const result = await pull(caseId, fromAlice)
    expect(result.errors).toEqual([])
    expect(result.capturesApplied).toBe(1)
    expect(result.rowsApplied).toBe(6)
    expect(listNotes(caseId).map((note) => [note.id, note.title])).toEqual([
      [w.noteId, 'Alice 1 note']
    ])
    expect(getTagsForCapture(w.captureId).map((tag) => tag.name)).toEqual(['Alice 1 tag'])
    expect(getTagsForNote(w.noteId).map((tag) => tag.name)).toEqual(['Alice 1 tag'])
    const { annotations, pins } = getAnnotations(w.captureId)
    expect(annotations).not.toBeNull()
    expect(pins.map((pin) => pin.body)).toEqual(['Alice 1 pin'])
    for (const { table, key } of keysOf(w)) {
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
    const versions = keysOf(w).map(({ table, key }) => {
      expectSignedBy(A, table, key, table === 'tags' ? null : caseId)
      return syncColumns(table, key).version
    })
    expect(versions).toEqual([0, 1, 2, 3, 4, 5].map((i) => first + i))
    expect(highWater(caseId)).toBe(first + 5)
    expect(highWater(otherId)).toBe(first + 5)
    expect(ownUnsignedRowsInCase(caseId)).toEqual([])
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
      for (const { table, key } of keysOf(w)) {
        expectSignedBy(A, table, key, table === 'tags' ? null : caseId)
      }
    }
  )

  it("leaves received rows, other Cases' rows and signed rows as they were, and signs only the tags the Case's applications name", async () => {
    const w = await olderRows()
    const otherId = createCase({ name: 'Never shared' }).id
    mkdirSync(caseDirOf(otherId), { recursive: true })
    const other = await olderRows(otherId, 2)
    // T2 is applied in both Cases, T3 in this one only through a note, T4 nowhere.
    const t2 = createTag({ name: 'Both Cases' })
    addTagToCapture({ captureId: w.captureId, tagId: t2.id })
    addTagToCapture({ captureId: other.captureId, tagId: t2.id })
    const t3 = createTag({ name: 'On a note' })
    addTagToNote({ noteId: w.noteId, tagId: t3.id })
    const t4 = createTag({ name: 'Never applied' })
    const tagKeys: Array<{ table: SyncedTable; key: RowKey }> = [
      { table: 'tags', key: { id: t2.id } },
      { table: 'exhibit_tags', key: { exhibit_id: w.captureId, tag_id: t2.id } },
      { table: 'exhibit_tags', key: { exhibit_id: other.captureId, tag_id: t2.id } },
      { table: 'tags', key: { id: t3.id } },
      { table: 'note_tags', key: { note_id: w.noteId, tag_id: t3.id } },
      { table: 'tags', key: { id: t4.id } }
    ]
    unsign(tagKeys)
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
      ...keysOf(other).map(({ table, key }): [SyncedTable, RowKey, null] => [table, key, null]),
      ['exhibit_tags', { exhibit_id: other.captureId, tag_id: t2.id }, null],
      ['tags', { id: t4.id }, null]
    ]
    const before = untouched.map(([table, key, author]) => raw(table, key, author))
    expect(before.every((row) => row !== undefined)).toBe(true)

    await shareCase(caseId, { nodeId: `node-${A.name}` })

    expect(untouched.map(([table, key, author]) => raw(table, key, author))).toEqual(before)
    for (const { table, key } of keysOf(w)) {
      expectSignedBy(A, table, key, table === 'tags' ? null : caseId)
    }
    expectSignedBy(A, 'tags', { id: t2.id }, null)
    expectSignedBy(A, 'exhibit_tags', { exhibit_id: w.captureId, tag_id: t2.id }, caseId)
    expectSignedBy(A, 'tags', { id: t3.id }, null)
    expectSignedBy(A, 'note_tags', { note_id: w.noteId, tag_id: t3.id }, caseId)
    // Other's own tag is applied only there.
    expectUnsigned([
      { table: 'tags', key: { id: other.tagId } },
      { table: 'tags', key: { id: t4.id } }
    ])
    expect(ownUnsignedRowsInCase(caseId)).toEqual([])
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
    for (const { table, key } of keysOf(w)) {
      expectSignedBy(A, table, key, table === 'tags' ? null : caseId)
      expect(syncColumns(table, key).version).toBeGreaterThan(500)
    }
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

  it("a fork signs its unsigned imported rows under the forker's key and keeps imported signatures", async () => {
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

    expectSignedBy(A, 'notes', { id: byTitle.get('Older')! }, newCaseId)
    expect(syncColumns('notes', { id: byTitle.get('Signed')! })).toEqual(signedSync)
  })

  // A Capture whose entry sits before the chain's `import` never reaches a member (#1877), so
  // a row on it would make every member's session refuse its rows: it stays local and
  // unsigned, and the rest of the Case's older rows travel.
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

    expectUnsigned(keysOf(local).filter(({ table }) => table !== 'tags'))
    for (const { table, key } of keysOf(fresh)) {
      expectSignedBy(A, table, key, table === 'tags' ? null : newCaseId)
    }
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
    expect(getTagsForCapture(fresh.captureId).map((tag) => tag.name)).toEqual(['Alice 2 tag'])
    expect(getAnnotations(fresh.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 2 pin'])
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
      { table: 'tags', key: { id: onEdited.id } },
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

    expectUnsigned(children)
    for (const { table, key } of keysOf(w)) {
      expectSignedBy(A, table, key, table === 'tags' ? null : caseId)
    }

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
    expect(getTagsForCapture(w.captureId).map((tag) => tag.name)).toEqual(['Alice 1 tag'])
    expect(getTagsForNote(w.noteId).map((tag) => tag.name)).toEqual(['Alice 1 tag'])
    expect(getAnnotations(w.captureId).pins.map((pin) => pin.body)).toEqual(['Alice 1 pin'])
  })

  // A tag from before row signing that no application in the Case named at its first share
  // stays unsigned; applied in the Shared Case later, it would leave a member's copy with an
  // application whose tag never arrives, and the deferred tag key would refuse every row of
  // that session. Each apply path signs it with the application.
  it('applying an unsigned tag of this installation in a Shared Case signs the tag, and a member receives the application', async () => {
    await activate(A)
    const { captureId } = await addCapture(caseId, A, 1)
    const note = createNote({ caseId, title: 'Tagged later', body: 'body' })
    const otherId = createCase({ name: 'Never shared' }).id
    mkdirSync(caseDirOf(otherId), { recursive: true })
    const { captureId: otherCapture } = await addCapture(otherId, A, 2)
    const [onCapture, onNote, inBatch, mergedInto, elsewhere] = [
      'On a capture',
      'On a note',
      'In a batch',
      'Merged into',
      'Elsewhere'
    ].map((name) => createTag({ name }))
    unsign(
      [onCapture, onNote, inBatch, mergedInto, elsewhere].map(({ id }) => ({
        table: 'tags' as const,
        key: { id }
      }))
    )
    await shareCase(caseId, { nodeId: `node-${A.name}` })
    expectUnsigned([{ table: 'tags', key: { id: onCapture.id } }])
    const source = createTag({ name: 'Merged away' })
    addTagToNote({ noteId: note.id, tagId: source.id })

    addTagToCapture({ captureId, tagId: onCapture.id })
    addTagToNote({ noteId: note.id, tagId: onNote.id })
    addTagToCaptures([captureId], inBatch.id)
    mergeTags({ sourceId: source.id, targetId: mergedInto.id })
    addTagToCapture({ captureId: otherCapture, tagId: elsewhere.id })

    for (const tag of [onCapture, onNote, inBatch, mergedInto]) {
      expectSignedBy(A, 'tags', { id: tag.id }, null)
    }
    expectUnsigned([{ table: 'tags', key: { id: elsewhere.id } }])

    await addMember(caseId, memberOfB(B))
    const roster = listCaseMembers(caseId)
    const fromAlice = recordSource(caseId, A)
    await activate(B)
    seedSharedCase(caseId, A, [])
    for (const member of roster) upsertCaseMember(member)
    expect((await pull(caseId, fromAlice)).errors).toEqual([])
    expect(getTagsForCapture(captureId).map((tag) => tag.name)).toEqual([
      'In a batch',
      'On a capture'
    ])
    expect(getTagsForNote(note.id).map((tag) => tag.name)).toEqual(['Merged into', 'On a note'])
  })
})
