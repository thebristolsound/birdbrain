// The signal registry for the repository health report, and the collector that
// runs it.
//
// A signal is one repository-level number with a budget:
//   { id, family, label, unit, better, budget, why, needs, measure(ctx) }
// `unit` is 'count' or 'percent', `better` is 'lower' or 'higher', `needs` says
// what the measurement reads ('tree', 'install' or 'gh'), and `why` records where
// the budget came from. measure() returns { value, note? } or throws.
//
// A signal that cannot be read is never a zero and never a pass: collect() turns
// any throw into { value: null, reason }, and the report renders that as "not
// measured" and counts it with the signals outside their budget.

import { CODE_SIGNALS } from './code.mjs'
import { DEPENDENCY_SIGNALS } from './deps.mjs'
import { DOCS_SIGNALS } from './docs.mjs'
import { TEST_SIGNALS } from './tests.mjs'
import { Unmeasured } from './unmeasured.mjs'

export const UNEXPECTED_FAILURE = 'the measurement failed; see the run log'

export const SIGNALS = [...CODE_SIGNALS, ...DEPENDENCY_SIGNALS, ...DOCS_SIGNALS, ...TEST_SIGNALS]

const describe = ({ id, family, label, unit, better, budget, needs }) => ({
  id,
  family,
  label,
  unit,
  better,
  budget,
  needs
})

// Runs every signal. One that throws does not stop the others: a report with one
// unreadable row is still worth publishing, and the row says it was not read.
export const collect = ({ signals = SIGNALS, ctx, log = () => {} }) =>
  signals.map((signal) => {
    try {
      const { value, note = null } = signal.measure(ctx)
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`measure() returned ${JSON.stringify(value)}, not a number`)
      }
      return { ...describe(signal), value, note, reason: null }
    } catch (error) {
      const known = error instanceof Unmeasured
      if (!known) log(`${signal.id}: ${error.message}`)
      return {
        ...describe(signal),
        value: null,
        note: null,
        reason: known ? error.reason : UNEXPECTED_FAILURE
      }
    }
  })
