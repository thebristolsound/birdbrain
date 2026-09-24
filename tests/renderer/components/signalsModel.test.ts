import { describe, it, expect } from 'vitest'
import type { Selector, Tag } from '@shared/types'
import {
  AUTO_CAPTURE_DESCRIPTION,
  AUTO_CAPTURE_SUSPENDED,
  buildSelectorSignals,
  buildTagSignals,
  exclusionFooter,
  exclusionSummary,
  findDuplicateSelector,
  findTagByName,
  nextTagColor,
  parseBulkPatterns,
  parseSelectorInput,
  signalCountLabel,
  slugifyTagName,
  TAG_PALETTE,
  TAG_PALETTE_LABELS
} from '@renderer/components/signals/signalsModel'

const selector = (over: Partial<Selector> = {}): Selector => ({
  id: 's1',
  caseId: 'case-1',
  pattern: 'acme',
  isRegex: false,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over
})

const tag = (over: Partial<Tag> = {}): Tag => ({
  id: 't1',
  name: 'evidence',
  color: '#f59e0b',
  ...over
})

describe('buildSelectorSignals', () => {
  it('prefers the label over the pattern for the row name, keeping the pattern below', () => {
    const [signal] = buildSelectorSignals([selector({ label: 'Acme mentions' })], {}, {})

    expect(signal.name).toBe('Acme mentions')
    expect(signal.sub).toBe('acme')
  })

  it('falls back to the pattern when there is no label', () => {
    expect(buildSelectorSignals([selector()], {}, {})[0].name).toBe('acme')
  })

  it('reads a missing count and a missing matrix row as zero coverage', () => {
    const [signal] = buildSelectorSignals([selector()], {}, {})

    expect(signal.count).toBe(0)
    expect(signal.captureIds).toEqual([])
  })

  it('carries count, coverage, enabled state and origin through', () => {
    const [signal] = buildSelectorSignals(
      [selector({ enabled: false, isRegex: true, origin: 'extension' })],
      { s1: 7 },
      { s1: ['c1', 'c2'] }
    )

    expect(signal).toMatchObject({
      kind: 'selector',
      count: 7,
      enabled: false,
      isRegex: true,
      origin: 'extension',
      captureIds: ['c1', 'c2']
    })
  })
})

describe('buildTagSignals', () => {
  it('reports a tag as always in force, since it is applied by hand', () => {
    expect(buildTagSignals([tag()], {}, {})[0].enabled).toBe(true)
  })

  it('defaults a colourless tag to the first palette entry', () => {
    expect(buildTagSignals([tag({ color: undefined })], {}, {})[0].color).toBe(TAG_PALETTE[0])
  })

  it('carries usage count and coverage through, with no pattern line', () => {
    const [signal] = buildTagSignals([tag()], { t1: 3 }, { t1: ['c1'] })

    expect(signal).toMatchObject({ kind: 'tag', count: 3, sub: '', captureIds: ['c1'] })
  })
})

// Two hand-maintained lists of the same eight colours. The detail rail draws
// TAG_PALETTE_LABELS and compares its values against a tag colour that came
// from TAG_PALETTE (#472), so a drift between them silently unnames a swatch or
// leaves the selected one unmarked.
describe('TAG_PALETTE_LABELS', () => {
  it('names the palette in the palette order, entry for entry', () => {
    expect(TAG_PALETTE_LABELS.map(({ value }) => value)).toEqual([...TAG_PALETTE])
  })

  it('gives every swatch a word rather than a hex', () => {
    for (const { label } of TAG_PALETTE_LABELS) expect(label).toMatch(/^[A-Z][a-z]+$/)
  })
})

describe('nextTagColor', () => {
  it('walks the palette and wraps', () => {
    expect(nextTagColor(0)).toBe(TAG_PALETTE[0])
    expect(nextTagColor(3)).toBe(TAG_PALETTE[3])
    expect(nextTagColor(TAG_PALETTE.length)).toBe(TAG_PALETTE[0])
  })
})

