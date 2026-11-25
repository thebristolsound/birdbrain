import { describe, expect, it } from 'vitest'
import {
  DEPENDENCY_SIGNALS,
  countDependabotEntries,
  daysToExpiry
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/deps.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { ctxOf, knipIssue, signalOf } from './helpers'

const measure = (id: string, ctx: ReturnType<typeof ctxOf>) =>
  signalOf(DEPENDENCY_SIGNALS, id).measure(ctx)

const exception = (expires: string, ghsa = 'GHSA-aaaa-bbbb-cccc') => ({
  ghsa,
  package: 'left-pad',
  tree: '.',
  path: '.>left-pad',
  reason: 'test fixture',
  expires
})

const exceptionsFile = (...expiries: string[]) =>
  JSON.stringify({ exceptions: expiries.map((expires) => exception(expires)) })

const DEPENDABOT = [
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  '    ignore:',
  "      - dependency-name: 'vitest'",
  "        update-types: ['version-update:semver-major']",
  '      # - dependency-name: commented-out',
  "      - dependency-name: '@vitest/*'",
  '    groups:',
  '      minor:',
  "        exclude-patterns: ['sharp']",
  ''
].join('\n')

describe('deferred dependency decisions', () => {
  it('adds the audit exceptions to the Dependabot ignores and says which is which', () => {
    const ctx = ctxOf({
      'audit-exceptions.json': exceptionsFile('2026-12-31', '2027-01-15', '2027-02-01'),
      '.github/dependabot.yml': DEPENDABOT
    })
    expect(measure('deferred-dependency-decisions', ctx)).toEqual({
      value: 5,
      note: '3 audit exception(s) and 2 Dependabot ignore(s)'
    })
  })

  it('is not measured when the exceptions file is missing, malformed or not a list', () => {
    const reason = 'audit-exceptions.json could not be read as an exceptions list'
    const without = ctxOf({ '.github/dependabot.yml': DEPENDABOT })
    expect(() => measure('deferred-dependency-decisions', without)).toThrow(Unmeasured)
    expect(() => measure('deferred-dependency-decisions', without)).toThrow(reason)
    for (const content of ['{ not json', '{}', '{"exceptions":[{"ghsa":"GHSA-x"}]}']) {
      const ctx = ctxOf({ 'audit-exceptions.json': content, '.github/dependabot.yml': DEPENDABOT })
      expect(() => measure('deferred-dependency-decisions', ctx)).toThrow(reason)
    }
  })

  it('is not measured when the Dependabot file is missing', () => {
    const ctx = ctxOf({ 'audit-exceptions.json': exceptionsFile() })
    expect(() => measure('deferred-dependency-decisions', ctx)).toThrow(
      '.github/dependabot.yml could not be read'
    )
  })

  it('is not measured when the Dependabot file is empty or holds only comments', () => {
    const reason = '.github/dependabot.yml is missing its `version` or `updates` key'
    for (const content of ['', '\n  \n', '# version: 2\n# updates: []\n', 'version: 2\n']) {
      const ctx = ctxOf({
        'audit-exceptions.json': exceptionsFile('2027-01-15'),
        '.github/dependabot.yml': content
      })
      expect(() => measure('deferred-dependency-decisions', ctx)).toThrow(Unmeasured)
      expect(() => measure('deferred-dependency-decisions', ctx)).toThrow(reason)
    }
  })

  it('reads a configuration with no ignores as zero ignores', () => {
    const ctx = ctxOf({
      'audit-exceptions.json': exceptionsFile('2027-01-15'),
      '.github/dependabot.yml': 'version: 2\nupdates: []\n'
    })
    expect(measure('deferred-dependency-decisions', ctx)).toEqual({
      value: 1,
      note: '1 audit exception(s) and 0 Dependabot ignore(s)'
    })
  })
})

describe('countDependabotEntries', () => {
  it('counts the block form, one entry a line', () => {
    expect(countDependabotEntries(DEPENDABOT)).toBe(2)
  })

  it('counts the flow form too, so a change of layout cannot read low', () => {
    const flow = [
      '    ignore:',
      "      - { dependency-name: 'vitest', update-types: ['version-update:semver-major'] }",
      "      - { dependency-name: 'jsdom' }",
      "    other: [{ dependency-name: 'a' }]",
      "    ignore: [{ dependency-name: 'b' }, { dependency-name: 'c' }]"
    ].join('\n')
    expect(countDependabotEntries(flow)).toBe(4)
  })

  it('leaves out allow entries, which name dependencies to update, not to hold back', () => {
    const text = [
      'updates:',
      '  - package-ecosystem: npm',
      '    allow:',
      "      - dependency-name: 'a'",
      '    ignore:',
      "      - dependency-name: 'b'",
      '  - package-ecosystem: pip',
      "    allow: [{ dependency-name: 'c' }, { dependency-name: 'd' }]",
      '  - ignore:',
      "    - dependency-name: 'e'",
      '    allow:',
      "    - dependency-name: 'f'"
    ].join('\n')
    expect(countDependabotEntries(text)).toBe(2)
  })

  it('counts a quoted key, and a # inside a quoted value does not end the line', () => {
    const text = [
      '    ignore:',
      '      - { "dependency-name": "vitest" }',
      "      - 'dependency-name': jsdom",
      "      - { versions: ['>= 1 #x'], dependency-name: y }",
      '      - { versions: ["\\" #x"], dependency-name: z }'
    ].join('\n')
    expect(countDependabotEntries(text)).toBe(4)
  })

  it('leaves out commented entries, whole-line and trailing', () => {
    const text = [
      '    ignore:',
      '# - dependency-name: whole-line',
      "      - dependency-name: 'kept' # dependency-name: trailing",
      '      #- dependency-name: another',
      "      - dependency-name : 'spaced'"
    ].join('\n')
    expect(countDependabotEntries(text)).toBe(2)
  })

  it('reads a file with no entries as zero', () => {
    expect(countDependabotEntries('version: 2\nupdates: []\n')).toBe(0)
  })
})

describe('daysToExpiry', () => {
  it('counts whole days to each expiry, negative once it has passed', () => {
    const entries = [exception('2026-11-21'), exception('2026-12-31'), exception('2026-11-20')]
    expect(daysToExpiry(entries, '2026-11-21')).toEqual([0, 40, -1])
  })

  it('is not measured when the run date is not a calendar day', () => {
    expect(() => daysToExpiry([exception('2026-12-31')], '21 November')).toThrow(Unmeasured)
  })
})

describe('audit exceptions expiring', () => {
  const at = (...expiries: string[]) =>
    measure(
      'audit-exceptions-expiring',
      ctxOf({ 'audit-exceptions.json': exceptionsFile(...expiries) }, { today: '2026-11-21' })
    )

  it('does not count an exception 22 days from its expiry', () => {
    expect(at('2026-12-13')).toEqual({ value: 0, note: 'the nearest expiry is 22 day(s) away' })
  })

  it('counts one at the 21-day warning line, the day audit-check starts warning', () => {
    expect(at('2026-12-12')).toEqual({ value: 1, note: 'the nearest expiry is 21 day(s) away' })
  })

  it('counts one that has already expired', () => {
    expect(at('2026-11-20')).toEqual({ value: 1, note: 'the nearest expiry is -1 day(s) away' })
  })

  it('counts each entry on its own date', () => {
    expect(at('2026-12-13', '2026-12-12', '2026-11-20', '2027-03-01').value).toBe(2)
  })

  it('reads an empty exceptions list as nothing expiring, with no nearest date', () => {
    expect(at()).toEqual({ value: 0, note: null })
  })

  it('is not measured when the exceptions file cannot be read', () => {
    expect(() => measure('audit-exceptions-expiring', ctxOf({}))).toThrow(Unmeasured)
  })
})

describe('unused dependencies', () => {
  it('adds unused dependencies to unused devDependencies', () => {
    const report = {
      issues: [knipIssue('package.json', { dependencies: 1, devDependencies: 2, exports: 9 })]
    }
    expect(measure('unused-dependencies', ctxOf({}, { knip: () => report }))).toEqual({ value: 3 })
  })
})
