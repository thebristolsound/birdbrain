import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaptures } from '@main/services/db/captureRepo'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  createTag,
  getTagCountsForCaptures,
  getTagUsageCountsForCase,
  getTagsForCapture
} from '@main/services/db/tagRepo'
import { deletePin, getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import {
  maxAuthorVersionInCase,
  readRow,
  type RowKey,
  type SyncedTable
} from '@main/services/db/workingRowRepo'
import { toWireRows, verifyWireRow } from '@main/services/sharing/workingRows'
import type { WireRow } from '@main/services/sharing/messages'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  activate,
  addCapture,
  appendOwnChainLine,
  createPeer,
  memberAddBody,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// Rows on a deleted Capture (#1877, ruling of 21 October 2026): a copy never
// changes or removes another member's signed row. When a Capture is deleted,
// by its author or by a copy applying the author's deletion, every other
// member's annotation layer, pin, tag application and note on it stays as
// signed, hidden with the Capture, still passed on under its author's
// signature, and changed only by that author's later write. The deleting
// copy tombstones its own rows on the Capture. Content is invented.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001877'
const TABLES: SyncedTable[] = ['notes', 'tags', 'exhibit_tags', 'annotations', 'annotation_pins']

interface Written {
  captureId: string
  tagId: string
  pinId: string
  noteId: string
}

// One member's annotation layer, pin, tag (applied only here) and note on a
// Capture, written on the active peer.
function writeRowsOn(captureId: string, label: string): Written {
  saveAnnotations({ captureId, shapes: [], imageWidth: 800, imageHeight: 600 })
  const pin = upsertPin({ captureId, body: `${label} pin` })
  const tag = createTag({ name: `${label} tag` })
  addTagToCapture({ captureId, tagId: tag.id })
  const note = createNote({
    caseId: CASE_ID,
    captureId,
    title: `${label} note`,
    body: `${label} wrote this`,
    anchor: JSON.stringify({ kind: 'capture', captureId })
  })
  return { captureId, tagId: tag.id, pinId: pin.id, noteId: note.id }
}

function keysOf(w: Written): Array<{ table: SyncedTable; key: RowKey }> {
  return [
    { table: 'annotations', key: { capture_id: w.captureId } },
    { table: 'annotation_pins', key: { id: w.pinId } },
    { table: 'exhibit_tags', key: { exhibit_id: w.captureId, tag_id: w.tagId } },
    { table: 'tags', key: { id: w.tagId } },
    { table: 'notes', key: { id: w.noteId } }
  ]
}

// Every row an author holds on the active peer, raw and with its rowid.
function rawRowsOf(author: string): Record<string, unknown[]> {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      getDb()
        .prepare(
          `SELECT rowid AS stored_rowid, * FROM ${table}
            WHERE author_installation_id = ? ORDER BY rowid`
        )
        .all(author)
    ])
  )
}

// The row as the active peer would serve it, checked under its author's key.
function served(table: SyncedTable, key: RowKey, author: Peer, local: Peer): WireRow {
  const own = author.installationId === local.installationId
  const stored = readRow(table, key, own ? null : author.installationId)
  expect(stored, `${table} ${JSON.stringify(key)} of ${author.name}`).toBeDefined()
  const [wire] = toWireRows([stored!], local.installationId)
  expect(verifyWireRow(wire, author.publicKeyPem), `${table} verifies under ${author.name}`).toBe(
    true
  )
  return wire
}

const deletedCaptures = (): Array<{ id: string; case_id: string }> =>
  getDb().prepare('SELECT id, case_id FROM deleted_captures ORDER BY id').all() as Array<{
    id: string
    case_id: string
  }>

// What every screen reader returns for a deleted Capture: nothing.
function expectHidden(w: Written): void {
  expect(getAnnotations(w.captureId)).toEqual({ annotations: null, pins: [] })
  expect(getTagsForCapture(w.captureId)).toEqual([])
  expect(getTagCountsForCaptures([w.captureId])).toEqual({})
  expect(getTagUsageCountsForCase(CASE_ID)[w.tagId]).toBeUndefined()
  expect(listCaptures(CASE_ID).map((c) => c.id)).not.toContain(w.captureId)
}

