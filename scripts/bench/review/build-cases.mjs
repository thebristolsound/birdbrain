// Materialises every case spec under cases/ into fixtures/<id>/: the resolved
// spec, the truth file with line numbers, the diff the model reads at tier L0,
// and the PR title and body. Proves each mutation applies at the pinned head.
//
// Usage: node build-cases.mjs [--only <id>] [--no-gh] [--repo <dir>]

import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  existsSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateCaseSpec, PR_BODY } from './lib/schema.mjs'
import { applyMutations, deriveTruth } from './lib/mutate.mjs'
import * as git from './lib/git.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_DIR = join(here, 'cases')
export const FIXTURES_DIR = join(here, 'fixtures')

export function loadSpecs(dir = CASES_DIR) {
  const specs = []
  for (const kind of ['mutation', 'real']) {
    const sub = join(dir, kind)
    if (!existsSync(sub)) continue
    for (const name of readdirSync(sub).sort()) {
      if (!name.endsWith('.json')) continue
      const spec = JSON.parse(readFileSync(join(sub, name), 'utf8'))
      const problems = validateCaseSpec(spec)
      if (problems.length) throw new Error(`${kind}/${name}: ${problems.join('; ')}`)
      if (spec.kind !== kind) throw new Error(`${kind}/${name}: kind is ${spec.kind}`)
      specs.push(spec)
    }
  }
  const ids = new Set()
  for (const s of specs) {
    if (ids.has(s.id)) throw new Error(`duplicate case id ${s.id}`)
    ids.add(s.id)
  }
  return specs
}

// deps: { readFile(sha, path), diff(head, files, base), pr(number) | null }
export function buildCase(spec, deps) {
  const readFile = (path) => deps.readFile(spec.source.head, path)
  let files = new Map()
  let truth
  if (spec.kind === 'mutation') {
    const applied = applyMutations(readFile, spec.mutations)
    files = applied.files
    truth = deriveTruth([...applied.defects, ...(spec.baseDefects ?? [])], applied.benign)
  } else {
    truth = spec.truth
    for (const d of truth.defects) {
      if (d.file !== PR_BODY && readFile(d.file) === null)
        throw new Error(`${spec.id}: ${d.file} not at head`)
    }
  }
  const diff = deps.diff(spec.source.head, files, spec.source.base)
  const pr = deps.pr ? deps.pr(spec.source.pr, spec.source.head) : null
  return { spec: { ...spec, truth: undefined }, truth, files, diff, pr }
}

export function writeFixture(dir, built) {
  mkdirSync(dir, { recursive: true })
  const { truth: _t, ...spec } = built.spec
  writeFileSync(join(dir, 'case.json'), JSON.stringify(spec, null, 2) + '\n')
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(built.truth, null, 2) + '\n')
  writeFileSync(join(dir, 'diff.patch'), built.diff)
  for (const [path, content] of built.files) {
    mkdirSync(dirname(join(dir, 'files', path)), { recursive: true })
    writeFileSync(join(dir, 'files', path), content)
  }
  if (built.pr) {
    writeFileSync(
      join(dir, 'pr.md'),
      `# ${built.pr.title}\n\n${built.pr.url}\n\n${built.pr.body ?? ''}\n`
    )
    // The metadata the dispatch mode's gh stand-in answers from.
    writeFileSync(join(dir, 'pr.json'), JSON.stringify(built.pr, null, 2) + '\n')
  }
}

export function gitDeps(repo, { gh = true } = {}) {
  return {
    readFile: (sha, path) => git.showFile(repo, sha, path),
    diff: (head, files, base) => {
      const dir = mkdtempSync(join(tmpdir(), 'bench-review-'))
      try {
        git.materialize(repo, head, files, dir)
        return git.diffAgainst(dir, base)
      } finally {
        git.removeWorktree(repo, dir)
      }
    },
    pr: gh ? git.prMetadata : null
  }
}

export function main(argv, { repo = process.cwd(), log = console.log } = {}) {
  let only = null
  let gh = true
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') only = argv[++i]
    else if (argv[i] === '--no-gh') gh = false
    else if (argv[i] === '--repo') repo = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  const specs = loadSpecs().filter((s) => !only || s.id === only)
  if (specs.length === 0) throw new Error(only ? `no case ${only}` : 'no cases')
  const deps = gitDeps(repo, { gh })
  let failed = 0
  for (const spec of specs) {
    for (const sha of [spec.source.base, spec.source.head]) {
      if (!git.revExists(repo, sha)) git.fetchPullHead(repo, spec.source.pr)
      if (!git.revExists(repo, sha)) throw new Error(`${spec.id}: ${sha} not fetchable`)
    }
    try {
      const built = buildCase(spec, deps)
      writeFixture(join(FIXTURES_DIR, spec.id), built)
      const where = built.truth.defects.map((d) => `${d.file}:${d.lineStart}`).join(', ')
      log(`ok    ${spec.id}  ${built.truth.verdict}  ${where}`)
    } catch (err) {
      failed += 1
      log(`FAIL  ${spec.id}  ${err.message}`)
    }
  }
  log(`${specs.length - failed}/${specs.length} cases built into ${FIXTURES_DIR}`)
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
