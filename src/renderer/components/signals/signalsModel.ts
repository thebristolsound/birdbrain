import type { AutoCaptureExclusionMode, Selector, SelectorOrigin, Tag } from '@shared/types'

// Pure model for the Signals screen (#400). Every string the operator reads and
// every decision about what a row shows is computed here rather than inside a
// component, so the copy that describes what the software captures can be
// pinned by a test instead of by a screenshot.

export type SignalKind = 'selector' | 'tag'

/** One row on the Signals screen. Selectors and Tags share the shape. */
export interface Signal {
  id: string
  kind: SignalKind
  /** Selector label or pattern; tag name. */
  name: string
  /** The selector's pattern, shown under the name. Empty for a tag. */
  sub: string
  /** How many captures this signal matched or was applied to, case-wide. */
  count: number
  /** Selectors can be switched off; a tag is always in force. */
  enabled: boolean
  isRegex: boolean
  color?: string
  origin?: SelectorOrigin
  /** Which of the recent captures it covers. See SIGNAL_COVERAGE_CAPTURES. */
  captureIds: string[]
}

/** Tag colours, in the order the design assigns them to new tags. */
export const TAG_PALETTE = [
  '#f59e0b',
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#f97316'
] as const

/**
 * The palette with a name against each swatch, for surfaces that must say a
 * colour rather than draw one — the row context menu's "Change color" submenu,
 * where a hex string would be the item's accessible name (#701).
 *
 * The names are the Tailwind names of these exact values (`amber-500`,
 * `red-500`, …), which is where the palette came from; they are not invented
 * here.
 */
export const TAG_PALETTE_LABELS: { value: string; label: string }[] = [
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#f97316', label: 'Orange' }
]

/** The colour a new tag gets, cycling through the palette by tag count. */
export function nextTagColor(existingCount: number): string {
  return TAG_PALETTE[existingCount % TAG_PALETTE.length]
}

export function buildSelectorSignals(
  selectors: Selector[],
  matchCounts: Record<string, number>,
  matrix: Record<string, string[]>
): Signal[] {
  return selectors.map((selector) => ({
    id: selector.id,
    kind: 'selector' as const,
    name: selector.label || selector.pattern,
    sub: selector.pattern,
    count: matchCounts[selector.id] ?? 0,
    enabled: selector.enabled,
    isRegex: selector.isRegex,
    origin: selector.origin,
    captureIds: matrix[selector.id] ?? []
  }))
}

export function buildTagSignals(
  tags: Tag[],
  usageCounts: Record<string, number>,
  matrix: Record<string, string[]>
): Signal[] {
  return tags.map((tag) => ({
    id: tag.id,
    kind: 'tag' as const,
    name: tag.name,
    sub: '',
    count: usageCounts[tag.id] ?? 0,
    // A tag has no enabled flag: it is applied by hand, so it is either on a
    // capture or it is not. Reporting it as switchable would invite an operator
    // to look for a control that does not exist.
    enabled: true,
    isRegex: false,
    color: tag.color || TAG_PALETTE[0],
    captureIds: matrix[tag.id] ?? []
  }))
}

/**
 * The Auto-capture card's description, and the disclosure under it.
 *
 * The description used to say that any page matching an enabled selector is
 * captured automatically while browsing. Nothing shipped does that: both
 * passive producers in the extension's service worker — shouldCapture/
 * captureTab and shouldSelectorCapture/handleSelectorCapture — sit inside the
 * hotfix comment block, so no page is captured without an explicit action. The
 * sentence is written to be true on its own rather than corrected by the
 * disclosure below it, because a screenshot of the card, or an operator who
 * reads only the heading, carries the primary sentence and not the footnote.
 */
export const AUTO_CAPTURE_DESCRIPTION =
  'App-wide setting — it records whether pages matching an enabled selector should be ' +
  'captured while browsing. It applies to every case, not only this one.'

export const AUTO_CAPTURE_SUSPENDED =
  'Passive capture is suspended in the current extension build, so no page is captured ' +
  'without an explicit action. The switch records the preference for when it returns (#600).'

/**
 * The collapsed summary on the Auto-capture card: how many exclusions this case
 * carries, and what they do to the global list.
 */
export function exclusionSummary(count: number, mode: AutoCaptureExclusionMode): string {
  const noun = count === 1 ? 'exclusion' : 'exclusions'
  const suffix = mode === 'override' ? 'overrides global' : '+ global'
  return `${count} ${noun} · ${suffix}`
}

