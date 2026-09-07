import { describe, expect, it } from 'vitest'
import {
  CODE_EXTENSIONS,
  buildInventory,
  classify,
  globToRegExp,
  isExcluded,
  kindOf,
  roleOf
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../../scripts/slop-audit/lib/files.mjs'

describe('isExcluded', () => {
  it('drops the excluded directory prefixes', () => {
    expect(isExcluded('website/app/page.tsx')).toBe(true)
    expect(isExcluded('docs/archive/old.md')).toBe(true)
    expect(isExcluded('docs/design-handoff/proto.js')).toBe(true)
    expect(isExcluded('tests/fixtures/sample.ts')).toBe(true)
  })

  it('drops top-level dot-directories and root dotfiles, not nested dot-segments', () => {
    expect(isExcluded('.claude/agents/reviewer.md')).toBe(true)
    expect(isExcluded('.design-sync/NOTES.md')).toBe(true)
    expect(isExcluded('.nvmrc')).toBe(true)
    expect(isExcluded('src/.keep')).toBe(false)
  })

  it('drops lock files and generated files', () => {
    expect(isExcluded('pnpm-lock.yaml')).toBe(true)
    expect(isExcluded('website/pnpm-lock.yaml')).toBe(true)
    expect(isExcluded('src/renderer/routeTree.gen.ts')).toBe(true)
  })

  it('keeps ordinary source', () => {
    expect(isExcluded('src/main/index.ts')).toBe(false)
    expect(isExcluded('docs/specs/thing.md')).toBe(false)
  })
})

describe('kindOf', () => {
  it('calls every listed code extension code', () => {
    for (const ext of CODE_EXTENSIONS) expect(kindOf(`src/a${ext}`)).toBe('code')
  })

  it('separates prose and config from everything else', () => {
    expect(kindOf('docs/specs/thing.md')).toBe('prose')
    expect(kindOf('package.json')).toBe('config')
    expect(kindOf('src/renderer/styles.css')).toBe('other')
    expect(kindOf('src/renderer/index.html')).toBe('other')
    expect(kindOf('src/renderer/assets/logo.png')).toBe('other')
    expect(kindOf('src/renderer/fonts/inter.woff2')).toBe('other')
    expect(kindOf('scripts/setup.sh')).toBe('other')
    expect(kindOf('.github/workflows/ci.yml')).toBe('other')
    expect(kindOf('tsconfig.json')).toBe('other')
  })
})

describe('roleOf', () => {
  it('assigns test by directory or by .test. infix', () => {
    expect(roleOf('tests/main/a.test.ts')).toBe('test')
    expect(roleOf('e2e/flow.spec.ts')).toBe('test')
    expect(roleOf('src/packages/x/tests/x.test.ts')).toBe('test')
    expect(roleOf('src/main/a.test.mts')).toBe('test')
  })

  it('assigns script and source by directory', () => {
    expect(roleOf('scripts/audit-check.mjs')).toBe('script')
    expect(roleOf('scripts/slop-audit/cli.mjs')).toBe('script')
    expect(roleOf('src/main/index.ts')).toBe('source')
    expect(roleOf('extension/src/background.ts')).toBe('source')
  })

  it('leaves root configuration code without a role', () => {
    expect(roleOf('vitest.config.ts')).toBeNull()
    expect(roleOf('eslint.config.js')).toBeNull()
  })
})

describe('classify', () => {
  it('returns null for excluded paths before looking at anything else', () => {
    expect(classify('website/app/page.tsx')).toBeNull()
  })

  it('gives code a role and everything else a null role', () => {
    expect(classify('src/main/index.ts')).toEqual({
      path: 'src/main/index.ts',
      kind: 'code',
      role: 'source'
    })
    expect(classify('src/renderer/styles.css')).toEqual({
      path: 'src/renderer/styles.css',
      kind: 'other',
      role: null
    })
    expect(classify('docs/specs/thing.md')).toEqual({
      path: 'docs/specs/thing.md',
      kind: 'prose',
      role: null
    })
  })
})

describe('globToRegExp', () => {
  it('spans directories with ** and stays in one segment with * and ?', () => {
    expect(globToRegExp('src/**/*.ts').test('src/main/services/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/main/a.ts')).toBe(false)
    expect(globToRegExp('src/**').test('src/main/a.ts')).toBe(true)
    expect(globToRegExp('src/a?.ts').test('src/ab.ts')).toBe(true)
    expect(globToRegExp('src/a?.ts').test('src/a/b.ts')).toBe(false)
  })

  it('escapes regular-expression metacharacters in the glob', () => {
    expect(globToRegExp('src/a.ts').test('src/aXts')).toBe(false)
    expect(globToRegExp('src/(a).ts').test('src/(a).ts')).toBe(true)
  })
})

describe('buildInventory', () => {
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'src/main/index.ts',
    'src/renderer/styles.css',
    'tests/main/a.test.ts',
    'website/app/page.tsx'
  ]

  it('classifies every path that survives the excludes and reports all of them', () => {
    const { files, reported } = buildInventory({ paths })
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      'package.json',
      'src/main/index.ts',
      'src/renderer/styles.css',
      'tests/main/a.test.ts'
    ])
    expect([...reported]).toEqual([
      'package.json',
      'src/main/index.ts',
      'src/renderer/styles.css',
      'tests/main/a.test.ts'
    ])
  })

  it('narrows the reported set, not the file list, when changed paths are given', () => {
    const { files, reported } = buildInventory({ paths, changed: ['src/main/index.ts'] })
    expect(files).toHaveLength(4)
    expect([...reported]).toEqual(['src/main/index.ts'])
  })

  it('narrows the file list when globs are given', () => {
    const { files } = buildInventory({ paths, globs: ['src/**'] })
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      'src/main/index.ts',
      'src/renderer/styles.css'
    ])
  })
})
