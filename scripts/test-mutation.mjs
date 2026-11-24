#!/usr/bin/env node
// Runs StrykerJS (stryker.config.mjs) inside Electron, scored against a chosen set of tests.
//
//   node scripts/test-mutation.mjs [--tests <path>[,<path>...]] [stryker run options]
//
// --tests names the directories or test files the mutants are scored against, relative to the
// repo root; vitest.mutation.config.ts reads it. It defaults to src/packages, which matches the
// default --mutate in stryker.config.mjs. Every other argument goes to `stryker run` unchanged.
//
// Electron, not Node: the unit tests load native modules built for Electron's ABI, and Stryker's
// workers run on the binary that started it. How to read the result: "Mutation baseline" in
// docs/agents/testing.md.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const TESTS_ENV = 'BIRDBRAIN_MUTATION_TESTS'
const STRYKER = './node_modules/@stryker-mutator/core/bin/stryker.js'

// Splits --tests (and --tests=<value>) from the arguments Stryker gets.
export const parseArgs = (argv) => {
  const stryker = []
  let tests = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--tests') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--tests needs a path')
      tests = value
      i++
    } else if (arg.startsWith('--tests=')) {
      tests = arg.slice('--tests='.length)
      if (tests === '') throw new Error('--tests needs a path')
    } else {
      stryker.push(arg)
    }
  }
  return { tests, stryker }
}

// One results file per set of arguments: Stryker keeps a file's earlier mutants in the report
// when a later run leaves them outside --mutate, so a shared file adds one scope's mutants to
// another's score. --force is left out of the name so that it rewrites the file it retests.
export const incrementalFile = ({ tests, stryker }) => {
  const scope = JSON.stringify([tests, stryker.filter((arg) => arg !== '--force')])
  const name = createHash('sha256').update(scope).digest('hex').slice(0, 12)
  return `.cache/stryker/incremental-${name}.json`
}

// Required from Node, the electron package exports the path of its binary.
const electronBinary = () => createRequire(import.meta.url)('electron')

export const main = (argv, deps = {}) => {
  const { env = process.env, run = spawn, electron = electronBinary, stderr = console.error } = deps
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    stderr(`test-mutation: ${error.message}`)
    return Promise.resolve(2)
  }
  // --tests alone sets the scope: a value already in the environment would narrow the run while
  // its results were filed under the default scope's name.
  const childEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
  delete childEnv[TESTS_ENV]
  if (parsed.tests !== null) childEnv[TESTS_ENV] = parsed.tests
  return new Promise((resolve) => {
    const args = [STRYKER, 'run', '--incrementalFile', incrementalFile(parsed), ...parsed.stryker]
    const child = run(electron(), args, { stdio: 'inherit', env: childEnv })
    child.on('error', (error) => {
      stderr(`test-mutation: ${error.message}`)
      resolve(2)
    })
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
