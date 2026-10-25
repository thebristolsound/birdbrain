import { describe, expect, it } from 'vitest'
import {
  findTestSites,
  siteForLine,
  touchedSites
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/testSites.mjs'

const FILE = [
  "describe('thing', () => {", // 1
  "  it('does one thing', () => {", // 2
  '    expect(1).toBe(1)', // 3
  '  })', // 4
  '', // 5
  "  test.only('does another', async () => {", // 6
  '    expect(2).toBe(2)', // 7
  '  })', // 8
  '', // 9
  "  it.each([1, 2])('handles %i', (n) => {", // 10
  '    expect(n).toBeGreaterThan(0)', // 11
  '  })', // 12
  '', // 13
  '  it(name, () => {})', // 14
  '})' // 15
].join('\n')

describe('findTestSites', () => {
  it('finds it, test, modified and each-style calls with their line ranges', () => {
    expect(findTestSites({ path: 'tests/a.test.ts', text: FILE })).toEqual([
      { startLine: 2, endLine: 4, title: 'does one thing' },
      { startLine: 6, endLine: 8, title: 'does another' },
      { startLine: 10, endLine: 12, title: 'handles %i' },
      { startLine: 14, endLine: 14, title: null }
    ])
  })

  it('parses TSX test files', () => {
    const text = "it('renders', () => {\n  render(<Thing />)\n})\n"
    expect(findTestSites({ path: 'tests/components/Thing.test.tsx', text })).toEqual([
      { startLine: 1, endLine: 3, title: 'renders' }
    ])
  })
})

describe('touchedSites', () => {
  const sites = findTestSites({ path: 'tests/a.test.ts', text: FILE })

  it('keeps the sites with an added line between their first and last line', () => {
    const touched = touchedSites({ sites, status: 'M', addedLines: new Set([3, 12]) })
    expect(touched.map(({ title }: { title: string }) => title)).toEqual([
      'does one thing',
      'handles %i'
    ])
  })

  it('keeps none when only lines outside every site changed', () => {
    expect(touchedSites({ sites, status: 'M', addedLines: new Set([5, 15]) })).toEqual([])
  })

  it('keeps every site of an added file', () => {
    expect(touchedSites({ sites, status: 'A', addedLines: new Set() })).toEqual(sites)
  })
})

describe('siteForLine', () => {
  const sites = findTestSites({ path: 'tests/a.test.ts', text: FILE })

  it('finds the site a reported test location falls in', () => {
    expect(siteForLine(sites, 6)?.title).toBe('does another')
    expect(siteForLine(sites, 4)?.title).toBe('does one thing')
    expect(siteForLine(sites, 11)?.title).toBe('handles %i')
  })

  it('returns null outside every site', () => {
    expect(siteForLine(sites, 1)).toBeNull()
  })
})
