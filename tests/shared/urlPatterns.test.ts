import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  globToRegex,
  matchIgnoredUrl,
  resolveEffectiveIgnorePatterns,
  validateIgnorePattern,
  type RegexTest
} from '@shared/urlPatterns'
import { safeRegexTest } from '@main/services/safeRegex'

// Known-answer table for the ignored-URL matcher (#227).
//
// This matcher decides what never enters a case, so its answers are part of the
// evidentiary record: a URL the operator believes was excluded must be excluded
// on BOTH sides of the wire, and the case file records *which* rule excluded it.
// Every row is therefore asserted twice — once with the extension's evaluator
// (the platform RegExp) and once with the capture server's sandboxed
// safeRegexTest — and the expected value is the matching pattern itself, not a
// boolean.
//
// Running a row through both evaluators is only *evidence* of cross-seam
// agreement for the rows that actually reach the injected evaluator, i.e. the
// regex-literal ones; for a glob or substring row the two runs execute the same
// code and agreeing proves nothing. Rows are tagged `usesRegexTest` and the tag
// is asserted against reality below, so that distinction cannot rot silently.
//
// The evaluators do not agree on every input. See the 'evaluator divergence'
// block at the bottom: it pins the one known input class where they differ.
interface Row {
  name: string
  patterns: string[]
  url: string
  expected: string | null
  /**
   * True when the row reaches the regex-literal branch, so the injected
   * evaluator — not shared code — decides it. Asserted, not documentation.
   */
  usesRegexTest?: boolean
}

const ROWS: Row[] = [
  // --- substring form (no wildcards, no regex literal) ---
  {
    name: 'substring matches anywhere in the URL',
    patterns: ['facebook.com'],
    url: 'https://www.facebook.com/some/page',
    expected: 'facebook.com'
  },
  {
    name: 'substring that is absent does not match',
    patterns: ['facebook.com'],
    url: 'https://example.com/page',
    expected: null
  },
  {
    name: 'substring is case-SENSITIVE (unlike the glob and /i regex forms)',
    patterns: ['Facebook.com'],
    url: 'https://www.facebook.com/some/page',
    expected: null
  },
  {
    name: 'substring dot is literal, not a regex wildcard',
    patterns: ['a.com'],
    url: 'https://axcom.example',
    expected: null
  },
  {
    name: 'a lone slash is a substring, not a regex literal, so it matches every URL',
    patterns: ['/'],
    url: 'https://example.com/page',
    expected: '/'
  },

  // --- glob form (contains * or ?) ---
  {
    name: 'glob * spans any run of characters',
    patterns: ['*.facebook.com*'],
    url: 'https://www.facebook.com/some/page',
    expected: '*.facebook.com*'
  },
  {
    name: 'glob that does not match returns null',
    patterns: ['*.facebook.com*'],
    url: 'https://example.com/page',
    expected: null
  },
  {
    name: 'glob ? spans exactly one character',
    patterns: ['example.com/user?'],
    url: 'https://example.com/userA',
    expected: 'example.com/user?'
  },
  {
    name: 'glob ? also matches the trailing s of /users',
    patterns: ['example.com/user?'],
    url: 'https://example.com/users',
    expected: 'example.com/user?'
  },
  {
    name: 'glob ? requires a character to be there',
    patterns: ['example.com/user?'],
    url: 'https://example.com/user',
    expected: null
  },
  {
    name: 'glob is case-insensitive',
    patterns: ['*.FACEBOOK.com*'],
    url: 'https://www.facebook.com/some/page',
    expected: '*.FACEBOOK.com*'
  },
  {
    name: 'glob escapes other regex metacharacters',
    patterns: ['a+b*'],
    url: 'https://example.com/a+bc',
    expected: 'a+b*'
  },
  {
    name: 'glob metacharacter escaping is not bypassed by a regex-shaped URL',
    patterns: ['a+b*'],
    url: 'https://example.com/aab',
    expected: null
  },

  // --- regex-literal form (/body/flags) ---
  {
    name: 'regex literal with the i flag',
    patterns: ['/.*\\.pdf$/i'],
    url: 'https://example.com/document.pdf',
    expected: '/.*\\.pdf$/i',
    usesRegexTest: true
  },
  {
    name: 'regex literal anchors are honoured',
    patterns: ['/.*\\.pdf$/i'],
    url: 'https://example.com/page.html',
    expected: null,
    usesRegexTest: true
  },
  {
    name: 'regex literal without flags is case-sensitive',
    patterns: ['/\\.PDF$/'],
    url: 'https://example.com/document.pdf',
    expected: null,
    usesRegexTest: true
  },
  {
    name: 'regex literal with the i flag is not',
    patterns: ['/\\.PDF$/i'],
    url: 'https://example.com/document.pdf',
    expected: '/\\.PDF$/i',
    usesRegexTest: true
  },
  {
    name: 'regex literal escaped slashes survive the body/flags split',
    patterns: ['/^https:\\/\\/example\\.com\\//'],
    url: 'https://example.com/page',
    expected: '/^https:\\/\\/example\\.com\\//',
    usesRegexTest: true
  },

  // --- which pattern matched, and pattern-level fault tolerance ---
  {
    name: 'returns the matching pattern, not merely a boolean',
    patterns: ['nope.example', 'facebook.com', 'also-no.example'],
    url: 'https://www.facebook.com/some/page',
    expected: 'facebook.com'
  },
  {
    name: 'first match in list order wins across differing forms',
    patterns: ['*.facebook.com*', 'facebook.com'],
    url: 'https://www.facebook.com/some/page',
    expected: '*.facebook.com*'
  },
  {
    name: 'an unparseable regex literal is skipped, not fatal',
    patterns: ['/[unclosed/', 'facebook.com'],
    url: 'https://www.facebook.com/some/page',
    expected: 'facebook.com',
    usesRegexTest: true
  },
  {
    name: 'an unparseable regex literal alone matches nothing',
    patterns: ['/[unclosed/'],
    url: 'https://www.facebook.com/some/page',
    expected: null,
    usesRegexTest: true
  },
  {
    name: 'an empty pattern list matches nothing',
    patterns: [],
    url: 'https://www.facebook.com/some/page',
    expected: null
  }
]

