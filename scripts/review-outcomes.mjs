// Tallies what happened to the reviewer pre-pass's findings on agent PRs.
//
// Anthropic's Claude Code team judges its reviewer's noise by what authors did with each
// comment, and its convergence by rounds per PR (https://claude.dev/blog/solving-code-review-at-anthropic/,
// 2026-10-15). This reads the same facts from this repository's PRs: every pre-pass verdict
// comment, the severity of each finding in it, the findings it carried from an earlier round,
// and the dispatcher's replies to each finding, and gives every finding one outcome:
//
//   fixed       applied, and a later round reviewed the fix
//   applied     applied, with no later round to review it
//   disputed    not applied (or no action), with a reason
//   deferred    not applied, with an issue number for the follow-up
//   overridden  the PR merged while its last verdict requested changes, with no reply
//   no reply    none of the above
//
// Verdicts come in the shapes the pre-pass has used most, and older shapes are not read:
// `**Review verdict: ...**` (the current
// post-comment shape), `**Reviewer pre-pass (<sha>): ...**`, and the `## Reviewer pre-pass`
// headings with a `Verdict:` line. Findings are read from the findings table, a numbered
// `1. **advisory** ...` list, or `### Finding 1 (blocking)` headings. A reply is joined to its
// finding by a keyed entry, `**<verdict comment id>-finding-<n>**` with the reply under it (the
// dispatch skill), or by a numbered line, `1. Applied ...` or `2. not applied: ...`, in a
// comment posted after the verdict and before the next one. Replies in inline review threads
// answer other reviewers and are not read.
//
// Usage: node scripts/review-outcomes.mjs [--repo owner/name] [--since YYYY-MM-DD] [--by-month] [--json]
//   Reads PRs labelled agent-pr with gh, created on or after --since, and prints Markdown;
//   --by-month adds one outcome row per month the PRs were opened, --json prints the summary.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['blocking', 'gate', 'advisory']
export const OUTCOMES = ['fixed', 'applied', 'disputed', 'deferred', 'overridden', 'no reply']
const SEVERITY_WORD = /^(blocking|gate|advisory|non-blocking|nit)\b/
const VERDICT_WORD = /(approve for human review|request changes)/i

// `non-blocking` and `nit` are older spellings of advisory.
const severityOf = (word) => {
  const w = word.toLowerCase()
  return SEVERITIES.includes(w) ? w : 'advisory'
}

// The disclosure lines a maintainer-account comment starts with are not part of its shape.
const stripDisclosure = (body) => (body ?? '').replace(/^(?:>[^\n]*\n)+\s*/, '')

