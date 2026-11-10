// Trusted input preparation. PR text chooses read-only resources, never commands or code.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closedIssues } from '../merge/gate.mjs'

// The rest of a link is captured without being consumed: it runs to whitespace or a Markdown
// delimiter and stops before a second link, so two links with no space between them both match.
const LINK =
  /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)(?=((?:(?!https?:\/\/)[^\s<>()[\]{}|"'`])*))/g

// The four fragments GitHub writes for a comment; `r<id>` is the Files changed view's link to
// an inline review comment.
const COMMENT = /^(issuecomment-|pullrequestreview-|discussion_r|r)(\d+)$/
// Any other spelling of one, read with letter case, hyphens and underscores removed.
const COMMENT_LIKE = /comment|review|^(?:discussion)?r(?:\d|$)/
// Sentence punctuation that follows a link without being part of it.
const TRAILING = '?!.,:;*_~'

// A browser decodes a fragment before it looks for the comment. Null when it does not decode.
function decoded(fragment) {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return null
  }
}

// The API paths a text names. A number pointer comes back as `comments/<id>`, which is neither
// comment endpoint: prepareInputs reads it from both.
export function referencedSources(text, repo) {
  const paths = new Set()
  for (const [link, target, kind, number, rest] of String(text).matchAll(LINK)) {
    // Credentials reach this repository only, so a link to another one is a missing source.
    if (target.toLowerCase() !== repo.toLowerCase())
      throw new Error(`referenced source outside ${repo}: ${target}`)
    // A path or query before the fragment does not change the comment it names. The trailing
    // punctuation goes in a loop: Node rescans a long run from every position for `[...]+$`.
    const hash = rest.indexOf('#')
    let end = hash < 0 ? 0 : rest.length
    while (end > hash + 1 && TRAILING.includes(rest[end - 1])) end--
    const raw = rest.slice(hash + 1, end)
    const fragment = decoded(raw)
    const [, name, id] = COMMENT.exec(fragment ?? '') ?? []
    // A link that names a comment in another shape must not read as the page around it.
    const like = !name && COMMENT_LIKE.test((fragment ?? '').toLowerCase().replace(/[-_]/g, ''))
    if (fragment === null || like)
      throw new Error(`malformed source link: ${link}${rest.slice(0, hash)}#${raw}`)
    if (name === 'issuecomment-') paths.add(`issues/comments/${id}`)
    else if (name === 'pullrequestreview-') paths.add(`pulls/${number}/reviews/${id}`)
    else if (name) paths.add(`pulls/comments/${id}`)
    else paths.add(`${kind === 'pull' ? 'pulls' : 'issues'}/${number}`)
  }
  // Older descriptions name a comment by number rather than linking it.
  for (const m of String(text).matchAll(/\bcomment\s+(\d{8,})\b/g)) paths.add(`comments/${m[1]}`)
  return [...paths]
}

// `read` answers null for a path GitHub has nothing at, and throws on any other failure.
export function prepareInputs(pr, repo, read) {
  if (typeof pr.body !== 'string' || !pr.body.trim()) throw new Error('PR has no source contract')
  const sources = []
  const pending = closedIssues(pr.body).map((n) => `issues/${n}`)
  pending.push(...referencedSources(pr.body, repo))
  const seen = new Set()
  for (const wanted of pending) {
    // A number pointer does not say which kind of comment it names, and the words before it do
    // not either: the issue comment is read first, the inline review comment only on a 404.
    const paths = wanted.startsWith('comments/')
      ? [`issues/${wanted}`, `pulls/${wanted}`]
      : [wanted]
    if (paths.some((path) => seen.has(path))) continue
    if (sources.length >= 30) throw new Error('too many referenced source contracts')
    let path
    let source = null
    for (path of paths) {
      source = read(`repos/${repo}/${path}`)
      if (source != null) break
    }
    if (!source || typeof source.body !== 'string' || !source.body.trim())
      throw new Error(`could not read required source ${paths.join(' or ')}`)
    seen.add(path)
    sources.push({ path, title: source.title ?? '', body: source.body })
    pending.push(...referencedSources(source.body, repo))
  }
  return sources
}

// GitHub CLI ends its error line with the HTTP status; only a 404 means the path has nothing.
function ghRead(path) {
  try {
    return JSON.parse(
      execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: 'pipe'
      })
    )
  } catch (error) {
    if (/\(HTTP 404\)/.test(String(error.stderr ?? ''))) return null
    throw error
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, dir] = process.argv.slice(2)
  const pr = JSON.parse(readFileSync(join(dir, 'pr.json'), 'utf8'))
  const sources = prepareInputs(pr, repo, ghRead)
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(sources, null, 2))
}
