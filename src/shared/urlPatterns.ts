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

import type { AutoCaptureExclusionMode } from '@shared/types'

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

/**
 * Whether `pattern` is one this module can evaluate, and why not when it is
 * not. Checked at the write seam so a rule that can never match is refused
 * when it is typed rather than skipped in silence at capture time —
 * `matchIgnoredUrl` swallows a throwing pattern by design, so without this a
 * mistyped regex reads to the operator as an active exclusion while enforcing
 * nothing at all.
 *
 * Only the regex form can fail to compile: a glob is escaped into a valid
 * RegExp by construction and a substring is always evaluable. Note what this
 * does NOT reject — a pattern that compiles but backtracks catastrophically.
 * That one is contained at match time by the server's time-budgeted evaluator,
 * and containment there is fail-open (see above).
 */
export function validateIgnorePattern(
  pattern: string
): { ok: true } | { ok: false; reason: string } {
  const trimmed = pattern.trim()
  if (!trimmed) return { ok: false, reason: 'Pattern is empty' }
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/')
    try {
      new RegExp(trimmed.slice(1, lastSlash), trimmed.slice(lastSlash + 1))
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'Invalid regular expression'
      }
    }
  }
  return { ok: true }
}

/**
 * The patterns actually in force for one case (#400): the operator's global
 * ignore list combined with the case's own, per the case's mode.
 *
 * Global entries come first under `stack`, so a URL on both lists is reported
 * as blocked by the global rule — `matchIgnoredUrl` returns the first match,
 * and naming the broader policy is the more useful answer. Exact-string
 * duplicates collapse, so a pattern on both lists is evaluated once.
 *
 * Under `override` the global list is dropped for this case. That is the point
 * of the mode, and it is the only place in the app where one case is more
 * permissive than the global policy. It does not reach the extension's
 * built-in scheme list (`matchesDefaultIgnore`), which is not an operator rule
 * and stays unconditional.
 */
export function resolveEffectiveIgnorePatterns(
  globalPatterns: readonly string[],
  casePatterns: readonly string[],
  mode: AutoCaptureExclusionMode
): string[] {
  const ordered = mode === 'override' ? casePatterns : [...globalPatterns, ...casePatterns]
  const seen = new Set<string>()
  const effective: string[] = []
  for (const pattern of ordered) {
    if (seen.has(pattern)) continue
    seen.add(pattern)
    effective.push(pattern)
  }
  return effective
}
