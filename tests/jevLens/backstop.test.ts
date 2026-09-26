import { describe, expect, it } from 'vitest'
import {
  INCLUDE_LIST_DOC,
  globToRegExp,
  loadIncludeList,
  matchEntry,
  parseIncludeList
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/jev-lens/backstop.mjs'

type Entry = { path: string; tier: 'blocking' | 'advisory'; why: string }

const doc = `# Assessment

## Include list

### Acquisition

| Path | Tier | Why |
|---|---|---|
| \`extension/src/content.ts\` | blocking | in-page capture |
| \`src/main/services/db/**\` | blocking | records |
| \`src/main/services/settings.ts\` | advisory | shared |
| \`scripts/coverage-*.mjs\` | blocking | glob in one segment |
| not a path | blocking | ignored |

## Notable exclusions

| Path | Why |
|---|---|
| \`src/main/windowSize.ts\` | geometry |
`

describe('parseIncludeList', () => {
  it('reads every tiered row between the include list and the exclusions', () => {
    const entries: Entry[] = parseIncludeList(doc)
    expect(entries.map((e) => [e.path, e.tier])).toEqual([
      ['extension/src/content.ts', 'blocking'],
      ['src/main/services/db/**', 'blocking'],
      ['src/main/services/settings.ts', 'advisory'],
      ['scripts/coverage-*.mjs', 'blocking']
    ])
    expect(entries[0].why).toBe('in-page capture')
  })

  it('refuses a document without the sections or without rows', () => {
    expect(() => parseIncludeList('# nothing')).toThrow('include list section not found')
    expect(() => parseIncludeList('\n## Include list\n\n## Notable exclusions\n')).toThrow('zero entries')
  })

  it('parses the real document', () => {
    const entries: Entry[] = loadIncludeList()
    expect(INCLUDE_LIST_DOC).toMatch(/evidence-affecting-paths-assessment/)
    expect(entries.length).toBeGreaterThan(50)
    expect(entries.every((e) => e.tier === 'blocking' || e.tier === 'advisory')).toBe(true)
  })
})

describe('globToRegExp', () => {
  it('spans directories with ** and one segment with *', () => {
    expect(globToRegExp('src/a/**').test('src/a/b/c.ts')).toBe(true)
    expect(globToRegExp('src/a/**').test('src/ab/c.ts')).toBe(false)
    expect(globToRegExp('scripts/coverage-*.mjs').test('scripts/coverage-all.mjs')).toBe(true)
    expect(globToRegExp('scripts/coverage-*.mjs').test('scripts/coverage-x/y.mjs')).toBe(false)
    expect(globToRegExp('a.ts').test('axts')).toBe(false)
  })
})

describe('matchEntry', () => {
  const entries: Entry[] = parseIncludeList(doc)
  it('returns the entry a path falls under, blocking over advisory, longer glob over shorter', () => {
    expect(matchEntry(entries, 'src/main/services/db/repos/x.ts')?.path).toBe('src/main/services/db/**')
    expect(matchEntry(entries, 'src/main/services/settings.ts')?.tier).toBe('advisory')
    expect(matchEntry(entries, 'src/main/windowSize.ts')).toBeNull()
    const both: Entry[] = [
      { path: 'src/**', tier: 'advisory', why: '' },
      { path: 'src/x/**', tier: 'advisory', why: '' },
      { path: 'src/x/y.ts', tier: 'blocking', why: '' }
    ]
    expect(matchEntry(both, 'src/x/z.ts')?.path).toBe('src/x/**')
    expect(matchEntry(both, 'src/x/y.ts')?.tier).toBe('blocking')
  })
})
