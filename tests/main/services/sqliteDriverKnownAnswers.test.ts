import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// Known answers for what the SQLite driver writes and throws. better-sqlite3 12.11.1 and 13.0.3
// both produced every value here under Electron 44.4.5, so a later driver bump that changes the
// stored bytes, storage class or error code for one of these inputs fails this file.
describe('better-sqlite3 storage known answers', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v)')
  })

  afterEach(() => {
    db.close()
  })

  const stored = (value: unknown): { type: string; hex: string } => {
    const { lastInsertRowid } = db.prepare('INSERT INTO t (v) VALUES (?)').run(value)
    return db
      .prepare('SELECT typeof(v) AS type, hex(v) AS hex FROM t WHERE id = ?')
      .get(lastInsertRowid) as { type: string; hex: string }
  }

  it.each([
    ['ASCII text', 'hello', 'text', '68656C6C6F'],
    ['astral-plane text', '\u{1F426}bird', 'text', 'F09F90A662697264'],
    ['text with an embedded NUL', 'a\u0000b', 'text', '610062'],
    ['a lone high surrogate, replaced by U+FFFD', 'x\uD800y', 'text', '78EFBFBD79'],
    ['a lone low surrogate, replaced by U+FFFD', 'x\uDC00y', 'text', '78EFBFBD79'],
    ['a leading byte-order mark', '﻿z', 'text', 'EFBBBF7A'],
    ['a JS number, bound as a double', 2 ** 53 - 1, 'real', '393030373139393235343734303939312E30'],
    [
      'a bigint, bound as an integer',
      9007199254740993n,
      'integer',
      '39303037313939323534373430393933'
    ],
    ['a Buffer', Buffer.from([0, 1, 255]), 'blob', '0001FF'],
    ['a Uint8Array', new Uint8Array([2, 3]), 'blob', '0203'],
    ['NaN, bound as NULL', NaN, 'null', ''],
    ['undefined, bound as NULL', undefined, 'null', '']
  ])('stores %s', (_label, value, type, hex) => {
    expect(stored(value)).toEqual({ type, hex })
  })

  it('reads a stored lone surrogate back as U+FFFD', () => {
    stored('x\uD800y')
    const { v } = db.prepare('SELECT v FROM t').get() as { v: string }
    expect(v).toBe('x�y')
  })

  it('reads integers above 2^53 as a bigint only in safe-integer mode', () => {
    const statement = db.prepare('SELECT 9007199254740993 AS v')
    expect((statement.get() as { v: number }).v).toBe(9007199254740992)
    statement.safeIntegers()
    expect((statement.get() as { v: bigint }).v).toBe(9007199254740993n)
  })

  it.each([
    ['a boolean', true],
    ['a Date', new Date(0)]
  ])('refuses to bind %s', (_label, value) => {
    expect(() => stored(value)).toThrow(TypeError)
  })

  // ipcError maps these codes to its user-facing messages, and logSafe keeps the name only
  // because SqliteError is on its allowlist.
  it.each([
    [
      'a UNIQUE violation',
      'CREATE TABLE u (x UNIQUE); INSERT INTO u VALUES (1); INSERT INTO u VALUES (1)',
      'SQLITE_CONSTRAINT_UNIQUE'
    ],
    [
      'a FOREIGN KEY violation',
      'PRAGMA foreign_keys = ON; CREATE TABLE p (id INTEGER PRIMARY KEY);' +
        ' CREATE TABLE c (pid REFERENCES p(id)); INSERT INTO c VALUES (9)',
      'SQLITE_CONSTRAINT_FOREIGNKEY'
    ]
  ])('throws a SqliteError carrying the extended code for %s', (_label, sql, code) => {
    let caught: unknown
    try {
      db.exec(sql)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Database.SqliteError)
    expect(caught).toMatchObject({ name: 'SqliteError', code })
  })
})
