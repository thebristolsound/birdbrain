import { spawnSync } from 'child_process'
import {
  type Dirent,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FINDER_LEGS,
  VERIFY_LEG,
  mergeFinders,
  mergeVerify,
  readLeg
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/review-fleet/fleet.mjs'

const SCRIPTS = join(__dirname, '..', '.github', 'scripts', 'review-fleet')
const COLLECT = join(SCRIPTS, 'collect.sh')
const WORKFLOW = join(__dirname, '..', '.github', 'workflows', 'review-fleet.yml')

const complete = {
  contract_version: 2,
  source_review_complete: true,
  not_checked: [],
  runtime_limitations: []
}
// What the check of Codex returned on the run that could not be recorded: one refuted finding.
const rulings = {
  ...complete,
  rulings: [{ id: 4534661581, ruling: 'REFUTED', reason: 'The guard is at line 12.' }]
}
const findings = { ...complete, findings: [] }

let dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

// One pass's output as leg.sh leaves it. `pass` is the name its `pass` file holds, or null for
// an output with no such file, which is what a pass uploaded before this change.
const output = (dir: string, pass: string | null, json: unknown = findings) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(json))
  writeFileSync(join(dir, 'transcript.jsonl'), '{}\n')
  writeFileSync(join(dir, 'claude.err'), '')
  if (pass !== null) writeFileSync(join(dir, 'pass'), `${pass}\n`)
}

