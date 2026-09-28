import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')

// Top-level dot-directories that belong to the project rather than to an agent tool: the
// design-sync inputs, GitHub workflows and templates, the triage knowledge base and the Vale
// vocabulary.
const PROJECT_DIRS = ['.design-sync', '.github', '.out-of-scope', '.vale']

// Directories agent tools create at the repository root. Each stays ignored, and a path the
// project shares from one comes back through a negation in .gitignore.
const AGENT_TOOL_DIRS = [
  '.agents',
  '.claude',
  '.codex',
  '.cursor',
  '.kilo',
  '.kilocode',
  '.macroscope',
  '.sandcastle',
  '.serena',
  '.specify',
  '.superpowers',
  '.zed'
]

// Rules out a bare label such as `# hooks`, which names the path and gives no reason.
const MIN_REASON_WORDS = 3

const PROBE = 'tool-state'

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

type Rule = { line: number; pattern: string } | null

const topDir = (path: string): string | null => {
  const [first, ...rest] = path.split('/')
  return first.startsWith('.') && rest.length > 0 ? first : null
}

// The rule git applies to each path, or null when none matches. In a scratch repository with
// core.excludesFile emptied, the given text is the only ignore source, and the empty index keeps
// check-ignore from skipping the paths this clone tracks.
const decidingRules = (gitignore: string, paths: string[]): Map<string, Rule> => {
  const repo = mkdtempSync(join(tmpdir(), 'gitignore-agent-tools-'))
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: gitEnv })
    writeFileSync(join(repo, '.gitignore'), gitignore)
    const { status, stdout, stderr } = spawnSync(
      'git',
      ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--stdin', '-z', '-v', '-n'],
      { cwd: repo, env: gitEnv, encoding: 'utf8', input: paths.map((p) => `${p}\0`).join('') }
    )
    // 0 and 1 only say whether any path matched a rule; anything else is git failing.
    if (status !== 0 && status !== 1)
      throw new Error(`git check-ignore exited ${status}: ${stderr}`)
    const fields = stdout.split('\0')
    const rules = new Map<string, Rule>()
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const [source, line, pattern, path] = fields.slice(i, i + 4)
      rules.set(path, source ? { line: Number(line), pattern } : null)
    }
    return rules
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

const isIgnored = (rule: Rule | undefined): boolean => !!rule && !rule.pattern.startsWith('!')

const audit = (gitignore: string, tracked: string[]): string[] => {
  const problems: string[] = []

  const trackedDirs = new Set(tracked.map(topDir).filter((dir) => dir !== null))
  for (const dir of [...trackedDirs].sort()) {
    if (PROJECT_DIRS.includes(dir) || AGENT_TOOL_DIRS.includes(dir)) continue
    problems.push(`${dir}/ is tracked but listed as neither a project nor an agent-tool directory`)
  }

  const shared = tracked.filter((path) => AGENT_TOOL_DIRS.includes(topDir(path) ?? ''))
  const probes = AGENT_TOOL_DIRS.map((dir) => `${dir}/${PROBE}`)
  const rules = decidingRules(gitignore, [...probes, ...shared])
  for (const dir of AGENT_TOOL_DIRS) {
    if (!isIgnored(rules.get(`${dir}/${PROBE}`))) problems.push(`${dir}/ is not ignored`)
  }
  for (const path of shared) {
    if (isIgnored(rules.get(path))) problems.push(`${path} is tracked but ignored`)
  }

  // Every negation, not only those naming an agent-tool directory: a pattern with no leading
  // directory, such as `!settings.json`, re-includes matching paths inside any of them.
  const lines = gitignore.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!line.startsWith('!')) return
    const comment: string[] = []
    for (let above = index - 1; above >= 0 && lines[above].startsWith('#'); above -= 1) {
      comment.push(lines[above].slice(1))
    }
    const words = comment.join(' ').split(/\s+/).filter(Boolean)
    if (words.length < MIN_REASON_WORDS) {
      problems.push(`.gitignore:${index + 1} ${line} has no reason comment directly above it`)
    }
  })

  return problems
}

