// Trusted input preparation. PR text chooses read-only resources, never commands or code.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closedIssues } from '../merge/gate.mjs'

export function referencedSources(text, repo) {
  const paths = new Set()
  for (const m of String(text).matchAll(
    /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)(?:#(issuecomment-|discussion_r|pullrequestreview-)(\d+))?/g
  )) {
    const [, target, kind, number, anchor, id] = m
    // Restrict credentials to this repository. Other contracts remain missing source work.
    if (target.toLowerCase() !== repo.toLowerCase())
      throw new Error(`referenced source outside ${repo}: ${target}`)
    if (anchor === 'issuecomment-') paths.add(`issues/comments/${id}`)
    else if (anchor === 'discussion_r') paths.add(`pulls/comments/${id}`)
    else if (anchor === 'pullrequestreview-') paths.add(`pulls/${number}/reviews/${id}`)
    else paths.add(`${kind === 'pull' ? 'pulls' : 'issues'}/${number}`)
  }
  // Older descriptions name a comment by number rather than linking it.
  for (const m of String(text).matchAll(/\bcomment\s+(\d{8,})\b/g))
    paths.add(`issues/comments/${m[1]}`)
  return [...paths]
}

export function prepareInputs(pr, repo, read) {
  if (typeof pr.body !== 'string' || !pr.body.trim()) throw new Error('PR has no source contract')
  const sources = []
  const pending = closedIssues(pr.body).map((n) => `issues/${n}`)
  pending.push(...referencedSources(pr.body, repo))
  const seen = new Set()
  for (const path of pending) {
    if (seen.has(path)) continue
    if (seen.size >= 30) throw new Error('too many referenced source contracts')
    seen.add(path)
    const source = read(`repos/${repo}/${path}`)
    if (!source || typeof source.body !== 'string' || !source.body.trim()) {
      throw new Error(`could not read required source ${path}`)
    }
    sources.push({ path, title: source.title ?? '', body: source.body })
    pending.push(...referencedSources(source.body, repo))
  }
  return sources
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, dir] = process.argv.slice(2)
  const pr = JSON.parse(readFileSync(join(dir, 'pr.json'), 'utf8'))
  const sources = prepareInputs(pr, repo, (path) =>
    JSON.parse(
      execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    )
  )
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(sources, null, 2))
}