const verdictOf = (text) => {
  const lines = stripDisclosure(text).split('\n')
  const first = lines[0]
  if (
    !/^(\*\*|#{2,3}\s)\s*`?(Review verdict|Reviewer (pre|re)-pass|agent\/pre-pass)/i.test(first)
  ) {
    return null
  }
  const word =
    first.match(VERDICT_WORD) ??
    lines
      .slice(1, 8)
      .find((l) => /^(\*\*|#{2,4}\s)\s*Verdict:/i.test(l))
      ?.match(VERDICT_WORD)
  if (!word) return null
  return word[1].toLowerCase() === 'request changes' ? 'request changes' : 'approve'
}

// Older verdicts group findings under a severity heading (`## Blocking`, `## Findings`) with
// `**1. What it found.**` items, so the heading supplies the severity an item does not state.
const SECTION =
  /^#{2,3}\s+(blocking|gate|advisory|non-blocking|nits?|findings)(\s+findings)?\s*(\(\d+\))?\s*$/i

const findingsOf = (body) => {
  const findings = []
  let unnumbered = 0
  let section = null
  const add = (id, word, rest) =>
    findings.push({
      id,
      severity: severityOf(word),
      carried: /\(carried\)/i.test(rest),
      preExisting: /\(pre-existing\)/i.test(rest)
    })
  for (const line of body.split('\n')) {
    const row = line.match(/^\|\s*(\d+|T\d+)\s*\|(.*)\|\s*$/)
    if (row) {
      // The first cell that names a severity: the findings table puts it second, the test-pass
      // table third.
      const cell = row[2]
        .split('|')
        .slice(0, 3)
        .map((c) => c.trim().toLowerCase().match(SEVERITY_WORD))
        .find(Boolean)
      if (cell) add(row[1], cell[1], row[2])
      continue
    }
    const item = line.match(/^(\d+)\.\s+\*\*(blocking|gate|advisory|non-blocking|nit)\b(.*)/i)
    if (item) {
      add(item[1], item[2], item[3])
      continue
    }
    const numbered = line.match(
      /^#{3,4}\s+Finding\s+(\d+)\s+\((blocking|gate|advisory|non-blocking|nit)\)(.*)/i
    )
    if (numbered) {
      add(numbered[1], numbered[2], numbered[3])
      continue
    }
    const heading = line.match(SECTION)
    if (heading) {
      const word = heading[1].toLowerCase()
      section = word === 'findings' || word.startsWith('nit') ? 'advisory' : word
      continue
    }
    const titled = line.match(
      /^#{3,4}\s+(blocking|gate|advisory|non-blocking|nit)\s*[-\u2013\u2014:]\s(.*)/i
    )
    if (titled) {
      add(`h${(unnumbered += 1)}`, titled[1], titled[2])
      continue
    }
    if (/^#{1,3}\s/.test(line)) section = null
    // Under a severity heading, each paragraph that opens in bold is a finding: `**1. ...`,
    // `**F1. ...`, `**BB7 - ...` or a bare `**file:line - ...`; a short `**Label:**` is not.
    if (!section || !line.startsWith('**') || /^\*\*[^*]{1,25}:\*\*/.test(line)) continue
    const bold = line.match(/^\*\*(?:(\d+|[A-Z]{1,3}\d+)(?:\.\s+|\s+[-\u2013\u2014]\s+))?(.*)/)
    const own = bold[2].match(/^(?:nit:\s*)?(blocking|gate|advisory|non-blocking|nit)\b/i)
    add(
      bold[1] ?? `h${(unnumbered += 1)}`,
      own ? own[1] : /^nit:/i.test(bold[2]) ? 'nit' : section,
      bold[2]
    )
  }
  return findings
}

export const parseVerdict = (body) => {
  const verdict = verdictOf(body)
  return verdict ? { verdict, findings: findingsOf(stripDisclosure(body)) } : null
}

const outcomeOf = (text) => {
  const t = text.trim()
  if (/^applied\b/i.test(t)) return { outcome: 'applied', reason: '' }
  const not = t.match(/^(not applied|no action)\b[:,.]?\s*(.*)/i)
  if (!not) return null
  const reason = not[2].split('\n')[0].trim()
  return { outcome: /#\d+/.test(reason) ? 'deferred' : 'disputed', reason }
}

// The finding ids a key names: `finding-3`, `finding-3-and-T3-plain-head` and `1-T1-multi-file`
// name 3; 3 and T3; 1 and T1.
const idsOfKey = (key) => {
  const ids = []
  for (const part of key.replace(/^finding-/, '').split('-')) {
    if (/^(\d+|T\d+)$/.test(part)) ids.push(part)
    else if (part !== 'and' && part !== 'finding') break
  }
  return ids
}

// A line that answers one finding by its number: `1. Applied ...`, `| 1 | applied ...`,
// `**1 - what it found.** Applied in ...`, `- **Finding 1:** Applied ...` or
// `- **Pre-pass #1** (what it found) - applied ...`.
const NUMBERED_REPLY =
  /^(?:(\d+)\.\s+|\|\s*(\d+|T\d+)\s*\|\s*|\*\*(\d+)\s+[-\u2014][^*]*\*\*\s*|-\s+\*\*(?:finding|pre-pass)\s*#?(\d+|T\d+)\b[^*]*\*\*\s*)(.+)/i

export const parseReplies = (body) => {
  const text = stripDisclosure(body)
  const keyed = []
  for (const m of text.matchAll(/\*\*(\d{6,})-([^*\n]+)\*\*\s*\n+([^\n]+)/g)) {
    const o = outcomeOf(m[3])
    if (o) keyed.push({ verdictId: m[1], ids: idsOfKey(m[2].trim()), ...o })
  }
  const numbered = []
  for (const line of text.split('\n')) {
    const m = line.match(NUMBERED_REPLY)
    const id = m && (m[1] ?? m[2] ?? m[3] ?? m[4])
    const o = m && outcomeOf(m[5].replace(/^\([^)]*\)\s*/, '').replace(/^[-\u2013\u2014:,\s]+/, ''))
    if (o) numbered.push({ ids: [id], ...o })
  }
  // A comment that is one reply in the review-reply shape names its finding, if at all, in
  // its sentence: `Not applied: finding 2 of the first verdict ...`.
  const whole = outcomeOf(text)
  const named = whole && text.split('\n')[0].match(/\bfinding (\d+|T\d+) of the (first|earlier)\b/i)
  const single = whole ? { ...whole, ids: named ? [named[1]] : [], first: Boolean(named) } : null
  return { keyed, numbered, single }
}

export const tallyPullRequest = ({ number, state, createdAt, comments, trusted }) => {
  const trustedComments = comments.filter((c) => trusted.includes(c.user?.login))
  const rounds = []
  const unmatched = []
  for (const c of trustedComments) {
    const verdict = parseVerdict(c.body)
    if (verdict) {
      rounds.push({ id: String(c.id), ...verdict, replies: new Map() })
      continue
    }
    const { keyed, numbered, single } = parseReplies(c.body)
    const record = (round, ids, reply) => {
      const known = new Set(round.findings.map((f) => f.id))
      for (const id of ids)
        if (known.has(id) && !round.replies.has(id)) round.replies.set(id, reply)
    }
    for (const reply of keyed) {
      const round = rounds.find((r) => r.id === reply.verdictId)
      if (round) record(round, reply.ids, reply)
    }
    // A numbered reply answers the latest verdict before it.
    if (keyed.length === 0 && rounds.length > 0) {
      for (const reply of numbered) record(rounds.at(-1), reply.ids, reply)
    }
    if (keyed.length === 0 && numbered.length === 0 && single && rounds.length > 0) {
      if (single.ids.length > 0)
        record(single.first ? rounds[0] : rounds.at(-1), single.ids, single)
      else unmatched.push(single.outcome)
    }
  }
  const merged = state === 'MERGED'
  const findings = rounds.flatMap((round, i) =>
    round.findings.map((f) => {
      const reply = round.replies.get(f.id)
      const last = i === rounds.length - 1
      let outcome = 'no reply'
      if (reply?.outcome === 'applied') outcome = last ? 'applied' : 'fixed'
      else if (reply) outcome = reply.outcome
      else if (last && merged && round.verdict === 'request changes') outcome = 'overridden'
      return { round: i + 1, ...f, outcome, reason: reply?.reason ?? '' }
    })
  )
  return {
    number,
    state,
    month: (createdAt ?? '').slice(0, 7),
    rounds: rounds.map(({ id, verdict, findings: fs }) => ({
      id,
      verdict,
      findings: fs.length,
      counts: Object.fromEntries(
        SEVERITIES.map((s) => [s, fs.filter((f) => f.severity === s).length])
      ),
      carried: fs.filter((f) => f.carried).length,
      preExisting: fs.filter((f) => f.preExisting).length
    })),
    findings,
    unmatchedReplies: unmatched
  }
}

const median = (xs) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0)

const outcomeCounts = (findings) =>
  Object.fromEntries(OUTCOMES.map((o) => [o, findings.filter((f) => f.outcome === o).length]))

export const summarize = (tallies) => {
  const reviewed = tallies.filter((t) => t.rounds.length > 0)
  const rounds = reviewed.flatMap((t) => t.rounds)
  const findings = reviewed.flatMap((t) => t.findings)
  const months = [...new Set(reviewed.map((t) => t.month))].filter(Boolean).sort()
  return {
    prs: tallies.length,
    reviewed: reviewed.length,
    rounds: {
      total: rounds.length,
      median: median(reviewed.map((t) => t.rounds.length)),
      max: Math.max(0, ...reviewed.map((t) => t.rounds.length)),
      approvedFirstRound: reviewed.filter((t) => t.rounds[0].verdict === 'approve').length,
      endedRequestingChanges: reviewed.filter((t) => t.rounds.at(-1).verdict === 'request changes')
        .length,
      // A request for changes whose findings none of the readers above could parse.
      unreadable: rounds.filter((r) => r.verdict === 'request changes' && r.findings === 0).length
    },
    findings: {
      ...Object.fromEntries(SEVERITIES.map((s) => [s, sum(rounds, (r) => r.counts[s])])),
      carried: sum(rounds, (r) => r.carried),
      preExisting: sum(rounds, (r) => r.preExisting)
    },
    outcomes: {
      all: outcomeCounts(findings),
      blocking: outcomeCounts(findings.filter((f) => f.severity !== 'advisory')),
      advisory: outcomeCounts(findings.filter((f) => f.severity === 'advisory'))
    },
    // Replies that name no finding, such as a bare `Applied.`, so no finding can count them.
    unmatchedReplies: {
      applied: sum(reviewed, (t) => t.unmatchedReplies.filter((o) => o === 'applied').length),
      other: sum(reviewed, (t) => t.unmatchedReplies.filter((o) => o !== 'applied').length)
    },
    reasons: findings
      .filter((f) => f.outcome === 'disputed' || f.outcome === 'deferred')
      .map(({ outcome, reason }) => ({ outcome, reason }))
      .filter((r) => r.reason),
    months: months.map((month) => ({
      month,
      prs: reviewed.filter((t) => t.month === month).length,
      outcomes: outcomeCounts(reviewed.filter((t) => t.month === month).flatMap((t) => t.findings))
    })),
    perPr: reviewed.map((t) => ({
      number: t.number,
      state: t.state,
      verdicts: t.rounds.map((r) => (r.verdict === 'approve' ? 'A' : 'R')).join(''),
      blocking: sum(t.rounds, (r) => r.counts.blocking + r.counts.gate),
      advisory: sum(t.rounds, (r) => r.counts.advisory),
      carried: sum(t.rounds, (r) => r.carried)
    }))
  }
}

const outcomeRow = (label, counts) => `| ${label} | ${OUTCOMES.map((o) => counts[o]).join(' | ')} |`
const outcomeHeader = (first) => [
  `| ${first} | ${OUTCOMES.map((o) => o[0].toUpperCase() + o.slice(1)).join(' | ')} |`,
  `| --- | ${OUTCOMES.map(() => '---:').join(' | ')} |`
]

export const formatReport = (s, { since = null, byMonth = false } = {}) => {
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
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
    `- Requests for changes with no finding this script could read: ${s.rounds.unreadable}.`,
    '',
    '## Findings',
    '',
    '| Blocking | Gate | Advisory | Carried from an earlier round | Pre-existing |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${s.findings.blocking} | ${s.findings.gate} | ${s.findings.advisory} | ${s.findings.carried} | ${s.findings.preExisting} |`,
    '',
    '## Outcomes',
    '',
    ...outcomeHeader('Findings'),
    outcomeRow('Blocking and gate', s.outcomes.blocking),
    outcomeRow('Advisory', s.outcomes.advisory),
    outcomeRow('All', s.outcomes.all),
    '',
    `Replies that name no finding, and so count against none: ${s.unmatchedReplies.applied} applied, ${s.unmatchedReplies.other} not applied.`,
    ''
  ]
  if (byMonth) {
    lines.push(
      '## By month opened',
      '',
      ...outcomeHeader('Month (PRs)'),
      ...s.months.map((m) => outcomeRow(`${m.month} (${m.prs})`, m.outcomes)),
      ''
    )
  }
  if (s.reasons.length > 0) {
    lines.push(
      'Each disputed or deferred reason, to sort by hand into wrong, intentional, or did not matter:',
      '',
      ...s.reasons.map((r) => `- ${r.outcome}: ${r.reason}`),
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

export const parseArgs = (argv) => {
  const args = { repo: 'thebristolsound/birdbrain', since: null, byMonth: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') args.repo = argv[(i += 1)]
    else if (argv[i] === '--since') args.since = argv[(i += 1)]
    else if (argv[i] === '--by-month') args.byMonth = true
    else if (argv[i] === '--json') args.json = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo ?? '')) {
    throw new Error(`--repo takes owner/name, got "${args.repo}"`)
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
  const prs = gh('pr', 'list', '-R', args.repo, ...search, '--json', 'number,state,createdAt')
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
    args.json ? `${JSON.stringify(summary, null, 2)}\n` : formatReport(summary, args)
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
