import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  takeUncleanSession,
  markCleanExit,
  readSessions,
  startSession,
  currentSession
} from '@main/services/sessionLog'

const INFO = { version: '1.0.0', platform: 'win32', installFormat: 'nsis' }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-session-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('sessionLog', () => {
  it('records a session that starts', () => {
    const rec = startSession(dir, INFO)
    expect(rec.cleanExit).toBe(false)
    expect(readSessions(dir)).toHaveLength(1)
  })

  it('reports no unclean session after a clean quit', () => {
    startSession(dir, INFO)
    markCleanExit(dir)
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('reports the previous session as unclean when the lock survived', () => {
    const first = startSession(dir, INFO)
    // No markCleanExit — simulates a crash or power loss.
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)?.sessionId).toBe(first.sessionId)
  })

  it('never reports the current session as unclean', () => {
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('offers a given crash exactly once', () => {
    startSession(dir, INFO)
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).not.toBeNull()
    // Without take-once semantics this crash would re-prompt on every launch
    // until the 20-record cap evicted it.
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('caps stored sessions at 20', () => {
    for (let i = 0; i < 25; i++) {
      startSession(dir, INFO)
      markCleanExit(dir)
    }
    expect(readSessions(dir)).toHaveLength(20)
  })

  it('recovers from a corrupt sessions file', () => {
    startSession(dir, INFO)
    writeFileSync(join(dir, 'sessions.json'), '{ not json')
    expect(() => startSession(dir, INFO)).not.toThrow()
    // The first session's lock is still on disk (no markCleanExit ran), so the
    // second startSession reclaims it as an orphaned record alongside its own
    // — corrupting sessions.json must not also erase that crash evidence.
    expect(readSessions(dir)).toHaveLength(2)
  })

  it('reconstructs an unclean record when only the lock survives', () => {
    writeFileSync(join(dir, 'session.lock'), 'ghost-session')
    startSession(dir, INFO)
    const ghost = readSessions(dir).find((r) => r.sessionId === 'ghost-session')
    expect(ghost).toMatchObject({ cleanExit: false, version: 'unknown' })
    expect(takeUncleanSession(dir)?.sessionId).toBe('ghost-session')
  })

  it('returns a usable session when the log directory cannot be written', () => {
    writeFileSync(join(dir, 'unwritable'), '')
    const record = startSession(join(dir, 'unwritable', 'logs'), INFO)
    expect(record.sessionId).toBeTruthy()
    expect(currentSession()).toBe(record.sessionId)
  })

  // A file truncated mid-write loses trailing fields but keeps the id. Dropping
  // those records would discard crash evidence in exactly the situation where a
  // crash is most likely, so they are filled instead — every record readSessions
  // returns has the shape its consumers dereference.
  it('fills a partially written record instead of dropping it', () => {
    writeFileSync(
      join(dir, 'sessions.json'),
      JSON.stringify([{ sessionId: 'truncated-abc' }, null, {}, { notASession: true }])
    )

    const records = readSessions(dir)

    // null, {} and the id-less object carry no identity and are dropped.
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      sessionId: 'truncated-abc',
      startedAt: '',
      endedAt: null,
      version: 'unknown',
      platform: 'unknown',
      installFormat: 'unknown',
      cleanExit: false
    })
  })

  it('surfaces a partially written record as an unclean session', () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify([{ sessionId: 'truncated-abc' }]))
    expect(takeUncleanSession(dir)?.sessionId).toBe('truncated-abc')
  })
})
