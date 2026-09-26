// B2 — Evidence impact claims vs the diff (citation-check pattern).
// Real bullets from merged PRs are taken as supported (they passed human review). A mutated copy
// of each bullet, negated by a small rule set, is labelled contradicted. One hand-labelled hard
// case: the PR #1569 docblock claim that its fix commit (78b7b789) called false.
import { ask, cap, choice, mapPool, noul } from '../lib/jev.mjs'
import { prs, diff, splitDiff, section } from '../lib/fixtures.mjs'
import { auc, binary, bestThreshold, confusion } from '../lib/metrics.mjs'

const MUTATIONS = [
  [/:\s*none\b/i, ': the package hash recipe and the manifest chain'],
  [/\bunchanged\b/, 'changed'],
  [/\bnever\b/, 'always'],
  [/\bpreserved[^:]*:\s*yes\b/i, (m) => m.replace(/yes$/i, 'no')],
  [/\bstill verif(y|ies)\b/, 'no longer verif$1'],
  [/\bdoes not\b/, 'does'],
  [/\bonly when\b/, 'even when'],
  [/\bno new\b/, 'a new']
]
const mutate = (s) => {
  for (const [re, rep] of MUTATIONS) if (re.test(s)) return s.replace(re, rep)
  return null
}

const bullets = (body) => section(body, 'Evidence impact').split(/\n(?=- )/).map((s) => s.trim()).filter((s) => s.startsWith('- ')).slice(0, 4)

// Diff context: files named in the claim first, then the rest, within a character budget.
const diffFor = (n, claim, budget = 70000) => {
  const files = splitDiff(diff(n)).filter((f) => !/pnpm-lock|\.snap$/.test(f.path))
  const named = (f) => claim.includes(f.path.split('/').pop().replace(/\.(ts|tsx|mjs)$/, ''))
  files.sort((a, b) => Number(named(b)) - Number(named(a)))
  let out = '', used = 0
  for (const f of files) {
    const t = cap(f.text, Math.max(2000, Math.floor((budget - used) / 2)))
    if (used + t.length > budget) break
    out += t + '\n'
    used += t.length
  }
  return out
}

const questions = {
  relation: choice('How does `diff` relate to `claim`, a statement from the pull request body describing the change?', {
    supports: 'The diff shows what the claim says; the claim is true of the change.',
    contradicts: 'The diff shows the opposite of what the claim says, or the claim asserts something the diff changes.',
    not_covered: 'The diff neither supports nor contradicts the claim; the claim is about something outside the diff.'
  }),
  claim_true: noul('Is `claim` an accurate description of the change in `diff`?')
}

export default async function run() {
  const cases = []
  for (const p of prs().filter((p) => diff(p.number) && /### Evidence impact/.test(p.body)).slice(0, 40)) {
    for (const b of bullets(p.body)) {
      cases.push({ pr: p.number, kind: 'original', claim: b, gold: 'supports' })
      const m = mutate(b)
      if (m) cases.push({ pr: p.number, kind: 'mutated', claim: m, gold: 'contradicts' })
    }
  }
  const rows = await mapPool(cases, 6, async (c) => {
    const r = await ask({ claim: c.claim, diff: diffFor(c.pr, c.claim) }, questions)
    return { pr: c.pr, kind: c.kind, gold: c.gold, pred: r.answers.relation.choice, conf: r.answers.relation.confidence, p_true: r.answers.claim_true.noul, claim: c.claim.slice(0, 160) }
  })
  const nrows = rows.map((r) => ({ p: r.p_true, label: r.gold === 'supports' }))

  // Hard case: the #1569 docblock defended a predicate as "the intersection of every candidate
  // answer"; the fix commit says it was the intersection of none. Code excerpt, not the diff.
  const hard = await ask(
    {
      claim: 'Requiring all of a note\'s capture pointers to sit inside the selection is the intersection of every candidate answer to the open scope question (attachment by the notes.capture_id column, or attachment by the anchor\'s captureId), so this predicate can never ship a note that the answer, once given, would have withheld.',
      context: 'Maintainer correction of 2026-08-31: attachment is the notes.capture_id column. The anchor may only withhold a note, never attach it. A note with no capture_id is withheld whatever its anchor says.',
      code: 'function noteTravelsWithSelection(note, selectedCaptureIds) {\n  const pointers = noteCaptureIds(note) // capture_id plus every anchor captureId\n  return pointers.length > 0 && pointers.every((id) => selectedCaptureIds.has(id))\n}'
    },
    { relation: questions.relation, claim_true: noul('Given `context`, is `claim` an accurate description of `code`?') }
  )

  return {
    summary: {
      relation_choice: confusion(rows.map((r) => ({ pred: r.pred, gold: r.gold }))),
      claim_true_noul: { at_0_5: binary(nrows), best: bestThreshold(nrows), auc: auc(nrows) },
      by_kind: Object.fromEntries(['original', 'mutated'].map((k) => [k, confusion(rows.filter((r) => r.kind === k).map((r) => ({ pred: r.pred, gold: r.gold })))])),
      hard_case_1569: { expected: 'contradicts', got: hard.answers.relation.choice, probabilities: hard.answers.relation.probabilities, claim_true: hard.answers.claim_true.noul }
    },
    rows
  }
}
