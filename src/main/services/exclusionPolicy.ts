import * as caseRepo from '@main/services/db/caseRepo'
import { safeRegexTest } from '@main/services/safeRegex'
import { getSettings } from '@main/services/settings'
import { matchIgnoredUrl, resolveEffectiveIgnorePatterns } from '@shared/urlPatterns'

/**
 * The one place the per-case exclusion list is turned into an enforcement
 * answer (#400).
 *
 * It lives here rather than inside `captureServer` because the list blocks
 * every capture route into a case, not only the extension's (ruled
 * 2026-08-21), and `recapture` is the other producer. Two copies of an
 * enforcement rule drift, and this is the rule the ticket exists to make.
 */

/**
 * The patterns in force for one case: the operator's global ignore list plus
 * the case's own, or the case's alone under 'override'.
 *
 * Read on every call rather than cached, because a policy edit has to take
 * effect on the next capture — the extension's mirror of this list is advisory
 * and the callers here are the enforcement points. The case is looked up by id,
 * so an unknown id yields the global list rather than an empty one: an id that
 * resolves to no case never reaches a capture anyway (the handler 404s first),
 * and answering "nothing is excluded" would be the wrong default if it ever did.
 */
export function effectiveIgnorePatternsForCase(caseId: string | null): string[] {
  const globalPatterns = getSettings().ignoredUrlPatterns
  if (!caseId) return [...globalPatterns]
  const { exclusions, mode } = caseRepo.getAutoCapturePolicy(caseId)
  return resolveEffectiveIgnorePatterns(globalPatterns, exclusions, mode)
}

/**
 * Regex literals are evaluated in the vm sandbox: the patterns come from
 * settings, so a catastrophically backtracking one must not stall the caller.
 * Containment is fail-open — a pattern that exhausts the 200 ms budget yields
 * no match, so the capture is accepted rather than refused. See matchIgnoredUrl.
 */
export function isUrlBlacklisted(url: string, patterns: readonly string[]): string | null {
  return matchIgnoredUrl(url, patterns, safeRegexTest)
}

/**
 * The pattern excluding `url` from `caseId`, or null. The composition of the
 * two functions above, which is what every enforcement site actually wants.
 */
export function matchCaseExclusion(url: string, caseId: string | null): string | null {
  return isUrlBlacklisted(url, effectiveIgnorePatternsForCase(caseId))
}

/**
 * The `skipReason` a blocked capture is reported under, in the capture activity
 * feed and in the recapture queue's rejection list. One wording for one rule:
 * an operator who sees it on the extension route should see the same words when
 * a recapture is refused for the same pattern.
 */
export function blockedSkipReason(pattern: string): string {
  return 'Blacklisted: ' + pattern
}
