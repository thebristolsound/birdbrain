import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The whole path the workflow takes: the real CLI, a real git repository, and a
// `gh` on PATH. Only `gh` is a stub, so this proves the calls the tool makes and
// the payloads it sends, without a network.
const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'repo-health', 'cli.mjs')
const REPO = 'o/r'
const ISSUES = `repos/${REPO}/issues?state=open&labels=repo-health&per_page=100`

// Answers `gh api <endpoint>` from fixtures.json and fails on a read it has no
// answer for. A write (`-X <method>`) is appended to `writes` as one JSON line
// with the payload it received on standard input.
const GH_STUB = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const dir = process.env.GH_STUB_DIR
const args = process.argv.slice(2)
if (args[0] !== 'api') {
  console.error('stub gh: unsupported command ' + args.join(' '))
  process.exit(2)
}
let method = 'GET'
let endpoint = null
for (let i = 1; i < args.length; i++) {
  if (args[i] === '-X') method = args[++i]
  else if (args[i] === '--input' || args[i] === '-f') i++
  else if (!args[i].startsWith('-') && endpoint === null) endpoint = args[i]
}
if (method !== 'GET') {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  fs.appendFileSync(path.join(dir, 'writes'), JSON.stringify({ method, endpoint, payload }) + '\\n')
  process.stdout.write('{}')
  process.exit(0)
}
const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'))
if (!(endpoint in fixtures)) {
  console.error('gh: Not Found (HTTP 404) ' + endpoint)
  process.exit(1)
}
process.stdout.write(JSON.stringify(fixtures[endpoint]))
`

type Write = { method: string; endpoint: string; payload: Record<string, unknown> }

let stub: string
let repo: string

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repo,
    stdio: 'pipe'
  })

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'repo-health-gh-'))
  writeFileSync(join(stub, 'gh'), GH_STUB, { mode: 0o755 })
  repo = mkdtempSync(join(tmpdir(), 'repo-health-repo-'))
  git('init', '-q')
  writeFileSync(join(repo, 'CLAUDE.md'), '# Rules\n')
  writeFileSync(join(repo, 'AGENTS.md'), '# Rules\n')
  git('add', '.')
  git('commit', '-q', '-m', 'fixture')
})

afterEach(() => {
  rmSync(stub, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

const run = (fixtures: Record<string, unknown>, env: Record<string, string> = {}) => {
  writeFileSync(join(stub, 'fixtures.json'), JSON.stringify(fixtures))
  const result = spawnSync(process.execPath, [SCRIPT, '--publish'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      PATH: `${stub}${delimiter}${process.env.PATH}`,
      GH_STUB_DIR: stub,
      GH_TOKEN: 'stub-token',
      GITHUB_REPOSITORY: REPO,
      GITHUB_REPOSITORY_OWNER: 'o',
      ...env
    }
  })
  const log = join(stub, 'writes')
  const writes: Write[] = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
  return { ...result, writes }
}

describe('repo-health --publish, end to end', () => {
  it('writes nothing unless DRY_RUN is exactly false, and says what it would write', () => {
    const environments: Record<string, string>[] = [
      {},
      { DRY_RUN: 'true' },
      { DRY_RUN: 'False' },
      { DRY_RUN: '' }
    ]
    for (const env of environments) {
      const { status, stderr, writes } = run({ [ISSUES]: [] }, env)
      expect(status).toBe(0)
      expect(writes).toEqual([])
      expect(stderr).toContain('repo-health: would open the repo-health issue')
      expect(stderr).toContain('dry run: nothing was written')
    }
  })

  it('opens the issue with DRY_RUN=false, sending the title and body on standard input', () => {
    const { status, stderr, writes } = run({ [ISSUES]: [] }, { DRY_RUN: 'false' })
    expect(status).toBe(0)
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      `POST repos/${REPO}/labels`,
      `POST repos/${REPO}/issues`
    ])
    const issue = writes[1].payload
    expect(String(issue.title)).toMatch(/^Repository health: \d+ outside budget, \d+ not measured/)
    expect(issue.labels).toEqual(['repo-health', 'process'])
    expect(issue.assignees).toEqual(['o'])
    expect(String(issue.body)).toContain('<!-- repo-health-state:v1')
    expect(stderr).toContain('repo-health: did open the repo-health issue')
  })

  it('still publishes when a signal cannot read GitHub, and shows it as not measured', () => {
    // No fixture answers the pull request, coverage, run or branch reads.
    const { status, stdout, writes } = run({ [ISSUES]: [] }, { DRY_RUN: 'false' })
    expect(status).toBe(0)
    expect(stdout).toMatch(/not measured\s+dependencies\s+not measured.*Dependabot/)
    expect(stdout).toContain('GitHub could not be read; see the run log')
    expect(String(writes[1].payload.body)).toContain('| **not measured** |')
  })

  it('rewrites the open issue and comments once when it cannot read the old state', () => {
    const { status, writes } = run(
      {
        [ISSUES]: [
          {
            number: 41,
            body: 'A body with no state block.',
            user: { login: 'github-actions[bot]' }
          }
        ]
      },
      { DRY_RUN: 'false' }
    )
    expect(status).toBe(0)
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      `POST repos/${REPO}/issues/41/comments`,
      `PATCH repos/${REPO}/issues/41`
    ])
    expect(String(writes[0].payload.body)).toContain('could not compare with the previous report')
  })

  it('exits 2 and writes nothing when the issue list cannot be read', () => {
    const { status, stderr, writes } = run({}, { DRY_RUN: 'false' })
    expect(status).toBe(2)
    expect(writes).toEqual([])
    expect(stderr).toContain('repo-health: could not publish: gh api')
  })

  it('exits 2 without a token instead of reporting a publish that did not happen', () => {
    const { status, stderr, writes } = run({ [ISSUES]: [] }, { GH_TOKEN: '', DRY_RUN: 'false' })
    expect(status).toBe(2)
    expect(writes).toEqual([])
    expect(stderr).toContain('--publish needs GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY')
  })
})