// The download directory after `lay` filled it and collect.sh ran: every file in it by path.
const collect = (lay: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-collect-'))
  dirs.push(dir)
  lay(dir)
  const before = files(dir)
  const r = spawnSync('bash', [COLLECT, dir], { encoding: 'utf8' })
  return { dir, status: r.status, stderr: r.stderr, before, after: files(dir) }
}
const files = (dir: string) =>
  (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort()
const of = (pass: string) =>
  ['claude.err', 'findings.json', 'pass', 'transcript.jsonl'].map((name) => `${pass}/${name}`)

describe('collecting the passes whatever layout the download left', () => {
  // actions/download-artifact puts each of several artifacts in a directory named for it.
  it('moves each of several artifacts to a directory named for its pass', () => {
    const r = collect((dir) => {
      for (const pass of FINDER_LEGS) output(join(dir, `leg-${pass}`), pass)
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.after).toEqual([...FINDER_LEGS].sort().flatMap(of))
  })

  // It extracts a lone artifact straight into the directory, with no directory of its own.
  it('puts a lone artifact, extracted with no directory, under the pass it names', () => {
    const r = collect((dir) => output(dir, VERIFY_LEG, rulings))
    expect(r.before).toEqual(['claude.err', 'findings.json', 'pass', 'transcript.jsonl'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.after).toEqual(of(VERIFY_LEG))
  })

  it('records the ruling of a check of Codex that arrived as the lone artifact', () => {
    const state = { v: 1, sha: 'a'.repeat(40), startedAt: '2026-11-11T05:00:00Z' }
    const ids = [4534661581]
    // The defect: read where the download left it, the output is missing and the check fails.
    const lone = mkdtempSync(join(tmpdir(), 'fleet-collect-'))
    dirs.push(lone)
    output(lone, VERIFY_LEG, rulings)
    expect(readLeg(lone, VERIFY_LEG)).toBeNull()
    expect(mergeVerify(state, readLeg(lone, VERIFY_LEG), ids).verifyFailedFor).toBe('4534661581')
    const r = collect((dir) => output(dir, VERIFY_LEG, rulings))
    const recorded = mergeVerify(state, readLeg(r.dir, VERIFY_LEG), ids)
    expect(recorded.verifyFailedFor).toBeUndefined()
    expect(recorded.claudeVerify).toEqual({
      4534661581: { ruling: 'REFUTED', reason: 'The guard is at line 12.' }
    })
  })

  // Only one of the four passes uploaded: its output is its own, and the other three failed.
  it.each(FINDER_LEGS as string[])(
    'gives a lone review artifact to the pass it names and to no other: %s',
    (pass) => {
      const r = collect((dir) => output(dir, pass))
      expect(r.status, r.stderr).toBe(0)
      expect(r.after).toEqual(of(pass))
      const state = { v: 1, sha: 'a'.repeat(40), startedAt: '2026-11-11T05:00:00Z' }
      const merged = mergeFinders(
        state,
        Object.fromEntries((FINDER_LEGS as string[]).map((l) => [l, readLeg(r.dir, l)]))
      )
      expect(merged.claude.legs).toEqual(
        Object.fromEntries(
          (FINDER_LEGS as string[]).map((l) => [l, l === pass ? 'done' : 'failed'])
        )
      )
    }
  )

  // A pass that ran before leg.sh wrote the file: the artifact's own name is the pass.
  it('places an artifact directory that carries no pass file by its artifact name', () => {
    const r = collect((dir) => {
      output(join(dir, 'leg-claims'), null)
      output(join(dir, 'leg-tests'), 'tests')
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.after).toEqual([...of('claims').filter((f) => f !== 'claims/pass'), ...of('tests')])
  })

  it('leaves an empty download empty, so every pass reads as failed', () => {
    const r = collect(() => {})
    expect(r.status, r.stderr).toBe(0)
    expect(r.after).toEqual([])
    expect(readLeg(r.dir, VERIFY_LEG)).toBeNull()
  })

  it('leaves a pass with no output file as failed, not as another pass', () => {
    const r = collect((dir) => {
      mkdirSync(join(dir, 'leg-claims'))
      writeFileSync(join(dir, 'leg-claims', 'pass'), 'claims\n')
      output(join(dir, 'leg-tests'), 'tests')
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.after).toEqual(['claims/pass', ...of('tests')])
    expect(readLeg(r.dir, 'claims')).toBeNull()
  })
})

describe('an output that cannot be attributed is never placed', () => {
  // The script fails, which stops the record step before it reads anything, and moves nothing.
  // `placed` is false for a layout that itself holds a pass directory.
  const refused = (lay: (dir: string) => void, message: string, placed = true) => {
    const r = collect(lay)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`::error::review-fleet: ${message}`)
    expect(r.after).toEqual(r.before)
    if (placed)
      for (const pass of [...FINDER_LEGS, VERIFY_LEG]) expect(readLeg(r.dir, pass)).toBeNull()
  }

  it('fails a lone output that names no pass', () => {
    refused((dir) => output(dir, null, rulings), 'an output in the download names no pass')
  })

  it.each(['', 'common', 'claims contract', '../claims', 'leg-claims', 'CLAIMS', 'claims\ntests'])(
    'fails a lone output whose pass file holds %j',
    (name) => {
      refused((dir) => output(dir, name), 'an output in the download names no pass')
    }
  )

  it('fails an artifact directory that names another pass', () => {
    refused(
      (dir) => output(join(dir, 'leg-claims'), 'tests'),
      'the artifact leg-claims does not name the pass claims'
    )
  })

  it.each(['', 'common\n'])('fails an artifact directory whose pass file holds %j', (text) => {
    refused((dir) => {
      output(join(dir, 'leg-claims'), null)
      writeFileSync(join(dir, 'leg-claims', 'pass'), text)
    }, 'the artifact leg-claims does not name the pass claims')
  })

  it('fails an artifact for a pass the fleet does not have', () => {
    refused((dir) => output(join(dir, 'leg-common'), 'common'), 'unexpected leg-common')
  })

  it('fails files beside artifact directories, which is neither layout', () => {
    refused((dir) => {
      output(dir, VERIFY_LEG, rulings)
      output(join(dir, 'leg-claims'), 'claims')
    }, 'unexpected leg-claims beside a lone output')
  })

  it('fails anything that is not an artifact directory', () => {
    refused((dir) => {
      output(join(dir, 'leg-claims'), 'claims')
      output(join(dir, 'claims-old'), 'claims')
    }, 'unexpected claims-old')
  })

  it('fails when the pass already has a directory', () => {
    refused(
      (dir) => {
        output(join(dir, 'leg-claims'), 'claims')
        output(join(dir, 'claims'), 'claims')
      },
      'unexpected claims',
      false
    )
  })

  it('fails a symbolic link in the download', () => {
    refused((dir) => {
      output(join(dir, 'leg-claims'), 'claims')
      symlinkSync(join(dir, 'leg-claims'), join(dir, 'leg-tests'))
    }, 'unexpected leg-tests')
  })

  it('fails without a directory to collect', () => {
    const r = spawnSync('bash', [COLLECT], { encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('usage: collect.sh <download directory>')
    const missing = spawnSync('bash', [COLLECT, join(tmpdir(), 'fleet-collect-absent')], {
      encoding: 'utf8'
    })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('is not a directory')
  })
})

describe('the record job', () => {
  const record = readFileSync(WORKFLOW, 'utf8')
    .split(/^ {2}record:$/m)[1]
    .split(/^ {2}relay:$/m)[0]

  it('collects the download with the script before it records, and renames nothing itself', () => {
    const collects = record.indexOf('bash .github/scripts/review-fleet/collect.sh "$DIR"')
    const records = record.indexOf('node .github/scripts/review-fleet/fleet.mjs record ')
    expect(collects).toBeGreaterThan(0)
    expect(records).toBeGreaterThan(collects)
    expect(record).not.toMatch(/\bmv\b/)
    expect(record).toContain('pattern: leg-*')
  })

  it('knows every pass the fleet runs, and no other', () => {
    const known = /^passes='([^']*)'$/m.exec(readFileSync(COLLECT, 'utf8'))?.[1]
    expect(known?.split(' ')).toEqual([...FINDER_LEGS, VERIFY_LEG])
  })
})
