import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { type GhStub, makeGhStub } from './helpers/ghStub'
import {
  QUALIFYING_AREAS,
  areasOf,
  collect,
  firstLineOf,
  numbersOf,
  recordOf,
  render,
  totalsOf
  // @ts-expect-error - skill script with no type declarations; the tsconfigs exclude .claude/
} from '../.claude/skills/catch-up-review/scripts/debt.mjs'

const SCRIPT = resolve(
  __dirname,
  '..',
  '.claude',
  'skills',
  'catch-up-review',
  'scripts',
  'debt.mjs'
)
const API = 'repos/{owner}/{repo}'
const MAINTAINER = 'maintainer'
const DISCLOSURE = '> <sub>**Written by a-model via A Harness on behalf of Matt.**</sub>'

const NUMBERS = {
  reviewers: { claude: 1, codex: 1, control: 0 },
  blocking: { claude: 1, codex: 0, control: 0 },
  confirmed: { claude: 1, codex: 0, control: 0 },
  other: { claude: 4, codex: 0, control: 0 },
  reproduced: 1,
  filed: 1,
  private: 0,
  tokens: 250000,
  minutes: 17
}

const recordBody = (numbers: object = NUMBERS, disclosure = DISCLOSURE) =>
  [
    disclosure,
    '',
    'Catch-up record: two reviewers read this merge after it landed.',
    '',
    `<!-- catch-up-review:record ${JSON.stringify({ v: 1, ...numbers })} -->`
  ].join('\n')

const comment = (body: string, login = MAINTAINER, id = 1) => ({
  user: { login },
  body,
  html_url: `https://example.test/comment-${id}`
})

const file = (filename: string, previous_filename?: string) => ({ filename, previous_filename })

const mergedIssue = (number: number, mergedAt: string | null) => ({
  number,
  title: `change ${number}`,
  pull_request: { merged_at: mergedAt }
})

// A gh double answering each endpoint from a table, and failing on one it was not given,
// the way a failed read does.
const ghOf = (routes: Record<string, unknown>) => {
  const calls: string[] = []
  const gh = ([endpoint]: string[]) => {
    calls.push(endpoint)
    if (!(endpoint in routes)) throw new Error(`gh api ${endpoint} failed (exit 1)`)
    return routes[endpoint]
  }
  return { gh, calls }
}

const LIST = `${API}/issues?state=closed&labels=break-glass&per_page=100`
const filesOf = (number: number, page = 1) =>
  `${API}/pulls/${number}/files?per_page=100&page=${page}`
const commentsOf = (number: number, page = 1) =>
  `${API}/issues/${number}/comments?per_page=100&page=${page}`

describe('areasOf', () => {
  it('names each qualifying area a merge changed', () => {
    const files = [file('src/main/index.ts'), file('.github/scripts/x.sh'), file('docs/a.md')]
    expect(areasOf(files)).toEqual(['src/', '.github/scripts/'])
  })

  it('finds no area in documents, tests and tooling', () => {
    const files = [file('docs/plans/a.md'), file('tests/a.test.ts'), file('scripts/a.mjs')]
    expect(areasOf(files)).toEqual([])
  })

  it('does not read a directory that only starts with an area name', () => {
    expect(areasOf([file('src-notes/a.md'), file('extensions/a.ts')])).toEqual([])
  })

  it('counts a file renamed out of an area', () => {
    expect(areasOf([file('docs/old.ts', 'extension/src/old.ts')])).toEqual(['extension/'])
  })

  it('qualifies a merge whose file list was cut, rather than read the part it got', () => {
    const files = Array.from({ length: 3000 }, (_, index) => file(`docs/${index}.md`))
    expect(areasOf(files)).toEqual(['file list cut at 3000'])
  })

  it('covers shipped source and the workflows and scripts beside secrets', () => {
    expect(QUALIFYING_AREAS).toEqual([
      'src/',
      'extension/',
      '.github/workflows/',
      '.github/scripts/'
    ])
  })
})

