// The dispatch mode: the model under test plays the dispatcher running the
// reviewer pre-pass (dispatch skill, section 4) on a PR that exists only as
// a local clone, with a gh stand-in answering read-only queries from the
// fixture and refusing every write. The product graded is the verdict
// comment, the artifact production posts.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PR_BODY, VERDICTS } from './schema.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// The agent configuration under test travels from the branch being
// benchmarked, not from the PR's own head, so an old PR is reviewed by
// today's reviewer definition, skills, hooks and instructions.
export const OVERLAY = ['.claude', 'CLAUDE.md', 'AGENTS.md']

// Fixed identities and dates so the synthetic commits, and with them the
// refs the reviewer diffs, are the same bytes on every run.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'bench',
  GIT_AUTHOR_EMAIL: 'bench@local',
  GIT_COMMITTER_NAME: 'bench',
  GIT_COMMITTER_EMAIL: 'bench@local',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
}

const git = (cwd, args, opts = {}) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV },
    ...opts
  }).trim()

function copyOverlay(repo, dir) {
  const tracked = git(repo, ['ls-files', '-z', '--', ...OVERLAY])
    .split('\0')
    .filter(Boolean)
  for (const p of OVERLAY) rmSync(join(dir, p), { recursive: true, force: true })
  for (const path of tracked) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    cpSync(join(repo, path), join(dir, path))
  }
}

// A shared clone where origin/main is the PR's base, origin/<branch> and the
// checked-out branch are the PR's head with the mutation committed on top,
// both carrying the overlay, and the remote points nowhere so nothing the
// model does can reach the real repository.
export function buildDispatchWorkspace({ repo, fixture, dir, linkNodeModules = true }) {
  const branch = fixture.pr?.headRefName ?? `bench/${fixture.id}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dirname(dir), { recursive: true })
  git(repo, ['clone', '-q', '--shared', '--no-checkout', repo, dir])
  git(dir, ['config', 'user.name', 'bench'])
  git(dir, ['config', 'user.email', 'bench@local'])
  git(dir, ['checkout', '-q', '--detach', fixture.source.base])
  copyOverlay(repo, dir)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'main at the reviewed base'])
  const base = git(dir, ['rev-parse', 'HEAD'])
  git(dir, ['checkout', '-q', '--detach', fixture.source.head])
  for (const [path, content] of fixture.files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  copyOverlay(repo, dir)
  git(dir, ['reset', '-q', '--soft', base])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', fixture.pr?.title ?? `PR #${fixture.source.pr}`])
  const head = git(dir, ['rev-parse', 'HEAD'])
  git(dir, ['update-ref', 'refs/remotes/origin/main', base])
  git(dir, ['branch', '-f', 'main', base])
  git(dir, ['branch', '-f', branch, head])
  git(dir, ['update-ref', `refs/remotes/origin/${branch}`, head])
  git(dir, ['checkout', '-q', branch])
  git(dir, ['remote', 'set-url', 'origin', '/nonexistent/bench-remote'])
  git(dir, ['remote', 'set-url', '--push', 'origin', '/nonexistent/bench-remote'])
  if (linkNodeModules && existsSync(join(repo, 'node_modules'))) {
    symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'))
  }
  return { dir, base, head, branch }
}

// The gh stand-in on PATH: `gh` and `agh` both resolve to it.
export function installGhShim(binDir) {
  mkdirSync(binDir, { recursive: true })
  const shim = `#!/usr/bin/env bash\nexec node "${join(here, 'gh-shim.mjs')}" "$@"\n`
  for (const name of ['gh', 'agh']) writeFileSync(join(binDir, name), shim, { mode: 0o755 })
  return binDir
}

export function dispatchPrompt({ pr, head, commentFile, reportFile }) {
  return [
    '/dispatch',
    `MODE: PRE-PASS ONLY on PR #${pr} at head commit ${head}.`,
    'Skip the environment probe, the identity check, and sections 1, 2, 2a, 3 and 5. The cycle',
    'claim is already held for this session and every CI check is green at that head commit.',
    'Run section 4, the reviewer pre-pass: spawn `birdbrain-reviewer` with that commit id',
    'exactly as the section says, and take its two products.',
    `Write the whole verdict comment (the top layer plus the collapsed full report, in the`,
    `pre-pass verdict shape from the post-comment skill) to ${commentFile}, run`,
    '`.claude/skills/post-comment/scripts/check.sh` on that file and fix it until the check',
    `passes, and write the full report on its own to ${reportFile}.`,
    'Post nothing and change nothing on GitHub: no comment, no commit status, no label, no',
    'push, no merge. Every gh write is disabled here and fails; treat a failed write as',
    'expected and never retry it. Do not release or take any claim. When the two files are',
    'written, reply with the single line DONE.'
  ].join('\n')
}

// The verdict comment's shape (post-comment template): a bold first line,
// numbered plain findings on top, and a collapsed report whose table rows
// carry file:line and severity. The table is the graded source; the top
// layer is the fallback when the report has no table.
const VERDICT_LINE = /^\*\*Review verdict:\s*(.+?)\*\*\s*$/m
const TABLE_ROW = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(.+?)\s*\|\s*$/
const TOP_ITEM = /^\s*\d+\.\s+(.+?)\s*$/

function parseLocation(cell) {
  const text = cell.replace(/`/g, '').trim()
  if (!text || text === '–' || text === '-') return { file: null, line: null }
  if (/^pr body/i.test(text)) return { file: PR_BODY, line: null }
  // "PR labels", "whole branch", "CI": a control, not a place in the tree.
  const m = text.match(/^([^\s:(]+?)(?::(\d+))?(?:[-–]\d+)?(?:\s|,|$|\()/)
  if (!m || !/[/.]/.test(m[1])) return { file: null, line: null }
  return { file: m[1], line: m[2] ? Number(m[2]) : null }
}

export function parseVerdictComment(text) {
  if (typeof text !== 'string') return null
  const v = text.match(VERDICT_LINE)
  if (!v) return null
  const verdict = v[1].trim().toLowerCase()
  if (!VERDICTS.includes(verdict)) return null
  const detailsAt = text.indexOf('<details>')
  const top = detailsAt < 0 ? text : text.slice(0, detailsAt)
  const detail = detailsAt < 0 ? '' : text.slice(detailsAt)
  const findings = []
  for (const line of detail.split('\n')) {
    const m = line.match(TABLE_ROW)
    if (!m) continue
    const severity = m[2].toLowerCase()
    // A row the reviewer marks as passed is a control it checked, not a finding.
    if (/^(pass|passed|ok|none|info)$/.test(severity)) continue
    const { file, line: lineNo } = parseLocation(m[3])
    findings.push({
      file,
      line: lineNo,
      quote: null,
      summary: m[4].replace(/`/g, ''),
      blocking: /\b(blocking|gate)\b/.test(severity)
    })
  }
  if (findings.length === 0) {
    for (const line of top.split('\n')) {
      const m = line.match(TOP_ITEM)
      if (m) {
        findings.push({
          file: null,
          line: null,
          quote: null,
          summary: m[1],
          blocking: verdict === 'request changes'
        })
      }
    }
  }
  return { verdict, findings, source: findings.length && detail ? 'table' : 'top' }
}
