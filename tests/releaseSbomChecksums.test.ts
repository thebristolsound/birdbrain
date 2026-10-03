import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const ROOT = resolve(__dirname, '..')
const SCRIPTS = join(ROOT, '.github', 'scripts', 'release')
const RELEASE_YML = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
// The script tests spawn bash, node and jq; the 5s default is tight on a loaded machine.
const SPAWN_TIMEOUT = 30_000

// A `gh` first on PATH for the two release scripts. `gh api [-H <header>] <endpoint>` answers
// with the next entry listed for the endpoint, repeating the last one; a null entry fails the
// way an HTTP error does, and anything unlisted fails too. Every call is logged.
const GH_STUB = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const log = path.join(__dirname, 'calls.log')
fs.appendFileSync(log, args.join(' ') + '\\n')
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'))
const fail = (message) => {
  process.stderr.write('gh stub: ' + message + '\\n')
  process.exit(1)
}
if (args[0] !== 'api') fail('unsupported: ' + args.join(' '))
const endpoint = args.find((arg, i) => i > 0 && !arg.startsWith('-') && args[i - 1] !== '-H')
const answers = routes[endpoint]
if (!answers) fail('no route for ' + endpoint)
const call = fs.readFileSync(log, 'utf8').split('\\n').filter((l) => l === args.join(' '))
const answer = answers[Math.min(call.length, answers.length) - 1]
if (answer === null) fail('HTTP 404 for ' + endpoint)
process.stdout.write(answer)
`

type Routes = Record<string, (string | null)[]>

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-scripts-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
  writeFileSync(join(dir, 'calls.log'), '')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (script: string, args: string[], routes: Routes, env: NodeJS.ProcessEnv = {}) => {
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes))
  const result = spawnSync('bash', [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}`, ...env }
  })
  const calls = readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean)
  return { ...result, calls }
}

const REPO = 'o/r'
const GENERATE = `repos/${REPO}/dependency-graph/sbom/generate-report`
const REPORT = `https://api.github.com/repos/${REPO}/dependency-graph/sbom/fetch-report/5b1f`
const DOCUMENT = {
  spdxVersion: 'SPDX-2.3',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'com.github.o/r',
  packages: [{ SPDXID: 'SPDXRef-npm-a-1.0.0', name: 'a', versionInfo: '1.0.0' }]
}
// Compact with a trailing newline, the shape GitHub served on 2026-09-28.
const SERVED = `${JSON.stringify(DOCUMENT)}\n`

const reportAnswers = (answers: (string | null)[]): Routes => ({
  [GENERATE]: [JSON.stringify({ sbom_url: REPORT })],
  [REPORT]: answers
})

describe.skipIf(!HAS_JQ)('sbom.sh exports the bill of materials', () => {
  const out = () => join(dir, 'dist', 'birdbrain-v1.0.0.spdx.json')
  const sbom = (routes: Routes, env: NodeJS.ProcessEnv = {}) =>
    run('sbom.sh', [REPO, out()], routes, { SBOM_POLL_SECONDS: '0', ...env })
  const fetches = (calls: string[]) => calls.filter((call) => call === `api ${REPORT}`)

  it(
    'waits out the answers of a report still generating, then saves the document as served',
    () => {
      // `{}` is what fetch-report answered with its 202 on 2026-09-28; the docs say no content.
      const result = sbom(reportAnswers(['{}', '', SERVED]))

      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(readFileSync(out(), 'utf8')).toBe(SERVED)
      expect(JSON.parse(readFileSync(out(), 'utf8')).spdxVersion).toBe('SPDX-2.3')
      expect(fetches(result.calls)).toHaveLength(3)
    },
    SPAWN_TIMEOUT
  )

  it.each([['{}'], ['<html>not the document</html>']])(
    'fails when the report never arrives, naming the last answer %s',
    (answer) => {
      const result = sbom(reportAnswers([answer]), { SBOM_POLL_ATTEMPTS: '3' })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`not ready after 3 attempts; last answer: ${answer}`)
      expect(fetches(result.calls)).toHaveLength(3)
      expect(existsSync(out())).toBe(false)
    },
    SPAWN_TIMEOUT
  )

  it.each([
    ['GitHub refuses to start the report', { [GENERATE]: [null] }, 'did not start'],
    ['the start names no report URL', { [GENERATE]: ['{}'] }, 'named no report URL'],
    ['fetching the report errors', reportAnswers([null]), 'cannot fetch the SBOM report'],
    [
      'the document is not SPDX 2.3',
      reportAnswers([JSON.stringify({ ...DOCUMENT, spdxVersion: 'SPDX-3.0' })]),
      'not an SPDX-2.3 document that lists packages'
    ],
    [
      'the document lists no packages',
      reportAnswers([JSON.stringify({ ...DOCUMENT, packages: [] })]),
      'not an SPDX-2.3 document that lists packages'
    ]
  ])(
    'fails, and writes nothing, when %s',
    (_, routes, message) => {
      const result = sbom(routes)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(message)
      expect(existsSync(out())).toBe(false)
    },
    SPAWN_TIMEOUT
  )
})

