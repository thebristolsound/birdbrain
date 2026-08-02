// Ignored-URL matching for the capture pipeline.
//
// Two callers, one implementation: the capture server rejects a capture whose
// URL matches an ignored pattern, and the extension's background script skips
// the capture before it is ever offered. The two must agree — a URL one side
// considers ignored and the other does not is a hole in what the operator
// believes was excluded from the case.
//
// A pattern is read as exactly one of three forms, tried in this order:
//   1. `/body/flags` — a regex literal (needs a closing slash past position 0)
//   2. anything containing `*` or `?` — a glob
//   3. everything else — a case-sensitive substring
//
// A pattern that throws (an unparseable regex, say) is skipped rather than
// failing the whole check: one bad entry in Settings must not silently disable
// every other ignore rule.

/** How a regex-literal pattern is evaluated. See `matchIgnoredUrl`. */
export type RegexTest = (source: string, flags: string, text: string) => boolean

const testWithRegExp: RegexTest = (source, flags, text) => new RegExp(source, flags).test(text)

/**
 * Glob → RegExp: `*` and `?` are the only wildcards, every other regex
 * metacharacter is escaped to its literal self. Case-insensitive and
 * unanchored, so a glob matches anywhere in the URL.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(withWildcards, 'i')
}

/**
 * Returns the first pattern in `patterns` that matches `url`, or null when
 * none does. The pattern is returned, not just a boolean, because both callers
 * report *which* rule excluded a URL (the server puts it in the skip event and
 * the 403 body).
 *
 * `regexTest` exists because only the main process can afford a sandboxed,
 * timeout-bounded regex evaluation (`safeRegexTest`, backed by node:vm); the
 * extension has no such primitive and uses the platform RegExp. Matching
 * semantics are identical either way — the seam only decides how a
 * catastrophically backtracking pattern is contained.
 */
export function matchIgnoredUrl(
  url: string,
  patterns: readonly string[],
  regexTest: RegexTest = testWithRegExp
): string | null {
  for (const pattern of patterns) {
    try {
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/')
        const source = pattern.slice(1, lastSlash)
        const flags = pattern.slice(lastSlash + 1)
        if (regexTest(source, flags, url)) return pattern
      } else if (pattern.includes('*') || pattern.includes('?')) {
        if (globToRegex(pattern).test(url)) return pattern
      } else {
        if (url.includes(pattern)) return pattern
      }
    } catch {
      // Invalid pattern, skip
    }
  }
  return null
}
