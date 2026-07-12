import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDatabase,
  closeDatabase,
  createCase,
  updateCase,
  insertCapture,
  deleteCapture,
  deleteCase,
  searchCaptures,
  getCaptureTextContent
} from '@main/services/database'
import { deleteRow, purgeArchived, vacuumDb } from '@main/services/db/dbAdmin'

function makeCapture(caseId: string, text: string, title = 'T') {
  return insertCapture({
    caseId,
    url: 'https://x.example',
    title,
    hash: 'h',
    timestamp: '2026-01-01T00:00:00Z',
    textContent: text,
    format: 'mhtml'
  })
}

describe('capture_texts keeps captures_fts in sync', () => {
  beforeEach(() => initDatabase(':memory:'))
  afterEach(() => closeDatabase())

  it('insert → searchable via trigger', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const cap = makeCapture(c.id, 'unique zebra text')
    expect(searchCaptures('zebra').map((x) => x.id)).toEqual([cap.id])
  })

  it('deleteCapture cleans the index', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const cap = makeCapture(c.id, 'unique zebra text')
    deleteCapture(cap.id)
    expect(searchCaptures('zebra')).toEqual([])
  })

  it('deleteCase cascade cleans the index (migration-12 bug class)', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    makeCapture(c.id, 'unique zebra text')
    deleteCase(c.id)
    expect(searchCaptures('zebra')).toEqual([])
    // and a new capture inserts cleanly afterwards (migration-14 bug class:
    // stale index rows used to collide with reused rowids)
    const c2 = createCase({ name: 'C2', description: '', type: 'custom' })
    expect(() => makeCapture(c2.id, 'fresh')).not.toThrow()
  })

  it('dbAdmin.deleteRow on captures cleans the index (migration-14 bug class)', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const cap = makeCapture(c.id, 'unique zebra text')
    deleteRow('captures', { id: cap.id })
    expect(searchCaptures('zebra')).toEqual([])
  })

  it('dbAdmin.deleteRow on cases cleans the index via cascade', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    makeCapture(c.id, 'unique zebra text')
    deleteRow('cases', { id: c.id })
    expect(searchCaptures('zebra')).toEqual([])
  })

  it('purgeArchived cleans the index for archived cases', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    makeCapture(c.id, 'unique zebra text')
    updateCase({ id: c.id, archived: true })
    purgeArchived()
    expect(searchCaptures('zebra')).toEqual([])
  })

  it('vacuum after deletes does not desync text linkage (implicit-rowid bug)', () => {
    const c = createCase({ name: 'C', description: '', type: 'custom' })
    const a = makeCapture(c.id, 'text of alpha', 'A')
    const b = makeCapture(c.id, 'text of bravo', 'B')
    deleteCapture(a.id)
    vacuumDb(':memory:')
    expect(getCaptureTextContent(b.id)).toBe('text of bravo')
    expect(searchCaptures('bravo').map((x) => x.id)).toEqual([b.id])
  })
})
