// B4 — Conventional-commit type from subject + file list. The post-commit-message linter checks
// shape only; this asks whether Jev could check the type is honest.
import { ask, choice, mapPool } from '../lib/jev.mjs'
import { commits } from '../lib/fixtures.mjs'
import { confusion } from '../lib/metrics.mjs'

const TYPES = {
  feat: 'adds user-facing capability', fix: 'corrects wrong behaviour', docs: 'documentation only', chore: 'tooling, deps, config, housekeeping with no product change',
  test: 'tests only', ci: 'CI workflows and pipeline scripts', refactor: 'restructures code without changing behaviour', perf: 'performance improvement'
}

export default async function run() {
  const set = commits().filter((c) => TYPES[c.type])
  const rows = await mapPool(set, 10, async (c) => {
    const r = await ask({ subject: c.subject, files: c.files.slice(0, 40) }, {
      type: choice('Which conventional-commit type fits this change? Judge from `subject` and `files`.', TYPES)
    })
    return { sha: c.sha.slice(0, 8), gold: c.type, pred: r.answers.type.choice, conf: r.answers.type.confidence, subject: c.subject.slice(0, 90) }
  })
  const highConf = rows.filter((r) => r.conf >= 0.8)
  return {
    summary: {
      all: confusion(rows.map((r) => ({ pred: r.pred, gold: r.gold }))),
      confidence_gte_0_8: { n: highConf.length, accuracy: highConf.length ? highConf.filter((r) => r.pred === r.gold).length / highConf.length : null },
      disagreements: rows.filter((r) => r.pred !== r.gold && r.conf >= 0.8).slice(0, 12)
    },
    rows
  }
}
