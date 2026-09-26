// B10 — Select, don't generate: hide the file paths in a ready-for-agent issue, ask Jev which
// module the work starts in, score against the path the issue actually named.
import { ask, cap, choice, mapPool } from '../lib/jev.mjs'
import { issues } from '../lib/fixtures.mjs'
import { confusion } from '../lib/metrics.mjs'

const MODULES = {
  'extension/src': 'Chrome extension: capture, popup, options, background',
  'src/main/services': 'Electron main process services: capture ingest, DB, manifest, export, persona, settings',
  'src/main': 'Electron main entry, IPC handlers, window management',
  'src/shared': 'Types, schemas, verify core shared by main and renderer',
  'src/renderer/components': 'React UI components by feature (captures, notes, export, dashboard, settings, onboarding)',
  'src/renderer/lib': 'Renderer helpers and API client',
  'src/renderer/hooks': 'React hooks',
  'src/renderer/routes': 'TanStack routes',
  'src/verifier': 'Standalone verifier CLI',
  'src/packages': 'Deep-module packages (evidence package layout)',
  tests: 'Unit and component tests',
  e2e: 'Playwright end-to-end tests',
  '.github': 'CI workflows and pipeline scripts',
  '.claude': 'Agent skills, hooks and settings',
  scripts: 'Build, preflight, coverage and tooling scripts',
  docs: 'Specs, plans, ADRs, agent docs',
  website: 'Docs site (Next.js, MDX)',
  root: 'Repository root files: CLAUDE.md, CONTEXT.md, package.json, configs'
}
const PATH_RE = /(?:^|[\s`(])((?:extension|src|tests|e2e|\.github|\.claude|scripts|docs|website)\/[\w./@-]+|(?:CLAUDE|CONTEXT|AGENTS|README)\.md|package\.json)/g
const moduleOf = (p) => {
  const keys = Object.keys(MODULES).filter((k) => k !== 'root').sort((a, b) => b.length - a.length)
  return keys.find((k) => p === k || p.startsWith(k + '/')) || 'root'
}

export default async function run() {
  const set = []
  for (const i of issues()) {
    if (!i.labels.includes('ready-for-agent') || !i.body) continue
    const paths = [...i.body.matchAll(PATH_RE)].map((m) => m[1])
    if (!paths.length) continue
    set.push({ number: i.number, title: i.title, gold: moduleOf(paths[0]), body: i.body.replace(PATH_RE, ' [path]') })
  }
  const rows = await mapPool(set, 8, async (i) => {
    const r = await ask({ title: i.title, body: cap(i.body, 6000) }, {
      module: choice('File paths in `body` are redacted as [path]. In which module does the work described start?', MODULES)
    })
    const ranked = Object.entries(r.answers.module.probabilities).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    return { issue: i.number, gold: i.gold, pred: r.answers.module.choice, top3: ranked.slice(0, 3).includes(i.gold), conf: r.answers.module.confidence }
  })
  return {
    summary: { top1: confusion(rows.map((r) => ({ pred: r.pred, gold: r.gold }))), top3_accuracy: rows.filter((r) => r.top3).length / rows.length, n: rows.length },
    rows
  }
}
