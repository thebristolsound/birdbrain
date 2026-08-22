import { v4 as uuid } from 'uuid'
import type { Case, CaseAutoCapturePolicy } from '@shared/types'
import { isAutoCaptureExclusionMode } from '@shared/types'
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

// --- Auto-capture exclusions (#400) ---

// The empty policy, and what a case that has never been given one reads as:
// no exclusions, stacking on the operator's global ignore list. Both columns
// are nullable and NULL means exactly this, so a pre-v30 case needs no backfill.
const DEFAULT_POLICY: CaseAutoCapturePolicy = { exclusions: [], mode: 'stack' }

/**
 * The case's exclusion policy, or the default when it has none.
 *
 * Every value is re-checked rather than asserted. The columns are plain TEXT,
 * the Database Admin hatch can hand-edit them, and an archive written by
 * another install supplies them — so malformed JSON, a non-array, a non-string
 * element or an unknown mode all degrade to the default rather than reaching
 * the matcher. Degrading here is fail-open in the same direction the matcher
 * already fails, and it is visible: the screen shows an empty list.
 */
export function getAutoCapturePolicy(caseId: string): CaseAutoCapturePolicy {
  const row = getDb()
    .prepare('SELECT exclusions, exclusion_mode FROM cases WHERE id = ?')
    .get(caseId) as { exclusions: string | null; exclusion_mode: string | null } | undefined
  if (!row) return DEFAULT_POLICY
  return {
    exclusions: parseExclusions(row.exclusions),
    mode: isAutoCaptureExclusionMode(row.exclusion_mode) ? row.exclusion_mode : 'stack'
  }
}

/**
 * Replaces the case's exclusion policy and returns what was stored.
 *
 * Deliberately not routed through `updateCase`: that rewrites `updated_at` on
 * every call, so editing an exclusion would bump the case's "last updated" time
 * on the dashboard as though evidence had changed. A narrow single write path
 * is also what the evidence review needs to audit.
 *
 * Patterns are stored as given, trimmed. Validating them is the caller's job
 * (`validateIgnorePattern` at the IPC seam) so a rejection can name the
 * offending pattern back to the operator instead of failing anonymously here.
 */
export function setAutoCapturePolicy(
  caseId: string,
  policy: CaseAutoCapturePolicy
): CaseAutoCapturePolicy | undefined {
  const existing = getCase(caseId)
  if (!existing) return undefined
  const exclusions = policy.exclusions.map((p) => p.trim()).filter((p) => p.length > 0)
  getDb()
    .prepare('UPDATE cases SET exclusions = ?, exclusion_mode = ? WHERE id = ?')
    .run(JSON.stringify(exclusions), policy.mode, caseId)
  return getAutoCapturePolicy(caseId)
}

function parseExclusions(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  } catch {
    return []
  }
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
      `INSERT INTO cases
         (id, name, description, type, created_at, updated_at, archived, exclusions, exclusion_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ctx.newCaseId,
      caseRow.name ?? null,
      caseRow.description ?? null,
      caseRow.type ?? 'custom',
      caseRow.created_at ?? null,
      caseRow.updated_at ?? null,
      caseRow.archived ?? 0,
      // Explicit column list, so an archive from a pre-v30 release has no key
      // here and imports as NULL — the same "no exclusions, stack" default a
      // case that never set one reads as. The list travels with the case so a
      // re-imported case enforces the policy it was exported under (#400).
      caseRow.exclusions ?? null,
      caseRow.exclusion_mode ?? null
    )
}