// The two evaluators in production: the extension's (default) and the capture
// server's vm-sandboxed one.
const EVALUATORS: Array<{ name: string; regexTest?: RegexTest }> = [
  { name: 'extension (platform RegExp)', regexTest: undefined },
  { name: 'capture server (safeRegexTest)', regexTest: safeRegexTest }
]

describe('matchIgnoredUrl', () => {
  for (const { name, regexTest } of EVALUATORS) {
    describe(name, () => {
      for (const row of ROWS) {
        it(row.name, () => {
          expect(matchIgnoredUrl(row.url, row.patterns, regexTest)).toBe(row.expected)
        })
      }
    })
  }

  it('gives the same answer on both sides of the wire for every known-answer row', () => {
    const extensionSide = ROWS.map((row) => matchIgnoredUrl(row.url, row.patterns))
    const serverSide = ROWS.map((row) => matchIgnoredUrl(row.url, row.patterns, safeRegexTest))
    expect(serverSide).toEqual(extensionSide)
    expect(extensionSide).toEqual(ROWS.map((row) => row.expected))
  })

  // Guards the assertion above from becoming a tautology. Only the tagged rows
  // put the two evaluators on different code; if a future edit drops the last
  // regex-literal row, the equality assertion would still pass while proving
  // nothing, and this test is what fails instead.
  it('reaches the injected evaluator on exactly the rows tagged for it', () => {
    for (const row of ROWS) {
      let consulted = false
      const spy: RegexTest = (source, flags, text) => {
        consulted = true
        return new RegExp(source, flags).test(text)
      }
      matchIgnoredUrl(row.url, row.patterns, spy)
      expect(consulted, row.name).toBe(row.usesRegexTest === true)
    }
    expect(ROWS.filter((row) => row.usesRegexTest).length).toBeGreaterThan(0)
  })
})

