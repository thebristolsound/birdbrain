import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, setCaptureVerification } from '@main/services/db/captureRepo'

// Migration 37 (#1592): rows an earlier import left naming the source case are
// pointed at the files the import wrote, and nothing else moves.
describe('migration v37 (imported capture paths)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-migration-37-'))
    dbPath = join(tempDir, 'v36.db')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function capture(caseId: string, id: string, mhtmlPath: string, screenshotPath?: string) {
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z',
      format: 'mhtml',
      mhtmlPath,
      screenshotPath
    })
    setCaptureVerification(id, {
      status: 'missing',
      computedHash: '',
      verifiedAt: '2026-01-02T00:00:00.000Z'
    })
  }

  function windBackToV36(stale: Array<{ id: string; path: string }>): void {
    closeDatabase()
    const raw = new Database(dbPath)
    for (const { id, path } of stale) {
      raw.prepare('UPDATE exhibits SET path = ? WHERE id = ?').run(path, id)
    }
    raw.pragma('user_version = 36')
    raw.close()
  }

  function row(id: string) {
    return getDb()
      .prepare(
        `SELECT c.mhtml_path, c.screenshot_path, c.last_verified_status, e.path AS exhibit_path
           FROM captures c JOIN exhibits e ON e.id = c.id WHERE c.id = ?`
      )
      .get(id) as {
      mhtml_path: string | null
      screenshot_path: string | null
      last_verified_status: string | null
      exhibit_path: string | null
    }
  }

  it('re-roots a stale imported row and its Exhibit, and clears its verification', async () => {
    await initDatabase(dbPath)
    const source = createCase({ name: 'Source' }).id
    const imported = createCase({ name: 'Imported' }).id
    capture(imported, 'new-id', `${source}/old-id.mhtml`, `${source}/old-id.png`)
    windBackToV36([{ id: 'new-id', path: `${source}/old-id.mhtml` }])

    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(37)
    expect(row('new-id')).toEqual({
      mhtml_path: `${imported}/new-id.mhtml`,
      screenshot_path: `${imported}/new-id.png`,
      last_verified_status: null,
      exhibit_path: `${imported}/new-id.mhtml`
    })
  })

  it('repairs an Exhibit path the old import collapsed to the case directory', async () => {
    await initDatabase(dbPath)
    const source = createCase({ name: 'Source' }).id
    const imported = createCase({ name: 'Imported' }).id
    capture(imported, 'new-id', `${source}\\old-id.mhtml`)
    windBackToV36([{ id: 'new-id', path: imported }])

    await initDatabase(dbPath)

    expect(row('new-id').exhibit_path).toBe(`${imported}/new-id.mhtml`)
  })

  it('leaves native rows alone, whichever separator they were written with', async () => {
    await initDatabase(dbPath)
    const own = createCase({ name: 'Own' }).id
    capture(own, 'posix', `${own}/posix.mhtml`, `${own}/posix.png`)
    capture(own, 'windows', `${own}\\windows.mhtml`)
    windBackToV36([{ id: 'windows', path: `${own}\\windows.mhtml` }])

    await initDatabase(dbPath)

    expect(row('posix')).toEqual({
      mhtml_path: `${own}/posix.mhtml`,
      screenshot_path: `${own}/posix.png`,
      last_verified_status: 'missing',
      exhibit_path: `${own}/posix.mhtml`
    })
    expect(row('windows')).toEqual({
      mhtml_path: `${own}\\windows.mhtml`,
      screenshot_path: null,
      last_verified_status: 'missing',
      exhibit_path: `${own}\\windows.mhtml`
    })
  })
})
