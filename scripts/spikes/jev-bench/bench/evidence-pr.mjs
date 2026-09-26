// B1 — Evidence-affecting classification.
// Two sets. (A) whole merged PR: title + Summary + file list → noul "could alter an evidentiary
// result", scored against the human triage label, alongside the path-list backstop baseline
// (docs/specs/2026-07-31-evidence-affecting-paths-assessment.md). (B) per-file hunks from the
// incidental brushes the assessment names, where the right answer is known to be "no".
import { ask, cap, mapPool, noul, choice, sample } from '../lib/jev.mjs'
import { prs, diff, splitDiff, section } from '../lib/fixtures.mjs'
import { auc, bestThreshold, binary, calibration } from '../lib/metrics.mjs'

const DEFINITION =
  'An evidence-affecting change is a change to acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, or software distribution that can alter an evidentiary result or the interpretation of one. Birdbrain is a web-evidence capture tool: captures are hashed, chained in a signed manifest, timestamped, and exported as packages a third party verifies.'

// Blocking-tier include list, abbreviated to path prefixes (same document, section "Include list").
const BLOCKING = [
  'extension/src/background.ts', 'extension/src/content.ts', 'extension/src/toast.ts', 'extension/src/utils/api.ts',
  'extension/src/utils/headers.ts', 'extension/src/popup/', 'extension/src/messages.ts', 'extension/manifest.json',
  'src/main/services/captureServer.ts', 'src/shared/urlPatterns.ts', 'src/shared/urlCanonicalize.ts',
  'src/main/services/exclusionPolicy.ts', 'src/main/services/serverToken.ts', 'src/main/services/session.ts',
  'src/main/services/recapture.ts', 'src/main/services/backgroundRenderer.ts', 'src/main/services/consentBlocker.ts',
  'src/main/services/manifest.ts', 'src/main/services/signingKey.ts', 'src/main/services/timestamp.ts',
  'src/main/services/timestampWorker.ts', 'src/main/services/staging.ts', 'src/main/services/trustedTime.ts',
  'src/main/services/tsaTrust.ts', 'src/main/services/tlsCertChain.ts', 'src/main/services/installationId.ts',
  'src/shared/verify/', 'src/verifier/', 'src/main/index.ts', 'src/main/services/captureLifecycle.ts',
  'src/main/services/captureStore.ts', 'src/main/services/storage.ts', 'src/main/services/mhtmlDecoder.ts',
  'src/main/services/dataExtractor.ts', 'src/main/services/extraction/', 'src/main/services/db/',
  'src/main/services/selectorLifecycle.ts', 'src/main/services/safeRegex.ts', 'src/main/services/annotations.ts',
  'src/main/services/burnAnnotations.ts', 'src/main/services/renderAnnotationsSvg.ts',
  'src/main/services/noteAnchorResolver.ts', 'src/shared/noteDoc.ts', 'src/shared/noteAnchor.ts',
  'src/renderer/components/captures/annotation/', 'src/main/services/export.ts', 'src/main/services/pdfExport.ts',
  'src/main/services/reportHtml.ts', 'src/main/services/certification.ts', 'src/renderer/components/export/',
  'scripts/build-verifier.mjs', 'sea-config.json'
]
const backstopHit = (files) => files.some((f) => BLOCKING.some((b) => f.path === b || f.path.startsWith(b)))

const questions = {
  evidence_affecting: noul(
    { definition: DEFINITION, question: 'Could the change described by `title`, `summary` and `files` alter an evidentiary result or the interpretation of one?' },
    { true: 'The change can alter what a capture contains, how it is hashed, signed, timestamped, verified, redacted, exported or reported, or what a verifier or reader concludes from it.', false: 'The change cannot reach an evidentiary result: UI layout, copy, tests, docs, tooling, CI, refactors that preserve behaviour on evidence paths.' }
  ),
  area: choice('Which evidence area does the change touch most directly? Pick `none` when it touches no evidence path.', {
    none: 'no evidence path', acquisition: 'capture, extension, recapture, ingest', parsing_extraction: 'MHTML, text, IOC extraction',
    storage: 'capture bytes on disk, DB records', hashing_signing: 'hashes, manifest chain, signing key', trusted_time: 'RFC 3161, TSA',
    verification: 'verifier, verify core', redaction_annotation: 'annotations, redaction, burn-in', export_reporting: 'packages, reports, PDF, certification',
    distribution: 'build, packaging, release supply chain', ai_analysis: 'AI analysis features'
  })
}

export default async function run() {
  const all = prs().filter((p) => p.body && p.files.length)
  const ea = all.filter((p) => p.labels.includes('evidence-affecting'))
  const notEa = sample(all.filter((p) => !p.labels.includes('evidence-affecting')), 150)
  const set = [...ea, ...notEa]

  const rows = await mapPool(set, 8, async (p) => {
    const state = {
      title: p.title,
      summary: cap(section(p.body, 'Summary') || p.body, 2000),
      files: p.files.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`)
    }
    const r = await ask(state, questions)
    return { pr: p.number, p: r.answers.evidence_affecting.noul, label: p.labels.includes('evidence-affecting'), area: r.answers.area.choice, backstop: backstopHit(p.files) }
  })
  const backstopRows = rows.map((r) => ({ p: r.backstop ? 1 : 0, label: r.label }))

  // (B) hunks: incidental brushes → expected false; blocking-file hunks from labelled PRs → expected true.
  const hunkCases = []
  for (const n of [786, 455, 357, 478]) {
    for (const f of splitDiff(diff(n))) if (BLOCKING.some((b) => f.path === b || f.path.startsWith(b))) hunkCases.push({ pr: n, path: f.path, text: f.text, label: false })
  }
  for (const p of ea.filter((p) => diff(p.number)).slice(0, 8)) {
    for (const f of splitDiff(diff(p.number))) if (BLOCKING.some((b) => f.path === b || f.path.startsWith(b)) && !/\.test\./.test(f.path)) hunkCases.push({ pr: p.number, path: f.path, text: f.text, label: true })
  }
  const hunkRows = await mapPool(hunkCases, 8, async (h) => {
    const r = await ask({ path: h.path, diff: cap(h.text, 14000) }, {
      touches_evidence: noul({ definition: DEFINITION, question: 'Do the changed lines in `diff` alter behaviour that can change an evidentiary result or its interpretation? Judge the changed lines, not the file they live in.' },
        { true: 'A changed line alters capture content, hashing, manifest, signing, timestamping, verification, redaction, export or report output.', false: 'The changed lines are cosmetic, UI wiring, comments, logging, tests, or a refactor that keeps evidence behaviour identical.' })
    })
    return { pr: h.pr, path: h.path, p: r.answers.touches_evidence.noul, label: h.label }
  })

  return {
    summary: {
      whole_pr_vs_label: { jev_at_0_5: binary(rows), jev_best: bestThreshold(rows), auc: auc(rows), backstop: binary(backstopRows) },
      calibration: calibration(rows),
      hunks: { at_0_5: binary(hunkRows), auc: auc(hunkRows) },
      // The four incidental brushes: what did Jev say per file? (lower is better)
      incidental: hunkRows.filter((h) => !h.label).map((h) => ({ pr: h.pr, path: h.path, p: Number(h.p.toFixed(2)) }))
    },
    rows, hunkRows
  }
}
