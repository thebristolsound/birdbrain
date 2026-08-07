import { runInNewContext } from 'vm'

/**
 * The budget a single pattern evaluation gets in production. Every call site
 * omits the argument below, so this number is what decides whether an ignore
 * rule is enforced or fails open on a pattern that backtracks past it.
 */
export const DEFAULT_REGEX_TIMEOUT_MS = 200

/**
 * Evaluates `pattern` against `text` in a vm sandbox under a wall-clock budget,
 * answering false for anything that throws: an unparseable pattern, invalid
 * flags, or the budget expiring mid-backtrack.
 *
 * `budgetMs` exists for the tests that pin the budget-expiry answer (#330).
 * Pinning it at the production 200 ms means finding an input the sandbox cannot
 * finish within 200 ms on any runner, which is a race against hardware;
 * injecting a budget far below the input's real cost makes the same assertion
 * deterministic. No production caller passes it.
 *
 * It must be a positive integer of milliseconds — node:vm rejects 0 and
 * negatives, and the catch below would turn that rejection into a blanket false,
 * i.e. every ignore rule failing open. Not a knob to route to configuration
 * without validating it first.
 */
export function safeRegexTest(
  pattern: string,
  flags: string,
  text: string,
  budgetMs: number = DEFAULT_REGEX_TIMEOUT_MS
): boolean {
  try {
    return runInNewContext(
      'new RegExp(pattern, flags).test(text)',
      { pattern, flags, text },
      { timeout: budgetMs }
    ) as boolean
  } catch {
    return false
  }
}