const RELEASES = 'o/releases'
const TAG = 'v1.0.0'
const RELEASE = `repos/${RELEASES}/releases/tags/${TAG}`
// One of each asset release.yml attaches, not in name order.
const ASSETS: Record<string, string> = {
  'Birdbrain-Setup-1.0.0.exe': 'windows installer',
  'Birdbrain-Setup-1.0.0.exe.blockmap': 'windows blockmap',
  'latest.yml': 'version: 1.0.0\n',
  'Birdbrain-1.0.0.AppImage': 'appimage',
  'birdbrain_1.0.0_amd64.deb': 'deb',
  'latest-linux.yml': 'version: 1.0.0\n',
  'birdbrain-extension.zip': 'zip',
  'birdbrain-v1.0.0.spdx.json': SERVED
}

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

// The release, listing its assets with ids in the order given, and one route per asset. A
// null asset fails its download.
const releaseRoutes = (assets: Record<string, string | null>): Routes => {
  const entries = Object.entries(assets)
  return {
    [RELEASE]: [JSON.stringify({ assets: entries.map(([name], i) => ({ id: i + 1, name })) })],
    ...Object.fromEntries(
      entries.map(([, content], i) => [`repos/${RELEASES}/releases/assets/${i + 1}`, [content]])
    )
  }
}

describe.skipIf(!HAS_JQ)('checksums.sh hashes every asset on the release', () => {
  const out = () => join(dir, 'dist', 'SHA256SUMS.txt')
  const checksums = (routes: Routes) => run('checksums.sh', [RELEASES, TAG, out()], routes)
  const downloads = (calls: string[]) =>
    calls.filter((call) => call.startsWith('api -H Accept: application/octet-stream '))

  it(
    'downloads every asset and writes one sha256sum line for each, in name order',
    () => {
      const result = checksums(releaseRoutes(ASSETS))

      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const lines = Object.keys(ASSETS)
        .sort()
        .map((name) => `${sha256(ASSETS[name])}  ${name}`)
      expect(readFileSync(out(), 'utf8')).toBe(`${lines.join('\n')}\n`)
      expect(downloads(result.calls)).toHaveLength(Object.keys(ASSETS).length)
    },
    SPAWN_TIMEOUT
  )

  it(
    'leaves out, and never downloads, an earlier checksum file of its own name',
    () => {
      const result = checksums(releaseRoutes({ ...ASSETS, 'SHA256SUMS.txt': 'an earlier run' }))

      expect(result.status).toBe(0)
      const names = readFileSync(out(), 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => line.slice(66))
      expect(names).toEqual(Object.keys(ASSETS).sort())
      expect(downloads(result.calls)).toHaveLength(Object.keys(ASSETS).length)
    },
    SPAWN_TIMEOUT
  )

  it(
    'verifies a partial download with the release notes command, and catches a changed byte',
    () => {
      checksums(releaseRoutes(ASSETS))
      const folder = join(dir, 'downloads')
      mkdirSync(folder)
      const deb = join(folder, 'birdbrain_1.0.0_amd64.deb')
      writeFileSync(deb, ASSETS['birdbrain_1.0.0_amd64.deb'])
      writeFileSync(join(folder, 'SHA256SUMS.txt'), readFileSync(out()))
      const check = () =>
        spawnSync('sha256sum', ['--check', '--ignore-missing', 'SHA256SUMS.txt'], {
          cwd: folder,
          encoding: 'utf8'
        })

      expect(check().status).toBe(0)
      appendFileSync(deb, 'x')
      expect(check().status).toBe(1)
    },
    SPAWN_TIMEOUT
  )

  it.each([
    [
      'the release cannot be read',
      { [RELEASE]: [null] },
      `cannot read release ${TAG} of ${RELEASES}`
    ],
    [
      'the release lists no assets',
      releaseRoutes({}),
      `${TAG} on ${RELEASES} has no assets to hash`
    ],
    [
      'an asset download fails',
      releaseRoutes({ ...ASSETS, 'latest.yml': null }),
      `cannot download latest.yml from release ${TAG} of ${RELEASES}`
    ]
  ])(
    'fails, and writes nothing, when %s',
    (_, routes, message) => {
      const result = checksums(routes)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(message)
      expect(existsSync(out())).toBe(false)
    },
    SPAWN_TIMEOUT
  )

  it(
    'fails, and writes nothing, when an asset cannot be hashed',
    () => {
      const failing = '#!/usr/bin/env bash\necho "read error" >&2\nexit 1\n'
      writeFileSync(join(dir, 'sha256sum'), failing, { mode: 0o755 })
      const result = checksums(releaseRoutes(ASSETS))

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`cannot hash the assets of ${TAG}`)
      expect(existsSync(out())).toBe(false)
    },
    SPAWN_TIMEOUT
  )
})

