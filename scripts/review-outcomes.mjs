// Tallies what happened to the reviewer pre-pass's findings on agent PRs.
//
// Anthropic's Claude Code team judges its reviewer's noise by what authors did with each
// comment, and its convergence by rounds per PR (https://claude.dev/blog/solving-code-review-at-anthropic/,
// 2026-10-15). This reads the same facts from this repository's PRs: every pre-pass verdict
// comment (`**Review verdict: ...**`, .claude/skills/post-comment/template.md), the severity
// of each finding in its table, the findings it carried from an earlier round, and the
// `Applied.` / `Not applied: <reason>` replies the dispatcher posted.
//
// A reply names the finding it answers only in the keyed shape, one comment holding
// `**<verdict comment id>-finding-<n>...**` entries, each followed by its reply. Older rounds
// posted bare replies, which this counts separately as unkeyed: they answer some piece of
// feedback on the PR, the pre-pass's or another reviewer's.
//
// Usage: node scripts/review-outcomes.mjs [--repo owner/name] [--since YYYY-MM-DD] [--json]
//   Reads PRs labelled agent-pr with gh, created on or after --since, and prints Markdown.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['blocking', 'gate', 'advisory']
const VERDICT = /^\*\*Review verdict: (approve for human review|request changes)\*\*/

// The first cell after the id that names a severity: the findings table puts it second, the
// test-pass table third. `non-blocking` and `nit` are older spellings of advisory.
const severityOf = (cells) => {
  for (const cell of cells) {
    const word = cell
      .trim()
      .toLowerCase()
      .match(/^(blocking|gate|advisory|non-blocking|nit)\b/)
    if (word) return SEVERITIES.includes(word[1]) ? word[1] : 'advisory'
  }
  return null
}

export const parseVerdict = (body) => {
  const head = (body ?? '').match(VERDICT)
  if (!head) return null
  const findings = []
  for (const line of body.split('\n')) {
    const row = line.match(/^\|\s*(\d+|T\d+)\s*\|(.*)\|\s*$/)
    if (!row) continue
    const cells = row[2].split('|')
    const severity = severityOf(cells.slice(0, 3))
    if (!severity) continue
    findings.push({
      id: row[1],
      severity,
      carried: /\(carried\)/i.test(row[2]),
      preExisting: /\(pre-existing\)/i.test(row[2])
    })
  }
  return { verdict: head[1] === 'request changes' ? 'request changes' : 'approve', findings }
}

const outcomeOf = (text) => {
  const t = text.trim()
  if (/^Applied\./.test(t)) return { outcome: 'applied', reason: '' }
  const not = t.match(/^Not applied:\s*(.*)/)
  return not ? { outcome: 'not applied', reason: not[1].split('\n')[0].trim() } : null
}

export const parseReplies = (body) => {
  const text = body ?? ''
  const keyed = []
  const entry = /\*\*(\d{6,})-([^*\n]+)\*\*\s*\n+([^\n]+)/g
  for (const m of text.matchAll(entry)) {
    const o = outcomeOf(m[3])
    if (o) keyed.push({ verdictId: m[1], key: m[2].trim(), ...o })
  }
  if (keyed.length > 0) return { keyed, loose: null }
  return { keyed, loose: outcomeOf(text) }
}

export const tallyPullRequest = ({ number, state, comments, trusted }) => {
  const mine = comments.filter((c) => trusted.includes(c.user?.login))
  const rounds = []
  const keyed = []
  const loose = []
  for (const c of mine) {
    const verdict = parseVerdict(c.body)
    if (verdict) {
      const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]))
      for (const f of verdict.findings) counts[f.severity] += 1
      rounds.push({
        id: String(c.id),
        verdict: verdict.verdict,
        counts,
        carried: verdict.findings.filter((f) => f.carried).length,
        preExisting: verdict.findings.filter((f) => f.preExisting).length
      })
      continue
    }
    const replies = parseReplies(c.body)
    keyed.push(...replies.keyed)
    if (replies.loose) loose.push(replies.loose)
  }
  const verdictIds = new Set(rounds.map((r) => r.id))
  return {
    number,
    state,
    rounds,
    keyed: keyed.filter((k) => verdictIds.has(k.verdictId)),
    loose
  }
}

