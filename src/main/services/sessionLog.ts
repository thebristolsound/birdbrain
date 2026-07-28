import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '@shared/types'

// A launch writes session.lock and clears it in before-quit. A lock that is
// still present at the next launch is the ONLY signal for an OOM kill or power
// loss — no JS handler observes those — so this drives the crash prompt.

const SESSIONS_FILE = 'sessions.json'
const LOCK_FILE = 'session.lock'
const MAX_SESSIONS = 20

export interface SessionInfo {
  version: string
  platform: string
  installFormat: string
}

let currentSessionId = ''

function sessionsPath(logDir: string): string {
  return join(logDir, SESSIONS_FILE)
}

function lockPath(logDir: string): string {
  return join(logDir, LOCK_FILE)
}

// sessionId is the identity: without it a record cannot be matched, acknowledged
// or reconciled against the lock, so there is nothing to salvage. `[null]` and
// `[{}]` are valid JSON arrays, and both get through a bare Array.isArray check —
// null then throws on `r.sessionId` during launch, and `{}` reads as
// cleanExit-falsy and raises a false crash prompt on every start.
function hasSessionId(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return typeof r.sessionId === 'string' && r.sessionId.length > 0
}

// The remaining fields are FILLED, not required. Demanding all of them would
// mean dropping a record whose file was truncated mid-write — discarding the
// crash evidence this module exists to preserve, in exactly the situation where
// a crash is most likely. So a record that survives here is guaranteed to have
// the shape its consumers dereference (the report header, the crash prompt,
// sessions.json in the bundle), using the same 'unknown' sentinel
// reclaimOrphanedLock already writes for a session it can only partly recover.
function normalizeSessionRecord(r: Record<string, unknown>): SessionRecord {
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
  return {
    sessionId: r.sessionId as string,
    startedAt: str(r.startedAt, ''),
    endedAt: typeof r.endedAt === 'string' ? r.endedAt : null,
    version: str(r.version, 'unknown'),
    platform: str(r.platform, 'unknown'),
    installFormat: str(r.installFormat, 'unknown'),
    cleanExit: r.cleanExit === true,
    ...(r.acknowledged === true ? { acknowledged: true } : {})
  }
}

export function readSessions(logDir: string): SessionRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sessionsPath(logDir), 'utf8'))
    if (!Array.isArray(parsed)) return []
    // Drop only identity-less records rather than rejecting the whole file: one
    // corrupt entry must not discard the crash evidence sitting beside it.
    return parsed.filter(hasSessionId).map(normalizeSessionRecord)
  } catch {
    // Missing or corrupt: a diagnostics file must never block startup.
    return []
  }
}

function writeSessions(logDir: string, records: SessionRecord[]): boolean {
  // Best-effort, like readSessions. A read-only logs directory or a `logs`
  // path that is a file makes every write here throw; startSession runs inside
  // whenReady before the window exists, so an escaping throw would stop
  // Birdbrain launching at all. Losing session history is an acceptable
  // degradation; refusing to start is not.
  try {
    writeFileSync(sessionsPath(logDir), JSON.stringify(records.slice(-MAX_SESSIONS), null, 2))
    return true
  } catch {
    // Session persistence disabled for this run. The caller decides what that
    // means — markCleanExit, for one, must not clear the lock after a failure.
    return false
  }
}

// A lock naming a session with no matching record is the residue of an unclean
// exit whose sessions.json was lost or corrupted. Without this, that crash is
// invisible: takeUncleanSession only reads records, and startSession is about
// to overwrite the lock. Synthesize the minimum record the recovery prompt
// needs — the fields we cannot recover are marked unknown rather than guessed.
function reclaimOrphanedLock(logDir: string, records: SessionRecord[]): SessionRecord[] {
  let lockedId = ''
  try {
    lockedId = readFileSync(lockPath(logDir), 'utf8').trim()
  } catch {
    return records
  }
  if (!lockedId || records.some((r) => r.sessionId === lockedId)) return records

  return [
    ...records,
    {
      sessionId: lockedId,
      startedAt: '',
      endedAt: null,
      version: 'unknown',
      platform: 'unknown',
      installFormat: 'unknown',
      cleanExit: false
    }
  ]
}

export function startSession(logDir: string, info: SessionInfo): SessionRecord {
  const record: SessionRecord = {
    sessionId: randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    version: info.version,
    platform: info.platform,
    installFormat: info.installFormat,
    cleanExit: false
  }

  // Set before any I/O: the logger stamps every entry with this, and it must
  // be correct even when nothing below can be written to disk.
  currentSessionId = record.sessionId

  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    return record
  }

  writeSessions(logDir, [...reclaimOrphanedLock(logDir, readSessions(logDir)), record])
  try {
    writeFileSync(lockPath(logDir), record.sessionId)
  } catch {
    // No lock means the next launch cannot detect an OOM kill for this run.
  }
  return record
}

export function markCleanExit(logDir: string): void {
  const records = readSessions(logDir)
  const current = records.find((r) => r.sessionId === currentSessionId)
  if (!current) return

  current.cleanExit = true
  current.endedAt = new Date().toISOString()

  // The lock goes ONLY if the clean state actually reached disk. writeSessions
  // swallows its errors, so a transiently locked sessions.json during an
  // otherwise normal quit would leave the record at cleanExit:false while the
  // lock disappeared — and takeUncleanSession reads records, not the lock, so
  // the next launch would greet the tester with a recovery prompt for a crash
  // that never happened. Keeping the lock costs nothing: reclaimOrphanedLock
  // reconciles it on the next start.
  if (!writeSessions(logDir, records)) return

  try {
    rmSync(lockPath(logDir), { force: true })
  } catch {
    // A lock we cannot remove makes the next launch report a false crash —
    // annoying, but not a reason to throw out of before-quit and block exit.
  }
}

// Take-once. Without acknowledging, a single genuine crash leaves cleanExit
// false forever and every subsequent launch re-shows the recovery prompt until
// the 20-record cap finally evicts it.
export function takeUncleanSession(logDir: string): SessionRecord | null {
  const records = readSessions(logDir)
  const unclean = records
    .filter((r) => !r.cleanExit && !r.acknowledged && r.sessionId !== currentSessionId)
    .pop()
  if (!unclean) return null

  unclean.acknowledged = true
  writeSessions(logDir, records)
  return unclean
}

export function currentSession(): string {
  return currentSessionId
}
