// Which rows a run still owes. A row that finished with ok, error or
// unsupported is never re-run under the same manifest; a rate_limited row is
// owed again, which is how a stopped run resumes from where it was cut.

import { existsSync, readFileSync } from 'node:fs'

export const rowKey = (row) => `${row.case}#${row.rep}`

export function readRows(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

export const SETTLED = new Set(['ok', 'error', 'unsupported'])

export function settledKeys(rows) {
  const out = new Set()
  for (const r of rows) if (SETTLED.has(r.status)) out.add(rowKey(r))
  return out
}

// The (case, rep) pairs in run order, minus the settled ones. Reps are the
// outer loop so a cut-off run still leaves one rep of every case.
export function pendingRows(caseIds, reps, rows) {
  const done = settledKeys(rows)
  const out = []
  for (let rep = 1; rep <= reps; rep += 1) {
    for (const id of caseIds) {
      if (!done.has(`${id}#${rep}`)) out.push({ case: id, rep })
    }
  }
  return out
}
