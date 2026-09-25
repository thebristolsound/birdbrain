// B3 — The ready-for-agent bar (docs/agents/triage-labels.md) as four Nouls plus a routing
// Choice, scored against the labels a human applied. Also the `process` label (ADR-0028):
// can Jev tell pipeline work from product work?
import { ask, cap, choice, mapPool, noul, sample } from '../lib/jev.mjs'
import { issues } from '../lib/fixtures.mjs'
import { auc, binary, bestThreshold, calibration, confusion } from '../lib/metrics.mjs'

const questions = {
  acceptance: noul('Does the issue state acceptance criteria: observable outcomes a reader could verify, not "improve" or "clean up"?',
    { true: 'Concrete, checkable outcomes are listed; two readers would agree whether a change closes it.', false: 'Outcome is vague, aspirational, or absent.' }),
  verification: noul('Does the issue name how to prove the change works: specific commands, a test to run, or a manual check to perform?'),
  starting_files: noul('Does the issue name the files or modules where the work begins?'),
  evidence_call: noul('Does the issue state explicitly whether or not it is evidence-affecting (a change to capture, hashing, signing, verification, export, reporting or similar)?'),
  route: choice('Given the four properties above and the issue content, which triage label fits?', {
    'ready-for-agent': 'Fully specified: acceptance criteria, verification path, starting files, evidence call all present. An unattended coding agent could complete it.',
    'ready-for-human': 'Needs judgement, design, product decisions, credentials, external accounts, or discovery an unattended agent cannot do.',
    'needs-info': 'Cannot be worked until the reporter supplies missing facts.'
  }),
  process: noul('Is this issue about the agent pipeline itself (dispatch, review gates, ADRs, CI workflows, Vale, skills, agent instructions) rather than about the product a user runs?')
}

export default async function run() {
  const all = issues().filter((i) => i.body)
  const rfa = sample(all.filter((i) => i.labels.includes('ready-for-agent') && !i.labels.includes('ready-for-human')), 60, 3)
  const rfh = sample(all.filter((i) => i.labels.includes('ready-for-human') && !i.labels.includes('ready-for-agent')), 60, 3)
  const ni = all.filter((i) => i.labels.includes('needs-info'))
  const set = [...rfa, ...rfh, ...ni]
  const gold = (i) => (i.labels.includes('ready-for-agent') ? 'ready-for-agent' : i.labels.includes('ready-for-human') ? 'ready-for-human' : 'needs-info')

  const rows = await mapPool(set, 8, async (i) => {
    const r = await ask({ title: i.title, body: cap(i.body, 7000), labels_hint: 'none' }, questions)
    const a = r.answers
    return {
      issue: i.number, gold: gold(i), pred: a.route.choice, conf: a.route.confidence,
      bar: [a.acceptance.noul, a.verification.noul, a.starting_files.noul, a.evidence_call.noul].map((x) => Number(x.toFixed(2))),
      process: a.process.noul, isProcess: i.labels.includes('process')
    }
  })
  const barRows = rows.map((r) => ({ p: Math.min(...r.bar), label: r.gold === 'ready-for-agent' }))
  const procRows = rows.map((r) => ({ p: r.process, label: r.isProcess }))
  return {
    summary: {
      route_choice: confusion(rows.map((r) => ({ pred: r.pred, gold: r.gold }))),
      bar_min_of_four_vs_rfa: { at_0_5: binary(barRows), best: bestThreshold(barRows), auc: auc(barRows), calibration: calibration(barRows) },
      process_label: { at_0_5: binary(procRows), auc: auc(procRows), n_process: procRows.filter((r) => r.label).length }
    },
    rows
  }
}