// The one input class where the two evaluators return DIFFERENT answers, pinned
// here so it is a known answer rather than an unknown.
//
// safeRegexTest gives each pattern a vm budget (200 ms in production) and
// returns false when the budget expires (src/main/services/safeRegex.ts). A
// pattern that backtracks past that budget therefore reads as "not ignored" on
// the capture server, while the extension's platform RegExp has no budget and
// eventually reports the match. The server's direction is fail-open: the
// operator wrote a rule that matches, and the capture is accepted, hashed,
// manifest-chained and filed with no `Blacklisted: <pattern>` skip record.
//
// What that costs used to depend on the route. The extension pre-filters with
// this matcher on the context-menu capture handler and on checkSelectorsOnTab,
// so those never reach the server's answer (they pay the backtracking in the
// service worker instead). The popup's Capture button was the one live route
// that did not — its MANUAL_CAPTURE message went straight to manualCaptureTab —
// until #387 gave that message the same pre-check. So on a pattern of this
// class the extension is more conservative than the server: it refuses what the
// server would have accepted. The divergence itself is unchanged and still
// pinned below.
//
// The pre-check is only as good as the pattern list behind it, and that list is
// worker memory filled by the first successful status poll. Before it lands the
// list is empty and this matcher answers "not ignored" for every URL, which is
// the server's fail-open direction reached by a different route. #387 gates the
// popup's capture route on rulesLoaded for that reason, pinned in
// tests/extension/popupPrefilter.test.ts.
//
// This is inherited behaviour, not introduced by the extraction — the server
// timed out to `false` before it too. It is recorded, not fixed: making a
// timeout fail-closed changes what the server does with an evidence-path rule
// and belongs to its own change.
describe('evaluator divergence (server fails open when its budget expires)', () => {
  const PATTERN = '/(a+)+b/'
  const REGEX_BODY = '(a+)+b'
  // The URL ends in 'aaab', which the pattern does match, so an evaluation
  // allowed to finish answers "ignored".
  const TARGET_URL = `https://example.com/${'a'.repeat(23)}/x/aaab`

  // The budget half of the known-answer triple (#330). safeRegexTest takes it as
  // an argument precisely so this pin does not have to race the runner: the
  // question the assertions ask is "what does the server answer when the budget
  // expires", and that question is answered by a budget the evaluation cannot
  // possibly meet, not by an input tuned to overrun 200 ms on one machine.
  // Production is unaffected — 200 ms remains the default and is pinned by value
  // in tests/main/services/safeRegex.test.ts.
  const SERVER_BUDGET_MS = 1
  const budgetedServerTest: RegexTest = (source, flags, text) =>
    safeRegexTest(source, flags, text, SERVER_BUDGET_MS)

  // Both sides really run the pattern — a stubbed evaluator would only prove
  // that matchIgnoredUrl returns what it is told, not that the two production
  // evaluators disagree. But backtracking is synchronous, so a bare
  // `new RegExp(REGEX_BODY).test(TARGET_URL)` here is unbounded and the per-test
  // timeout cannot interrupt it: an out-of-envelope machine would hang the
  // Vitest worker rather than fail. So the unsandboxed side runs through the
  // same node:vm primitive safeRegexTest uses, evaluating the identical
  // expression in the identical engine, with a deadline far above the budget
  // under test. vm timeouts do interrupt regex backtracking (that is what
  // tests/main/services/safeRegex.test.ts pins at 200 ms), so a machine outside
  // the envelope now fails loudly instead of stalling.
  //
  // This is the extension's evaluator in everything but the ceiling: the
  // extension has no timeout at all, and what the assertion needs is the answer
  // an evaluation gets when it is allowed to finish. The literal default
  // `testWithRegExp` is covered by the regex-literal rows in the table above.
  const PLATFORM_DEADLINE_MS = 30_000
  let platformDeadlineFired = false
  const boundedPlatformTest: RegexTest = (source, flags, text) => {
    platformDeadlineFired = false
    try {
      return runInNewContext(
        'new RegExp(pattern, flags).test(text)',
        { pattern: source, flags, text },
        { timeout: PLATFORM_DEADLINE_MS }
      ) as boolean
    } catch (err) {
      platformDeadlineFired = true
      throw err
    }
  }

  // Neither assertion below is a close race. Measured on the container this was
  // written on (Electron's Node 20 runtime, `pnpm test
  // tests/shared/urlPatterns.test.ts`), the n=23 evaluation takes ~560 ms on the
  // first run in a fresh process and ~100 ms once V8 has tiered up the regexp:
  // ~100x the 1 ms budget the sandbox is given, and ~50x under the 30 s deadline
  // the platform side is given. Both margins have to close by two orders of
  // magnitude before either assertion changes answer, and neither depends on
  // hardware the way a 200 ms budget did — the previous shape of this test ran
  // n=26 against the production 200 ms and had only a ~3x margin warm, so a ~3x
  // faster runner made the two evaluators agree and turned it red with no code
  // change (#329, #330). The 'a' run is still exponential in n and still the
  // reason the sandbox cannot finish; what changed is that the budget it cannot
  // finish inside is now chosen by the test rather than by production.
  // The 60 s per-test timeout is an outer bound the 30 s deadline stays under.
  it('the underlying evaluators disagree: platform RegExp matches, the server fails open', () => {
    expect(boundedPlatformTest(REGEX_BODY, '', TARGET_URL)).toBe(true)
    expect(safeRegexTest(REGEX_BODY, '', TARGET_URL, SERVER_BUDGET_MS)).toBe(false)
  }, 60_000)

  it('so the extension reports the URL ignored and the capture server does not', () => {
    // matchIgnoredUrl swallows a throwing evaluator by design, so a deadline
    // overrun would surface here as a bare `null` and read as a matcher bug.
    // Assert the deadline first so the failure names the real cause.
    const extensionSide = matchIgnoredUrl(TARGET_URL, [PATTERN], boundedPlatformTest)
    expect(
      platformDeadlineFired,
      `platform evaluation did not finish within ${PLATFORM_DEADLINE_MS} ms`
    ).toBe(false)
    expect(extensionSide).toBe(PATTERN)
    expect(matchIgnoredUrl(TARGET_URL, [PATTERN], budgetedServerTest)).toBe(null)
  }, 60_000)
})