const GITIGNORE = readFileSync(join(ROOT, '.gitignore'), 'utf8')
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

// Edits the real .gitignore at `anchor`, failing when the anchor line is gone, so a case cannot
// pass because the line it meant to change has moved.
const editGitignore = (anchor: string, edit: (lines: string[], index: number) => void) => {
  const lines = GITIGNORE.split('\n')
  const index = lines.indexOf(anchor)
  expect(index, `${anchor} is a line of .gitignore`).toBeGreaterThan(-1)
  edit(lines, index)
  return lines.join('\n')
}

const noReason = (gitignore: string, pattern: string) =>
  `.gitignore:${gitignore.split('\n').indexOf(pattern) + 1} ${pattern} has no reason comment directly above it`

describe('agent-tool directories in .gitignore (#1367)', () => {
  it('ignores the three directories found committed on branch tips, queried by bare name', () => {
    const dirs = ['.macroscope', '.specify', '.sandcastle']
    const rules = decidingRules(GITIGNORE, dirs)
    for (const dir of dirs) expect(isIgnored(rules.get(dir)), dir).toBe(true)
  })

  it('reports nothing for the repository as it stands', () => {
    expect(TRACKED).toContain('.claude/settings.json')
    expect(audit(GITIGNORE, TRACKED)).toEqual([])
  })

  it('reports a new tracked dot-directory that neither list names', () => {
    expect(audit(GITIGNORE, [...TRACKED, '.newtool/prompt.md'])).toEqual([
      '.newtool/ is tracked but listed as neither a project nor an agent-tool directory'
    ])
  })

  it('reports an agent-tool directory whose ignore rule is removed', () => {
    const gitignore = editGitignore('.macroscope', (lines, index) => lines.splice(index, 1))
    expect(audit(gitignore, TRACKED)).toEqual(['.macroscope/ is not ignored'])
  })

  it('reports a force-added file from an ignored tool directory', () => {
    expect(audit(GITIGNORE, [...TRACKED, '.claude/settings.local.json'])).toEqual([
      '.claude/settings.local.json is tracked but ignored'
    ])
  })

  it('reports tracked files under a parent directory that is no longer re-opened', () => {
    const gitignore = editGitignore('!.claude/agents/', (lines, index) => lines.splice(index, 1))
    expect(audit(gitignore, TRACKED)).toEqual([
      '.claude/agents/birdbrain-implementer.md is tracked but ignored',
      '.claude/agents/birdbrain-reviewer.md is tracked but ignored'
    ])
  })

  it('reports a negation with no comment above it, or with only a label', () => {
    const bare = editGitignore('!.claude/hooks/', (lines, index) => lines.splice(index - 1, 1))
    const label = editGitignore('!.claude/hooks/', (lines, index) => {
      lines[index - 1] = '# hooks'
    })
    expect(audit(bare, TRACKED)).toEqual([noReason(bare, '!.claude/hooks/')])
    expect(audit(label, TRACKED)).toEqual([noReason(label, '!.claude/hooks/')])
  })

  it('reports the Serena negations as they stood before #1600, and accepts them with reasons', () => {
    const serena = (block: string[]) =>
      editGitignore('.serena/', (lines, index) => lines.splice(index, 1, ...block))
    const tracked = [...TRACKED, '.serena/project.yml', '.serena/memories/overview.md']
    const before = serena([
      '# Serena: memories + project.yml are shared (committed); cache/local config stay local',
      '.serena/*',
      '!.serena/project.yml',
      '!.serena/memories/'
    ])
    const reasoned = serena([
      '.serena/*',
      '# Project configuration the Serena server reads at startup.',
      '!.serena/project.yml',
      '# Memories every session shares.',
      '!.serena/memories/'
    ])
    expect(audit(before, tracked)).toEqual([
      noReason(before, '!.serena/project.yml'),
      noReason(before, '!.serena/memories/')
    ])
    expect(audit(reasoned, tracked)).toEqual([])
  })
})
