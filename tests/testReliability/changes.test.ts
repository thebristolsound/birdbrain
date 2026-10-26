import { describe, expect, it } from 'vitest'
import {
  classifyPath,
  collectChanges,
  isClean,
  mergeBase,
  parseAddedLines,
  parseNameStatus
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/changes.mjs'

type Git = (args: string[]) => string

describe('classifyPath', () => {
  it('names unit tests in both test trees', () => {
    expect(classifyPath('tests/shared/memberCode.test.ts')).toBe('unit-test')
    expect(classifyPath('tests/components/Thing.test.tsx')).toBe('unit-test')
    expect(classifyPath('src/packages/case-search/tests/index.test.ts')).toBe('unit-test')
  })

  it('names end-to-end specs', () => {
    expect(classifyPath('e2e/annotation.spec.ts')).toBe('e2e')
  })

  it('names app and extension source', () => {
    expect(classifyPath('src/shared/memberCode.ts')).toBe('source')
    expect(classifyPath('src/renderer/components/Thing.tsx')).toBe('source')
    expect(classifyPath('extension/src/background.ts')).toBe('source')
  })

  it('keeps a types.ts file, whose runtime exports the tests can load', () => {
    expect(classifyPath('src/shared/types.ts')).toBe('source')
  })

  it('leaves out source the unit runner never loads, as the coverage excludes do', () => {
    expect(classifyPath('src/renderer/env.d.ts')).toBeNull()
    expect(classifyPath('src/renderer/routeTree.gen.ts')).toBeNull()
    expect(classifyPath('src/main/index.ts')).toBeNull()
    expect(classifyPath('src/preload/index.ts')).toBeNull()
    expect(classifyPath('src/packages/case-search/tests/helper.ts')).toBeNull()
  })

  it('leaves out everything else', () => {
    expect(classifyPath('scripts/check.mjs')).toBeNull()
    expect(classifyPath('docs/plans/x.md')).toBeNull()
    expect(classifyPath('src/renderer/styles.css')).toBeNull()
  })
})

describe('parseNameStatus', () => {
  it('reads NUL-separated status and path pairs', () => {
    expect(parseNameStatus('M\0src/a.ts\0A\0tests/a.test.ts\0D\0src/old.ts\0')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'tests/a.test.ts' },
      { status: 'D', path: 'src/old.ts' }
    ])
  })

  it('reads an empty diff as no entries, and ignores a truncated trailing status', () => {
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus('M\0src/a.ts\0A')).toEqual([{ status: 'M', path: 'src/a.ts' }])
  })
})

describe('parseAddedLines', () => {
  it('collects new-side lines per file, single-line hunks included', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+one',
      '+two',
      '@@ -10 +12 @@',
      '-old',
      '+new',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -5,2 +4,0 @@'
    ].join('\n')
    const lines = parseAddedLines(diff)
    expect([...lines.get('src/a.ts')]).toEqual([4, 5, 12])
    expect([...lines.get('src/b.ts')]).toEqual([])
  })

  it('skips a deleted file', () => {
    const diff = ['--- a/src/gone.ts', '+++ /dev/null', '@@ -1,3 +0,0 @@'].join('\n')
    expect(parseAddedLines(diff).size).toBe(0)
  })
})

describe('mergeBase', () => {
  it('returns the trimmed sha', () => {
    const git: Git = (args) => {
      expect(args).toEqual(['merge-base', 'origin/main', 'HEAD'])
      return 'abc123\n'
    }
    expect(mergeBase(git, 'origin/main')).toBe('abc123')
  })

  it('names the base it could not resolve', () => {
    const git: Git = () => {
      throw new Error('fatal: Not a valid object name')
    }
    expect(() => mergeBase(git, 'origin/nope')).toThrow(/"origin\/nope" and HEAD/)
  })
})

describe('isClean', () => {
  it('is true only when git status lists no tracked change', () => {
    expect(isClean(() => '')).toBe(true)
    expect(isClean(() => ' M src/a.ts\n')).toBe(false)
  })
})

describe('collectChanges', () => {
  it('sorts the changed paths into sources, unit tests and specs with their added lines', () => {
    const git: Git = (args) => {
      if (args[0] === 'merge-base') return 'base\n'
      if (args.includes('--name-status')) {
        return 'M\0src/a.ts\0A\0tests/a.test.ts\0M\0e2e/a.spec.ts\0M\0README.md\0D\0src/old.ts\0'
      }
      return ['+++ b/src/a.ts', '@@ -1 +1 @@', '+++ b/tests/a.test.ts', '@@ -0,0 +1,2 @@'].join(
        '\n'
      )
    }
    const changes = collectChanges({ git, base: 'origin/main' })
    expect(changes.base).toBe('base')
    expect(
      changes.sources.map(({ path, status }: { path: string; status: string }) => [path, status])
    ).toEqual([
      ['src/a.ts', 'M'],
      ['src/old.ts', 'D']
    ])
    expect([...changes.sources[0].addedLines]).toEqual([1])
    expect([...changes.sources[1].addedLines]).toEqual([])
    expect([...changes.unitTests[0].addedLines]).toEqual([1, 2])
    expect(changes.e2e.map(({ path }: { path: string }) => path)).toEqual(['e2e/a.spec.ts'])
  })
})