describe('globToRegex', () => {
  it('maps * to .* and ? to . and leaves other metacharacters literal', () => {
    expect(globToRegex('a*b?c.d').source).toBe('a.*b.c\\.d')
  })

  it('is case-insensitive and unanchored', () => {
    expect(globToRegex('example').test('https://EXAMPLE.com/page')).toBe(true)
    expect(globToRegex('*.example.com*').flags).toBe('i')
  })
})

// #400. Known answers for the two pure functions the per-case exclusion feature
// adds. Both sit on the acquisition path — one decides whether a pattern is
// allowed to be stored at all, the other decides which patterns are in force
// for a case — so both are pinned by exact answer rather than by shape.
describe('validateIgnorePattern', () => {
  it.each([
    ['substring', 'facebook.com'],
    ['glob', '*.bank.com*'],
    ['single-char glob', 'exa?ple.com'],
    ['regex with flags', '/\\.gov(\\.|\\/|$)/i'],
    ['regex without flags', '/^https:/'],
    // Not a regex literal (no closing slash past position 0), so it is read as
    // a substring and needs no compilation.
    ['leading slash, no closing slash', '/some/path'],
    ['pattern with surrounding whitespace', '  facebook.com  ']
  ])('accepts a %s pattern', (_name, pattern) => {
    expect(validateIgnorePattern(pattern)).toEqual({ ok: true })
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   ']
  ])('rejects an %s pattern', (_name, pattern) => {
    expect(validateIgnorePattern(pattern)).toEqual({ ok: false, reason: 'Pattern is empty' })
  })

  it('rejects an uncompilable regex and surfaces the engine error', () => {
    const result = validateIgnorePattern('/[/')
    expect(result.ok).toBe(false)
    // The engine's own message, not a generic one: the operator has to be able
    // to see what is wrong with the pattern they typed.
    expect(result.ok === false && result.reason.length > 0).toBe(true)
    expect(result.ok === false && result.reason).toMatch(/character class|Invalid regular/i)
  })

  it('rejects an unknown regex flag', () => {
    expect(validateIgnorePattern('/abc/q').ok).toBe(false)
  })

  // The write seam refuses what cannot compile, not what is slow. Containment
  // for that class is the server's time budget, and it is fail-open — stated
  // here so a reader does not mistake validation for protection against it.
  it('accepts a pattern that compiles but backtracks catastrophically', () => {
    expect(validateIgnorePattern('/(a+)+$/').ok).toBe(true)
  })
})

describe('resolveEffectiveIgnorePatterns', () => {
  it('stacks the case list after the global list, global first', () => {
    // Order is load-bearing: matchIgnoredUrl returns the FIRST match, and a URL
    // on both lists should be reported as blocked by the broader global rule.
    expect(resolveEffectiveIgnorePatterns(['g1', 'g2'], ['c1'], 'stack')).toEqual([
      'g1',
      'g2',
      'c1'
    ])
  })

  it('collapses a pattern present on both lists to one entry', () => {
    expect(resolveEffectiveIgnorePatterns(['dup', 'g'], ['dup', 'c'], 'stack')).toEqual([
      'dup',
      'g',
      'c'
    ])
  })

  it('returns the case list verbatim under override, bypassing the global list', () => {
    expect(resolveEffectiveIgnorePatterns(['g1', 'g2'], ['c1', 'c2'], 'override')).toEqual([
      'c1',
      'c2'
    ])
  })

  it('is empty under override with no case patterns, however long the global list', () => {
    expect(resolveEffectiveIgnorePatterns(['g1', 'g2'], [], 'override')).toEqual([])
  })

  it('is the global list under stack with no case patterns', () => {
    expect(resolveEffectiveIgnorePatterns(['g1'], [], 'stack')).toEqual(['g1'])
  })

  it('handles both lists empty in either mode', () => {
    expect(resolveEffectiveIgnorePatterns([], [], 'stack')).toEqual([])
    expect(resolveEffectiveIgnorePatterns([], [], 'override')).toEqual([])
  })

  it('does not mutate either input', () => {
    const globalPatterns = ['g1']
    const casePatterns = ['c1']
    resolveEffectiveIgnorePatterns(globalPatterns, casePatterns, 'stack')
    expect(globalPatterns).toEqual(['g1'])
    expect(casePatterns).toEqual(['c1'])
  })
})
