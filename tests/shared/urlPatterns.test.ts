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
interface Row {
  name: string
  patterns: string[]
  url: string
  expected: string | null
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
    expected: '/.*\\.pdf$/i'
  },
  {
    name: 'regex literal anchors are honoured',
    patterns: ['/.*\\.pdf$/i'],
    url: 'https://example.com/page.html',
    expected: null
  },
  {
    name: 'regex literal without flags is case-sensitive',
    patterns: ['/\\.PDF$/'],
    url: 'https://example.com/document.pdf',
    expected: null
  },
  {
    name: 'regex literal with the i flag is not',
    patterns: ['/\\.PDF$/i'],
    url: 'https://example.com/document.pdf',
    expected: '/\\.PDF$/i'
  },
  {
    name: 'regex literal escaped slashes survive the body/flags split',
    patterns: ['/^https:\\/\\/example\\.com\\//'],
    url: 'https://example.com/page',
    expected: '/^https:\\/\\/example\\.com\\//'
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
    expected: 'facebook.com'
  },
  {
    name: 'an unparseable regex literal alone matches nothing',
    patterns: ['/[unclosed/'],
    url: 'https://www.facebook.com/some/page',
    expected: null
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
