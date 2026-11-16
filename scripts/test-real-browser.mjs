// Runs the real-browser suites, each file in an xvfb-run of its own.
//
// Those suites launch the pinned Chrome for Testing and skip unless they run under xvfb-run
// (tests/helpers/launchedBrowserSuite.ts). Vitest runs files in parallel, so two of them under
// one xvfb-run share one X display, where a browser from one file can sit in front of the
// other's while it captures. One display per file keeps them apart.
//
// A suite that also wants a loopback-only network namespace (it defines namespaceSkipReason)
// runs inside one, by the command that suite prints. A suite that ran no test fails the run:
// Vitest exits 0 for a file whose tests all skipped, and that must not read as a pass.
//
// Usage: node scripts/test-real-browser.mjs [<test file>...]

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ARCHIVES, CACHE_DIR, CHROME_FOR_TESTING_VERSION } from './fetch-chrome-for-testing.mjs'

export const SUITE_DIR = join('tests', 'main', 'services', 'launchedBrowser')

// A real-browser suite is a test file that asks the helper whether it may run.
export const realBrowserSuites = (root, dir = SUITE_DIR) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => readFileSync(join(root, dir, name), 'utf8').includes('realBrowserSkipReason'))
    .sort()
    .map((name) => join(dir, name))

// The command for one suite: xvfb-run around `pnpm test <file>`, and around that, for a suite
// with a namespace rule of its own, the two unshare calls tests/.../egressNetns.test.ts names.
export const suiteCommand = (suite, source, { uid, gid }) => {
  const test = ['xvfb-run', '--auto-servernum', 'pnpm', 'test', suite]
  if (!source.includes('namespaceSkipReason')) return test
  const mapped = `unshare -U --map-user=${uid} --map-group=${gid} ${test.join(' ')}`
  return ['unshare', '-rn', 'sh', '-c', `ip link set lo up && ${mapped}`]
}

// What Vitest's closing Tests line says happened: 'passed', 'failed', or 'ran no test'.
// Vitest colours that line when CI or FORCE_COLOR is set, so the escape codes go first.
export const suiteOutcome = (exitCode, output) => {
  if (exitCode !== 0) return 'failed'
  // eslint-disable-next-line no-control-regex -- the escape character is what is being removed
  const tests = /^\s*Tests\s+(.+)$/m.exec(output.replace(/\x1b\[[0-9;]*m/g, ''))
  return tests && /\b[1-9]\d* passed\b/.test(tests[1]) ? 'passed' : 'ran no test'
}

// Why no suite can run here, or null. A suite that cannot run skips its tests and exits 0,
// which would read as a pass, so the runner refuses first.
export const preconditionProblem = (platformKey, exists = existsSync) => {
  const pin = ARCHIVES[platformKey]
  if (!pin) return `no pinned Chrome for Testing build for ${platformKey}`
  if (!exists(join(CACHE_DIR, CHROME_FOR_TESTING_VERSION, pin.executable))) {
    return (
      `no pinned Chrome for Testing ${CHROME_FOR_TESTING_VERSION}: ` +
      'run node scripts/fetch-chrome-for-testing.mjs'
    )
  }
  return null
}

const main = () => {
  const root = process.cwd()
  const problem = preconditionProblem(`${process.platform}-${process.arch}`)
  if (problem) {
    console.error(`test:real-browser: ${problem}`)
    return 1
  }
  const suites = process.argv.length > 2 ? process.argv.slice(2) : realBrowserSuites(root)
  if (suites.length === 0) {
    console.error(`test:real-browser: no real-browser suite under ${SUITE_DIR}`)
    return 1
  }
  const user = { uid: process.getuid(), gid: process.getgid() }
  const notPassed = []
  for (const suite of suites) {
    const [command, ...args] = suiteCommand(suite, readFileSync(join(root, suite), 'utf8'), user)
    console.log(`\ntest:real-browser: ${suite}`)
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit']
    })
    if (result.error) {
      console.error(`test:real-browser: cannot start ${command}: ${result.error.message}`)
      return 1
    }
    process.stdout.write(result.stdout)
    const outcome = suiteOutcome(result.status, result.stdout)
    if (outcome !== 'passed') notPassed.push(`${suite} (${outcome})`)
  }
  console.log(
    `\ntest:real-browser: ${suites.length - notPassed.length} of ${suites.length} suites passed` +
      (notPassed.length ? `; not passed: ${notPassed.join(', ')}` : '')
  )
  return notPassed.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
