import { describe, expect, it } from 'vitest'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { CODE_SIGNALS } from '../../scripts/repo-health/lib/code.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { ctxOf, knipIssue, signalOf } from './helpers'

const measure = (id: string, ctx: ReturnType<typeof ctxOf>) =>
  signalOf(CODE_SIGNALS, id).measure(ctx)

describe('eslint-disable comments', () => {
  it('counts the line, block and next-line forms across the scanned roots', () => {
    const ctx = ctxOf({
      'src/main/a.ts': [
        '// eslint-disable-next-line no-console',
        'console.log(1)',
        'const b = 2 // eslint-disable-line no-unused-vars'
      ].join('\n'),
      'extension/src/b.tsx': '/* eslint-disable react/no-danger */\nexport const B = 1\n',
      '.github/scripts/c.mjs': '//eslint-disable-next-line no-undef\nfoo()\n',
      'tests/d.test.ts': '  /*   eslint-disable-next-line */\n',
      'e2e/e.spec.ts': 'export const e = 1\n'
    })
    expect(measure('eslint-disable', ctx)).toEqual({ value: 5 })
  })

  it('does not count the words outside a comment, or outside code', () => {
    const ctx = ctxOf({
      'src/main/a.ts': "const rule = 'eslint-disable is not allowed here'\n",
      'scripts/notes.md': '// eslint-disable-next-line\n',
      'vitest.config.ts': '// eslint-disable-next-line\n',
      'website/content/x.js': '// eslint-disable-next-line\n'
    })
    expect(measure('eslint-disable', ctx)).toEqual({ value: 0 })
  })

  it("leaves out the tool's own source and tests, which spell the pattern out", () => {
    const ctx = ctxOf({
      'scripts/repo-health/lib/code.mjs': '// eslint-disable-next-line\n',
      'tests/repoHealth/code.test.ts': '// eslint-disable-next-line\n',
      'scripts/other.mjs': '// eslint-disable-next-line\n'
    })
    expect(measure('eslint-disable', ctx)).toEqual({ value: 1 })
  })

  it('is not measured when it finds no code to scan, and so never reads as zero', () => {
    const ctx = ctxOf({ 'README.md': '# hi\n' })
    expect(() => measure('eslint-disable', ctx)).toThrow(Unmeasured)
    expect(() => measure('eslint-disable', ctx)).toThrow('no code files were found to scan')
  })
})

describe('double casts in product code', () => {
  it('counts every occurrence under src and extension/src, across a line break too', () => {
    const ctx = ctxOf({
      'src/main/a.ts': 'const a = x as unknown as A\nconst b = y as unknown\n  as B\n',
      'extension/src/c.ts': 'export const c = (z as unknown as C).d\n'
    })
    expect(measure('double-casts', ctx)).toEqual({ value: 3 })
  })

  it('leaves tests out, where a double cast builds a partial fixture', () => {
    const ctx = ctxOf({
      'src/main/a.ts': 'export const a = 1\n',
      'src/main/a.test.ts': 'const a = x as unknown as A\n',
      'src/packages/example/tests/helper.ts': 'const a = x as unknown as A\n',
      'tests/b.ts': 'const b = x as unknown as B\n',
      'scripts/c.ts': 'const c = x as unknown as C\n'
    })
    expect(measure('double-casts', ctx)).toEqual({ value: 0 })
  })

  it('is not measured when there is no product code', () => {
    const ctx = ctxOf({ 'tests/b.test.ts': 'const b = 1\n' })
    expect(() => measure('double-casts', ctx)).toThrow('no code files were found to scan')
  })
})

describe('knip code signals', () => {
  const report = {
    issues: [
      knipIssue('src/a.ts', { files: 1, exports: 2, types: 3 }),
      knipIssue('src/b.ts', { enumMembers: 1, namespaceMembers: 1, duplicates: 1, exports: 4 }),
      knipIssue('package.json', { dependencies: 5 })
    ]
  }
  const ctx = ctxOf({}, { knip: () => report })

  it('counts unused files', () => {
    expect(measure('unused-files', ctx)).toEqual({ value: 1 })
  })

  it('adds up unused exports, types, members and duplicates, and nothing else', () => {
    expect(measure('unused-exports', ctx)).toEqual({ value: 12 })
  })

  it('passes on the reason knip could not run', () => {
    const failing = ctxOf(
      {},
      {
        knip: () => {
          throw new Unmeasured('knip is not installed')
        }
      }
    )
    expect(() => measure('unused-files', failing)).toThrow('knip is not installed')
    expect(() => measure('unused-exports', failing)).toThrow('knip is not installed')
  })
})

describe('code signal definitions', () => {
  it('give every signal a budget and the reason for it', () => {
    for (const signal of CODE_SIGNALS) {
      expect(signal.family).toBe('code')
      expect(signal.better).toBe('lower')
      expect(Number.isInteger(signal.budget)).toBe(true)
      expect(signal.why.length).toBeGreaterThan(10)
    }
  })
})