describe('numbersOf', () => {
  it('reads a complete block', () => {
    expect(numbersOf(recordBody())).toEqual(NUMBERS)
  })

  it('keeps unknown tokens and minutes as null', () => {
    const numbers = { ...NUMBERS, tokens: null, minutes: null }
    expect(numbersOf(recordBody(numbers))).toEqual(numbers)
  })

  it.each([
    ['no block', 'Catch-up record: reviewed.'],
    ['a block that is not JSON', '<!-- catch-up-review:record {reviewers} -->'],
    ['another version', recordBody({ ...NUMBERS, v: 2 })],
    ['a missing count', recordBody({ ...NUMBERS, filed: undefined })],
    ['a missing reviewer slot', recordBody({ ...NUMBERS, reviewers: { claude: 1, codex: 1 } })],
    ['no count of reproduced candidates', recordBody({ ...NUMBERS, confirmed: undefined })],
    ['a negative count', recordBody({ ...NUMBERS, reproduced: -1 })],
    ['a count written as text', recordBody({ ...NUMBERS, filed: '1' })],
    ['tokens left out', recordBody({ ...NUMBERS, tokens: undefined })],
    ['minutes left out', recordBody({ ...NUMBERS, minutes: undefined })],
    ['a fractional token count', recordBody({ ...NUMBERS, tokens: 1.5 })]
  ])('refuses %s', (_name, body) => {
    expect(numbersOf(body)).toBeNull()
  })
})

describe('firstLineOf', () => {
  it('skips the disclosure line and the blank line after it', () => {
    expect(firstLineOf(`${DISCLOSURE}\n\nCatch-up record: reviewed.`)).toBe(
      'Catch-up record: reviewed.'
    )
  })

  it('skips the older two-line alert', () => {
    const body = '> [!NOTE]\n> Written by a-model on behalf of Matt.\n\nCatch-up record: x'
    expect(firstLineOf(body)).toBe('Catch-up record: x')
  })

  it('reads a body with no disclosure and CRLF line endings', () => {
    expect(firstLineOf('Catch-up record: x\r\nmore')).toBe('Catch-up record: x')
  })

  it('answers an empty body with an empty line', () => {
    expect(firstLineOf('')).toBe('')
  })
})

describe('recordOf', () => {
  it('reports no record when no comment names one', () => {
    expect(recordOf([comment('Looks fine.')], MAINTAINER)).toEqual({ state: 'none' })
  })

  it('reads the record the maintainer account posted', () => {
    expect(recordOf([comment(recordBody())], MAINTAINER)).toEqual({
      state: 'recorded',
      numbers: NUMBERS,
      url: 'https://example.test/comment-1'
    })
  })

  it("ignores another account's record", () => {
    expect(recordOf([comment(recordBody(), 'someone-else')], MAINTAINER)).toEqual({
      state: 'none'
    })
  })

  it('ignores a comment that only quotes the first line further down', () => {
    const body = `${DISCLOSURE}\n\nA note.\n\nCatch-up record: quoted`
    expect(recordOf([comment(body)], MAINTAINER)).toEqual({ state: 'none' })
  })

  it('lets the last record decide', () => {
    const later = { ...NUMBERS, filed: 2 }
    const comments = [
      comment(recordBody(), MAINTAINER, 1),
      comment(recordBody(later), MAINTAINER, 2)
    ]
    expect(recordOf(comments, MAINTAINER)).toMatchObject({
      state: 'recorded',
      numbers: later,
      url: 'https://example.test/comment-2'
    })
  })

  it('reports a record whose numbers do not read as malformed', () => {
    const body = `${DISCLOSURE}\n\nCatch-up record: reviewed.`
    expect(recordOf([comment(body, MAINTAINER, 7)], MAINTAINER)).toEqual({
      state: 'malformed',
      url: 'https://example.test/comment-7'
    })
  })

  it('does not fall back to an earlier record when the last one is malformed', () => {
    const broken = `${DISCLOSURE}\n\nCatch-up record: reviewed again.`
    const comments = [comment(recordBody(), MAINTAINER, 1), comment(broken, MAINTAINER, 2)]
    expect(recordOf(comments, MAINTAINER).state).toBe('malformed')
  })

  it.each([
    ['no Codex reviewer', { claude: 1, codex: 0, control: 1 }, ['codex']],
    ['no Claude reviewer', { claude: 0, codex: 1, control: 1 }, ['claude']],
    ['no reviewer at all', { claude: 0, codex: 0, control: 0 }, ['claude', 'codex']]
  ])('reports a record that counts %s as incomplete', (_name, reviewers, missing) => {
    const body = recordBody({ ...NUMBERS, reviewers })
    expect(recordOf([comment(body, MAINTAINER, 3)], MAINTAINER)).toEqual({
      state: 'incomplete',
      missing,
      url: 'https://example.test/comment-3'
    })
  })

  it('accepts a record with both families and no control reviewer', () => {
    expect(recordOf([comment(recordBody())], MAINTAINER).state).toBe('recorded')
  })
})

