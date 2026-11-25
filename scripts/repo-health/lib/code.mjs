// Code debt signals: suppressions, double casts and what knip finds unused.
//
// Left out on purpose, each measured on 2026-11-20:
// - `as any` and `: any`: every hit was prose ("as any other"), and
//   typescript-eslint's no-explicit-any already gates the real ones.
// - `@ts-expect-error`: none in src/. The 67 hits are untyped-script imports in
//   tests and deliberate negative type tests.
// - TODO and FIXME: all six are the migration scaffold script's template text,
//   five in the script and one in its test.

import { countIssues } from './knip.mjs'
import { Unmeasured } from './unmeasured.mjs'
import { countMatches, isCode, isTestFile, under } from './tree.mjs'

const BUDGET_SOURCE = 'the value at f2bd1b03 on 2026-11-24, so any growth shows'

const SUPPRESSION_ROOTS = [
  'src/',
  'extension/src/',
  'tests/',
  'e2e/',
  'scripts/',
  '.github/scripts/'
]
const PRODUCT_ROOTS = ['src/', 'extension/src/']

// A comment that opens with the directive: the line, block and next-line forms.
// Nothing is excluded, this tool's own folders included. Its tests build the
// directive from parts so that no file of the tool matches, and a real
// suppression added to the tool later is counted like any other.
const ESLINT_DISABLE = /(?:\/\/|\/\*)\s*eslint-disable/g
const DOUBLE_CAST = /\bas\s+unknown\s+as\b/g

const countIn = (ctx, keep, pattern) => {
  const files = ctx.paths.filter(keep)
  if (files.length === 0) throw new Unmeasured('no code files were found to scan')
  return files.reduce((total, path) => total + countMatches(ctx.read(path), pattern), 0)
}

export const CODE_SIGNALS = [
  {
    id: 'eslint-disable',
    family: 'code',
    label: '`eslint-disable` comments',
    unit: 'count',
    better: 'lower',
    budget: 14,
    why: BUDGET_SOURCE,
    needs: 'tree',
    measure: (ctx) => ({
      value: countIn(ctx, (path) => isCode(path) && under(path, SUPPRESSION_ROOTS), ESLINT_DISABLE)
    })
  },
  {
    id: 'double-casts',
    family: 'code',
    label: '`as unknown as` casts in product code',
    unit: 'count',
    better: 'lower',
    budget: 19,
    why: BUDGET_SOURCE,
    needs: 'tree',
    measure: (ctx) => ({
      value: countIn(
        ctx,
        (path) => isCode(path) && under(path, PRODUCT_ROOTS) && !isTestFile(path),
        DOUBLE_CAST
      )
    })
  },
  {
    id: 'unused-files',
    family: 'code',
    label: 'Unused files (knip)',
    unit: 'count',
    better: 'lower',
    budget: 4,
    why: BUDGET_SOURCE,
    needs: 'install',
    measure: (ctx) => ({ value: countIssues(ctx.knip(), ['files']) })
  },
  {
    id: 'unused-exports',
    family: 'code',
    label: 'Unused exports and types (knip)',
    unit: 'count',
    better: 'lower',
    budget: 281,
    why: BUDGET_SOURCE,
    needs: 'install',
    measure: (ctx) => ({
      value: countIssues(ctx.knip(), [
        'exports',
        'types',
        'enumMembers',
        'namespaceMembers',
        'duplicates'
      ])
    })
  }
]
