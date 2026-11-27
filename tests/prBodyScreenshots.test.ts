import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
// @ts-expect-error - skill script with no type declarations
import { lintBody } from '../.claude/skills/post-pr-body/scripts/lint-body.mjs'

const scripts = resolve(__dirname, '../.claude/skills/post-pr-body/scripts')
const filled = readFileSync(join(scripts, 'fixtures/pass-filled.md'), 'utf8')
const SHOTS = /(## Screenshots\n\n)[\s\S]*?\n\n(?=## Blast radius)/
// The passing body with its Screenshots section emptied: no visual decision at all.
const undeclared = filled.replace(SHOTS, '$1')
const noVisualChange = '- Visual changes: No. Changes only the database query.'
const attachment = (id: string) => `https://github.com/user-attachments/assets/${id}`
const rows = (before: string, after: string, screen = 'Signals') =>
  `- Before, ${screen}: ![before](${before})\n- After, ${screen}: ![after](${after})`
const bodyWith = (lines: string) => filled.replace(SHOTS, `$1${lines}\n\n`)
const lint = (lines: string, posted = false) => lintBody(bodyWith(lines), { posted })

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-body-screenshots-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PR screenshot evidence', () => {
  it('requires an explicit visual decision on every body', () => {
    expect(lintBody(filled)).toEqual([])
    expect(lintBody(undeclared)).toEqual([expect.stringContaining('Visual changes:')])
    expect(lint(noVisualChange)).toEqual([])
    expect(lint('- Visual changes: No.')).toEqual([expect.stringContaining('followed by a reason')])
  })

  it('refuses missing, duplicate and commented-out declarations', () => {
    expect(lint(`${noVisualChange}\n${noVisualChange}`)).not.toEqual([])
    expect(lint(`<!-- ${noVisualChange} -->`)).not.toEqual([])
  })

  it('requires a complete pair for every named screen', () => {
    const pair = rows(attachment('before'), attachment('after'))
    expect(lint(`- Visual changes: Yes\n${pair}`)).toEqual([])
    expect(
      lint(`- Visual changes: Yes\n${pair}\n- After, Notes: ![after](${attachment('notes')})`)
    ).toEqual([expect.stringContaining('notes needs both Before and After')])
    expect(lint('- Visual changes: Yes')).not.toEqual([])
    expect(lint(`- Visual changes: No. No layout changed.\n${pair}`)).not.toEqual([])
  })

  it('accepts captured local PNGs before the PR exists, including paths with spaces', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',
      'base64'
    )
    const before = join(dir, 'before shot.png')
    const after = join(dir, 'after shot.png')
    writeFileSync(before, png)
    writeFileSync(after, png)
    expect(lint(`- Visual changes: Yes\n${rows(`<${before}>`, `<${after}>`)}`)).toEqual([])
    expect(lint(`- Visual changes: Yes\n${rows(before, after)}`, true)).toEqual([
      expect.stringContaining('upload the screenshot'),
      expect.stringContaining('upload the screenshot')
    ])
    rmSync(after)
    expect(lint(`- Visual changes: Yes\n${rows(before, after)}`)).toEqual([
      expect.stringContaining('cannot be read')
    ])
    writeFileSync(after, 'not a screenshot')
    expect(lint(`- Visual changes: Yes\n${rows(before, after)}`)).toEqual([
      expect.stringContaining('not a PNG')
    ])
  })

  it.each([
    ['https://example.com/before.png', attachment('after')],
    ['before.png', 'after.png'],
    [attachment('same'), attachment('same')]
  ])('refuses unsupported or reused screenshot references: %s', (before, after) => {
    expect(lint(`- Visual changes: Yes\n${rows(before, after)}`)).not.toEqual([])
  })

  it('refuses screenshots outside the Screenshots section', () => {
    const pair = rows(attachment('before'), attachment('after'))
    const body = undeclared.replace(
      '## Blast radius',
      `${noVisualChange}\n\n## Not done\n\n${pair}\n\n## Blast radius`
    )
    expect(lintBody(body)).toEqual([
      expect.stringContaining('images go in the Screenshots section')
    ])
  })

  it('refuses handoffs, hidden screenshots and mismatched screen names', () => {
    expect(
      lint(
        '- Visual changes: Yes\n- Before, Signals: not captured, handed to the maintainer\n' +
          '- After, Signals: not captured, handed to the maintainer'
      )
    ).not.toEqual([])
    expect(
      lint(`- Visual changes: Yes\n<!-- ${rows(attachment('before'), attachment('after'))} -->`)
    ).not.toEqual([])
    expect(
      lint(
        `- Visual changes: Yes\n- Before, Signals: ![before](${attachment('before')})\n` +
          `- After, Notes: ![after](${attachment('after')})`
      )
    ).toHaveLength(2)
  })
})

