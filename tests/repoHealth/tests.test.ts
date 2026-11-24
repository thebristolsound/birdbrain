import { describe, expect, it } from 'vitest'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { TEST_SIGNALS } from '../../scripts/repo-health/lib/tests.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { ctxOf, signalOf } from './helpers'

const measure = (ctx: ReturnType<typeof ctxOf>) =>
  signalOf(TEST_SIGNALS, 'skipped-or-focused-tests').measure(ctx)

// Built from parts so this file never holds a focused or skipped call of its own.
const call = (target: string, modifier: string) => `${target}.${modifier}('case', () => {})`

describe('skipped or focused tests', () => {
  it('counts every skip, focus, todo and fixme form at the start of a line', () => {
    const ctx = ctxOf({
      'tests/a.test.ts': [
        call('it', 'skip'),
        call('test', 'only'),
        `  ${call('describe', 'skip')}`,
        `\t${call('it', 'todo')}`,
        call('describe', 'only')
      ].join('\n'),
      'e2e/b.spec.ts': [call('test', 'fixme'), call('test.describe', 'skip')].join('\n'),
      'src/main/c.test.ts': [
        'xit' + "('case', () => {})",
        'xdescribe' + "('group', () => {})"
      ].join('\n')
    })
    expect(measure(ctx)).toEqual({ value: 9 })
  })

  it('does not count the same text in a string, a comment or a conditional skip', () => {
    const ctx = ctxOf({
      'tests/a.test.ts': [
        `const sample = "${call('test', 'only')}"`,
        `// ${call('it', 'skip')}`,
        "it.skipIf(process.platform === 'win32')('case', () => {})",
        "describe.runIf(HAS_JQ)('group', () => {})",
        "it('skip the header row', () => {})",
        'exit(1)'
      ].join('\n')
    })
    expect(measure(ctx)).toEqual({ value: 0 })
  })

  it("looks only at test files, this tool's own tests included", () => {
    const ctx = ctxOf({
      'src/main/a.ts': call('it', 'skip'),
      'scripts/b.mjs': call('it', 'skip'),
      'tests/fixtures/c.md': call('it', 'skip'),
      'tests/repoHealth/tests.test.ts': call('it', 'skip'),
      'src/packages/example/tests/d.ts': call('it', 'skip'),
      'tests/e.test.ts': "it('runs', () => {})"
    })
    expect(measure(ctx)).toEqual({ value: 2 })
  })

  it('is not measured when it finds no test files, so a moved suite cannot read as zero', () => {
    const ctx = ctxOf({ 'src/main/a.ts': 'export const a = 1\n' })
    expect(() => measure(ctx)).toThrow(Unmeasured)
    expect(() => measure(ctx)).toThrow('no test files were found to scan')
  })
})
