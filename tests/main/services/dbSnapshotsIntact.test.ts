import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { isIntactDatabase } from '@main/services/db/dbSnapshots'

// `isIntactDatabase` is the last thing between a failed restore and a
// migration that builds a fresh schema over the operator's data (#428), and it
// answers by opening the file rather than by looking at it. So the cases that
// matter are the ones where opening is the only way to tell: a file that is
// the right size and the wrong thing, and a real database with a valid header
// and a missing tail. A zero-length file returns early and never reaches the
// probe, which is why the branch below it needs its own coverage.

// A database large enough that `sqlite_master` does not fit on page 1, so a
// file cut in half is one SQLite has to read past the end of to answer.
// Verified at these sizes: the probe reports "database disk image is
// malformed" rather than opening it and reporting a schema.
function writeMultiPageDb(path: string): void {
  const db = new Database(path)
  try {
    // One transaction instead of 140 autocommit ones: each autocommit fsyncs,
    // which put this fixture at ~4.6s under coverage against the 5s default
    // test timeout (#446). The committed file is byte-for-byte the same size.
    db.exec('BEGIN')
    for (let i = 0; i < 40; i++) db.exec(`CREATE TABLE t${i} (a TEXT, b TEXT)`)
    const insert = db.prepare(`INSERT INTO t0 VALUES (?, ?)`)
    for (let i = 0; i < 100; i++) insert.run('x'.repeat(300), String(i))
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

describe('isIntactDatabase', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-intact-'))
    dbPath = join(dir, 'birdbrain.db')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a database that opens and has a schema in it', () => {
    writeMultiPageDb(dbPath)

    expect(isIntactDatabase(dbPath)).toBe(true)
  })

  it('leaves no sidecars behind for a database that had none', () => {
    // The probe opens the file, and opening a WAL-mode database creates
    // -wal/-shm beside it. A check run before a migration must not be what
    // leaves them there for the next open to find.
    writeMultiPageDb(dbPath)

    expect(isIntactDatabase(dbPath)).toBe(true)
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
  })

  it('rejects a file that is not a database', () => {
    // Non-zero length, so the size check passes it through to the probe — this
    // is the branch the function exists for. SQLite refuses it on the header.
    writeFileSync(dbPath, 'this is definitely not a sqlite database, just bytes')
    expect(statSync(dbPath).size).toBeGreaterThan(0)

    expect(isIntactDatabase(dbPath)).toBe(false)
  })

  it('rejects a real database with its body truncated away', () => {
    // The #428 shape short of zero length: a valid SQLite header, so nothing
    // about the first bytes says the file is unusable, over a body that is
    // half missing. Only opening it and reading the schema catches this.
    writeMultiPageDb(dbPath)
    const size = statSync(dbPath).size
    truncateSync(dbPath, Math.floor(size / 2))

    expect(statSync(dbPath).size).toBeGreaterThan(0)
    expect(isIntactDatabase(dbPath)).toBe(false)
  })

  it('rejects a zero-length file rather than treating it as a new database', () => {
    // SQLite opens a zero-length file as a brand new, empty database rather
    // than refusing, so this one cannot be delegated to the probe.
    writeFileSync(dbPath, '')

    expect(isIntactDatabase(dbPath)).toBe(false)
  })

  it('rejects a database that opens cleanly but holds no schema', () => {
    // A real header on a file with nothing in it — what migrating a truncated
    // remnant forward would produce before the first migration block runs. It
    // has to fail on the schema count, not on the size check.
    const db = new Database(dbPath)
    try {
      db.pragma('user_version = 27')
    } finally {
      db.close()
    }
    expect(statSync(dbPath).size).toBeGreaterThan(0)

    expect(isIntactDatabase(dbPath)).toBe(false)
  })

  it('rejects a missing file', () => {
    expect(isIntactDatabase(join(dir, 'nothing-here.db'))).toBe(false)
  })

  it('rejects a directory in the database file position', () => {
    // Not a stat failure but an open failure, and it must not escape as a
    // throw: the caller is deciding whether to migrate, not handling errors.
    expect(isIntactDatabase(dir)).toBe(false)
  })
})
