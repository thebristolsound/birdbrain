import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// The weekly workflow holds no stored credential and never fails on a finding
// (ADR-0058). These pin the properties that make both true, so an edit that
// breaks one fails here instead of on a Monday.
const ROOT = join(__dirname, '..', '..')
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'repo-health.yml'), 'utf8')
const lines = workflow.split('\n')

// The lines of one top-level block, without its header.
const block = (name: string) => {
  const start = lines.indexOf(`${name}:`)
  if (start === -1) throw new Error(`no top-level ${name}: block`)
  const end = lines.findIndex((line, index) => index > start && /^[^\s#]/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line.trim() !== '')
}

const code = lines.filter((line) => !line.trim().startsWith('#'))

describe('repo-health.yml', () => {
  it('starts only on a schedule or by hand, never from a pull request', () => {
    const triggers = block('on')
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim())
    expect(triggers).toEqual(['schedule:', 'workflow_dispatch:'])
    expect(workflow).not.toMatch(/pull_request|issue_comment|workflow_run/)
  })

  it('runs on Monday at 09:13 UTC, clear of the other Monday jobs', () => {
    expect(block('on')).toContain("    - cron: '13 9 * * 1'")
  })

  it('defaults a manual run to a dry run', () => {
    const inputs = block('on').join('\n')
    expect(inputs).toContain('dry_run:')
    expect(inputs).toContain('type: boolean')
    expect(inputs).toContain('default: true')
  })

  it('asks for exactly the four permissions it uses, and can write only issues', () => {
    expect(block('permissions').map((line) => line.trim())).toEqual([
      'contents: read',
      'actions: read',
      'issues: write',
      'pull-requests: read'
    ])
  })

  it('names no stored secret anywhere, comments included, and no environment', () => {
    // tests/spendGuardWorkflows.test.ts reads comment lines too when it looks for a
    // job that holds a secret, so the text must not appear at all.
    expect(workflow).not.toMatch(/\bsecrets\./)
    expect(workflow).not.toMatch(/^\s*environment:/m)
  })

  it('has no job-level condition, so a paused report is a disabled workflow, not a skipped run', () => {
    expect(code.filter((line) => /^\s*if:/.test(line))).toEqual([])
  })

  it('pins every action to a full commit', () => {
    const uses = code.filter((line) => /^\s*-?\s*uses:/.test(line))
    expect(uses.length).toBeGreaterThanOrEqual(3)
    for (const line of uses) expect(line).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d/)
  })

  it('checks out without leaving the token in the working tree', () => {
    expect(workflow).toContain('persist-credentials: false')
  })

  it('installs without running any package build script', () => {
    expect(workflow).toContain('run: pnpm install --frozen-lockfile --ignore-scripts')
  })

  it('pins the DRY_RUN expression: false on a schedule, or by hand on main with dry_run unticked', () => {
    expect(workflow).toContain(
      "DRY_RUN: ${{ (github.event_name == 'workflow_dispatch' && inputs.dry_run) || github.ref != 'refs/heads/main' }}"
    )
  })

  it('passes every expression through env, never into a run: script', () => {
    const scripts = code.filter((line) => /^\s*-?\s*run:/.test(line))
    expect(scripts.length).toBeGreaterThanOrEqual(2)
    // One-line scripts only, so this line check sees the whole of each script.
    for (const line of scripts) expect(line).not.toMatch(/run:\s*[|>]/)
    for (const line of scripts) expect(line).not.toContain('${{')
  })

  it('runs the tool with --publish under the workflow token', () => {
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}')
    expect(workflow).toContain('run: node scripts/repo-health/cli.mjs --publish')
  })

  it('has a timeout and never cancels a run that is writing', () => {
    expect(workflow).toContain('timeout-minutes: 10')
    expect(block('concurrency').map((line) => line.trim())).toEqual([
      'group: repo-health',
      'cancel-in-progress: false'
    ])
  })
})

describe('the Health workflow', () => {
  it('watches repo-health.yml for a failure streak', () => {
    const check = readFileSync(join(ROOT, '.github', 'scripts', 'health', 'check.sh'), 'utf8')
    const watched = /^WORKFLOWS=\(([^)]*)\)$/m.exec(check)?.[1].split(/\s+/) ?? []
    expect(watched).toContain('repo-health.yml')
    expect(watched).toContain('dispatch.yml')
  })
})
