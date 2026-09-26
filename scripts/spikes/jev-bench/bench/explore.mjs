// Exploratory lenses with no ground truth: the output is a ranked list a human reads, not a score.
//  (a) needs-triage backlog under the ADR-0028 filing rule: user-visible? evidence-affecting? process?
//  (b) plain-language top layer of agent PR bodies: could a reader outside the repo follow it?
//  (c) commit subjects that oversell: does the subject promise more than the file list delivers?
import { ask, cap, mapPool, noul, score } from '../lib/jev.mjs'
import { issues, prs, commits } from '../lib/fixtures.mjs'

export default async function run() {
  const triage = issues().filter((i) => i.labels.includes('needs-triage') && i.state === 'OPEN' && i.body)
  const triageRows = await mapPool(triage, 8, async (i) => {
    const r = await ask({ title: i.title, body: cap(i.body, 5000) }, {
      user_visible: noul('Would a person using the desktop app or Chrome extension notice this defect or feature?'),
      evidence: noul('Could this change what a capture contains, how it is hashed, signed, timestamped, verified, exported or reported?'),
      process: noul('Is this about the agent pipeline itself (dispatch, gates, CI workflows, ADRs, skills) rather than the product?'),
      severity: score('If this is a defect, how bad is it for an investigator relying on the tool?', [
        'Cosmetic or no defect', 'Annoyance with a workaround', 'Blocks a task', 'Wrong or lost evidence, or a false verification result'
      ])
    })
    const a = r.answers
    return { issue: i.number, title: i.title.slice(0, 70), user_visible: +a.user_visible.noul.toFixed(2), evidence: +a.evidence.noul.toFixed(2), process: +a.process.noul.toFixed(2), severity: +a.severity.score.toFixed(2) }
  })
  triageRows.sort((a, b) => b.severity - a.severity || b.evidence - a.evidence)

  const agentPrs = prs().filter((p) => (p.labels.includes('agent-authored') || p.labels.includes('agent-pr')) && p.body).slice(0, 40)
  const topLayer = (body) => body.split('<details>')[0].replace(/^Closes #\d+\s*/m, '').trim()
  const prRows = await mapPool(agentPrs, 8, async (p) => {
    const r = await ask({ text: cap(topLayer(p.body), 3000) }, {
      outsider: noul('Could a reader who has never seen this repository follow `text` without looking anything up? Paths, code identifiers, commit ids, tool names and repository-specific jargon make the answer no.'),
      jargon: score('How much repository-specific jargon does `text` carry?', ['Plain language throughout', 'One or two terms an outsider would not know', 'Several such terms', 'Reads as internal notes'])
    })
    return { pr: p.number, outsider: +r.answers.outsider.noul.toFixed(2), jargon: +r.answers.jargon.score.toFixed(2) }
  })
  prRows.sort((a, b) => a.outsider - b.outsider)

  const cs = commits().filter((c) => c.type === 'feat' || c.type === 'fix')
  const commitRows = await mapPool(cs, 10, async (c) => {
    const r = await ask({ subject: c.subject, files: c.files.slice(0, 40) }, {
      oversell: noul('Does `subject` promise a broader change than `files` could plausibly deliver?')
    })
    return { sha: c.sha.slice(0, 8), subject: c.subject.slice(0, 80), files: c.files.length, oversell: +r.answers.oversell.noul.toFixed(2) }
  })
  commitRows.sort((a, b) => b.oversell - a.oversell)

  return {
    summary: {
      needs_triage: { n: triageRows.length, process_over_0_5: triageRows.filter((r) => r.process > 0.5).length, evidence_over_0_5: triageRows.filter((r) => r.evidence > 0.5).length, top10_by_severity: triageRows.slice(0, 10) },
      pr_top_layer: { n: prRows.length, outsider_under_0_5: prRows.filter((r) => r.outsider < 0.5).length, least_readable: prRows.slice(0, 8) },
      commit_oversell: { n: commitRows.length, top8: commitRows.slice(0, 8) }
    },
    rows: { triageRows, prRows, commitRows }
  }
}