/**
 * The footer under the exclusion chips.
 *
 * Two deliberate departures from the design's copy, both recorded as
 * constraints on #400 rather than invented here:
 *
 *  - The design points at "Settings → Privacy". No such section exists; the
 *    global list lives under Settings → Capture Preferences, and a pointer to a
 *    screen the operator cannot find is worse than none.
 *  - The design says matching pages are "never captured, even by selectors".
 *    The maintainer ruled on 2026-08-21 that the list blocks every capture
 *    route including manual, so the copy names every route rather than
 *    singling out the one the design happened to mention.
 *
 * The entry count is live, not the design's seeded 12.
 *
 * The pipeline self-test (`POST /api/captures/test`) is exempt from the list
 * (#766), and the string is deliberately not qualified for it: it captures no
 * page. Its URL is a fixed `birdbrain://pipeline-test` sentinel that fetches
 * nothing, so the promise the operator relies on — that a page they excluded
 * never enters the case — holds absolutely. Since #614 the self-test ingests
 * into a throwaway sandbox rather than a real case, so it leaves no residue to
 * qualify the string for either. The exemption is documented at the call site.
 */
export function exclusionFooter(mode: AutoCaptureExclusionMode, globalCount: number): string {
  const entries = `${globalCount} ${globalCount === 1 ? 'entry' : 'entries'}`
  const scope =
    'Matching pages are never captured for this case, by any route, including manual capture.'
  return mode === 'override'
    ? `Only these patterns are excluded for this case; the global ignore list ` +
        `(${entries}, Settings → Capture Preferences) is bypassed. ${scope}`
    : `Applied on top of the global ignore list (${entries}, Settings → Capture ` +
        `Preferences). ${scope}`
}

/**
 * What one selector or tag covers, in words.
 *
 * Not the design's "N matches · in M of K captures": that needs a per-selector
 * count of match *occurrences*, and the database stores one row per matched
 * capture rather than per occurrence, so N and M would always be the same
 * number printed twice. Recorded as a constraint on #400.
 */
export function signalCountLabel(signal: Signal, totalCaptures: number): string {
  const captures = `${totalCaptures} ${totalCaptures === 1 ? 'capture' : 'captures'}`
  const verb = signal.kind === 'tag' ? 'Applied to' : 'Matches'
  return `${verb} ${signal.count} of ${captures}`
}

/**
 * Reads what the operator typed into the add-selector row.
 *
 * A value wrapped in slashes forces regex mode and loses them, whichever mode
 * the chip is in — the design's shortcut, and the reason the keyboard legend
 * lists `/…/`. Returns null for an empty pattern, which is not an error worth
 * reporting: it is the Enter keystroke that ends a typing run.
 */
export function parseSelectorInput(
  raw: string,
  regexMode: boolean
): { pattern: string; isRegex: boolean } | null {
  let pattern = raw.trim()
  let isRegex = regexMode
  const lastSlash = pattern.lastIndexOf('/')
  if (pattern.length > 2 && pattern.startsWith('/') && lastSlash > 0) {
    isRegex = true
    pattern = pattern.slice(1, lastSlash)
  }
  if (!pattern) return null
  return { pattern, isRegex }
}

/**
 * Tag names are slugs: a leading # is dropped, runs of whitespace become single
 * hyphens, and the result is lowercased, so 'Bank Records' and '#bank records'
 * are the same tag rather than two that look alike in a list.
 */
export function slugifyTagName(raw: string): string {
  return raw.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()
}

export interface BulkParseResult {
  /** Patterns that are new to this case, in the order they were pasted. */
  unique: string[]
  blankCount: number
  withinPasteDuplicates: number
  existingDuplicates: number
}

/**
 * Splits a pasted block into new patterns plus the counts the drawer reports.
 *
 * Lifted unchanged from the Bulk Add modal this screen replaces: the counts are
 * a capability the redesign must not drop, and their exact arithmetic (a
 * within-paste repeat and an already-present pattern are counted separately,
 * case-insensitively unless the batch is regex) is pinned by e2e.
 */
export function parseBulkPatterns(
  raw: string,
  existingSelectors: Selector[],
  isRegex: boolean
): BulkParseResult {
  const key = (value: string): string => (isRegex ? value : value.toLowerCase())
  const seen = new Set<string>()
  const pasted: string[] = []
  let blankCount = 0
  let withinPasteDuplicates = 0

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      blankCount++
      continue
    }
    if (seen.has(key(trimmed))) {
      withinPasteDuplicates++
      continue
    }
    seen.add(key(trimmed))
    pasted.push(trimmed)
  }

  const existingKeys = new Set(
    existingSelectors.filter((s) => s.isRegex === isRegex).map((s) => key(s.pattern))
  )
  const unique: string[] = []
  let existingDuplicates = 0
  for (const pattern of pasted) {
    if (existingKeys.has(key(pattern))) existingDuplicates++
    else unique.push(pattern)
  }

  return { unique, blankCount, withinPasteDuplicates, existingDuplicates }
}
