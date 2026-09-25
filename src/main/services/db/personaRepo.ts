import { v4 as uuid } from 'uuid'
import type { Persona } from '@shared/types'
import type { CreatePersonaParams, UpdatePersonaParams } from '@shared/ipc'
import { getDb } from '@main/services/db/core'

interface PersonaRow {
  id: string
  label: string
  notes: string
  created_at: string
  last_import_at: string | null
  last_import_count: number | null
  deleted_at: string | null
}

function toPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    label: row.label,
    notes: row.notes,
    createdAt: row.created_at,
    lastImportAt: row.last_import_at,
    lastImportCount: row.last_import_count
  }
}

// Pickers and the Settings list: live rows only. A soft-deleted Persona is
// invisible here but its label stays readable through `getPersonaLabel`.
export function listPersonas(): Persona[] {
  const rows = getDb()
    .prepare('SELECT * FROM personas WHERE deleted_at IS NULL ORDER BY label COLLATE NOCASE')
    .all() as PersonaRow[]
  return rows.map(toPersona)
}

export function getPersona(id: string): Persona | undefined {
  const row = getDb()
    .prepare('SELECT * FROM personas WHERE id = ? AND deleted_at IS NULL')
    .get(id) as PersonaRow | undefined
  return row ? toPersona(row) : undefined
}

// The label a Capture would be stamped with (ADR-0030, frozen at acquisition
// from phase 2 on). Reads deleted rows too: the stamp on a historic Capture
// must stay resolvable after the Persona is gone.
export function getPersonaLabel(id: string): string | undefined {
  const row = getDb().prepare('SELECT label FROM personas WHERE id = ?').get(id) as
    { label: string } | undefined
  return row?.label
}

export function createPersona(params: CreatePersonaParams): Persona {
  const id = uuid()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare('INSERT INTO personas (id, label, notes, created_at) VALUES (?, ?, ?, ?)')
    .run(id, params.label, params.notes ?? '', createdAt)
  return {
    id,
    label: params.label,
    notes: params.notes ?? '',
    createdAt,
    lastImportAt: null,
    lastImportCount: null
  }
}

// Rename or re-note. Nothing else moves: a rename never rewrites the label a
// Capture already carries (ADR-0030), and the import fields belong to
// `recordImport` alone.
export function updatePersona(params: UpdatePersonaParams): Persona | undefined {
  const existing = getPersona(params.id)
  if (!existing) return undefined
  getDb()
    .prepare('UPDATE personas SET label = ?, notes = ? WHERE id = ?')
    .run(params.label ?? existing.label, params.notes ?? existing.notes, params.id)
  return getPersona(params.id)
}

export function recordImport(id: string, count: number, importedAt: string): void {
  getDb()
    .prepare('UPDATE personas SET last_import_at = ?, last_import_count = ? WHERE id = ?')
    .run(importedAt, count, id)
}

// Soft delete (ADR-0030): the row survives so historic Captures keep their
// label; `deleted_at` hides it from every list. Idempotent — a second delete
// of the same id changes nothing and reports false.
export function softDeletePersona(id: string): boolean {
  const result = getDb()
    .prepare('UPDATE personas SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), id)
  return result.changes > 0
}
