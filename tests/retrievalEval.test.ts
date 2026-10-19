import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { fillerPage } from '../scripts/retrieval-eval/filler'
import { QUERIES } from '../scripts/retrieval-eval/queries'
import {
  firstRank,
  percentile,
  rankedKeys,
  renderReport,
  scoreQuery,
  spread,
  type EvalReport
} from '../scripts/retrieval-eval/score'
import { POOLED_FILE, TARGET_ONLY_STRINGS, TARGET_PAGES } from '../scripts/retrieval-eval/targets'

const PAGES_DIR = resolve(__dirname, '..', 'scripts', 'retrieval-eval', 'pages')
const RESERVED_HOST = /(^|\.)example\.(com|net|org)$/

// Every host a page names: link targets, page URLs and the domains of addresses.
function hostsIn(text: string): string[] {
  const urls = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())
  const addresses = [...text.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) =>
    m[1].toLowerCase()
  )
  return [...urls, ...addresses]
}

describe('firstRank', () => {
  it('returns the 1-based rank of the first expected key', () => {
    expect(firstRank(['a', 'b', 'c'], ['c', 'b'])).toBe(2)
  })

  it('returns null when no expected key was returned', () => {
    expect(firstRank(['a'], ['b'])).toBeNull()
  })
})

describe('rankedKeys', () => {
  it('keeps non-target results in place, so they count toward a target rank', () => {
    const ranked = rankedKeys(['f1', 't1', 'f2', 't1'], { t1: 'mail-header' })
    expect(ranked).toEqual(['other:f1', 'mail-header', 'other:f2'])
    expect(firstRank(ranked, ['mail-header'])).toBe(2)
  })
})

describe('scoreQuery', () => {
  const query = { id: 'q', text: 'x', expected: ['mail-header' as const], tests: 't' }

  it('counts a hit at rank 5 in the top 5 and at rank 6 only in the top 20', () => {
    const five = scoreQuery(query, 'p', {
      ranked: ['a', 'b', 'c', 'd', 'mail-header'],
      returned: 9
    })
    expect(five).toMatchObject({ firstRank: 5, top5: true, top20: true, passed: true })
    const six = scoreQuery(query, 'p', {
      ranked: ['a', 'b', 'c', 'd', 'e', 'mail-header'],
      returned: 9
    })
    expect(six).toMatchObject({ firstRank: 6, top5: false, top20: true })
  })

  it('passes a query with several expected targets only when every one came back', () => {
    const both = { ...query, expected: ['mail-header' as const, 'address-variant' as const] }
    expect(scoreQuery(both, 'p', { ranked: ['mail-header'], returned: 1 }).passed).toBe(false)
    expect(
      scoreQuery(both, 'p', { ranked: ['address-variant', 'other:x', 'mail-header'], returned: 3 })
        .passed
    ).toBe(true)
  })

  it('fails a query whose path threw, and keeps the error', () => {
    const scored = scoreQuery(query, 'p', {
      ranked: ['mail-header'],
      returned: 1,
      error: 'fts5: syntax error'
    })
    expect(scored).toMatchObject({
      firstRank: null,
      passed: false,
      returned: 0,
      error: 'fts5: syntax error'
    })
  })

  it('passes a query whose correct answer is nothing only when nothing came back', () => {
    const empty = { ...query, expected: [] }
    expect(scoreQuery(empty, 'p', { ranked: [], returned: 0 }).passed).toBe(true)
    expect(scoreQuery(empty, 'p', { ranked: [], returned: 2 }).passed).toBe(false)
  })
})

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6]
    expect(percentile(values, 50)).toBe(5)
    expect(percentile(values, 95)).toBe(10)
  })

  it('returns null for no samples', () => {
    expect(percentile([], 50)).toBeNull()
  })
})

describe('spread', () => {
  it('picks evenly spaced values from the whole list, first included', () => {
    const values = Array.from({ length: 100 }, (_, i) => i)
    expect(spread(values, 4)).toEqual([0, 25, 50, 75])
  })

  it('returns every value when there are no more than asked for', () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3])
  })
})

describe('fillerPage', () => {
  it('builds the same page for the same index on every call', () => {
    expect(fillerPage(17)).toEqual(fillerPage(17))
    expect(fillerPage(17).html).not.toBe(fillerPage(18).html)
  })

  it('never holds a string only a target page or the pooled file may hold', () => {
    for (let index = 0; index < 2000; index += 1) {
      const { url, title, html } = fillerPage(index)
      for (const marker of TARGET_ONLY_STRINGS) {
        expect(`${url} ${title} ${html}`).not.toContain(marker)
      }
    }
  })

  it('names only hosts under the reserved example domains', () => {
    for (let index = 0; index < 200; index += 1) {
      const { url, html } = fillerPage(index)
      for (const host of hostsIn(`${url} ${html}`)) expect(host).toMatch(RESERVED_HOST)
    }
  })
})