// The card's primary description is what a screenshot carries and what an
// operator who skips the footnote takes away, so it is held to what the shipped
// build does rather than corrected by the disclosure under it (#600).
describe('auto-capture copy', () => {
  it('does not promise that browsing captures pages by itself', () => {
    expect(AUTO_CAPTURE_DESCRIPTION).not.toMatch(/captured automatically/)
    expect(AUTO_CAPTURE_DESCRIPTION).toContain('records whether')
  })

  it('still says the setting is app-wide, since the exclusions beside it are not', () => {
    expect(AUTO_CAPTURE_DESCRIPTION).toContain('App-wide setting')
    expect(AUTO_CAPTURE_DESCRIPTION).toContain('every case, not only this one')
  })

  it('discloses the suspension and where passive capture returns', () => {
    expect(AUTO_CAPTURE_SUSPENDED).toContain('Passive capture is suspended')
    expect(AUTO_CAPTURE_SUSPENDED).toContain('without an explicit action')
    expect(AUTO_CAPTURE_SUSPENDED).toContain('#600')
  })
})

describe('exclusionSummary', () => {
  it.each([
    [0, 'stack', '0 exclusions · + global'],
    [1, 'stack', '1 exclusion · + global'],
    [3, 'stack', '3 exclusions · + global'],
    [1, 'override', '1 exclusion · overrides global'],
    [3, 'override', '3 exclusions · overrides global']
  ] as const)('reads %s / %s as "%s"', (count, mode, expected) => {
    expect(exclusionSummary(count, mode)).toBe(expected)
  })
})

describe('exclusionFooter', () => {
  // The copy states what the software does with the patterns, so it is pinned
  // by exact string. Two departures from the design are deliberate and are
  // recorded on #400: the section it points at, and the scope it claims.
  it('points at Capture Preferences, which is where the global list actually is', () => {
    for (const mode of ['stack', 'override'] as const) {
      expect(exclusionFooter(mode, 4)).toContain('Settings → Capture Preferences')
      expect(exclusionFooter(mode, 4)).not.toContain('Privacy')
    }
  })

  it('names every capture route, not only selectors', () => {
    for (const mode of ['stack', 'override'] as const) {
      expect(exclusionFooter(mode, 4)).toContain('by any route, including manual capture')
      expect(exclusionFooter(mode, 4)).not.toContain('even by selectors')
    }
  })

  it('reports the live global entry count, singular and plural', () => {
    expect(exclusionFooter('stack', 1)).toContain('(1 entry, ')
    expect(exclusionFooter('stack', 12)).toContain('(12 entries, ')
    expect(exclusionFooter('stack', 0)).toContain('(0 entries, ')
  })

  it('says the global list is bypassed only under override', () => {
    expect(exclusionFooter('override', 4)).toContain('is bypassed')
    expect(exclusionFooter('stack', 4)).toContain('Applied on top of the global ignore list')
    expect(exclusionFooter('stack', 4)).not.toContain('bypassed')
  })
})

describe('signalCountLabel', () => {
  it('says a selector matches and a tag is applied', () => {
    const [sel] = buildSelectorSignals([selector()], { s1: 2 }, {})
    const [t] = buildTagSignals([tag()], { t1: 2 }, {})

    expect(signalCountLabel(sel, 9)).toBe('Matches 2 of 9 captures')
    expect(signalCountLabel(t, 9)).toBe('Applied to 2 of 9 captures')
  })

  it('singularises a lone capture', () => {
    const [sel] = buildSelectorSignals([selector()], { s1: 1 }, {})
    expect(signalCountLabel(sel, 1)).toBe('Matches 1 of 1 capture')
  })
})

describe('parseSelectorInput', () => {
  it('trims and keeps the chip mode when there are no slashes', () => {
    expect(parseSelectorInput('  acme  ', false)).toEqual({ pattern: 'acme', isRegex: false })
    expect(parseSelectorInput('acme', true)).toEqual({ pattern: 'acme', isRegex: true })
  })

  it('forces regex and strips the slashes for a /…/ value', () => {
    expect(parseSelectorInput('/bc1[a-z0-9]{20,}/', false)).toEqual({
      pattern: 'bc1[a-z0-9]{20,}',
      isRegex: true
    })
  })

  it('leaves a path-like value alone: one slash is not a regex literal', () => {
    expect(parseSelectorInput('/etc/passwd', false)).toEqual({
      pattern: 'etc',
      isRegex: true
    })
  })

  it('returns null for an empty or whitespace-only value', () => {
    expect(parseSelectorInput('', false)).toBeNull()
    expect(parseSelectorInput('   ', false)).toBeNull()
  })

  it('returns null when the slashes would leave an empty pattern', () => {
    expect(parseSelectorInput('//x', false)).toBeNull()
  })

  it('reads a bare pair of slashes as a substring, not an empty regex', () => {
    // Under three characters there is no room for a body, so the /…/ shortcut
    // does not fire and the value is what it looks like: two slashes.
    expect(parseSelectorInput('//', false)).toEqual({ pattern: '//', isRegex: false })
  })
})

