import { getDb, LATEST_SCHEMA_VERSION } from '@main/services/db/core'

// Read-only DB facts for Settings → Diagnostics. Everything is guarded: a
// missing/uninitialized database yields sentinel values (-1 / '') so the
// diagnostics snapshot never throws.

export interface DbDiagnostics {
  dbPath: string
  schemaVersion: number
  latestSchemaVersion: number
  cases: number
  captures: number
  notes: number
  selectors: number
  extractedData: number
}

// -1 signals "unavailable" so the UI renders a dash instead of a lie.
function count(table: string): number {
  try {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get() as { n: number }
    return row.n
  } catch {
    return -1
  }
}

export function getDbDiagnostics(): DbDiagnostics {
  let dbPath = ''
  let schemaVersion = -1
  try {
    const db = getDb()
    dbPath = db.name
    schemaVersion = db.pragma('user_version', { simple: true }) as number
  } catch {
    /* db not initialized */
  }

  return {
    dbPath,
    schemaVersion,
    latestSchemaVersion: LATEST_SCHEMA_VERSION,
    cases: count('cases'),
    captures: count('captures'),
    notes: count('notes'),
    selectors: count('selectors'),
    extractedData: count('extracted_data')
  }
}
