/**
 * Why a regex selector's pattern cannot be compiled, or null when it can.
 *
 * Compiled with the flags the matcher uses ('gi' in safeRegexTest), so a
 * pattern this accepts is one the matcher can run. The matcher swallows a
 * SyntaxError and reports no match, which is why an invalid pattern has to be
 * refused before it is saved: stored, it would read as "the term is absent"
 * (#1754). Exact-text selectors need no check.
 */
export function regexPatternError(pattern: string): string | null {
  try {
    new RegExp(pattern, 'gi')
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