describe('slugifyTagName', () => {
  it.each([
    ['Bank Records', 'bank-records'],
    ['#crypto', 'crypto'],
    ['  Mixed   Case  ', 'mixed-case'],
    ['#Bank  Records', 'bank-records']
  ])('slugs %s to %s', (raw, expected) => {
    expect(slugifyTagName(raw)).toBe(expected)
  })

  it('is empty for an empty or hash-only value', () => {
    expect(slugifyTagName('   ')).toBe('')
    expect(slugifyTagName('#')).toBe('')
  })
})

describe('parseBulkPatterns', () => {
  // The exact arithmetic e2e/bulk-selectors.spec.ts pins: three unique
  // patterns, one within-paste repeat, two blank lines.
  it('separates new patterns from within-paste repeats and blank lines', () => {
    const result = parseBulkPatterns('alpha\nbeta\n\ngamma\nalpha\n', [], false)

    expect(result.unique).toEqual(['alpha', 'beta', 'gamma'])
    expect(result.withinPasteDuplicates).toBe(1)
    expect(result.blankCount).toBe(2)
    expect(result.existingDuplicates).toBe(0)
  })

  it('counts a pattern this case already holds as an existing duplicate', () => {
    const result = parseBulkPatterns('alpha', [selector({ pattern: 'alpha' })], false)

    expect(result.unique).toEqual([])
    expect(result.existingDuplicates).toBe(1)
  })

  it('matches existing patterns case-insensitively unless the batch is regex', () => {
    const existing = [selector({ pattern: 'Alpha' })]

    expect(parseBulkPatterns('alpha', existing, false).existingDuplicates).toBe(1)
    // A regex batch compares exactly: case is meaningful inside a pattern.
    expect(
      parseBulkPatterns('alpha', [selector({ pattern: 'Alpha', isRegex: true })], true)
        .existingDuplicates
    ).toBe(0)
  })

  it('only compares against selectors of the same kind', () => {
    const existing = [selector({ pattern: 'alpha', isRegex: true })]

    expect(parseBulkPatterns('alpha', existing, false).unique).toEqual(['alpha'])
  })

  it('trims each line before comparing', () => {
    expect(parseBulkPatterns('  alpha  \nalpha', [], false)).toMatchObject({
      unique: ['alpha'],
      withinPasteDuplicates: 1
    })
  })

  it('handles CRLF input', () => {
    expect(parseBulkPatterns('alpha\r\nbeta', [], false).unique).toEqual(['alpha', 'beta'])
  })
})

// #1549: the inline add row refuses on the same rule bulk import applies, so
// the two routes in one card cannot disagree about what a duplicate is.
describe('findDuplicateSelector', () => {
  it('agrees with bulk import on every pairing', () => {
    const existing = [
      selector({ id: 'a', pattern: 'Alpha' }),
      selector({ id: 'b', pattern: 'Beta', isRegex: true })
    ]
    const cases: Array<[string, boolean]> = [
      ['alpha', false],
      ['ALPHA', false],
      ['alpha', true],
      ['Beta', true],
      ['beta', true],
      ['Beta', false],
      ['gamma', false]
    ]
    for (const [pattern, isRegex] of cases) {
      const bulkSaysDuplicate = parseBulkPatterns(pattern, existing, isRegex).existingDuplicates > 0
      expect(Boolean(findDuplicateSelector(existing, pattern, isRegex))).toBe(bulkSaysDuplicate)
    }
  })

  it('returns the selector it collides with', () => {
    const existing = [selector({ id: 'a', pattern: 'Alpha' })]
    expect(findDuplicateSelector(existing, 'alpha', false)?.id).toBe('a')
  })
})

describe('findTagByName', () => {
  const tags = [tag({ id: 't1', name: 'evidence' }), tag({ id: 't2', name: 'Finance' })]

  // Case-insensitive, the rule main's find-or-create reuses a tag on.
  it('finds a taken name whatever its letter case', () => {
    expect(findTagByName(tags, 'EVIDENCE')?.id).toBe('t1')
    expect(findTagByName(tags, 'finance')?.id).toBe('t2')
    expect(findTagByName(tags, 'other')).toBeUndefined()
  })

  it('leaves out the tag being renamed', () => {
    expect(findTagByName(tags, 'Evidence', 't1')).toBeUndefined()
    expect(findTagByName(tags, 'evidence', 't2')?.id).toBe('t1')
  })
})
