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

// A `gh` first on PATH for the release scripts. `gh api [options] <endpoint>` answers with the
// next entry listed for the endpoint, prefixed with the method when the call names one with
// -X, repeating the last entry; a null entry fails the way an HTTP error does, and anything
// unlisted fails too. Every call is logged.
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
const valued = ['-H', '-X', '-f', '-F', '--input', '--jq']
const endpoint = args.find((arg, i) => i > 0 && !arg.startsWith('-') && !valued.includes(args[i - 1]))
const method = args.includes('-X') ? args[args.indexOf('-X') + 1] + ' ' : ''
const answers = routes[method + endpoint]
if (!answers) fail('no route for ' + method + endpoint)
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
const RELEASE_ID = '7'
const RELEASE = `repos/${RELEASES}/releases/${RELEASE_ID}`
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
  const checksums = (routes: Routes) => run('checksums.sh', [RELEASES, RELEASE_ID, out()], routes)
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
      `cannot read release ${RELEASE_ID} of ${RELEASES}`
    ],
    [
      'the release lists no assets',
      releaseRoutes({}),
      `release ${RELEASE_ID} of ${RELEASES} has no assets to hash`
    ],
    [
      'an asset download fails',
      releaseRoutes({ ...ASSETS, 'latest.yml': null }),
      `cannot download latest.yml from release ${RELEASE_ID} of ${RELEASES}`
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
      expect(result.stderr).toContain(`cannot hash the assets of release ${RELEASE_ID}`)
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

const REPO_P = 'o/r'
const PTAG = 'v1.0.0'
const DRAFT_ID = 9
const LIST = `repos/${REPO_P}/releases`
const BY_TAG = `repos/${REPO_P}/releases/tags/${PTAG}`
const UPLOAD = (name: string) =>
  `POST https://uploads.github.com/repos/${REPO_P}/releases/${DRAFT_ID}/assets?name=${name}`
const FILES: Record<string, string> = {
  'latest-linux.yml': 'version: 1.0.0\n',
  'birdbrain_1.0.0_amd64.deb': 'deb',
  'SHA256SUMS.txt': 'left by an earlier step'
}

// The routes for one publication of FILES: no published release for the tag, an empty
// release list, the draft, and the draft's assets as checksums.sh reads them back.
const publishRoutes = (overrides: Routes = {}): Routes => {
  const attached = ['birdbrain_1.0.0_amd64.deb', 'latest-linux.yml']
  return {
    [BY_TAG]: [null],
    [LIST]: ['[]'],
    [`POST ${LIST}`]: [JSON.stringify({ id: DRAFT_ID })],
    ...Object.fromEntries([...attached, 'SHA256SUMS.txt'].map((name) => [UPLOAD(name), ['{}']])),
    [`repos/${REPO_P}/releases/${DRAFT_ID}`]: [
      JSON.stringify({ assets: attached.map((name, i) => ({ id: 100 + i, name })) })
    ],
    ...Object.fromEntries(
      attached.map((name, i) => [`repos/${REPO_P}/releases/assets/${100 + i}`, [FILES[name]]])
    ),
    [`PATCH repos/${REPO_P}/releases/${DRAFT_ID}`]: ['{}'],
    ...overrides
  }
}

describe.skipIf(!HAS_JQ)('publish.sh publishes a release complete, then never again', () => {
  const files = () => join(dir, 'dist')
  const notes = () => join(dir, 'notes.md')
  const publish = (routes: Routes, env: NodeJS.ProcessEnv = { PUBLISH_TOKEN: 'maintainer' }) => {
    mkdirSync(files(), { recursive: true })
    for (const [name, content] of Object.entries(FILES)) writeFileSync(join(files(), name), content)
    writeFileSync(notes(), 'notes')
    return run('publish.sh', [REPO_P, PTAG, 'abc123', notes(), files()], routes, env)
  }
  const index = (calls: string[], fragment: string) => calls.findIndex((c) => c.includes(fragment))

  it(
    'creates an untagged pre-release draft, attaches every file and the checksums, then publishes',
    () => {
      const result = publish(publishRoutes())

      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const create = result.calls.find((c) => c.startsWith(`api -X POST ${LIST}`))
      expect(create).toContain('-f tag_name=v1.0.0')
      expect(create).toContain('-f target_commitish=abc123')
      expect(create).toContain('-F draft=true')
      expect(create).toContain('-F prerelease=true')
      expect(create).toContain(`-F body=@${notes()}`)
      const sums = index(result.calls, 'assets?name=SHA256SUMS.txt')
      expect(index(result.calls, 'assets?name=latest-linux.yml')).toBeLessThan(sums)
      expect(index(result.calls, `releases/assets/100`)).toBeLessThan(sums)
      expect(index(result.calls, '-X PATCH')).toBe(result.calls.length - 1)
      expect(result.calls.at(-1)).toContain('-F draft=false')
      expect(result.calls.filter((c) => c.includes('assets?name='))).toHaveLength(3)
      expect(readFileSync(join(files(), 'SHA256SUMS.txt'), 'utf8')).toBe(
        `${sha256('deb')}  birdbrain_1.0.0_amd64.deb\n${sha256(FILES['latest-linux.yml'])}  latest-linux.yml\n`
      )
    },
    SPAWN_TIMEOUT
  )

  it(
    'publishes with PUBLISH_TOKEN and builds the draft with GH_TOKEN',
    () => {
      const tokenLog = join(dir, 'tokens.log')
      const wrapped = `#!/usr/bin/env bash\necho "$GH_TOKEN $*" >>'${tokenLog}'\nexec '${join(dir, 'gh-real')}' "$@"\n`
      writeFileSync(join(dir, 'gh-real'), GH_STUB, { mode: 0o755 })
      writeFileSync(join(dir, 'gh'), wrapped, { mode: 0o755 })
      writeFileSync(join(dir, 'routes.json'), '{}')
      const result = publish(publishRoutes(), { GH_TOKEN: 'workflow', PUBLISH_TOKEN: 'maintainer' })

      expect(result.status).toBe(0)
      const tokens = readFileSync(tokenLog, 'utf8').trimEnd().split('\n')
      expect(tokens.filter((line) => line.startsWith('maintainer '))).toEqual([
        `maintainer api -X PATCH repos/${REPO_P}/releases/${DRAFT_ID} -F draft=false`
      ])
      expect(tokens.slice(0, -1).every((line) => line.startsWith('workflow '))).toBe(true)
    },
    SPAWN_TIMEOUT
  )

  it(
    'stops without a change when the tag is already published',
    () => {
      const result = publish(publishRoutes({ [BY_TAG]: ['{"id": 1}'] }))

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('v1.0.0 is already published on o/r')
      expect(result.calls).toEqual([`api ${BY_TAG}`])
    },
    SPAWN_TIMEOUT
  )

  it(
    'deletes a draft an earlier attempt left for the same tag, and only that one',
    () => {
      const list = [
        { id: 3, draft: true, tag_name: PTAG },
        { id: 4, draft: true, tag_name: 'v0.9.0' },
        { id: 5, draft: false, tag_name: 'v0.8.0' }
      ]
      const result = publish(
        publishRoutes({
          [LIST]: [JSON.stringify(list)],
          [`DELETE repos/${REPO_P}/releases/3`]: ['']
        })
      )

      expect(result.status).toBe(0)
      expect(result.calls.filter((c) => c.includes('-X DELETE'))).toEqual([
        `api -X DELETE repos/${REPO_P}/releases/3`
      ])
      expect(index(result.calls, '-X DELETE')).toBeLessThan(index(result.calls, `-X POST ${LIST}`))
    },
    SPAWN_TIMEOUT
  )

  it.each([
    ['PUBLISH_TOKEN is unset', publishRoutes(), {}, 'PUBLISH_TOKEN is not set'],
    [
      'an upload fails',
      publishRoutes({ [UPLOAD('latest-linux.yml')]: [null] }),
      undefined,
      'cannot attach latest-linux.yml to the draft for v1.0.0 on o/r'
    ],
    [
      'the checksums cannot be written',
      publishRoutes({ [`repos/${REPO_P}/releases/assets/100`]: [null] }),
      undefined,
      'cannot download birdbrain_1.0.0_amd64.deb'
    ]
  ])(
    'fails, and leaves the release a draft, when %s',
    (_, routes, env, message) => {
      const result = publish(routes, env ?? { PUBLISH_TOKEN: 'maintainer' })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(message)
      expect(result.calls.some((c) => c.includes('-X PATCH'))).toBe(false)
    },
    SPAWN_TIMEOUT
  )
})

describe('release.yml publishes through publish.sh', () => {
  const job = jobBlock(RELEASE_YML, 'publish')
  const at = (name: string): number => job.indexOf(`name: ${name}`)

  it('runs one job after both build jobs, with the bill of materials exported first', () => {
    expect(job).toContain('needs: [prepare, build-app, build-extension]')
    expect(at('Export the bill of materials')).toBeGreaterThan(0)
    expect(at('Publish the release')).toBeGreaterThan(at('Export the bill of materials'))
  })

  // The release notes name both files, so a rename in one place would publish notes that
  // point at a file the page does not carry (#603).
  it('names each file the same way in the script calls and the notes', () => {
    expect(job).toContain('"$GITHUB_REPOSITORY" "dist/birdbrain-$TAG.spdx.json"')
    expect(job).toContain(
      '"$GITHUB_REPOSITORY" "$TAG" "$GITHUB_SHA" "$RUNNER_TEMP/release-notes.md" dist'
    )
    expect(RELEASE_YML).toContain('\\`birdbrain-${TAG}.spdx.json\\` is that bill of materials')
    expect(RELEASE_YML).toContain('\\`sha256sum --check --ignore-missing SHA256SUMS.txt\\`')
  })

  // A pushed version tag is in the update feed before its files are uploaded, so the run
  // starts by hand and GitHub creates the tag when the draft is published (ADR-0047).
  it('starts by hand, and nothing in it pushes a tag', () => {
    expect(RELEASE_YML).toMatch(/^on:\n {2}workflow_dispatch:\n/m)
    expect(RELEASE_YML).not.toMatch(/^ {2}push:/m)
    expect(RELEASE_YML).not.toMatch(/git (tag|push)/)
  })
})

describe('release.yml write access', () => {
  const blocks = (content: string) =>
    [...content.matchAll(/^( *)permissions:\n(?:\1 {2}\S.*\n)+/gm)].map((m) => m[0])

  it('widens to contents: write in the publish job only', () => {
    expect(RELEASE_YML).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(blocks(RELEASE_YML)).toEqual([
      'permissions:\n  contents: read\n',
      '    permissions:\n      contents: write\n'
    ])
    expect(jobBlock(RELEASE_YML, 'publish')).toContain('    permissions:\n      contents: write\n')
  })

  // The jobs that can write, or hold a token that can, run only GitHub's tools and the
  // release scripts.
  it.each(['publish', 'bridge'])('runs no install, build or project script in %s', (name) => {
    const job = jobBlock(RELEASE_YML, name)
    expect(job).not.toMatch(/\bpnpm\b|\bnpm\b|\bnode\b|\bnpx\b/)
    for (const [, script] of job.matchAll(/bash (\S+)/g)) {
      expect(script).toMatch(/^\.github\/scripts\/release\/[a-z]+\.sh$/)
    }
  })

  it('hands the maintainer token to publish.sh in the publish job only', () => {
    const uses = [...RELEASE_YML.matchAll(/secrets\.RELEASE_TAG_TOKEN/g)]
    expect(uses).toHaveLength(1)
    expect(jobBlock(RELEASE_YML, 'publish')).toContain(
      'PUBLISH_TOKEN: ${{ secrets.RELEASE_TAG_TOKEN }}'
    )
  })

  it('reads the bridge token only in the bridge job', () => {
    const bridge = jobBlock(RELEASE_YML, 'bridge')
    expect([...RELEASE_YML.matchAll(/secrets\.RELEASES_REPO_TOKEN/g)]).toHaveLength(1)
    expect(bridge).toContain('GH_TOKEN: ${{ secrets.RELEASES_REPO_TOKEN }}')
    expect(bridge).toContain('thebristolsound/birdbrain-releases "$TAG" main')
  })
})
