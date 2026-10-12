import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { fillerPage } from '../scripts/retrieval-eval/filler'
import { QUERIES } from '../scripts/retrieval-eval/queries'
import {
  firstRank,
  percentile,
  renderReport,
  scoreQuery,
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
      latency: [{ path: 'Case search', medianMs: 0.1, p95Ms: 0.2, samples: 3 }],
      indexSizes: [{ name: 'captures_fts_data', bytes: 4096 }],
      fullRebuildMs: 1,
      incrementalMedianMs: null,
      unreviewedCaptures: 4,
      unreviewedTargets: ['mail-header']
    }
    const markdown = renderReport(report)
    expect(markdown).toContain('| image-link-host | Case search | - | no | no | 0 | no | boom |')
    expect(markdown).toContain('| image-link-host | Data search | 1 | yes | yes | 1 | yes |  |')
    expect(markdown).toContain('| captures_fts_data | 4096 | 410 |')
    expect(markdown).toContain('Targets among them: mail-header.')
  })
})
