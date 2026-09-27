// Reads one built fixture directory back into memory: the spec, the truth,
// the diff, the PR body and the mutated files the builder wrote.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(relative(base, full))
  }
  return out
}

export function loadFixture(dir) {
  const read = (name) => readFileSync(join(dir, name), 'utf8')
  const spec = JSON.parse(read('case.json'))
  const truth = JSON.parse(read('truth.json'))
  const diff = read('diff.patch')
  const prBody = existsSync(join(dir, 'pr.md')) ? read('pr.md') : null
  const pr = existsSync(join(dir, 'pr.json')) ? JSON.parse(read('pr.json')) : null
  const files = new Map()
  const filesDir = join(dir, 'files')
  if (existsSync(filesDir)) {
    for (const path of walk(filesDir)) files.set(path, readFileSync(join(filesDir, path), 'utf8'))
  }
  return { ...spec, truth, diff, prBody, pr, files }
}