const median = (xs) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export const summarize = (tallies) => {
  const reviewed = tallies.filter((t) => t.rounds.length > 0)
  const rounds = reviewed.map((t) => t.rounds.length)
  const all = reviewed.flatMap((t) => t.rounds)
  const replies = reviewed.flatMap((t) => [...t.keyed, ...t.loose])
  const count = (xs, outcome) => xs.filter((x) => x.outcome === outcome).length
  return {
    prs: tallies.length,
    reviewed: reviewed.length,
    rounds: {
      total: all.length,
      median: median(rounds),
      max: Math.max(0, ...rounds),
      approvedFirstRound: reviewed.filter((t) => t.rounds[0].verdict === 'approve').length,
      endedRequestingChanges: reviewed.filter((t) => t.rounds.at(-1).verdict === 'request changes')
        .length
    },
    findings: {
      ...Object.fromEntries(SEVERITIES.map((s) => [s, all.reduce((n, r) => n + r.counts[s], 0)])),
      carried: all.reduce((n, r) => n + r.carried, 0),
      preExisting: all.reduce((n, r) => n + r.preExisting, 0)
    },
    replies: {
      keyedApplied: count(
        reviewed.flatMap((t) => t.keyed),
        'applied'
      ),
      keyedNotApplied: count(
        reviewed.flatMap((t) => t.keyed),
        'not applied'
      ),
      unkeyedApplied: count(
        reviewed.flatMap((t) => t.loose),
        'applied'
      ),
      unkeyedNotApplied: count(
        reviewed.flatMap((t) => t.loose),
        'not applied'
      ),
      notAppliedReasons: replies
        .filter((r) => r.outcome === 'not applied')
        .map((r) => r.reason)
        .filter(Boolean)
    },
    perPr: reviewed.map((t) => ({
      number: t.number,
      state: t.state,
      verdicts: t.rounds.map((r) => (r.verdict === 'approve' ? 'A' : 'R')).join(''),
      blocking: t.rounds.reduce((n, r) => n + r.counts.blocking + r.counts.gate, 0),
      advisory: t.rounds.reduce((n, r) => n + r.counts.advisory, 0),
      carried: t.rounds.reduce((n, r) => n + r.carried, 0)
    }))
  }
}

export const formatReport = (s, since) => {
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
  const r = s.replies
  const lines = [
    `# Reviewer pre-pass outcomes${since ? ` since ${since}` : ''}`,
    '',
    `${s.reviewed} of ${s.prs} agent PRs had a pre-pass verdict, across ${s.rounds.total} rounds.`,
    '',
    '## Rounds',
    '',
    `- Median rounds per PR: ${s.rounds.median}; most: ${s.rounds.max}.`,
    `- Approved on the first round: ${s.rounds.approvedFirstRound} (${pct(s.rounds.approvedFirstRound, s.reviewed)}).`,
    `- Last verdict still requesting changes: ${s.rounds.endedRequestingChanges}.`,
    '',
    '## Findings',
    '',
    '| Blocking | Gate | Advisory | Carried from an earlier round | Pre-existing |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${s.findings.blocking} | ${s.findings.gate} | ${s.findings.advisory} | ${s.findings.carried} | ${s.findings.preExisting} |`,
    '',
    '## Replies',
    '',
    '| | Applied | Not applied |',
    '| --- | ---: | ---: |',
    `| Keyed to a pre-pass finding | ${r.keyedApplied} | ${r.keyedNotApplied} |`,
    `| Unkeyed (any reviewer) | ${r.unkeyedApplied} | ${r.unkeyedNotApplied} |`,
    ''
  ]
  if (r.notAppliedReasons.length > 0) {
    lines.push(
      'Each "not applied" reason, to sort by hand into wrong, intentional, or did not matter:',
      '',
      ...r.notAppliedReasons.map((reason) => `- ${reason}`),
      ''
    )
  }
  lines.push(
    '## Per PR',
    '',
    'Verdicts in order: A approves for human review, R requests changes.',
    '',
    '| PR | State | Verdicts | Blocking and gate | Advisory | Carried |',
    '| ---: | --- | --- | ---: | ---: | ---: |',
    ...s.perPr.map(
      (p) =>
        `| #${p.number} | ${p.state.toLowerCase()} | ${p.verdicts} | ${p.blocking} | ${p.advisory} | ${p.carried} |`
    )
  )
  return `${lines.join('\n')}\n`
}

const parseArgs = (argv) => {
  const args = { repo: 'thebristolsound/birdbrain', since: null, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') args.repo = argv[(i += 1)]
    else if (argv[i] === '--since') args.since = argv[(i += 1)]
    else if (argv[i] === '--json') args.json = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (args.since && !/^\d{4}-\d{2}-\d{2}$/.test(args.since)) {
    throw new Error(`--since takes YYYY-MM-DD, got "${args.since}"`)
  }
  return args
}

const gh = (...args) =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 }))

const main = () => {
  const args = parseArgs(process.argv.slice(2))
  const [owner] = args.repo.split('/')
  const trusted = [process.env.BIRDBRAIN_AGENT_GH_LOGIN || 'birdbrain-agent', owner]
  const search = ['--label', 'agent-pr', '--state', 'all', '--limit', '1000']
  if (args.since) search.push('--search', `created:>=${args.since}`)
  const prs = gh('pr', 'list', '-R', args.repo, ...search, '--json', 'number,state')
  const tallies = prs.map((pr) => {
    const pages = gh(
      'api',
      '--paginate',
      '--slurp',
      `repos/${args.repo}/issues/${pr.number}/comments?per_page=100`
    )
    return tallyPullRequest({ ...pr, comments: pages.flat(), trusted })
  })
  const summary = summarize(tallies)
  process.stdout.write(
    args.json ? `${JSON.stringify(summary, null, 2)}\n` : formatReport(summary, args.since)
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
