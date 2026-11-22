// The Vitest config `pnpm test:mutation` hands to StrykerJS: vitest.config.ts with each project's
// tests narrowed to the ones a run is scored against. Nothing else loads it.
//
// The narrowing is done here, not with Stryker's `testFiles` option. That option hands Stryker
// a test filter for every mutant, and Stryker 10.1 then switches a mutant on only once the test
// file has loaded. A mutant in code that runs as a module loads (a top-level constant, or a
// function a test file calls at its top level) is never live for the tests, and all of them
// are reported as survivors: 60 of 60 in evidence-package-layout/lib/shell.ts.
import { globSync } from 'fs'
import base from './vitest.config'

// Paths the tests must sit under: directories or single test files, relative to the repo root.
// scripts/test-mutation.mjs sets this from --tests.
const SCOPE = (process.env.BIRDBRAIN_MUTATION_TESTS ?? 'src/packages')
  .split(',')
  .map((path) => path.trim().replace(/\\/g, '/').replace(/\/+$/, ''))
  .filter((path) => path !== '')

// These read source files as text. In the sandbox every source file carries all of its mutants
// side by side, so a test that greps source fails the initial run before any mutant is tried.
const READS_SOURCE_AS_TEXT = ['src/packages/evidence-package-layout/tests/literalGuard.test.ts']

const inScope = (file: string): boolean =>
  !READS_SOURCE_AS_TEXT.includes(file) &&
  SCOPE.some((path) => file === path || file.startsWith(`${path}/`))

// A project's own include patterns, resolved to the files in scope. Its `exclude` still applies.
// A project left with no file gets a pattern that matches nothing, since an empty include would
// fall back to Vitest's default.
const narrowed = (include: string[]): string[] => {
  const files = globSync(include, { cwd: __dirname })
    .map((file) => file.replace(/\\/g, '/'))
    .filter(inScope)
  return files.length > 0 ? files : ['no-test-in-mutation-scope']
}

export default {
  ...base,
  test: {
    ...base.test,
    projects: (base.test?.projects ?? []).map((project) => {
      if (typeof project !== 'object' || !('test' in project) || !project.test) {
        throw new Error('vitest.mutation.config.ts expects the inline projects of vitest.config.ts')
      }
      return {
        ...project,
        test: { ...project.test, include: narrowed(project.test.include ?? []) }
      }
    })
  }
}
