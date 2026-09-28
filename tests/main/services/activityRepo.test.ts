import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, updateCase } from '@main/services/db/caseRepo'
import { insertCapture, setCaptureVerification } from '@main/services/db/captureRepo'
import { createNote, updateNote } from '@main/services/db/noteRepo'
import { listRecentActivity } from '@main/services/db/activityRepo'
import { MAX_RECENT_ACTIVITY_LIMIT } from '@shared/constants'

// The repository timestamps rows with Date.now(), so ordering fixtures set the
// two columns the feed sorts on directly. Everything else about the rows is
// built through the real repositories.
function setCaptureCreatedAt(captureId: string, iso: string): void {
  getDb().prepare('UPDATE captures SET created_at = ? WHERE id = ?').run(iso, captureId)
}

function setNoteUpdatedAt(noteId: string, iso: string): void {
  getDb().prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(iso, noteId)
}

function seedCapture(caseId: string, title: string, createdAt: string, id?: string): string {
  const capture = insertCapture({
    caseId,
    url: `https://example.com/${title}`,
    title,
    hash: `hash-${title}`,
    timestamp: createdAt,
    ...(id ? { id } : {})
  })
  setCaptureCreatedAt(capture.id, createdAt)
  return capture.id
}

function seedNote(caseId: string, title: string, updatedAt: string): string {
  const note = createNote({ caseId, title, body: `${title} body` })
  setNoteUpdatedAt(note.id, updatedAt)
  return note.id
}