describe('rows on a deleted Capture (#1877)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer

  const lifecycle = () =>
    createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-deleted-capture-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    C = await createPeer(root, 'carol', 'Carol Member', 'CA')
    for (const peer of [A, B, C]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B, C])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, C, 'member', A))
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  // Alice's Capture with Bob's rows on it, pulled back to Alice, and Alice's
  // own rows beside them. Leaves Alice active.
  async function aliceHoldsBobsRows(): Promise<{ bob: Written; alice: Written }> {
    await activate(A)
    const { captureId } = await addCapture(CASE_ID, A, 1)
    const fromAlice = recordSource(CASE_ID, A)
    await activate(B)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    const bob = writeRowsOn(captureId, 'Bob')
    const fromBob = recordSource(CASE_ID, B)
    await activate(A)
    expect((await pull(CASE_ID, fromBob)).errors).toEqual([])
    const alice = writeRowsOn(captureId, 'Alice')
    return { bob, alice }
  }

  it("a member deleting their own Capture keeps every other member's row on it as signed, hidden and served", async () => {
    const { bob, alice } = await aliceHoldsBobsRows()
    const before = rawRowsOf(B.installationId)
    const cursorBefore = maxAuthorVersionInCase(CASE_ID, B.installationId)

    expect(await lifecycle().delete(bob.captureId)).toBe(true)

    expect(rawRowsOf(B.installationId)).toEqual(before)
    for (const { table, key } of keysOf(bob)) {
      const wire = served(table, key, B, A)
      expect(wire.caseId).toBe(table === 'tags' ? null : CASE_ID)
    }
    const ownVersions = new Set<number>()
    for (const { table, key } of keysOf(alice).filter(({ table }) =>
      ['annotations', 'annotation_pins', 'exhibit_tags'].includes(table)
    )) {
      const own = readRow(table, key, null)!
      expect(own.deletedAt, `${table} tombstoned`).not.toBeNull()
      ownVersions.add(own.version)
      expect(served(table, key, A, A).caseId).toBe(CASE_ID)
    }
    expect(ownVersions.size).toBe(1)
    expect(getNote(alice.noteId)?.captureId).toBe(alice.captureId)
    expect(readRow('notes', { id: alice.noteId }, null)?.deletedAt).toBeNull()

    expectHidden(bob)
    expect(listNotes(CASE_ID).find((n) => n.id === bob.noteId)?.captureId).toBe(bob.captureId)
    expect(deletedCaptures()).toEqual([{ id: bob.captureId, case_id: CASE_ID }])
    const offered = recordSource(CASE_ID, A).rows.get(B.installationId)!
    expect([...new Set(offered.map((r) => r.table))].sort()).toEqual([...TABLES].sort())
    expect(maxAuthorVersionInCase(CASE_ID, B.installationId)).toBe(cursorBefore)
  })

  it("a receiver applying the author's deletion keeps the other members' rows and tombstones only its own", async () => {
    await activate(A)
    const { captureId } = await addCapture(CASE_ID, A, 1)
    const alice = writeRowsOn(captureId, 'Alice')
    const fromAlice = recordSource(CASE_ID, A)
    await activate(C)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    const carol = writeRowsOn(captureId, 'Carol')
    const fromCarol = recordSource(CASE_ID, C)
    await activate(B)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    expect((await pull(CASE_ID, fromCarol)).errors).toEqual([])
    const bob = writeRowsOn(captureId, 'Bob')
    const carolsBefore = rawRowsOf(C.installationId)

    await activate(A)
    expect(await lifecycle().delete(captureId)).toBe(true)
    const deleted = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, deleted)
    expect(result.errors).toEqual([])
    expect(result.removed).toBe(1)

    expect(rawRowsOf(C.installationId)).toEqual(carolsBefore)
    for (const { table, key } of keysOf(carol)) served(table, key, C, B)
    for (const table of ['annotations', 'annotation_pins', 'exhibit_tags'] as const) {
      const key = keysOf(alice).find((k) => k.table === table)!.key
      expect(readRow(table, key, A.installationId)?.deletedAt, `Alice's ${table}`).not.toBeNull()
      served(table, key, A, B)
      const own = keysOf(bob).find((k) => k.table === table)!.key
      expect(readRow(table, own, null)?.deletedAt, `Bob's ${table}`).not.toBeNull()
      served(table, own, B, B)
    }
    expect(getNote(bob.noteId)?.captureId).toBe(captureId)
    expect(deletedCaptures()).toEqual([{ id: captureId, case_id: CASE_ID }])
    expectHidden(carol)
  })

  it("a copy that never held the Capture records its deletion from the author's chain and accepts the rows passed on", async () => {
    const { bob } = await aliceHoldsBobsRows()
    expect(await lifecycle().delete(bob.captureId)).toBe(true)
    const deleted = recordSource(CASE_ID, A)

    await activate(C)
    const first = await pull(CASE_ID, deleted)
    expect(first.errors).toEqual([])
    expect(first.capturesApplied).toBe(0)
    expect(deletedCaptures()).toEqual([{ id: bob.captureId, case_id: CASE_ID }])
    for (const { table, key } of keysOf(bob)) served(table, key, B, C)
    expect(listNotes(CASE_ID).map((n) => n.id)).toContain(bob.noteId)
    const offered = recordSource(CASE_ID, C).rows.get(B.installationId)!
    expect([...new Set(offered.map((r) => r.table))].sort()).toEqual([...TABLES].sort())
    expectHidden(bob)

    const second = await pull(CASE_ID, deleted)
    expect(second.errors).toEqual([])
    expect(second.rowsApplied).toBe(0)
  })

  it("each author's later delete of their own row on the deleted Capture applies on every copy", async () => {
    await activate(A)
    const { captureId } = await addCapture(CASE_ID, A, 1)
    const fromAlice = recordSource(CASE_ID, A)
    await activate(C)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    await activate(B)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    const bob = writeRowsOn(captureId, 'Bob')
    const second = createNote({ caseId: CASE_ID, captureId, title: 'Second', body: 'more' })
    const fromBob = recordSource(CASE_ID, B)
    await activate(A)
    expect((await pull(CASE_ID, fromBob)).errors).toEqual([])
    await activate(C)
    expect((await pull(CASE_ID, fromBob)).errors).toEqual([])

    // Bob removes his pin while the Capture is still there.
    await activate(B)
    deletePin(bob.pinId)

    await activate(A)
    expect(await lifecycle().delete(captureId)).toBe(true)
    const deleted = recordSource(CASE_ID, A)
    await activate(B)
    const applied = await pull(CASE_ID, deleted)
    expect(applied.errors).toEqual([])
    expect(applied.removed).toBe(1)
    // Applying the deletion tombstoned Bob's own layer and application.
    expect(readRow('annotations', { capture_id: captureId }, null)?.deletedAt).not.toBeNull()
    expect(
      readRow('exhibit_tags', { exhibit_id: captureId, tag_id: bob.tagId }, null)?.deletedAt
    ).not.toBeNull()
    expect(deleteNote(bob.noteId)).toBe(true)
    expect(updateNote({ id: second.id, title: 'Second, edited' })?.title).toBe('Second, edited')
    const later = recordSource(CASE_ID, B)

    for (const copy of [A, C]) {
      await activate(copy)
      const result = await pull(CASE_ID, later)
      expect(result.errors, copy.name).toEqual([])
      for (const { table, key } of keysOf(bob).filter(({ table }) => table !== 'tags')) {
        expect(
          readRow(table, key, B.installationId)?.deletedAt,
          `${table} on ${copy.name}`
        ).not.toBeNull()
        served(table, key, B, copy)
      }
      expect(readRow('notes', { id: second.id }, B.installationId)?.fields.title).toBe(
        'Second, edited'
      )
      served('notes', { id: second.id }, B, copy)
      expectHidden(bob)
    }
  })

  // Only the record is rebuilt. The deletion here is a v41 one with its record removed, so the
  // rows on the Capture are as signed; a real v40 deletion also cascaded them away and nulled
  // the notes' links, and nothing repairs those rows.
  it('a copy whose deletion left no record, as one before migration 41 did, records it from its chain', async () => {
    await activate(A)
    const { captureId } = await addCapture(CASE_ID, A, 1)
    const fromAlice = recordSource(CASE_ID, A)
    await activate(C)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    const carol = writeRowsOn(captureId, 'Carol')
    const fromCarol = recordSource(CASE_ID, C)
    await activate(B)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    expect((await pull(CASE_ID, fromCarol)).errors).toEqual([])

    // A deletion made before v41 left no record behind; the rows on it stay here.
    await activate(A)
    expect(await lifecycle().delete(captureId)).toBe(true)
    getDb().prepare('DELETE FROM deleted_captures').run()
    const deleted = recordSource(CASE_ID, A)
    await activate(B)
    expect((await pull(CASE_ID, deleted)).errors).toEqual([])
    const fromBob = recordSource(CASE_ID, B)

    await activate(A)
    const back = await pull(CASE_ID, fromBob)
    expect(back.errors).toEqual([])
    expect(deletedCaptures()).toEqual([{ id: captureId, case_id: CASE_ID }])
    for (const { table, key } of keysOf(carol)) served(table, key, C, A)

    // The same from a member chain: Carol applied the deletion, and lost the record.
    await activate(C)
    expect((await pull(CASE_ID, deleted)).errors).toEqual([])
    getDb().prepare('DELETE FROM deleted_captures').run()
    const again = await pull(CASE_ID, fromBob)
    expect(again.errors).toEqual([])
    expect(deletedCaptures()).toEqual([{ id: captureId, case_id: CASE_ID }])
  })
})
