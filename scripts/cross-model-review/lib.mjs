// The pure half of the cross-model review: which pull requests to read, the verdict, and the
// comment and status that report it. cross-model-review.mjs does the I/O around these.

export const LABEL = 'cross-model-review'
export const CONTEXT = 'cross-model-review'
export const MAINTAINER = 'thebristolsound'
export const PER_DAY = 20

// The label counts only in the state the maintainer last set: his newest add or removal. `at`
// is when he added it, so removing and re-adding it asks for a fresh read of the same head.
export function labelState(events, maintainer = MAINTAINER) {
  const last = events
    .filter(
      (e) =>
        (e.event === 'labeled' || e.event === 'unlabeled') &&
        e.label?.name === LABEL &&
        e.actor?.login === maintainer
    )
    .at(-1)
  return last?.event === 'labeled' ? { on: true, at: last.created_at } : { on: false, at: null }
}

// A head is read once per label add: a status from the posting account at that head, newer
// than the add, means it is done.
export const reviewed = (statuses, login, labeledAt) =>
  statuses.some(
    (s) => s.context === CONTEXT && s.creator?.login === login && s.created_at > labeledAt
  )

// The pull requests to read, oldest first. A fork's head is code nobody on the trust list
// wrote, and the review runs on the maintainer's machine, so forks are named and skipped.
export function selectReviews(prs) {
  const out = { review: [], skipped: [] }
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    if (!pr.label.on) continue
    if (pr.isCrossRepository) out.skipped.push(`#${pr.number}: head is in a fork`)
    else if (!pr.reviewed) out.review.push(pr.number)
  }
  return out
}

// Runs started in the last 24 hours, against the daily cap.
export const underCap = (starts, now = Date.now(), cap = PER_DAY) =>
  starts.filter((t) => now - t < 24 * 3600 * 1000).length < cap

// The script decides the verdict from the findings, never the model.
export function verdict(findings) {
  const blocking = findings.filter((f) => f.severity === 'BLOCKING').length
  return {
    blocking,
    other: findings.length - blocking,
    word: blocking > 0 ? 'request changes' : 'no blocking findings'
  }
}

export function statusDescription(v, model) {
  const counts = `${v.blocking} blocking, ${v.other} other`
  return `${model}: ${v.word} (${counts}). Advisory.`.slice(0, 140)
}

// Credentials the reviewer could have read off this machine. The review is posted publicly, so
// any match stops the post.
const SECRETS = [
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS key', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/]
]
export const leaks = (text) => SECRETS.filter(([, re]) => re.test(text)).map(([name]) => name)

const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim()

const where = (f) => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '-')

// The comment, in the post-comment skill's "anything else" shape: a plain top layer and the
// full findings collapsed. At most five findings are named on top, blocking first.
export function renderComment({ head, model, effort, result }) {
  const v = verdict(result.findings)
  const ordered = [...result.findings].sort(
    (a, b) => (a.severity === 'BLOCKING' ? 0 : 1) - (b.severity === 'BLOCKING' ? 0 : 1)
  )
  const top = [
    `**Cross-model review: ${v.word}**`,
    '',
    `A second, independent review by an OpenAI model, asked for with the label. It is advisory and blocks nothing. Findings: ${v.blocking} blocking, ${v.other} other.`
  ]
  if (ordered.length) {
    top.push('')
    ordered.slice(0, 5).forEach((f, i) => {
      top.push(`${i + 1}. ${f.severity === 'BLOCKING' ? 'Blocking: ' : ''}${cell(f.plain)}`)
    })
    if (ordered.length > 5) top.push(`${ordered.length - 5} more are in the full report.`)
  }
  const detail = [
    '',
    '<details>',
    '<summary>Full report</summary>',
    '',
    `Reviewed commit \`${head}\` with \`${model}\` at \`${effort}\`, read-only and without network.`,
    ''
  ]
  if (ordered.length) {
    detail.push(
      '| # | severity | where | finding | failure scenario |',
      '| --- | --- | --- | --- | --- |'
    )
    ordered.forEach((f, i) => {
      detail.push(
        `| ${i + 1} | ${f.severity} | ${where(f)} | ${cell(f.detail)} | ${cell(f.failure_scenario) || '-'} |`
      )
    })
    detail.push('')
  }
  detail.push(
    result.not_checked.length
      ? `Not checked:\n\n${result.not_checked.map((n) => `- ${cell(n)}`).join('\n')}`
      : 'Not checked: nothing.',
    '',
    '</details>'
  )
  return [...top, ...detail].join('\n') + '\n'
}
