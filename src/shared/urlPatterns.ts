// Ignored-URL matching for the capture pipeline.
//
// Two callers, one implementation: the capture server rejects a capture whose
// URL matches an ignored pattern, and the extension's background script skips
// the capture before it is ever offered. The two must agree — a URL one side
// considers ignored and the other does not is a hole in what the operator
// believes was excluded from the case. They do agree on every pattern both can
// evaluate; see `matchIgnoredUrl` for the one input class where they do not.
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
 * extension has no such primitive and uses the platform RegExp. Pattern
 * grammar is identical either way — same three forms in the same order, same
 * glob escape set, same case sensitivity — and so is the answer, for every
 * pattern both evaluators can decide.
 *
 * They do NOT agree on a pattern that backtracks past the main process's
 * budget. `safeRegexTest` returns false when its vm budget expires (200 ms in
 * production), so the server reports such a URL as *not* ignored while the
 * extension, which has no budget, eventually reports the match. That direction
 * is fail-open on the server: an operator's ignore rule can admit a capture
 * rather than refuse it. Every live extension route pre-filters with this
 * matcher — including the popup's Capture button, which left the server's 403
 * as sole enforcement until #387 closed it — so on a pattern of that class the
 * extension refuses a capture the server would have accepted.
 *
 * That holds only once the extension has the rules. They reach the service
 * worker with the first successful status poll and live in worker memory, so
 * between a cold start and that poll the pattern list is empty and this matcher
 * answers "not ignored" for everything. The extension routes therefore gate on
 * `PopupPageStatus.rulesLoaded` rather than on this matcher alone: no capture
 * route runs while the list may be empty. Without that gate the pre-filter is
 * fail-open in the same direction as the server, and for a much wider class of
 * pattern.
 * Pinned as a known answer in `tests/shared/urlPatterns.test.ts` (with the
 * budget injected, so the pin is on the semantics and not on the runner's
 * hardware); closing it means changing what a timeout means, which is a
 * behaviour change this module does not make.
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
