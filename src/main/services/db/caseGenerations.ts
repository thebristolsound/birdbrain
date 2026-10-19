import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

// A restore replaces the database instead of editing it, so every Case in the
// copy it installs gets a new generation (ADR-0042): a counter alone can repeat
// after a restore while the state behind it differs. Both restores call this on
// their copy before the copy replaces anything. The counter stays as it was.
//
// Opens the file on its own connection and closes it again. Returns false, and
// changes nothing, for a copy with no `case_revisions` table, as one from
// before migration 40 has; migrating it writes fresh generations.
//
// Imports nothing from `core`, which imports the snapshot module that calls
// this.
export function replaceGenerationsInFile(path: string): boolean {
  const conn = new Database(path, { fileMustExist: true })
  try {
    const table = conn
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'case_revisions'")
      .get()
    if (!table) return false
    const cases = conn.prepare('SELECT case_id FROM case_revisions').all() as Array<{
      case_id: string
    }>
    const update = conn.prepare('UPDATE case_revisions SET generation = ? WHERE case_id = ?')
    conn.transaction(() => {
      for (const { case_id } of cases) update.run(randomUUID(), case_id)
    })()
    return true
  } finally {
    conn.close()
  }
}
