// Trusted input preparation. PR text chooses read-only resources, never commands or code.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closedIssues } from '../merge/gate.mjs'
import { RELAY_MARK, STATE_MARK } from './fleet.mjs'

// Going over a limit stops the pass before the paid call, with the limit in the message.
// Nothing is dropped to fit. A source is one issue, pull request, comment or review.
export const MAX_SOURCES = 60
export const MAX_COMMENTS = 200
export const MAX_SOURCES_BYTES = 1024 * 1024

// An issue or a pull request, the two kinds of source that carry a conversation.
const ITEM = /^(?:issues|pulls)\/(\d+)$/

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

// The text GitHub looks for `#<n>` in: a fenced block, a code span and an HTML comment are not
// prose. A fence or a comment that never closes runs to the end, as it renders. A backtick
// fence opens only on a line with no later backtick, so three backticks around words on one
// line are a code span. A description edited in the browser is saved with CRLF line endings,
// which are read as line feeds: a carriage return left on a line would keep a fence open.
function prose(text) {
  const lines = []
  let fence = null
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!fence) {
      const [, ticks, tildes] = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/.exec(line) ?? []
      fence = ticks ?? tildes ?? null
      lines.push(fence ? '' : line)
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
      if (close?.[0] === fence[0] && close.length >= fence.length) fence = null
    }
  }
  // One pattern, so whichever of a comment and a code span opens first hides the other.
  return lines
    .join('\n')
    .replace(/<!--[\s\S]*?(?:-->|$)|(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, ' ')
}

// The issues and pull requests a text names as `#<n>`, the way GitHub links one: not inside a
// word, a path, an entity or a link's fragment, and not as the target of a Markdown link, which
// is an anchor on the page. `owner/repo#<n>` is not one.
export function bareReferences(text) {
  const numbers = new Set()
  for (const m of prose(text).matchAll(/(?<![\w/&#.-]|\]\()#([1-9]\d*)(?![\w-])/g))
    numbers.add(Number(m[1]))
  return [...numbers]
}

// `read` answers null for a path GitHub has nothing at, and throws on any other failure.
export function prepareInputs(pr, repo, read) {
  if (typeof pr.body !== 'string' || !pr.body.trim()) throw new Error('PR has no source contract')
  const sources = []
  const seen = new Set()
  // The source at the first of `paths` that answers, or nothing when it is already read.
  const load = (paths) => {
    if (paths.some((path) => seen.has(path))) return null
    if (sources.length >= MAX_SOURCES)
      throw new Error(`too many referenced source contracts: the limit is ${MAX_SOURCES}`)
    let path
    let source = null
    for (path of paths) {
      source = read(`repos/${repo}/${path}`)
      if (source != null) break
    }
    if (!source || typeof source.body !== 'string' || !source.body.trim())
      throw new Error(`could not read required source ${paths.join(' or ')}`)
    seen.add(path)
    sources.push({
      path,
      title: source.title ?? '',
      author: source.user?.login ?? null,
      created_at: source.created_at ?? source.submitted_at ?? null,
      body: source.body,
      // An issue or a pull request says how many comments it has; trustedComments reads them.
      ...(ITEM.test(path)
        ? { comments_total: Number.isInteger(source.comments) ? source.comments : null }
        : {})
    })
    return source
  }
  const pending = closedIssues(pr.body).map((n) => `issues/${n}`)
  pending.push(...referencedSources(pr.body, repo))
  for (const wanted of pending) {
    // A number pointer does not say which kind of comment it names, and the words before it do
    // not either: the issue comment is read first, the inline review comment only on a 404.
    const source = load(
      wanted.startsWith('comments/') ? [`issues/${wanted}`, `pulls/${wanted}`] : [wanted]
    )
    if (source) pending.push(...referencedSources(source.body, repo))
  }
  // A bare `#<n>` in the description is read like a link, and no further: what its source
  // cites is not followed. The issues endpoint answers for a pull request too.
  for (const n of bareReferences(pr.body)) {
    if (!seen.has(`pulls/${n}`)) load([`issues/${n}`])
  }
  return sources
}

// The fleet's own records on a pull request: a head's state comment, whose last line is the
// state, and the relay that asks Codex. Each is one comment per head and says nothing a source
// contract does; a description that links one still gets it, as its own source.
const STATE_LINE = new RegExp(`^<!-- ${STATE_MARK} \\{.*\\} -->$`)
const RELAY_LINE = new RegExp(`^<!-- ${RELAY_MARK} [0-9a-f]{40} -->$`, 'm')
const fleetRecord = (body) =>
  STATE_LINE.test(body.trimEnd().split(/\r?\n/).pop()) || RELAY_LINE.test(body)

// Each issue and pull request among the sources gains the comments `trusted` accounts wrote on
// it. Any other author's comment is untrusted text and stays out; `comments_total` counts them
// all, so what was left out shows. `list` answers every comment at a path, or throws.
export function trustedComments(sources, repo, list, trusted, limit = MAX_COMMENTS) {
  let kept = 0
  return sources.map((source) => {
    const [, n] = ITEM.exec(source.path) ?? []
    if (!n) return source
    const all =
      source.comments_total === 0 ? [] : list(`repos/${repo}/issues/${n}/comments?per_page=100`)
    if (!Array.isArray(all)) throw new Error(`could not read the comments of ${source.path}`)
    const comments = all
      .filter((c) => trusted.includes(c.user?.login) && !fleetRecord(String(c.body ?? '')))
      .map((c) => ({
        id: c.id,
        author: c.user.login,
        created_at: c.created_at ?? null,
        body: String(c.body ?? '')
      }))
    kept += comments.length
    if (kept > limit)
      throw new Error(`too many comments on the referenced sources: the limit is ${limit}`)
    return { ...source, comments_total: all.length, comments }
  })
}

// The two accounts whose comments are read. An unset name would read as nobody's comments.
export function trustedAccounts(env) {
  const names = [env.MAINTAINER, env.MACHINE].map((name) => (name ?? '').trim())
  if (names.some((name) => !name)) throw new Error('MAINTAINER and MACHINE must both be set')
  return names
}

export function sourcesFile(sources, limit = MAX_SOURCES_BYTES) {
  const text = JSON.stringify(sources, null, 2)
  const bytes = Buffer.byteLength(text)
  if (bytes > limit) throw new Error(`sources.json would be ${bytes} bytes: the limit is ${limit}`)
  return text
}

// GitHub CLI ends its error line with the HTTP status; only a 404 means the path has nothing.
export function ghRead(path) {
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

// Every page of a list endpoint. Any failure throws: a list that cannot be read is not empty.
export function ghList(path) {
  const pages = JSON.parse(
    execFileSync('gh', ['api', path, '--paginate', '--slurp'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: 'pipe'
    })
  )
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw new Error(`gh returned no list for ${path}`)
  return pages.flat()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, dir] = process.argv.slice(2)
  const trusted = trustedAccounts(process.env)
  const pr = JSON.parse(readFileSync(join(dir, 'pr.json'), 'utf8'))
  const sources = trustedComments(prepareInputs(pr, repo, ghRead), repo, ghList, trusted)
  writeFileSync(join(dir, 'sources.json'), sourcesFile(sources))
}
