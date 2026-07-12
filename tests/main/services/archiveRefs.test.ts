import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import {
  createArchiveRef,
  listArchiveRefs,
  deleteArchiveRef
} from '@main/services/db/archiveRefRepo'
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

function makeCapture(caseId: string) {
  return insertCapture({
    caseId,
    url: 'https://example.com/',
    title: 'Example',
    hash: 'deadbeef',
    timestamp: '2020-01-15T12:00:00.000Z',
    format: 'mhtml'
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-archive-'))
  initDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('archive refs CRUD', () => {
  it('creates and lists a pinned ref for a capture', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createArchiveRef({
      captureId: cap.id,
      snapshot,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    expect(ref.id).toBeTruthy()
    expect(ref.snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(ref.pinnedAt).toMatch(/^\d{4}-/)

    const refs = listArchiveRefs(cap.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotTimestamp).toBe('2020-01-15T12:00:00.000Z')
    expect(refs[0].statusCode).toBe(200)
  })

  it('deletes a ref by id', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createArchiveRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    expect(deleteArchiveRef(ref.id)).toBe(true)
    expect(listArchiveRefs(cap.id)).toHaveLength(0)
    expect(deleteArchiveRef(ref.id)).toBe(false)
  })

  it('cascade-deletes refs when the capture is deleted', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    createArchiveRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    // initDatabase sets `foreign_keys = ON`, so deleting the capture cascades.
    getDb().prepare('DELETE FROM captures WHERE id = ?').run(cap.id)
    expect(listArchiveRefs(cap.id)).toHaveLength(0)
  })
})
