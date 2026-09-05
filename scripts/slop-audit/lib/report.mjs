// Output for the slop audit: the JSON envelope consumers parse and the text a
// developer reads. Findings are sorted so two runs over the same tree print the
// same bytes. The envelope names the commit it describes and whether the tree had
// uncommitted edits, because the input is the working tree, not HEAD.

export const SCHEMA_VERSION = 1
export const SEVERITIES = ['blocking', 'advisory']

const compareFindings = (a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id)

export const buildEnvelope = ({
  commit,
  dirty,
  adapters = [],
  findings,
  skipped = [],
  stale = []
}) => {
  for (const finding of findings) {
    if (!SEVERITIES.includes(finding.severity)) {
      throw new Error(`${finding.id}: unknown severity "${finding.severity}"`)
    }
  }
  const sorted = [...findings].sort(compareFindings)
  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, sorted.filter((f) => f.severity === severity).length])
  )
  return {
    schemaVersion: SCHEMA_VERSION,
    commit,
    dirty,
    adapters,
    findings: sorted,
    skipped,
    stale,
    counts
  }
}

export const renderJson = (envelope) => JSON.stringify(envelope, null, 2)

export const renderText = (envelope) => {
  const lines = [`slop-audit: ${envelope.commit}${envelope.dirty ? ' (dirty working tree)' : ''}`]
  const byId = new Map()
  for (const finding of envelope.findings) {
    if (!byId.has(finding.id)) byId.set(finding.id, [])
    byId.get(finding.id).push(finding)
  }
  for (const [id, group] of byId) {
    lines.push(`${id} - ${group.length}`)
    for (const finding of group) {
      lines.push(
        `  ${finding.severity.padEnd(8)}  ${finding.file}:${finding.line}  ${finding.message}`
      )
      if (finding.evidence) lines.push(`      ${finding.evidence}`)
    }
  }
  for (const entry of envelope.skipped) lines.push(`skipped ${entry.name}: ${entry.reason}`)
  for (const entry of envelope.stale) lines.push(`stale allowlist entry: ${entry.id} ${entry.path}`)
  lines.push(
    `slop-audit: ${envelope.counts.blocking} blocking, ${envelope.counts.advisory} advisory`
  )
  return lines.join('\n')
}

export const exitCode = ({ envelope, strict }) => (strict && envelope.counts.blocking > 0 ? 1 : 0)
