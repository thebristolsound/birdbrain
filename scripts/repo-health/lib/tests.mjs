// Test health signals read from the tree. The signals that read GitHub (coverage
// on main, red runs on main, stale branches) arrive with the weekly workflow.
//
// No scheduled test or coverage run is part of this report: CI already runs both
// on every change, and a second copy on a timer would cost runner minutes to learn
// nothing new.

import { Unmeasured } from './unmeasured.mjs'
import { countMatches, isCode, isTestFile } from './tree.mjs'

// A call at the start of a line with the modifier anywhere in its chain:
// `it.skip(`, `test.describe.only(`, `it.skip.each([...])(`, `test.only.concurrent(`,
// `xit(`. `skipIf` and `runIf` are conditions, not modifiers, and are left out.
// Anchoring to the line start leaves out the same text inside a string or a
// comment, which is how the two `.only` mentions in the test-site fixtures read.
const SKIPPED_OR_FOCUSED =
  /^[ \t]*(?:(?:it|test|describe|suite)(?:\.\w+)*\.(?:skip|only|todo|fixme)(?:\.\w+)*|x(?:it|describe))\(/gm

export const TEST_SIGNALS = [
  {
    id: 'skipped-or-focused-tests',
    family: 'tests',
    label: 'Skipped or focused tests',
    unit: 'count',
    better: 'lower',
    budget: 2,
    why: 'the value at f2bd1b03 on 2026-11-24, so any growth shows',
    needs: 'tree',
    measure: (ctx) => {
      const files = ctx.paths.filter((path) => isCode(path) && isTestFile(path))
      if (files.length === 0) throw new Unmeasured('no test files were found to scan')
      return {
        value: files.reduce(
          (total, path) => total + countMatches(ctx.read(path), SKIPPED_OR_FOCUSED),
          0
        )
      }
    }
  }
]
