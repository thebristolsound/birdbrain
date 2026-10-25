// The probe's output: a Markdown summary (terminal and the CI job summary), GitHub workflow
// annotations on the lines a finding names, and JSON.

import { describeMutant } from './mutants.mjs'

export const READING_GUIDE =
  'https://github.com/thebristolsound/birdbrain/blob/main/docs/agents/testing.md#test-reliability-probe'

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')

const count = (results, outcome) => results.filter((result) => result.outcome === outcome).length

export const survivors = (mutation) =>
  mutation?.results?.filter((result) => result.outcome === 'survived') ?? []

const revertSection = (revert) => {
  if (!revert) return ['### Revert probe', '', 'Not run (`--no-revert`).']
  if (revert.skipped) return ['### Revert probe', '', `Skipped: ${revert.skipped}.`]
  const lines = [
    '### Revert probe',
    '',
    `Reverted ${revert.sourcesReverted} source file(s) to the merge base and reran the ` +
      `${revert.testsChecked} passing test(s) the branch added or edited. ` +
      `${revert.findings.length} still pass without the change.`
  ]
  if (revert.failingAtHead > 0) {
    lines.push('', `${revert.failingAtHead} touched test(s) fail at HEAD and were not judged.`)
  }
  if (revert.findings.length > 0) {
    lines.push('', '| Test | Location |', '| --- | --- |')
    for (const { fullName, path, line } of revert.findings) {
      lines.push(`| ${cell(fullName)} | \`${path}:${line}\` |`)
    }
  }
  return lines
}

const mutationSection = (mutation) => {
  if (!mutation) return ['### Mutation probe', '', 'Not run (`--no-mutate`).']
  const { candidates, selected, results, files } = mutation
  if (candidates === 0) {
    return ['### Mutation probe', '', 'No mutation site on the changed source lines.']
  }
  const caught = count(results, 'killed') + count(results, 'timeout')
  const lines = [
    '### Mutation probe',
    '',
    `Probed ${selected} of ${candidates} mutation site(s) on the changed source lines: ` +
      `${count(results, 'survived')} survived, ${caught} caught, ` +
      `${count(results, 'not-run')} not run for time, ` +
      `${count(results, 'skipped') + count(results, 'no-tests')} skipped.`
  ]
  const live = survivors(mutation)
  if (live.length > 0) {
    lines.push('', '| Location | Mutation | Test files run |', '| --- | --- | --- |')
    for (const mutant of live) {
      lines.push(
        `| \`${mutant.path}:${mutant.line}\` | ${cell(describeMutant(mutant))} | ${mutant.tests} |`
      )
    }
  }
  const untested = files.filter(({ outcome }) => outcome === 'no-tests')
  if (untested.length > 0) {
    lines.push('', `No unit test imports: ${untested.map(({ path }) => `\`${path}\``).join(', ')}.`)
  }
  const red = files.filter(({ outcome }) => outcome === 'red-baseline')
  if (red.length > 0) {
    lines.push(
      '',
      `Not probed, because their tests fail before any mutation: ` +
        `${red.map(({ path }) => `\`${path}\``).join(', ')}.`
    )
  }
  if (count(results, 'not-run') > 0) {
    lines.push('', 'The time budget ran out before every selected mutant ran.')
  }
  return lines
}

export const renderMarkdown = ({ commit, base, revert, mutation, e2e }) => {
  const lines = [
    '## Test reliability probe',
    '',
    `Commit \`${commit}\`, merge base \`${base}\`. Advisory: this does not block a merge. ` +
      `[How to read it](${READING_GUIDE}).`,
    '',
    ...revertSection(revert),
    '',
    ...mutationSection(mutation)
  ]
  if (e2e.length > 0) {
    lines.push(
      '',
      '### End-to-end specs',
      '',
      `Not probed: ${e2e.map(({ path }) => `\`${path}\``).join(', ')}. ` +
        'The `test-reliability-reviewer` agent reads changed specs against their titles.'
    )
  }
  return `${lines.join('\n')}\n`
}

const escapeData = (value) => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (value) => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')

const annotation = ({ path, line, title, message }) =>
  `::warning file=${escapeProperty(path)},line=${line},title=${escapeProperty(title)}::${escapeData(message)}`

export const renderAnnotations = ({ revert, mutation }) => [
  ...(revert?.findings ?? []).map(({ path, line, fullName }) =>
    annotation({
      path,
      line,
      title: 'Test passes without the change',
      message: `"${fullName}" passes with the branch's source changes reverted.`
    })
  ),
  ...survivors(mutation).map((mutant) =>
    annotation({
      path: mutant.path,
      line: mutant.line,
      title: 'Surviving mutant',
      message: `${describeMutant(mutant)} and all ${mutant.tests} related test file(s) passed.`
    })
  )
]

export const renderJson = (result) =>
  JSON.stringify(result, (name, value) => (value instanceof Set ? [...value] : value), 2)
