// What a branch changed, in the terms the probes need: which source files and unit test
// files it touched, with the new-side line numbers of every added or modified line.
//
// Every git call goes through an injected `git(args)` so the tests run without a repository.

export const UNIT_TEST = /^(tests\/|src\/packages\/.+\/tests\/).*\.test\.(ts|tsx|mts|cts)$/
export const E2E_SPEC = /^e2e\/.*\.spec\.tsx?$/

// Mirrors the coverage excludes in vitest.config.ts: these files never run under the unit
// runner, so a mutant in them would be reported as untested by construction.
const NOT_UNIT_SOURCE = [
  /\.d\.ts$/,
  /(^|\/)types\.ts$/,
  /\.gen\.tsx?$/,
  /^src\/main\/index\.ts$/,
  /^src\/mcp\/index\.ts$/,
  /^src\/mcp\/stdoutGuard\.ts$/,
  /^src\/main\/services\/extraction\/process\.ts$/,
  /^src\/preload\//,
  /^src\/renderer\/main\.tsx$/,
  /\/tests\//
]

export const classifyPath = (path) => {
  if (UNIT_TEST.test(path)) return 'unit-test'
  if (E2E_SPEC.test(path)) return 'e2e'
  if (!/^(src|extension\/src)\/.*\.(ts|tsx|mts|cts)$/.test(path)) return null
  return NOT_UNIT_SOURCE.some((pattern) => pattern.test(path)) ? null : 'source'
}

export const mergeBase = (git, base) => {
  try {
    return git(['merge-base', base, 'HEAD']).trim()
  } catch (error) {
    throw new Error(
      `cannot resolve a merge base between "${base}" and HEAD; fetch it first or pass --base`,
      { cause: error }
    )
  }
}

export const isClean = (git) => git(['status', '--porcelain', '--untracked-files=no']).trim() === ''

// `--no-renames` so a moved file reads as a deletion plus an addition: the revert probe then
// restores the old path and removes the new one, which is the merge-base tree.
export const parseNameStatus = (text) => {
  const fields = text.split('\0').filter((field) => field !== '')
  const entries = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    entries.push({ status: fields[i].charAt(0), path: fields[i + 1] })
  }
  return entries
}

// New-side line numbers per file from a `--unified=0` diff. A pure deletion has a count of
// zero and adds nothing.
export const parseAddedLines = (text) => {
  const files = new Map()
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      current = path === '/dev/null' ? null : path.replace(/^b\//, '')
      if (current !== null && !files.has(current)) files.set(current, new Set())
      continue
    }
    const hunk = current && /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk) continue
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let n = start; n < start + count; n++) files.get(current).add(n)
  }
  return files
}

export const collectChanges = ({ git, base }) => {
  const baseSha = mergeBase(git, base)
  const statuses = parseNameStatus(
    git(['diff', '--name-status', '--no-renames', '-z', baseSha, 'HEAD'])
  )
  // The prefixes are explicit because diff.mnemonicPrefix or diff.noprefix in a user's config
  // would otherwise replace the `b/` the parser strips.
  const added = parseAddedLines(
    git([
      'diff',
      '--unified=0',
      '--no-color',
      '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      baseSha,
      'HEAD'
    ])
  )
  const changes = { base: baseSha, sources: [], unitTests: [], e2e: [] }
  for (const { status, path } of statuses) {
    const kind = classifyPath(path)
    if (kind === null) continue
    const entry = { path, status, addedLines: added.get(path) ?? new Set() }
    if (kind === 'source') changes.sources.push(entry)
    else if (kind === 'unit-test') changes.unitTests.push(entry)
    else changes.e2e.push(entry)
  }
  return changes
}