describe('target pages', () => {
  it('each exist, say they are fictional, and name only reserved hosts', () => {
    for (const target of TARGET_PAGES) {
      const html = readFileSync(join(PAGES_DIR, target.file), 'utf-8')
      expect(html).toContain('This page is fictional.')
      for (const host of hostsIn(`${target.url} ${html}`)) expect(host).toMatch(RESERVED_HOST)
    }
    for (const host of hostsIn(POOLED_FILE.text)) expect(host).toMatch(RESERVED_HOST)
  })

  it('back every query, and every target-only string appears in a target or the pooled file', () => {
    const keys = new Set(TARGET_PAGES.map((target) => target.key))
    for (const query of QUERIES) for (const key of query.expected) expect(keys).toContain(key)
    const corpus = [
      ...TARGET_PAGES.map((target) => readFileSync(join(PAGES_DIR, target.file), 'utf-8')),
      POOLED_FILE.text
    ].join('\n')
    for (const marker of TARGET_ONLY_STRINGS) expect(corpus).toContain(marker)
  })

  it("leave the mail header's Reply-To address and host out of every query", () => {
    const html = readFileSync(join(PAGES_DIR, 'mail-header.html'), 'utf-8')
    const address = /^Reply-To: &lt;(.+)&gt;$/m.exec(html)?.[1] ?? ''
    expect(address).toContain('@')
    const [localPart, host] = address.toLowerCase().split('@')
    for (const query of QUERIES) {
      const text = query.text.toLowerCase()
      for (const part of [localPart, host]) expect(text).not.toContain(part)
    }
  })
})

describe('renderReport', () => {
  it('writes one table row per scored query and states the unreviewed targets', () => {
    const report: EvalReport = {
      generatedAt: '2026-10-09T00:00:00.000Z',
      toolVersion: '0.0.0',
      captures: 10,
      targets: 5,
      fillers: 5,
      queries: QUERIES.slice(0, 1),
      scored: [
        scoreQuery(QUERIES[0], 'Case search', { ranked: [], returned: 0, error: 'boom' }),
        scoreQuery(QUERIES[0], 'Data search', { ranked: ['image-link'], returned: 1 })
      ],
      latency: [
        { path: 'Case search', queryId: 'image-link-host', medianMs: 0.1, p95Ms: 0.2, samples: 3 }
      ],
      indexSizes: [{ name: 'captures_fts_data', bytes: 4096 }],
      fullRebuildMs: 1,
      incrementalMedianMs: null,
      fieldIndex: {
        extractor: 'fields/9',
        fullBuildMs: 12.5,
        incrementalMedianMs: 0.25,
        outcomes: [
          { outcome: 'built', builds: 9 },
          { outcome: 'partial', builds: 1 }
        ],
        records: [{ field: 'link.href', records: 25 }]
      },
      unreviewedCaptures: 4,
      unreviewedTargets: ['mail-header']
    }
    const markdown = renderReport(report)
    expect(markdown).toContain('| image-link-host | Case search | - | no | no | 0 | no | boom |')
    expect(markdown).toContain('| image-link-host | Data search | 1 | yes | yes | 1 | yes |  |')
    expect(markdown).toContain('| Case search | image-link-host | 0.10 | 0.20 | 3 |')
    expect(markdown).toContain('| captures_fts_data | 4096 | 410 |')
    expect(markdown).toContain('Targets among them: mail-header.')
  })

  it('states the search field build and its records per field', () => {
    const report: EvalReport = {
      generatedAt: '2026-10-16T00:00:00.000Z',
      toolVersion: '0.0.0',
      captures: 10,
      targets: 5,
      fillers: 5,
      queries: [],
      scored: [],
      latency: [],
      indexSizes: [{ name: 'exhibit_search_fields', bytes: 8192 }],
      fullRebuildMs: 1,
      incrementalMedianMs: 0.1,
      fieldIndex: {
        extractor: 'fields/9',
        fullBuildMs: 12.5,
        incrementalMedianMs: null,
        outcomes: [
          { outcome: 'built', builds: 9 },
          { outcome: 'partial', builds: 1 }
        ],
        records: [
          { field: 'header.from', records: 3 },
          { field: 'link.href', records: 25 }
        ]
      },
      unreviewedCaptures: 0,
      unreviewedTargets: []
    }
    const markdown = renderReport(report)
    expect(markdown).toContain('| exhibit_search_fields | 8192 | 819 |')
    expect(markdown).toContain('- Full build of the search field records (`fields/9`): 12.50 ms.')
    expect(markdown).toContain("- Building one Capture's search field records again, median: - ms.")
    expect(markdown).toContain('- Search field builds by outcome: built 9, partial 1.')
    expect(markdown).toContain('| header.from | 3 | 0.30 |')
    expect(markdown).toContain('| link.href | 25 | 2.50 |')
    expect(
      renderReport({ ...report, fieldIndex: { ...report.fieldIndex, outcomes: [] } })
    ).toContain('- Search field builds by outcome: none.')
  })
})
