import { spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const sha = 'a'.repeat(40)
const repo = 'thebristolsound/birdbrain'

// Exercise the real readers with read-only API fixtures. Unexpected writes fail the stub.
function readers(stamps: unknown[], enabled = 'true', olderEvents = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'override-readers-'))
  try {
    const gh = join(dir, 'gh')
    writeFileSync(
      gh,
      `#!/usr/bin/env node
const a = process.argv.slice(2)
const sha = '${sha}'
const labels = [{ name: 'break-glass' }]
const statuses = JSON.parse(process.env.STAMPS)
const pr = { state: 'open', draft: false, head: { sha, repo: { full_name: '${repo}' } },
  labels, user: { login: 'thebristolsound' }, body: '' }
let result
if (a[0] === 'pr' && a[1] === 'view') {
  result = { state: 'OPEN', isDraft: false, author: pr.user, labels, headRefOid: sha,
    mergeStateStatus: 'CLEAN', autoMergeRequest: null, body: '', reviews: [],
    statusCheckRollup: [], isCrossRepository: false }
} else if (a[0] === 'api' && !a.includes('-X')) {
  const p = a.at(-1)
  if (p.includes('/statuses')) result = statuses
  else if (p.endsWith('/pulls/7')) result = pr
  else if (p.includes('/events')) result = [
    ...Array.from({ length: Number(process.env.OLDER_EVENTS) }, () => ({ event: 'labeled',
      label: { name: 'size:XL', description: 'x'.repeat(1000) }, actor: { login: 'other' } })),
    {event: 'labeled', label: {name: 'break-glass'}, actor: {login: 'thebristolsound'}}]
  else if (/\\/(comments|reviews|files|main)(\\?|$)/.test(p)) result = []
  else throw new Error('unexpected read ' + p)
  result = Array.isArray(result) ? [result] : [result]
} else throw new Error('unexpected command ' + a.join(' '))
console.log(JSON.stringify(result))
`
    )
    chmodSync(gh, 0o755)
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STAMPS: JSON.stringify(stamps),
      OLDER_EVENTS: String(olderEvents),
      REVIEW_FLEET_ENABLED: enabled
    }
    const run = (script: string, args: string[]) =>
      spawnSync(process.execPath, [join(root, '.github/scripts', script), ...args], {
        cwd: root,
        env,
        encoding: 'utf8'
      })
    const gate = run('merge/gate.mjs', [repo, '7'])
    const next = run('pr-next/next.mjs', ['--dry-run', repo, '7'])
    // plan's first write would be a pending review claim without authorization, or success
    // with it. Capture the verdict printed before either attempted write.
    const fleet = run('review-fleet/fleet.mjs', ['plan', repo, '7'])
    return { gate, next, fleet }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const stamp = (context = 'merge/break-glass', head = sha, login = 'github-actions[bot]') => ({
  context,
  description: `Review override by thebristolsound on ${head}`,
  state: 'success',
  creator: { login }
})

describe('head-specific override authorization in every reader', () => {
  it.each([
    [],
    [stamp('merge/approved')],
    [stamp('merge/break-glass', 'b'.repeat(40))],
    [stamp('merge/break-glass', sha, 'thebristolsound')]
  ])('rejects a retained override without its own trusted head stamp: %j', (...items) => {
    const { gate, next, fleet } = readers(items)
    expect(gate.status, gate.stderr).toBe(1)
    expect(next.status, next.stderr).toBe(0)
    expect(next.stdout).toContain('next: wait')
    expect(fleet.stdout).toContain('pending (owed a review)')
  })

  it('reads trusted fleet results and the existing enabled switch from API facts', () => {
    const fleet = (state: string, description = '') => ({
      context: 'review/fleet',
      state,
      description,
      creator: { login: 'birdbrain-agent' }
    })
    expect(readers([fleet('failure')]).next.stdout).toContain('next: fix')
    expect(readers([fleet('success')]).next.stdout).toContain('next: merge')
    expect(
      readers([fleet('success', 'break-glass applied by the maintainer; no review')]).next.stdout
    ).toContain('next: wait')
    const disabled = readers([], 'false')
    expect(disabled.gate.status).toBe(0)
    expect(disabled.next.stdout).toContain('next: merge')
  })

  // Every reader asks who applied the label on every PR, so the whole event history is read.
  it('reads a label history larger than the default 1 MiB process buffer', () => {
    const { gate, next, fleet } = readers([stamp()], 'true', 1500)
    expect(gate.status, gate.stderr).toBe(0)
    expect(next.stdout).toContain('next: merge')
    expect(fleet.stdout).toContain('success (break-glass applied')
  })

  it('accepts the override only with its own trusted stamp for this head', () => {
    const { gate, next, fleet } = readers([stamp()])
    expect(gate.status, gate.stderr).toBe(0)
    expect(next.stdout).toContain('next: merge')
    expect(fleet.stdout).toContain('success (break-glass applied')
  })
})
