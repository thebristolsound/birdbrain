import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhStub, makeGhStub } from './helpers/ghStub'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'friction.sh')
const FIXTURES = resolve(
  __dirname,
  '..',
  '.claude',
  'skills',
  'post-comment',
  'scripts',
  'fixtures'
)
const ISSUE = readFileSync(SCRIPT, 'utf8').match(/^FRICTION_ISSUE=(\d+)$/m)?.[1]
const COMMENTS = `repos/o/r/issues/${ISSUE}/comments`
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
// Assembled at runtime, like the values in dispatchRedact.test.ts.
const CREDENTIAL = `ghp_${'Ab3'.repeat(12)}`

// The notes a session leaves, without the provenance block the step appends.
const NOTES = readFileSync(join(FIXTURES, 'pass-friction.md'), 'utf8').split(
  '\n<details>\n<summary>Where these came from'
)[0]

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const post = (notes?: string) => {
  stub = makeGhStub({ [COMMENTS]: { html_url: 'https://example.test/comment/1' } })
  mkdirSync(join(stub.dir, '.dispatch'))
  if (notes !== undefined) writeFileSync(join(stub.dir, '.dispatch', 'friction.md'), notes)
  const result = spawnSync('bash', [SCRIPT], {
    cwd: stub.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_STEP_SUMMARY: '/dev/null',
      GITHUB_SHA: SHA,
      RUN_URL: 'https://example.test/run/1'
    }
  })
  const posted = join(stub.dir, '.dispatch', 'friction-post.json')
  const body = existsSync(posted) ? JSON.parse(readFileSync(posted, 'utf8')).body : undefined
  return { ...result, calls: stub.calls(), body }
}

describe.skipIf(!HAS_JQ)('friction.sh posts the notes of a run to the tracking issue', () => {
  it('names a tracking issue', () => {
    expect(Number(ISSUE)).toBeGreaterThan(0)
  })

  it('posts nothing when the run left no notes', () => {
    const result = post()
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls).toEqual([])
  })

  it('posts the notes with the run, the commit and the date appended', () => {
    const result = post(NOTES)
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatch(new RegExp(`^api -X POST ${COMMENTS} `))
    expect(result.body.startsWith(NOTES.trimEnd())).toBe(true)
    expect(result.body).toContain('Run: https://example.test/run/1\n')
    expect(result.body).toContain(`Commit: ${SHA}\n`)
    expect(result.body).toMatch(/\nDate: \d{4}-\d{2}-\d{2}\n/)
  })

  it('redacts a credential before posting', () => {
    const result = post(NOTES.replace('queried the slot labels twice', `printed ${CREDENTIAL}`))
    expect(result.status, result.stderr).toBe(0)
    expect(result.body).toContain('printed ghp_<REDACTED>')
    expect(result.body).not.toContain(CREDENTIAL)
  })

  it('warns and posts nothing when the notes fail the comment linter', () => {
    const result = post(NOTES.replace('| confusing |', '| annoying |'))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('::warning title=Friction notes not posted::')
    expect(result.calls).toEqual([])
  })
})
