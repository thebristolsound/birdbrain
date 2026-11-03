import { runInNewContext } from 'vm'

/**
 * The budget a single pattern evaluation gets in production. No production call
 * path passes a budget, so on a pattern that backtracks past this number an
 * ignore rule fails open and a regex Selector records no match.
 */
export const DEFAULT_REGEX_TIMEOUT_MS = 200

export type SafeRegexOutcome = 'match' | 'no-match' | 'timeout'

/**
 * Evaluates `pattern` against `text` in a vm sandbox under a wall-clock budget,
 * answering true only for a match. `safeRegexOutcome` below runs the evaluation
 * and reports a timeout apart from no match; this form answers false for both.
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
  return safeRegexOutcome(pattern, flags, text, budgetMs) === 'match'
}

/**
 * Answers 'timeout' only when the budget expires mid-evaluation, and 'no-match'
 * for anything else that throws: an unparseable pattern, invalid flags, or a
 * budget node:vm rejects. `budgetMs` carries the contract `safeRegexTest` states.
 */
export function safeRegexOutcome(
  pattern: string,
  flags: string,
  text: string,
  budgetMs: number = DEFAULT_REGEX_TIMEOUT_MS
): SafeRegexOutcome {
  try {
    const matched = runInNewContext(
      'new RegExp(pattern, flags).test(text)',
      { pattern, flags, text },
      { timeout: budgetMs }
    ) as boolean
    return matched ? 'match' : 'no-match'
  } catch (err) {
    // The timeout error fails `instanceof Error` in this realm, so read its code.
    const code = (err as { code?: unknown } | null)?.code
    return code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'no-match'
  }
}
