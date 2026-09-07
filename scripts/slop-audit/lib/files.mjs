// Inventory for the slop audit: which tracked files exist, what kind each one is,
// and which of them a run reports on.
//
// Classification runs in three steps and the first step that decides wins:
// excludes drop the path, the extension fixes the kind, and for code the path
// fixes the role. Only `code` reaches a parser, so a stylesheet or an image under
// src/ can never be mistaken for TypeScript.
//
// The unit of analysis is the tracked working tree: what `git ls-files` lists,
// read from disk. Uncommitted edits are scanned, untracked files are not. See
// docs/specs/2026-09-03-slop-audit-design.md, "Tracked working tree".

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

// Directory prefixes dropped before anything else looks at the path.
export const EXCLUDED_PREFIXES = [
  'website/',
  'docs/archive/',
  'docs/design-handoff/',
  'tests/fixtures/'
]

const LOCK_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])
const GENERATED = /\.gen\.[cm]?[jt]sx?$/
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/

const basename = (path) => path.slice(path.lastIndexOf('/') + 1)

const extension = (path) => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

// A leading dot covers top-level dot-directories (.claude/, .design-sync/) and
// root dotfiles (.nvmrc) in one rule. A dot-segment deeper in the tree is kept.
export const isExcluded = (path) =>
  path.startsWith('.') ||
  EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
  LOCK_FILES.has(basename(path)) ||
  GENERATED.test(path)

export const kindOf = (path) => {
  const ext = extension(path)
  if (CODE_EXTENSIONS.includes(ext)) return 'code'
  if (ext === '.md') return 'prose'
  if (basename(path) === 'package.json') return 'config'
  return 'other'
}

// Roles apply to code only. Code outside every role directory (root configuration
// such as vitest.config.ts) gets null and is seen by no role-scoped check.
export const roleOf = (path) => {
  if (path.startsWith('tests/') || path.startsWith('e2e/') || TEST_FILE.test(path)) return 'test'
  if (path.startsWith('scripts/')) return 'script'
  if (path.startsWith('src/') || path.startsWith('extension/src/')) return 'source'
  return null
}

export const classify = (path) => {
  if (isExcluded(path)) return null
  const kind = kindOf(path)
  return { path, kind, role: kind === 'code' ? roleOf(path) : null }
}

// Minimal glob: `**` spans directories, `*` and `?` stay inside one segment. Node
// 20's path.matchesGlob is experimental and emits a warning; --path needs no more.
export const globToRegExp = (glob) => {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        out += '(?:.*/)?'
      } else {
        out += '.*'
      }
    } else if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

// Pure: takes the listed paths and, when --changed-since was given, the paths git
// says changed. `reported` is the subset findings are printed for; the checks still
// see every file so cross-file checks keep their context.
export const buildInventory = ({ paths, changed = null, globs = [] }) => {
  const matchers = globs.map(globToRegExp)
  const files = paths
    .filter((path) => matchers.length === 0 || matchers.some((re) => re.test(path)))
    .map(classify)
    .filter((entry) => entry !== null)
  const changedSet = changed === null ? null : new Set(changed)
  const reported = new Set(
    files.map((entry) => entry.path).filter((path) => changedSet === null || changedSet.has(path))
  )
  return { files, reported }
}

export const listTrackedFiles = (root) =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

export const listChangedFiles = (root, ref) =>
  execFileSync('git', ['diff', '--name-only', ref], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.length > 0)

// Reads a tracked file once; every check shares the text through ctx.read.
export const createReader = (root) => {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) cache.set(path, readFileSync(join(root, path), 'utf8'))
    return cache.get(path)
  }
}