// From the job's header line to the next job's, or to the end of the file.
const jobBlock = (content: string, job: string): string => {
  const start = content.indexOf(`\n  ${job}:\n`)
  if (start === -1) return ''
  const next = content.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/)
  return next === -1 ? content.slice(start) : content.slice(start, start + 1 + next)
}

describe('release.yml attaches both files once every build has uploaded', () => {
  const job = jobBlock(RELEASE_YML, 'sbom-and-checksums')

  it('runs one job after both build jobs, and hashes after the bill of materials is up', () => {
    expect(job).toContain('needs: [build-app, build-extension]')
    expect(job.indexOf('name: Upload the bill of materials')).toBeGreaterThan(0)
    expect(job.indexOf('name: Hash every asset on the release')).toBeGreaterThan(
      job.indexOf('name: Upload the bill of materials')
    )
  })

  // The release notes name both files, so a rename in one place would publish notes that
  // point at a file the page does not carry (#603).
  it('names each file the same way in the script call, the upload and the notes', () => {
    expect(job).toContain('"$GITHUB_REPOSITORY" "dist/birdbrain-$TAG.spdx.json"')
    expect(job).toContain('files: dist/birdbrain-${{ github.ref_name }}.spdx.json')
    expect(job).toContain('thebristolsound/birdbrain-releases "$TAG" dist/SHA256SUMS.txt')
    expect(job).toContain('files: dist/SHA256SUMS.txt')
    expect(RELEASE_YML).toContain('\\`birdbrain-${TAG}.spdx.json\\` is that bill of materials')
    expect(RELEASE_YML).toContain('\\`sha256sum --check --ignore-missing SHA256SUMS.txt\\`')
  })

  it('reads with the workflow token, and nothing widens the read-only permissions', () => {
    expect(RELEASE_YML).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(RELEASE_YML.match(/^ *permissions:/gm)).toHaveLength(1)
    expect(job.match(/GH_TOKEN: .*/g)).toEqual([
      'GH_TOKEN: ${{ github.token }}',
      'GH_TOKEN: ${{ github.token }}'
    ])
  })

  it('fails the run when a file to upload is missing', () => {
    expect(job.match(/fail_on_unmatched_files: true/g)).toHaveLength(2)
  })
})

describe('release-macos.yml rewrites the checksum file after a backfill', () => {
  const content = readFileSync(join(ROOT, '.github', 'workflows', 'release-macos.yml'), 'utf8')
  const job = jobBlock(content, 'refresh-checksums')

  it('hashes the tag it backfilled once the macOS upload has finished', () => {
    expect(job).toContain('needs: build-macos')
    expect(job).toContain('TAG: ${{ inputs.tag }}')
    expect(job).toContain('GH_TOKEN: ${{ github.token }}')
    expect(job).toContain('thebristolsound/birdbrain-releases "$TAG" dist/SHA256SUMS.txt')
  })

  it('replaces the file on that release, failing the run when it is missing', () => {
    expect(job).toContain('tag_name: ${{ inputs.tag }}')
    expect(job).toContain('files: dist/SHA256SUMS.txt')
    expect(job).toContain('fail_on_unmatched_files: true')
    expect(job).not.toContain('overwrite_files: false')
  })
})