describe('totalsOf', () => {
  it('sums the records and counts unknown costs apart from zero', () => {
    const unknown = { ...NUMBERS, tokens: null, minutes: null, private: 1 }
    const recorded = [NUMBERS, unknown].map((numbers) => ({ record: { numbers } }))
    expect(totalsOf(recorded)).toEqual({
      merges: 2,
      reviewers: { claude: 2, codex: 2, control: 0 },
      blocking: { claude: 2, codex: 0, control: 0 },
      confirmed: { claude: 2, codex: 0, control: 0 },
      other: { claude: 8, codex: 0, control: 0 },
      reproduced: 2,
      filed: 2,
      private: 1,
      tokens: { sum: 250000, unknown: 1 },
      minutes: { sum: 17, unknown: 1 }
    })
  })

  it('sums nothing to zero with nothing unknown', () => {
    expect(totalsOf([])).toMatchObject({ merges: 0, tokens: { sum: 0, unknown: 0 } })
  })
})

describe('collect', () => {
  const routes = (): Record<string, unknown> => ({
    [API]: { owner: { login: MAINTAINER } },
    [`${LIST}&page=1`]: [
      mergedIssue(30, '2026-11-19T00:00:00Z'),
      mergedIssue(10, '2026-11-11T00:00:00Z'),
      mergedIssue(20, '2026-11-12T00:00:00Z'),
      // Closed without merging, and an issue that carries the label.
      mergedIssue(40, null),
      { number: 50, title: 'an issue' }
    ],
    [filesOf(10)]: [file('src/main/a.ts')],
    [filesOf(20)]: [file('docs/a.md')],
    [filesOf(30)]: [file('.github/workflows/a.yml')],
    [commentsOf(10)]: [comment(recordBody())],
    [commentsOf(30)]: [comment('Merged.')]
  })

  it('sorts the override merges into owed, recorded and out of scope', () => {
    const { gh } = ghOf(routes())
    const report = collect(gh)
    expect(report.owed.map(({ number }: { number: number }) => number)).toEqual([30])
    expect(report.recorded.map(({ number }: { number: number }) => number)).toEqual([10])
    expect(report.outOfScope.map(({ number }: { number: number }) => number)).toEqual([20])
    expect(report.totals).toMatchObject({ merges: 1, reproduced: 1, filed: 1 })
  })

  it('reads no comments on a merge outside the scope, and nothing on an unmerged one', () => {
    const { gh, calls } = ghOf(routes())
    collect(gh)
    expect(calls).not.toContain(commentsOf(20))
    expect(calls.some((call) => call.includes('/40/') || call.includes('/50/'))).toBe(false)
  })

  it('keeps a merge with a malformed record in the owed list', () => {
    const table = routes()
    table[commentsOf(10)] = [comment(`${DISCLOSURE}\n\nCatch-up record: reviewed.`)]
    const report = collect(ghOf(table).gh)
    expect(report.owed.map(({ number }: { number: number }) => number)).toEqual([10, 30])
    expect(report.owed[0].record.state).toBe('malformed')
    expect(report.recorded).toEqual([])
  })

  it('keeps a merge reviewed by one family in the owed list and out of the totals', () => {
    const table = routes()
    const reviewers = { claude: 1, codex: 0, control: 0 }
    table[commentsOf(10)] = [comment(recordBody({ ...NUMBERS, reviewers }))]
    const report = collect(ghOf(table).gh)
    expect(report.owed.map(({ number }: { number: number }) => number)).toEqual([10, 30])
    expect(report.recorded).toEqual([])
    expect(report.totals).toMatchObject({ merges: 0, reproduced: 0 })
  })

  it('reads a second page when the first is full', () => {
    const table = routes()
    table[commentsOf(10)] = Array.from({ length: 100 }, () => comment('Noise.'))
    table[commentsOf(10, 2)] = [comment(recordBody())]
    const report = collect(ghOf(table).gh)
    expect(report.recorded.map(({ number }: { number: number }) => number)).toEqual([10])
  })

  it('fails when a read fails, rather than list what it got', () => {
    const table = routes()
    delete table[filesOf(30)]
    expect(() => collect(ghOf(table).gh)).toThrow(/pulls\/30\/files/)
  })

  it('fails when an endpoint answers with something other than a list', () => {
    const table = routes()
    table[commentsOf(30)] = { message: 'Not Found' }
    expect(() => collect(ghOf(table).gh)).toThrow(/did not answer with a list/)
  })
})