describe('PR body script suites', () => {
  // The fixture and compose suites are shell scripts; running them here puts them in CI.
  it.each([
    join(scripts, 'test-check.sh'),
    resolve(scripts, '../../merge-pr/scripts/test-compose.sh')
  ])(
    '%s passes',
    (suite) => {
      // A dispatch cycle exports BIRDBRAIN_DISPATCH=1, which binds the hook the suite expects
      // to pass through; the suite sets it itself where it needs it.
      const run = spawnSync('bash', [suite], {
        encoding: 'utf8',
        env: { ...process.env, BIRDBRAIN_DISPATCH: '0' }
      })
      expect(run.stdout).toContain('0 failure(s)')
      expect(run.status).toBe(0)
      // Over a hundred node runs; under the full parallel suite they take far longer than alone.
    },
    120_000
  )
})

describe('PR body hook routing', () => {
  const check = (command: string, agent = 'birdbrain-implementer', dispatch = '0') => {
    const input = JSON.stringify({
      agent_type: agent,
      cwd: dir,
      tool_input: { command }
    })
    return spawnSync('bash', ['-c', 'exec "$1"', 'hook', join(scripts, 'check.sh')], {
      input,
      encoding: 'utf8',
      env: { ...process.env, BIRDBRAIN_DISPATCH: dispatch }
    })
  }

  it.each([
    'gh pr create --body-file body.md',
    'agh pr create --body-file=body.md',
    'gh pr edit 12 --body-file body.md',
    'gh api repos/o/r/pulls --input body.json',
    'gh api repos/o/r/pulls/12 -X PATCH --input body.json'
  ])('enforces the visual decision on %s', (command) => {
    writeFileSync(join(dir, 'body.md'), undeclared)
    writeFileSync(join(dir, 'body.json'), JSON.stringify({ body: undeclared }))
    expect(check(command).status).toBe(2)
    const body = bodyWith(noVisualChange)
    writeFileSync(join(dir, 'body.md'), body)
    writeFileSync(join(dir, 'body.json'), JSON.stringify({ body }))
    expect(check(command).status).toBe(0)
  })

  it('accepts an attached pair and blocks a missing image on an agent body write', () => {
    const body = bodyWith(
      `- Visual changes: Yes\n${rows(attachment('before'), attachment('after'))}`
    )
    writeFileSync(join(dir, 'body.md'), body)
    expect(check('gh pr create --body-file body.md').status).toBe(0)
    writeFileSync(join(dir, 'body.md'), body.replace(attachment('after'), join(dir, 'absent.png')))
    expect(check('gh pr create --body-file body.md').status).toBe(2)
  })

  it('passes reads, metadata edits and unbound sessions; binds dispatch and the merge check', () => {
    writeFileSync(join(dir, 'body.md'), undeclared)
    expect(check('gh pr view 12').status).toBe(0)
    expect(check('gh pr edit 12 --add-label agent-authored').status).toBe(0)
    expect(check('gh pr create --body-file body.md', '').status).toBe(0)
    expect(check('gh pr create --body-file body.md', '', '1').status).toBe(2)
    expect(
      spawnSync('bash', [join(scripts, 'check.sh'), '--any-author', join(dir, 'body.md')]).status
    ).toBe(1)
    writeFileSync(join(dir, 'body.md'), filled)
    expect(
      spawnSync('bash', [
        join(scripts, 'check.sh'),
        '--any-author',
        '--posted',
        join(dir, 'body.md')
      ]).status
    ).toBe(0)
  })
})