describe('activityRepo.listRecentActivity', () => {
  beforeEach(async () => {
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  it('returns an empty list when nothing has happened', () => {
    expect(listRecentActivity()).toEqual([])
  })

  it('reports capture events with their case, url and provenance status', () => {
    const c = createCase({ name: 'Nightjar', type: 'fraud' })
    const captureId = seedCapture(c.id, 'Sign in', '2026-08-01T10:00:00.000Z')
    setCaptureVerification(captureId, {
      status: 'verified',
      computedHash: 'hash-Sign in',
      verifiedAt: '2026-08-01T10:05:00.000Z'
    })

    expect(listRecentActivity()).toEqual([
      {
        kind: 'capture',
        captureId,
        caseId: c.id,
        caseName: 'Nightjar',
        caseType: 'fraud',
        title: 'Sign in',
        url: 'https://example.com/Sign in',
        occurredAt: '2026-08-01T10:00:00.000Z',
        lastVerifiedStatus: 'verified'
      }
    ])
  })

  it('reports note events dated by their last edit', () => {
    const c = createCase({ name: 'Lazuli', type: 'crypto' })
    const note = createNote({ caseId: c.id, title: 'Kit fingerprint', body: 'first' })
    updateNote({ id: note.id, title: 'Kit fingerprint', body: 'second' })
    setNoteUpdatedAt(note.id, '2026-08-02T09:00:00.000Z')

    expect(listRecentActivity()).toEqual([
      {
        kind: 'note',
        noteId: note.id,
        caseId: c.id,
        caseName: 'Lazuli',
        caseType: 'crypto',
        title: 'Kit fingerprint',
        occurredAt: '2026-08-02T09:00:00.000Z'
      }
    ])
  })

  it('interleaves captures and notes across cases, newest first', () => {
    const one = createCase({ name: 'Case One', type: 'malware' })
    const two = createCase({ name: 'Case Two' })
    seedCapture(one.id, 'oldest', '2026-08-01T00:00:00.000Z')
    seedNote(two.id, 'middle', '2026-08-02T00:00:00.000Z')
    seedCapture(two.id, 'newest', '2026-08-03T00:00:00.000Z')

    const events = listRecentActivity()
    expect(events.map((e) => [e.kind, e.title, e.caseName])).toEqual([
      ['capture', 'newest', 'Case Two'],
      ['note', 'middle', 'Case Two'],
      ['capture', 'oldest', 'Case One']
    ])
  })

  it('breaks timestamp ties on id so repeated calls agree', () => {
    const c = createCase({ name: 'Tied' })
    const sameInstant = '2026-08-04T12:00:00.000Z'
    seedCapture(c.id, 'alpha', sameInstant, 'aaa')
    seedCapture(c.id, 'bravo', sameInstant, 'zzz')
    seedNote(c.id, 'charlie', sameInstant)

    const first = listRecentActivity().map((e) => e.title)
    const second = listRecentActivity().map((e) => e.title)
    expect(first).toEqual(second)
    // Descending id: 'zzz' > note uuid is not guaranteed, but the two captures
    // are, and every ordering must be identical across calls.
    expect(first.indexOf('bravo')).toBeLessThan(first.indexOf('alpha'))
  })

  it('bounds the result at the requested limit', () => {
    const c = createCase({ name: 'Busy' })
    for (let i = 0; i < 6; i += 1) {
      seedCapture(c.id, `capture-${i}`, `2026-08-05T00:0${i}:00.000Z`)
      seedNote(c.id, `note-${i}`, `2026-08-05T00:0${i}:30.000Z`)
    }

    expect(listRecentActivity(3)).toHaveLength(3)
    expect(listRecentActivity(3).map((e) => e.title)).toEqual(['note-5', 'capture-5', 'note-4'])
    // The default limit is what the dashboard asks for.
    expect(listRecentActivity()).toHaveLength(10)
  })

  it('clamps a limit that arrives out of range rather than trusting it', () => {
    const c = createCase({ name: 'Clamped' })
    for (let i = 0; i < 3; i += 1) {
      seedCapture(c.id, `capture-${i}`, `2026-08-06T00:0${i}:00.000Z`)
    }

    expect(listRecentActivity(0)).toHaveLength(1)
    expect(listRecentActivity(-5)).toHaveLength(1)
    expect(listRecentActivity(Number.NaN)).toHaveLength(3)
    expect(listRecentActivity(MAX_RECENT_ACTIVITY_LIMIT + 1000)).toHaveLength(3)
  })

  it('leaves archived cases out of the feed', () => {
    const live = createCase({ name: 'Live' })
    const archived = createCase({ name: 'Archived' })
    seedCapture(live.id, 'kept', '2026-08-07T00:00:00.000Z')
    seedCapture(archived.id, 'hidden', '2026-08-08T00:00:00.000Z')
    seedNote(archived.id, 'hidden note', '2026-08-08T01:00:00.000Z')
    updateCase({ id: archived.id, archived: true })

    expect(listRecentActivity().map((e) => e.title)).toEqual(['kept'])
  })

  it('reports a blank title as null and leaves the fallback to the view', () => {
    const c = createCase({ name: 'Untitled things' })
    const capture = insertCapture({
      caseId: c.id,
      url: 'https://example.com/no-title',
      title: '',
      hash: 'h',
      timestamp: '2026-08-09T00:00:00.000Z'
    })
    setCaptureCreatedAt(capture.id, '2026-08-09T00:00:00.000Z')
    seedNote(c.id, '', '2026-08-09T01:00:00.000Z')

    const events = listRecentActivity()
    expect(events.map((e) => e.title)).toEqual([null, null])
  })

  it('carries the verifier-too-old status through, rather than dropping it (X25)', () => {
    const c = createCase({ name: 'Newer chain' })
    const captureId = seedCapture(c.id, 'newer', '2026-08-11T00:00:00.000Z')
    setCaptureVerification(captureId, {
      status: 'verifier-too-old',
      computedHash: 'hash-newer',
      verifiedAt: '2026-08-11T00:05:00.000Z'
    })

    const [event] = listRecentActivity()
    expect(event.kind === 'capture' && event.lastVerifiedStatus).toBe('verifier-too-old')
  })

  it('reports an unrecognised case type and verification status as absent', () => {
    const c = createCase({ name: 'Legacy' })
    getDb().prepare("UPDATE cases SET type = 'not-a-type' WHERE id = ?").run(c.id)
    const captureId = seedCapture(c.id, 'odd', '2026-08-10T00:00:00.000Z')
    getDb()
      .prepare("UPDATE captures SET last_verified_status = 'unknown' WHERE id = ?")
      .run(captureId)

    const [event] = listRecentActivity()
    expect(event.caseType).toBeUndefined()
    expect(event.kind === 'capture' && event.lastVerifiedStatus).toBeUndefined()
  })
})
