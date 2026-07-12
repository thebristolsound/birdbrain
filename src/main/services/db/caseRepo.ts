import { v4 as uuid } from 'uuid'
import type { Case } from '@shared/types'
import type { CreateCaseParams, UpdateCaseParams } from '@shared/ipc'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function listCases(): Case[] {
  const rows = getDb()
    .prepare('SELECT * FROM cases WHERE archived = 0 ORDER BY updated_at DESC, rowid DESC')
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToCase)
}

export function getCase(id: string): Case | undefined {
  const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCase(row) : undefined
}

export function createCase(params: CreateCaseParams): Case {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO cases (id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, params.name, params.description ?? null, params.type ?? 'custom', now, now)
  return getCase(id)!
}

export function updateCase(params: UpdateCaseParams): Case | undefined {
  const existing = getCase(params.id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'UPDATE cases SET name = ?, description = ?, archived = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      params.name ?? existing.name,
      params.description ?? existing.description ?? null,
      params.archived !== undefined ? (params.archived ? 1 : 0) : existing.archived ? 1 : 0,
      now,
      params.id
    )
  return getCase(params.id)
}

export function deleteCase(id: string): boolean {
  const d = getDb()
  const run = d.transaction(() => {
    return d.prepare('DELETE FROM cases WHERE id = ?').run(id)
  })
  const result = run()
  return result.changes > 0
}

function rowToCase(row: Record<string, unknown>): Case {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
    type: (row.type as Case['type']) || 'custom',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archived: row.archived === 1
  }
}

// Safely parses the JSON-serialized corroboration-only TLS cert chain (#123)
// from its DB column. Returns undefined for NULL/legacy rows or any malformed

// --- Archive bulk ops ---

export function collectCaseRow(caseId: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as
    | Record<string, unknown>
    | undefined
  if (!row) throw new Error(`Case not found: ${caseId}`)
  return row
}

export function importCaseRow(caseRow: Record<string, unknown>, ctx: ImportCtx): void {
  getDb()
    .prepare(
      `INSERT INTO cases (id, name, description, type, created_at, updated_at, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ctx.newCaseId,
      caseRow.name ?? null,
      caseRow.description ?? null,
      caseRow.type ?? 'custom',
      caseRow.created_at ?? null,
      caseRow.updated_at ?? null,
      caseRow.archived ?? 0
    )
}
