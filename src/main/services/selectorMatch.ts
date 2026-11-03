import type { Selector } from '@shared/types'
import {
  DEFAULT_REGEX_TIMEOUT_MS,
  safeRegexOutcome,
  type SafeRegexOutcome
} from '@main/services/safeRegex'

/**
 * Single source of truth for "does this Selector hit this text". Never throws:
 * the regex path delegates to safeRegexOutcome, which reports a timeout apart
 * from no match; the substring path is plain JS and cannot time out. Nothing
 * here touches the database, so code without one can apply the same rule.
 * `budgetMs` carries the contract `safeRegexTest` states.
 */
export function selectorMatchOutcome(
  selector: Selector,
  text: string,
  budgetMs: number = DEFAULT_REGEX_TIMEOUT_MS
): SafeRegexOutcome {
  if (selector.isRegex) {
    return safeRegexOutcome(selector.pattern, 'gi', text, budgetMs)
  }
  return text.toLowerCase().includes(selector.pattern.toLowerCase()) ? 'match' : 'no-match'
}

/**
 * The answer the Selector repo writes Persisted Matches from: a timeout counts
 * as no match.
 */
export function selectorMatchesText(
  selector: Selector,
  text: string,
  budgetMs: number = DEFAULT_REGEX_TIMEOUT_MS
): boolean {
  return selectorMatchOutcome(selector, text, budgetMs) === 'match'
}
