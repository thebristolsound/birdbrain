import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import {
  createPersona,
  getPersona,
  getPersonaLabel,
  listPersonas,
  recordImport,
  softDeletePersona,
  updatePersona
} from '@main/services/db/personaRepo'

describe('personaRepo', () => {
  beforeEach(async () => {
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  it('creates a persona with empty notes and no import, and lists it', () => {
    const p = createPersona({ label: 'Research account' })
    expect(p).toMatchObject({
      label: 'Research account',
      notes: '',
      lastImportAt: null,
      lastImportCount: null
    })
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(listPersonas()).toEqual([p])
    expect(getPersona(p.id)).toEqual(p)
  })

  it('lists case-insensitively by label', () => {
    createPersona({ label: 'zed' })
    createPersona({ label: 'Alpha' })
    createPersona({ label: 'beta' })
    expect(listPersonas().map((p) => p.label)).toEqual(['Alpha', 'beta', 'zed'])
  })

  it('rename updates the label and nothing else', () => {
    const p = createPersona({ label: 'Before', notes: 'kept' })
    recordImport(p.id, 12, '2026-09-23T10:00:00.000Z')
    const renamed = updatePersona({ id: p.id, label: 'After' })
    expect(renamed).toEqual({
      ...p,
      label: 'After',
      lastImportAt: '2026-09-23T10:00:00.000Z',
      lastImportCount: 12
    })
    expect(updatePersona({ id: p.id, notes: 'changed' })?.notes).toBe('changed')
    expect(getPersona(p.id)?.label).toBe('After')
  })

  it('update of an unknown or deleted persona returns undefined', () => {
    expect(updatePersona({ id: 'missing', label: 'x' })).toBeUndefined()
    const p = createPersona({ label: 'gone' })
    softDeletePersona(p.id)
    expect(updatePersona({ id: p.id, label: 'x' })).toBeUndefined()
  })

  it('recordImport stores the count and time on the row', () => {
    const p = createPersona({ label: 'seeded' })
    recordImport(p.id, 3, '2026-09-23T11:00:00.000Z')
    expect(getPersona(p.id)).toMatchObject({
      lastImportAt: '2026-09-23T11:00:00.000Z',
      lastImportCount: 3
    })
  })

  it('soft delete hides the row from the list, keeps it with deleted_at, and is idempotent', () => {
    const p = createPersona({ label: 'sock' })
    expect(softDeletePersona(p.id)).toBe(true)
    expect(listPersonas()).toEqual([])
    expect(getPersona(p.id)).toBeUndefined()
    const row = getDb().prepare('SELECT deleted_at FROM personas WHERE id = ?').get(p.id) as {
      deleted_at: string | null
    }
    expect(row.deleted_at).toMatch(/^\d{4}-/)
    expect(softDeletePersona(p.id)).toBe(false)
    expect(softDeletePersona('missing')).toBe(false)
  })

  // The stamp on a historic Capture (phase 2) must resolve after the persona
  // is gone: that is the whole reason the delete is soft.
  it('getPersonaLabel still answers for a deleted persona', () => {
    const p = createPersona({ label: 'historic' })
    softDeletePersona(p.id)
    expect(getPersonaLabel(p.id)).toBe('historic')
    expect(getPersonaLabel('missing')).toBeUndefined()
  })
})
