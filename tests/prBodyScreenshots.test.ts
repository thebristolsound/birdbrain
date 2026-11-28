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
  it.each(['| :-- | :-- | :-- |', '| :-- | :-- | :--', ':-- | :-- | :-- |', ':-- | :-- | :--'])(
    'rejects empty required tables with optional outer pipes: %s',
    (rule) => {
      const body = filled
        .replace(
          /(\| Acceptance criterion \| Proof \| Result \|\n)[^\n]+\n(?:\|[^\n]+\n)+/,
          `$1${rule}\n`
        )
        .replace(/(\| Area \| What changed \| Why \|\n)[^\n]+\n(?:\|[^\n]+\n)+/, `$1${rule}\n`)
      expect(lintBody(body, { posted: true })).toEqual([
        expect.stringContaining('Proof has no filled row'),
        expect.stringContaining('Changes lists no file group')
      ])
    }
  )

  it.each(['| :-- | :-- | :-- |', '| :-- | :-- | :--', ':-- | :-- | :-- |', ':-- | :-- | :--'])(
    'accepts filled tables with optional outer pipes on the divider: %s',
    (rule) => {
      expect(lintBody(filled.replaceAll('| :-- | :-- | :-- |', rule), { posted: true })).toEqual([])
    }
  )

  it.each(['| :-- | :-- | :-- |', '| :-- | :-- | :--', ':-- | :-- | :-- |', ':-- | :-- | :--'])(
    'rejects an empty Decisions table with optional outer pipes: %s',
    (rule) => {
      const body = readFileSync(
        join(scripts, 'fixtures/fail-header-only-decisions.md'),
        'utf8'
      ).replaceAll('| :-- | :-- | :-- |', rule)
      expect(lintBody(body, { posted: true })).toEqual([
        expect.stringContaining('the "Decisions" block in Changes is empty')
      ])
      expect(
        lintBody(body.replace('| Decision | Grade | Source |\n', ''), { posted: true })
      ).toEqual([expect.stringContaining('the "Decisions" block in Changes is empty')])
    }
  )

  it.each([' ```', '  ```', '   ```', ' ~~~', '  ~~~', '   ~~~'])(
    'rejects ambiguous indented fence openers: %j',
    (fence) => {
      const body = filled.replace(
        /(- `pnpm coverage:diff`[^\n]*\n)/,
        `$1${fence}\n![tracker](https://example.com/pixel.png)\n`
      )
      expect(lintBody(body, { posted: true })).toEqual([
        expect.stringContaining('fence openers must start in the first column'),
        expect.stringContaining('images go in the Screenshots section')
      ])
    }
  )

  it('accepts an unindented fence with an indented closing fence', () => {
    const body = filled.replace(
      '`pnpm preflight` at',
      '```text\n![quoted](image.png)\n  ```\n\n`pnpm preflight` at'
    )
    expect(lintBody(body, { posted: true })).toEqual([])
  })

  it.each(['    ', '        ', '\t', ' \t'])(
    'rejects screenshot evidence with code-block indentation: %j',
    (indent) => {
      const pair = rows(attachment('before'), attachment('after'))
        .split('\n')
        .map((line) => indent + line)
        .join('\n')
      expect(lint(`- Visual changes: Yes\n\n${pair}`, true)).toEqual([
        expect.stringContaining('screenshot rows cannot use code-block indentation')
      ])
    }
  )

  it('accepts a rendered pair with up to three leading spaces', () => {
    const pair = rows(attachment('before'), attachment('after'))
      .split('\n')
      .map((line) => '   ' + line)
      .join('\n')
    expect(lint(`- Visual changes: Yes\n\n${pair}`, true)).toEqual([])
  })

  it.each(['Yes', 'No. No screen changed.'])(
    'rejects an indented visual declaration: %s',
    (decision) => {
      const pair = decision === 'Yes' ? rows(attachment('before'), attachment('after')) : ''
      expect(lint(`        - Visual changes: ${decision}\n\n${pair}`, true)).toEqual([
        expect.stringContaining('screenshot rows cannot use code-block indentation')
      ])
    }
  )

  it.each([
    '---',
    'Existing matches are never cleared',
    '| Existing matches are never cleared',
    'Existing matches are never cleared | | pending'
  ])('checks every continuation of the acceptance table: %s', (row) => {
    const body = filled.replace(
      '| Existing matches are never cleared | `selectorLifecycle.test.ts` insert-or-ignore case | pass |',
      row
    )
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('lacks a proof or result')
    ])
  })

  it.each([1, 3])('does not hide images behind %i escape backslashes', (count) => {
    const quote = '\\'.repeat(count) + '`'
    const body = filled.replace(
      '`pnpm preflight` at',
      `${quote}![shot](/tmp/after.png)${quote}\n\n\`pnpm preflight\` at`
    )
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('images go in the Screenshots section')
    ])
  })

  it.each([0, 2, 4])('accepts code spans preceded by %i literal backslashes', (count) => {
    const quote = '\\'.repeat(count) + '`'
    const body = filled.replace(
      '`pnpm preflight` at',
      `${quote}![shot](/tmp/after.png)\`\n\n\`pnpm preflight\` at`
    )
    expect(lintBody(body, { posted: true })).toEqual([])
  })

  it('detects multiline image text outside Screenshots and with a No declaration', () => {
    const image = `![local\nshot](${attachment('wrapped')})`
    expect(
      lintBody(filled.replace('`pnpm preflight` at', `${image}\n\n\`pnpm preflight\` at`), {
        posted: true
      })
    ).toEqual([expect.stringContaining('images go in the Screenshots section')])
    expect(lint(`${noVisualChange}\n${image}`, true)).toEqual([
      expect.stringContaining('Visual changes is No but Screenshots contains screenshot images')
    ])
    expect(
      lint(
        `- Visual changes: Yes\n${rows(attachment('before'), attachment('after'))}\n${image}`,
        true
      )
    ).toEqual([expect.stringContaining('each screenshot image is written on one line')])
  })

  it.each([7, 12])(
    'accepts a matching %i-character proof head and rejects a different prefix',
    (length) => {
      const head = '2c8c60c22a9dc92a778ef74653b7d5aa8be2ee4c'
      const body = filled.replace(`Head: \`${head}\`.`, `Head: \`${head.slice(0, length)}\`.`)
      expect(lintBody(body, { posted: true })).toEqual([])
      expect(
        lintBody(
          body.replace(`Head: \`${head.slice(0, length)}\`.`, `Head: \`${'f'.repeat(length)}\`.`),
          { posted: true }
        )
      ).toEqual([expect.stringContaining('but Verification ran at')])
    }
  )

  it('isolates the HTML image refusal from every other rule', () => {
    const body = readFileSync(join(scripts, 'fixtures/fail-html-image-outside.md'), 'utf8')
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('images go in the Screenshots section')
    ])
  })

  it.each(['    ```', '\t```', '```invalid`info'])(
    'does not hide images after a false fence: %j',
    (fence) => {
      const body = filled.replace(
        '`pnpm preflight` at',
        `${fence}\n![extra](/tmp/extra.png)\n${fence}\n\n\`pnpm preflight\` at`
      )
      expect(lintBody(body, { posted: true })).toEqual([
        expect.stringContaining('images go in the Screenshots section')
      ])
    }
  )

  it.each([1, 2, 3])('treats matching %i-backtick spans as quoted image syntax', (count) => {
    const ticks = '`'.repeat(count)
    const body = filled.replace(
      '`pnpm preflight` at',
      `${ticks}Expected: ![before](image.png)${ticks}\n\n\`pnpm preflight\` at`
    )
    expect(lintBody(body, { posted: true })).toEqual([])
  })

  it('does not hide an image between unequal backtick runs', () => {
    const body = filled.replace(
      '`pnpm preflight` at',
      '``Expected: ![before](image.png)`\n\n`pnpm preflight` at'
    )
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('images go in the Screenshots section')
    ])
  })

  it.each([
    `alt='x src="${attachment('fake')}"' src='/tmp/after.png'`,
    `alt='x src="${attachment('fake')}"' src=/tmp/after.png`,
    `data-src="${attachment('fake')}" src="/tmp/after.png"`,
    `src="/tmp/after.png" data-src="${attachment('fake')}"`
  ])('checks the actual image source in %s', (attributes) => {
    const shots = `- Visual changes: Yes\n- Before, Signals: ![before](${attachment('before')})\n- After, Signals: <img ${attributes}>`
    expect(lint(shots, true)).toEqual([expect.stringContaining('upload the screenshot')])
  })

  it.each([`src='${attachment('after')}'`, `src=${attachment('after')}`])(
    'accepts an attached source in %s',
    (attributes) => {
      const shots = `- Visual changes: Yes\n- Before, Signals: ![before](${attachment('before')})\n- After, Signals: <img ${attributes}>`
      expect(lint(shots, true)).toEqual([])
    }
  )

  it('checks incomplete proof rows without a trailing pipe', () => {
    const body = filled.replace(
      '| Existing matches are never cleared | `selectorLifecycle.test.ts` insert-or-ignore case | pass |',
      '| Existing matches are never cleared | | pending'
    )
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('lacks a proof or result')
    ])
    expect(
      lintBody(filled.replace('insert-or-ignore case | pass |', 'insert-or-ignore case | pass'), {
        posted: true
      })
    ).toEqual([])
  })

  it('requires the area in every file group row', () => {
    const body = filled.replace(
      '| `src/main/services/selectorLifecycle.ts`, `src/main/ipcHandlers.ts`, `src/shared/ipc.ts` |',
      '| |'
    )
    expect(lintBody(body, { posted: true })).toEqual([
      expect.stringContaining('Changes file group row needs a filled Area cell')
    ])
  })

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
    resolve(scripts, '../../merge-pr/scripts/test-compose.sh'),
    resolve(scripts, '../../post-comment/scripts/test-check.sh')
  ])(
    '%s passes',
    (suite) => {
      // A dispatch cycle exports BIRDBRAIN_DISPATCH=1, which binds the hook the suite expects
      // to pass through; the suite sets it itself where it needs it.
      const run = spawnSync('bash', [suite], {
        encoding: 'utf8',
        env: { ...process.env, BIRDBRAIN_DISPATCH: '0' }
      })
      expect(run.stdout).toMatch(/^0 failure\(s\)$/m)
      expect(run.status).toBe(0)
      // Over a hundred node runs; under the full parallel suite they take far longer than alone.
    },
    120_000
  )
})

describe('the merge label path', () => {
  it('runs the body check with the flags that refuse a local screenshot', () => {
    const workflow = readFileSync(
      resolve(scripts, '../../../../.github/workflows/merge-on-label.yml'),
      'utf8'
    )
    const call = workflow.match(
      /post-pr-body\/scripts\/check\.sh((?: --[\w-]+)*) "\$out\/body\.md"/
    )
    expect(call).not.toBeNull()
    const flags = (call?.[1] ?? '').trim().split(' ').filter(Boolean)
    // A readable PNG passes without --posted, so only the workflow's own flags can refuse it.
    const png = join(dir, 'after.png')
    writeFileSync(png, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    writeFileSync(join(dir, 'body.md'), filled.replace(attachment('4f5a6b7c-after'), png))
    const run = spawnSync('bash', [join(scripts, 'check.sh'), ...flags, join(dir, 'body.md')], {
      encoding: 'utf8'
    })
    expect(run.status).toBe(1)
    expect(run.stderr + run.stdout).toContain('upload the screenshot')
  })
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
