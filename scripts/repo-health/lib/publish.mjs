// Keeps one open issue holding the latest report. When two are open it rewrites
// the lower-numbered one and names the other in the run log.
//
// The pattern is .github/scripts/health/alert.sh with two differences. The issue
// never closes itself, because the next run reads last week's values out of its
// body, and a signal outside its budget is not an alarm. And a comment is posted
// only when a signal changes status, so a standing condition is one notification
// and a value that drifts inside its budget is none.
//
// `process` keeps the issue out of the dispatch frontier (ADR-0028), and the stale
// sweep closes only issues the machine account filed, which this is not: the
// workflow's own token writes it.
//
// A label is something anyone with triage access can put on any issue, and every
// workflow's token writes as github-actions[bot], the Health workflow's alert issue
// included. So an issue is the report only when it carries the label, that author,
// and the marker this file writes at the top of every body it sends.
//
// Everything a person can edit (the issue body) is read through decodeState,
// which accepts numbers and status names only. A failed read of the issue list
// throws: publishing a report that claims "no previous report" because the list
// could not be read would overwrite the trend with a lie.

import {
  decodeState,
  formatBudget,
  formatValue,
  renderMarkdown,
  statusChanges,
  titleOf
} from './report.mjs'

export const LABEL = 'repo-health'
const LABEL_COLOR = '0E8A16'
const LABEL_DESCRIPTION = 'The weekly repository health report; one open issue, rewritten each run'
const PROCESS_LABEL = 'process'
// The login GitHub gives anything written with a workflow's own token.
const AUTHOR = 'github-actions[bot]'
const LISTING = `issues?state=open&creator=${encodeURIComponent(AUTHOR)}&per_page=100`
export const REPORT_MARKER = '<!-- repo-health-report -->'

const detailOf = (signal) =>
  signal.value === null
    ? signal.reason
    : `${formatValue(signal.value, signal.unit)}, budget ${formatBudget(signal)}`

// The comment for a run whose statuses differ from the stored ones.
export const changeComment = ({ report, changes, runUrl }) => {
  const byId = new Map(report.signals.map((signal) => [signal.id, signal]))
  const lines = changes.map(
    ({ id, label, from, to }) =>
      `- **${label}:** ${from ?? 'new'} -> ${to} (${detailOf(byId.get(id))})`
  )
  return [
    `Status changed in the run of ${report.measuredAt}:`,
    '',
    ...lines,
    ...(runUrl ? ['', `Run: ${runUrl}`] : []),
    ''
  ].join('\n')
}

// The comment for a run that found the issue but could not read its state block.
// Saying nothing here would let a hand-edited body hide a week's crossings.
export const uncomparedComment = ({ report, reason, runUrl }) => {
  const attention = report.signals.filter((signal) => signal.status !== 'within')
  const lines = attention.map(
    (signal) => `- **${signal.label}:** ${signal.status} (${detailOf(signal)})`
  )
  return [
    `The run of ${report.measuredAt} could not compare with the previous report: ${reason}. ` +
      (attention.length > 0
        ? 'These signals need a look now, whether or not they did last week:'
        : 'Every signal is within its budget now.'),
    ...(lines.length > 0 ? ['', ...lines] : []),
    ...(runUrl ? ['', `Run: ${runUrl}`] : []),
    ''
  ].join('\n')
}

const hasLabel = (issue) =>
  Array.isArray(issue.labels) &&
  issue.labels.some((label) => (typeof label === 'string' ? label : label?.name) === LABEL)

const isReport = (issue) =>
  !issue?.pull_request &&
  Number.isInteger(issue?.number) &&
  issue.user?.login === AUTHOR &&
  hasLabel(issue) &&
  typeof issue.body === 'string' &&
  issue.body.startsWith(REPORT_MARKER)

// Every page of open issues the workflow token wrote, with the label read on each
// one. A label filter on the listing would read GitHub's search index, which
// lags a direct read (CLAUDE.md, "Issue tracker").
const openIssues = (gh, repo) => {
  const pages = gh(['--paginate', '--slurp', `repos/${repo}/${LISTING}`])
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Error('GitHub returned no issue list')
  }
  return pages
    .flat()
    .filter(isReport)
    .sort((a, b) => a.number - b.number)
}

const labelExists = (gh, repo) => {
  try {
    return gh([`repos/${repo}/labels/${LABEL}`])?.name === LABEL
  } catch {
    // A 404 and a failed read look the same from here. Creating the label next
    // settles it: that call succeeds, or fails loudly.
    return false
  }
}

// Works out what one run writes, then writes it unless dryRun. Returns the plan
// either way, with the state it compared against, so the caller can print both.
export const publish = ({ gh, repo, owner, report, runUrl = null, dryRun = true }) => {
  const issues = openIssues(gh, repo)
  const issue = issues[0] ?? null
  const { state, reason } = decodeState(issue?.body)
  const title = titleOf(report)
  const rendered = renderMarkdown(report, { state, stateReason: reason, runUrl })
  const body = `${REPORT_MARKER}\n${rendered}`
  const changes = statusChanges(report, state)

  const writes = []
  let comment = null
  if (issue === null) {
    if (!labelExists(gh, repo)) {
      writes.push({
        summary: `create the ${LABEL} label`,
        args: ['-X', 'POST', `repos/${repo}/labels`],
        payload: { name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION }
      })
    }
    writes.push({
      summary: `open the ${LABEL} issue`,
      args: ['-X', 'POST', `repos/${repo}/issues`],
      payload: { title, body, labels: [LABEL, PROCESS_LABEL], assignees: owner ? [owner] : [] }
    })
  } else {
    // The comment goes first. The rewrite stores this run's statuses, so a comment
    // that failed after it would never be posted: the next run would find nothing
    // changed. A rewrite that fails after the comment repeats the comment instead.
    if (state === null) comment = uncomparedComment({ report, reason, runUrl })
    else if (changes.length > 0) comment = changeComment({ report, changes, runUrl })
    if (comment !== null) {
      writes.push({
        summary: `comment on issue #${issue.number}`,
        args: ['-X', 'POST', `repos/${repo}/issues/${issue.number}/comments`],
        payload: { body: comment }
      })
    }
    writes.push({
      summary: `rewrite issue #${issue.number}`,
      args: ['-X', 'PATCH', `repos/${repo}/issues/${issue.number}`],
      payload: { title, body }
    })
  }

  if (!dryRun) {
    for (const write of writes) gh([...write.args, '--input', '-'], JSON.stringify(write.payload))
  }

  return {
    dryRun,
    issue: issue?.number ?? null,
    duplicates: issues.slice(1).map((other) => other.number),
    state,
    stateReason: reason,
    changes,
    commented: comment !== null,
    writes: writes.map((write) => write.summary)
  }
}