describe('render', () => {
  it('lists what is owed, the totals and the count outside the scope', () => {
    const { gh } = ghOf({
      [API]: { owner: { login: MAINTAINER } },
      [`${LIST}&page=1`]: [
        mergedIssue(10, '2026-11-11T00:00:00Z'),
        mergedIssue(30, '2026-11-19T08:00:00Z')
      ],
      [filesOf(10)]: [file('src/main/a.ts')],
      [filesOf(30)]: [file('extension/src/a.ts'), file('src/a.ts')],
      [commentsOf(10)]: [comment(recordBody({ ...NUMBERS, minutes: null }))],
      [commentsOf(30)]: [comment(`${DISCLOSURE}\n\nCatch-up record: reviewed.`, MAINTAINER, 9)]
    })
    expect(render(collect(gh)).split('\n')).toEqual([
      'Override merges that owe a catch-up review: 1',
      '  #30  2026-11-19  change 30  (src/, extension/)  [record unreadable: https://example.test/comment-9]',
      'Reviewed: 1',
      '  reviewers: 1 claude, 1 codex, 0 control',
      '  blocking candidates: 1 claude, 0 codex, 0 control',
      '  of those reproduced: 1 claude, 0 codex, 0 control',
      '  other candidates: 4 claude, 0 codex, 0 control',
      '  defects reproduced: 1, filed: 1, reported privately: 0',
      '  cost: 250,000 tokens, 0 minutes (1 unknown)',
      'Override merges outside the scope: 0'
    ])
  })

  it('says which reviewer family an incomplete record lacks', () => {
    const record = { state: 'incomplete', missing: ['codex'], url: 'https://example.test/c' }
    const owed = [
      { number: 7, mergedAt: '2026-11-20T00:00:00Z', title: 'change 7', areas: ['src/'], record }
    ]
    const report = { owed, recorded: [], outOfScope: [], totals: totalsOf([]) }
    expect(render(report).split('\n')[1]).toBe(
      '  #7  2026-11-20  change 7  (src/)  [record counts no codex reviewer: https://example.test/c]'
    )
  })

  it('prints no totals when nothing is reviewed', () => {
    const empty = { owed: [], recorded: [], outOfScope: [], totals: totalsOf([]) }
    expect(render(empty).split('\n')).toEqual([
      'Override merges that owe a catch-up review: 0',
      'Reviewed: 0',
      'Override merges outside the scope: 0'
    ])
  })
})

describe('debt.mjs', () => {
  let stub: GhStub | undefined

  afterEach(() => {
    stub?.cleanup()
    stub = undefined
  })

  const run = (routes: Record<string, unknown>, args: string[] = []) => {
    stub = makeGhStub(routes)
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: stub.path }
    })
  }

  const routes = {
    [API]: { owner: { login: MAINTAINER } },
    [`${LIST}&page=1`]: [mergedIssue(10, '2026-11-11T00:00:00Z')],
    [filesOf(10)]: [file('src/main/a.ts')],
    [commentsOf(10)]: []
  }

  it('prints the list and exits 0 while reviews are owed', () => {
    const result = run(routes)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Override merges that owe a catch-up review: 1')
    expect(result.stdout).toContain('#10  2026-11-11  change 10  (src/)')
  })

  it('prints the report as JSON on request', () => {
    const result = run(routes, ['--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).owed[0]).toMatchObject({ number: 10, areas: ['src/'] })
  })

  it('exits 2 with no list when GitHub cannot be read', () => {
    const result = run({ [API]: { owner: { login: MAINTAINER } } })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^debt: gh api .*issues\?state=closed/)
  })

  it('exits 2 on an argument it does not know', () => {
    const result = run(routes, ['--since', '2026-11-10'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage: debt.mjs [--json]')
  })
})
