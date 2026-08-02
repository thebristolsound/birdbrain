import { describe, expect, it } from 'vitest'
import { globToRegex, matchIgnoredUrl, type RegexTest } from '@shared/urlPatterns'
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
// safeRegexTest gives each pattern a 200 ms vm budget and returns false when the
// budget expires (src/main/services/safeRegex.ts). A pattern that backtracks
// past that budget therefore reads as "not ignored" on the capture server, while
// the extension's platform RegExp has no budget and eventually reports the
// match. The server's direction is fail-open: the operator wrote a rule that
// matches, and the capture is accepted, hashed, manifest-chained and filed with
// no `Blacklisted: <pattern>` skip record. On the manual/context-menu path the
// extension does not pre-filter at all, so nothing else catches it.
//
// This is inherited behaviour, not introduced by the extraction — the server
// timed out to `false` before it too. It is recorded, not fixed: making a
// timeout fail-closed changes what the server does with an evidence-path rule
// and belongs to its own change.
describe('evaluator divergence (catastrophic backtracking)', () => {
  // 26 a's puts the unsandboxed evaluation at roughly 1 s (about 6 s on the
  // first, pre-tier-up run) against a 200 ms budget, so the sandbox loses by a
  // wide margin on any plausible machine — a slower runner only widens it. The
  // URL ends in 'aaab', which the pattern does match, so an evaluation allowed
  // to finish answers "ignored". The generous per-test timeouts are for the
  // unsandboxed side, which has to run the backtracking to completion.
  const PATTERN = '/(a+)+b/'
  const REGEX_BODY = '(a+)+b'
  const TARGET_URL = `https://example.com/${'a'.repeat(26)}/x/aaab`

  it('the underlying evaluators disagree: platform RegExp matches, safeRegexTest times out', () => {
    expect(new RegExp(REGEX_BODY).test(TARGET_URL)).toBe(true)
    expect(safeRegexTest(REGEX_BODY, '', TARGET_URL)).toBe(false)
  }, 60_000)

  it('so the extension reports the URL ignored and the capture server does not', () => {
    expect(matchIgnoredUrl(TARGET_URL, [PATTERN])).toBe(PATTERN)
    expect(matchIgnoredUrl(TARGET_URL, [PATTERN], safeRegexTest)).toBe(null)
  }, 60_000)
})

describe('globToRegex', () => {
  it('maps * to .* and ? to . and leaves other metacharacters literal', () => {
    expect(globToRegex('a*b?c.d').source).toBe('a.*b.c\\.d')
  })

  it('is case-insensitive and unanchored', () => {
    expect(globToRegex('*.example.com*').flags).toBe('i')
    expect(globToRegex('example').test('https://EXAMPLE.com/page')).toBe(true)
  })
})
