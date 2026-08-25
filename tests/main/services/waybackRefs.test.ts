import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, getDb, type ImportCtx } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import {
  createWaybackRef,
  listWaybackRefs,
  listWaybackRefsForCase,
  deleteWaybackRef,
  importWaybackRefRows
} from '@main/services/db/waybackRefRepo'
import type { WaybackSnapshot } from '@shared/types'

let dir = ''

const snapshot: WaybackSnapshot = {
  timestamp: '2020-01-15T12:00:00.000Z',
  snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
  originalUrl: 'https://example.com/',
  statusCode: 200,
  mimeType: 'text/html',
  digest: 'ABC'
}

function makeCapture(caseId: string, timestamp = '2020-01-15T12:00:00.000Z') {
  return insertCapture({
    caseId,
    url: 'https://example.com/',
    title: 'Example',
    hash: 'deadbeef',
    timestamp,
    format: 'mhtml'
  })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bb-archive-'))
  await initDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('archive refs CRUD', () => {
  it('creates and lists a pinned ref for a capture', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createWaybackRef({
      captureId: cap.id,
      snapshot,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    expect(ref.id).toBeTruthy()
    expect(ref.snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(ref.pinnedAt).toMatch(/^\d{4}-/)

    const refs = listWaybackRefs(cap.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotTimestamp).toBe('2020-01-15T12:00:00.000Z')
    expect(refs[0].statusCode).toBe(200)
  })

  it('deletes a ref by id', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createWaybackRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    expect(deleteWaybackRef(ref.id)).toBe(true)
    expect(listWaybackRefs(cap.id)).toHaveLength(0)
    expect(deleteWaybackRef(ref.id)).toBe(false)
  })

  it('cascade-deletes refs when the capture is deleted', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    createWaybackRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    // initDatabase sets `foreign_keys = ON`, so deleting the capture cascades.
    getDb().prepare('DELETE FROM captures WHERE id = ?').run(cap.id)
    expect(listWaybackRefs(cap.id)).toHaveLength(0)
  })
})

describe('case-wide pinned refs', () => {
  it('reads every pin in a case with the capture time it corroborates', () => {
    const target = createCase({ name: 'Case' })
    const other = createCase({ name: 'Other case' })
    const first = makeCapture(target.id, '2020-01-15T12:00:00.000Z')
    const second = makeCapture(target.id, '2021-03-01T09:00:00.000Z')
    const elsewhere = makeCapture(other.id)

    createWaybackRef({ captureId: first.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    createWaybackRef({
      captureId: second.id,
      snapshot: {
        ...snapshot,
        timestamp: '2021-02-01T00:00:00.000Z',
        snapshotUrl: 'https://web.archive.org/web/20210201000000/https://example.com/'
      },
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    createWaybackRef({ captureId: elsewhere.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })

    const refs = listWaybackRefsForCase(target.id)

    // Newest snapshot first, scoped to the case, each carrying its capture time.
    expect(refs.map((ref) => ref.snapshotTimestamp)).toEqual([
      '2021-02-01T00:00:00.000Z',
      '2020-01-15T12:00:00.000Z'
    ])
    expect(refs.map((ref) => ref.captureTimestamp)).toEqual([
      '2021-03-01T09:00:00.000Z',
      '2020-01-15T12:00:00.000Z'
    ])
    expect(refs.every((ref) => ref.captureId !== elsewhere.id)).toBe(true)
  })

  it('returns nothing for a case with no pins', () => {
    const c = createCase({ name: 'Unpinned' })
    makeCapture(c.id)
    expect(listWaybackRefsForCase(c.id)).toEqual([])
  })
})

/**
 * `status_code` is declared INTEGER, but SQLite affinity leaves a non-numeric
 * string as TEXT, and `importWaybackRefRows` binds whatever `data.json` carried —
 * a `.birdbrain` archive is parsed with a bare cast and validated by no schema.
 * The column is therefore an untrusted channel, and this repo is the boundary
 * that has to make the declared `statusCode?: number` true for everything
 * downstream of it, the report included.
 */
describe('untrusted status_code', () => {
  const HOSTILE = '"><script>alert(1)</script>'

  const importCtx: ImportCtx = {
    newCaseId: 'unused',
    mapId: (id) => id,
    mapTag: (id) => id,
    getText: () => ''
  }

  function importRef(captureId: string, statusCode: unknown) {
    importWaybackRefRows(
      [
        {
          id: 'imported-ref',
          capture_id: captureId,
          snapshot_timestamp: snapshot.timestamp,
          snapshot_url: snapshot.snapshotUrl,
          original_url: snapshot.originalUrl,
          digest: null,
          status_code: statusCode,
          mime_type: 'text/html',
          checked_at: '2026-06-30T00:00:00.000Z',
          pinned_at: '2026-06-30T00:00:00.000Z'
        }
      ],
      importCtx
    )
  }

  it('drops a non-numeric status_code instead of handing it on as a number', () => {
    const c = createCase({ name: 'Imported' })
    const cap = makeCapture(c.id)
    importRef(cap.id, HOSTILE)

    // The column really did take the markup — INTEGER affinity did not reject
    // it, which is the premise the coercion exists for.
    const stored = getDb()
      .prepare('SELECT status_code AS code, typeof(status_code) AS ty FROM capture_archive_refs')
      .get() as { code: unknown; ty: string }
    expect(stored.ty).toBe('text')
    expect(stored.code).toBe(HOSTILE)

    expect(listWaybackRefs(cap.id)[0].statusCode).toBeUndefined()
    expect(listWaybackRefsForCase(c.id)[0].statusCode).toBeUndefined()
  })

  it('keeps a genuine status_code', () => {
    const c = createCase({ name: 'Imported' })
    const cap = makeCapture(c.id)
    importRef(cap.id, 404)

    expect(listWaybackRefs(cap.id)[0].statusCode).toBe(404)
  })
})
