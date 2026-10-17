import { getDb } from '@main/services/db/core'

// The two parts of a Case's revision the database holds (ADR-0042): the
// generation and the counter. Triggers advance the counter (migration 40); this
// module only reads it.
export interface CaseRevisionRow {
  generation: string
  counter: number
}

// Undefined when the database holds no revision row for the id, which is true
// of every id that names no Case: the rows cascade with their Case.
export function getCaseRevisionRow(caseId: string): CaseRevisionRow | undefined {
  return getDb()
    .prepare('SELECT generation, counter FROM case_revisions WHERE case_id = ?')
    .get(caseId) as CaseRevisionRow | undefined
}
