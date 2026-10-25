import { describe, expect, it } from 'vitest'
import {
  READING_GUIDE,
  renderAnnotations,
  renderJson,
  renderMarkdown,
  survivors
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/report.mjs'

const mutant = (outcome: string, line = 3) => ({
  path: 'src/a.ts',
  line,
  start: 0,
  end: 3,
  original: '===',
  replacement: '!==',
  operator: 'operator',
  outcome,
  tests: 4
})

const header = { commit: 'c0ffee', base: 'ba5e', e2e: [] }

describe('renderMarkdown', () => {
  it('lists the tests that pass without the change and the mutants that survived', () => {
    const markdown = renderMarkdown({
      ...header,
      revert: {
        sourcesReverted: 2,
        testsChecked: 5,
        failingAtHead: 1,
        findings: [{ path: 'tests/a.test.ts', fullName: 'a | b works', line: 7 }]
      },
      mutation: {
        candidates: 9,
        selected: 6,
        results: [
          mutant('survived'),
          mutant('killed'),
          mutant('timeout'),
          mutant('not-run'),
          mutant('skipped'),
          mutant('no-tests')
        ],
        files: [
          { path: 'src/a.ts', outcome: 'probed', tests: [] },
          { path: 'src/b.ts', outcome: 'no-tests', tests: [] },
          { path: 'src/c.ts', outcome: 'red-baseline', tests: [] }
        ]
      }
    })
    expect(markdown).toContain('Commit `c0ffee`, merge base `ba5e`.')
    expect(markdown).toContain(`[How to read it](${READING_GUIDE})`)
    expect(markdown).toContain(
      'Reverted 2 source file(s) to the merge base and reran the 5 passing test(s) the branch ' +
        'added or edited. 1 still pass without the change.'
    )
    expect(markdown).toContain('1 touched test(s) fail at HEAD and were not judged.')
    expect(markdown).toContain('| Test | Location |\n| --- | --- |\n| a \\| b works |')
    expect(markdown).toContain(
      'Probed 6 of 9 mutation site(s) on the changed source lines: 1 survived, 2 caught, ' +
        '1 not run for time, 2 skipped.'
    )
    expect(markdown).toContain(
      '| Location | Mutation | Test files run |\n| --- | --- | --- |\n' +
        '| `src/a.ts:3` | replaced `===` with `!==` | 4 |'
    )
    expect(markdown).toContain('No unit test imports: `src/b.ts`.')
    expect(markdown).toContain(
      'Not probed, because their tests fail before any mutation: `src/c.ts`.'
    )
    expect(markdown).toContain('The time budget ran out before every selected mutant ran.')
  })

  it('says when a probe was skipped, turned off, or found nothing to mutate', () => {
    const skipped = renderMarkdown({
      ...header,
      revert: { skipped: 'the branch adds or edits no unit test' },
      mutation: { candidates: 0, selected: 0, results: [], files: [] }
    })
    expect(skipped).toContain('Skipped: the branch adds or edits no unit test.')
    expect(skipped).toContain('No mutation site on the changed source lines.')
    const off = renderMarkdown({ ...header, revert: null, mutation: null })
    expect(off).toContain('Not run (`--no-revert`).')
    expect(off).toContain('Not run (`--no-mutate`).')
  })

  it('leaves out empty tables and lists, and names changed end-to-end specs', () => {
    const markdown = renderMarkdown({
      ...header,
      e2e: [{ path: 'e2e/a.spec.ts' }],
      revert: { sourcesReverted: 1, testsChecked: 1, failingAtHead: 0, findings: [] },
      mutation: {
        candidates: 1,
        selected: 1,
        results: [mutant('killed')],
        files: [{ path: 'src/a.ts', outcome: 'probed', tests: [] }]
      }
    })
    expect(markdown).not.toContain('| Test |')
    expect(markdown).not.toContain('| Location |')
    expect(markdown).not.toContain('fail at HEAD')
    expect(markdown).not.toContain('time budget')
    expect(markdown).not.toContain('No unit test imports')
    expect(markdown).not.toContain('fail before any mutation')
    expect(markdown).toContain('Not probed: `e2e/a.spec.ts`.')
  })

  it('has no end-to-end section when no spec changed', () => {
    expect(renderMarkdown({ ...header, revert: null, mutation: null })).not.toContain('End-to-end')
  })
})

describe('renderAnnotations', () => {
  it('writes one warning per finding, escaping what the workflow command syntax reserves', () => {
    expect(
      renderAnnotations({
        revert: {
          findings: [{ path: 'tests/a,b.test.ts', fullName: '100% works\nnow', line: 7 }]
        },
        mutation: { results: [mutant('survived'), mutant('killed', 9)] }
      })
    ).toEqual([
      '::warning file=tests/a%2Cb.test.ts,line=7,title=Test passes without the change::' +
        '"100%25 works%0Anow" passes with the branch\'s source changes reverted.',
      '::warning file=src/a.ts,line=3,title=Surviving mutant::' +
        'replaced `===` with `!==` and all 4 related test file(s) passed.'
    ])
  })

  it('writes nothing for skipped or disabled probes', () => {
    expect(renderAnnotations({ revert: { skipped: 'x' }, mutation: null })).toEqual([])
    expect(survivors(undefined)).toEqual([])
  })
})

describe('renderJson', () => {
  it('serialises line sets as arrays', () => {
    expect(JSON.parse(renderJson({ lines: new Set([1, 2]) }))).toEqual({ lines: [1, 2] })
  })
})
