// Whole-module mutation testing with StrykerJS.
//
// `pnpm test:reliability` already mutates the lines a branch changed (at most 40 mutants, eight
// kinds of edit) and is the per-PR check. This asks the wider question that probe cannot: across
// a whole module, how many faults would the unit tests catch? It is a baseline to run on demand,
// not a gate. How to read the result: "Mutation baseline" in docs/agents/testing.md.
//
// Run it through `pnpm test:mutation` (scripts/test-mutation.mjs), which starts Stryker inside
// Electron and takes --tests. Plain `stryker run` under Node fails on the first better-sqlite3
// import.
//
//   pnpm test:mutation
//       src/packages, each mutant scored against the tests under src/packages
//   pnpm test:mutation --mutate src/shared/safeFilename.ts --tests tests/shared
//       one file, scored against the tests under tests/shared
//   pnpm test:mutation --mutate 'src/shared/noteDoc.ts:40-90' --tests tests/shared/noteDoc.test.ts
//       a line range, scored against one test file
//
// @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
export default {
  // Named explicitly: pnpm does not hoist the runner next to @stryker-mutator/core, so Stryker's
  // default `@stryker-mutator/*` lookup finds no plugins.
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: {
    // Narrows the tests to --tests; the reason it is done there is at the top of that file.
    configFile: 'vitest.mutation.config.ts',
    // The runner's default is `threads`; the suite runs in Vitest's default, `forks`.
    pool: 'forks',
    // Within --tests, each mutant runs only the test files that import the mutated file.
    related: true
  },

  // The default scope is the deep-module packages, scored against the tests beside them: the
  // question for a deep module is whether its own tests pin its behaviour, not whether some
  // test elsewhere in the suite happens to. Pass --mutate and --tests together for anything
  // else, and keep --tests narrow: with all of tests/ in scope, a 28-line file in src/shared
  // pulled in the IPC and component suites and took seven minutes.
  mutate: ['src/packages/**/*.{ts,mts,cts}', '!src/packages/**/tests/**', '!**/*.d.ts'],

  // Stryker copies the tree into a sandbox and mutates the copy, so the working tree is never
  // edited and a dirty tree is fine. Only build output and the docs site are left out of the
  // copy: vitest.config.ts reads a file under docs/, and tests read fixtures from resources/,
  // scripts/ and design-system/.
  tempDirName: '.cache/stryker-tmp',
  ignorePatterns: [
    'out',
    'dist',
    'coverage',
    'website',
    // Everything under .cache but the system sharp build: with BIRDBRAIN_TEST_SYSTEM_SHARP=1,
    // tests/setup/system-sharp.ts loads that addon from a path relative to itself, so the
    // sandbox needs its own copy. A narrower exception than the directory re-includes all of
    // .cache.
    '.cache/*',
    '!.cache/test-sharp',
    '.preflight',
    'reports'
  ],

  // Reuses results for mutants whose code and covering tests are unchanged since the last run.
  incremental: true,
  incrementalFile: '.cache/stryker/incremental.json',

  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: '.cache/stryker/report/mutation.html' },
  jsonReporter: { fileName: '.cache/stryker/report/mutation.json' },
  // The score table and the surviving mutants, without the list of every test that ran.
  clearTextReporter: { logTests: false, reportTests: false },

  // Advisory: no score fails the run. `high` and `low` only colour the report.
  thresholds: { high: 85, low: 70, break: null },

  // The suite has tests near its 15 s timeout when CPUs are contended (vitest.config.ts), so
  // leave cores free and give slow mutants room before they count as timed out.
  concurrency: '50%',
  timeoutMS: 15_000,
  timeoutFactor: 2,
  // The initial run is one worker with per-test coverage on, several times slower than
  // `pnpm test` on the same files; Stryker's default of five minutes is too short for a wide scope.
  dryRunTimeoutMinutes: 15
}
