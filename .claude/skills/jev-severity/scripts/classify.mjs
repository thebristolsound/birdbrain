// Classify an issue's findings by severity with Jev (TypeSafe System One), for triage.
// Reads the issue with `gh`, parses every findings table (a header row with a Sev column),
// falls back to the whole issue as one finding, and asks three questions per finding.
// The client is the jev-lens one (scripts/jev-lens/lib/jev.mjs); the question shapes follow
// https://docs.typesafe.ai/api.md as read on 2026-09-25.
//
// Usage: node classify.mjs <issue> [--repo o/r] [--dry-run] [--out <dir>]
//        node classify.mjs --file <markdown> [--dry-run] [--out <dir>]
// Env: TYPESAFE_API_KEY (required unless --dry-run), TYPESAFE_MODEL (default jev-latest).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cap, choice, createClient, mapPool, noul } from '../../../../scripts/jev-lens/lib/jev.mjs'

const BODY_CAP = 7000
const SEVERITIES = ['blocking', 'should-fix', 'polish']
const SEV_ALIASES = { b: 'blocking', s: 'should-fix', p: 'polish', blocker: 'blocking', 'should fix': 'should-fix' }

const PRODUCT =
  'Birdbrain is an open-source desktop tool for web investigators that captures web pages as evidence, keeps a signed chain of custody, verifies file integrity, and exports evidence packages meant to be checked by third parties and used in court. A false statement about evidence integrity, or evidence that cannot be verified, is the most serious class of defect. The app is in public beta.'

export const QUESTIONS = {
  severity: choice(
    {
      question: 'Rate the severity of `finding` for the current release, given `product`. Judge by the harm to a user, not by how hard the fix is.',
      product: PRODUCT
    },
    {
      blocking: 'Must be fixed before release: the app misreports evidence integrity, verification or export fails, data is read from the wrong place, or a core screen is unusable.',
      'should-fix': 'A real defect a user will notice and be misled or obstructed by, but with a workaround or limited reach. Fix soon after release.',
      polish: 'Cosmetic, wording, layout, keyboard-nicety or transient-state issues. No misleading claim about evidence, no lost work.'
    }
  ),
  evidence: noul(
    {
      question: 'Does `finding` affect the evidentiary reliability of the tool: what it stores, verifies, signs, exports, or what it tells the user about integrity, provenance or timestamps?',
      product: PRODUCT
    },
    {
      true: 'It changes, misreports or breaks evidence, verification, chain of custody, export packages, or timestamps shown as facts.',
      false: 'Purely UI, wording, layout, focus or navigation; evidence claims are unaffected.'
    }
  ),
  false_claim: noul(
    'Does `finding` cause the tool to assert something untrue to the user (for example calling intact evidence tampered, missing, or verified when it is not)?'
  )
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line)
const isRule = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
const norm = (h) => h.toLowerCase().replace(/[^a-z#]/g, '')
const COLUMNS = { id: ['#', 'id', 'no'], sev: ['sev', 'severity'], ev: ['ev', 'evidence'], finding: ['finding', 'title', 'description', 'summary'], where: ['where', 'location'], repro: ['repro', 'reproduce', 'steps'], seen: ['seen', 'source'] }

function columnMap(header) {
  const map = {}
  header.map(norm).forEach((h, i) => {
    for (const [key, names] of Object.entries(COLUMNS)) if (names.includes(h) && !(key in map)) map[key] = i
  })
  return 'sev' in map && 'finding' in map ? map : null
}

// Every row of every table whose header carries a severity column. A row whose ids were all
// seen already is a cross-reference (the same finding listed under a second screen) and is
// dropped, as is a row with an empty finding cell.
export function parseFindings(markdown) {
  const lines = markdown.split('\n')
  const findings = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i]) || !isRule(lines[i + 1] || '')) continue
    const map = columnMap(cells(lines[i]))
    if (!map) continue
    for (i += 2; i < lines.length && isRow(lines[i]); i++) {
      const c = cells(lines[i])
      const finding = c[map.finding] || ''
      const id = 'id' in map ? c[map.id] : String(findings.length + 1)
      const ids = id.split(/\s*,\s*/)
      if (!finding || ids.every((x) => seen.has(x))) continue
      ids.forEach((x) => seen.add(x))
      const sevRaw = (c[map.sev] || '').toLowerCase()
      findings.push({
        id,
        authorSeverity: SEV_ALIASES[sevRaw] || (SEVERITIES.includes(sevRaw) ? sevRaw : sevRaw || null),
        authorEvidence: 'ev' in map ? c[map.ev] : null,
        finding: finding.replace(/\*\*/g, ''),
        where: 'where' in map ? c[map.where] : null,
        repro: 'repro' in map ? c[map.repro] : null,
        seen: 'seen' in map ? c[map.seen] : null
      })
    }
  }
  return findings
}

const line = (r) => {
  const { severity, evidence, false_claim } = r.jev
  const moved = r.authorSeverity && r.authorSeverity !== severity.choice ? ` (author: ${r.authorSeverity})` : ''
  return `| ${r.id} | ${severity.confidence.toFixed(2)} | ${evidence.noul.toFixed(2)} | ${false_claim.noul.toFixed(2)} | ${r.finding.slice(0, 120)}${moved} |`
}

export function renderReport(label, results, usage) {
  const out = [`# Jev severity: ${label}`, '', `Model ${usage.model}, ${results.length} findings, ${usage.requests} requests.`, '']
  for (const bucket of SEVERITIES) {
    const rows = results.filter((r) => r.jev.severity.choice === bucket).sort((a, b) => b.jev.severity.confidence - a.jev.severity.confidence)
    out.push(`## ${bucket} (${rows.length})`, '', '| # | conf | evidence | false claim | finding |', '|---|---|---|---|---|', ...rows.map(line), '')
  }
  const moved = results.filter((r) => r.authorSeverity && r.authorSeverity !== r.jev.severity.choice)
  out.push(`## Disagreements with the author (${moved.length})`, '')
  for (const r of moved) out.push(`- #${r.id}: author ${r.authorSeverity}, Jev ${r.jev.severity.choice} at ${r.jev.severity.confidence.toFixed(2)}`)
  const soft = results.filter((r) => r.jev.severity.confidence < 0.5)
  if (soft.length) out.push('', `Low confidence (under 0.50): ${soft.map((r) => `#${r.id}`).join(', ')}. Treat these as coin flips.`)
  return out.join('\n') + '\n'
}

function args(argv) {
  const a = { repo: null, dryRun: false, out: null, file: null, issue: null }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--repo') a.repo = argv[++i]
    else if (v === '--dry-run') a.dryRun = true
    else if (v === '--out') a.out = argv[++i]
    else if (v === '--file') a.file = argv[++i]
    else if (/^\d+$/.test(v)) a.issue = v
    else throw new Error(`unknown argument ${v}`)
  }
  if (!a.issue && !a.file) throw new Error('give an issue number or --file <markdown>')
  return a
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const a = args(argv)
  let title, body, label
  if (a.file) {
    body = readFileSync(a.file, 'utf8')
    title = a.file
    label = a.file
  } else {
    const ghArgs = ['issue', 'view', a.issue, '--json', 'title,body']
    if (a.repo) ghArgs.push('--repo', a.repo)
    ;({ title, body } = JSON.parse(execFileSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 1 << 26 })))
    label = `#${a.issue}`
  }
  let findings = parseFindings(body)
  const mode = findings.length ? `${findings.length} table findings` : 'whole issue as one finding'
  if (!findings.length) findings = [{ id: a.issue || '1', authorSeverity: null, authorEvidence: null, finding: `${title}\n\n${cap(body, BODY_CAP)}`, where: null, repro: null, seen: null }]
  if (a.dryRun) {
    console.log(`${label}: ${mode}`)
    for (const f of findings) console.log(`${f.id}\t${f.authorSeverity ?? '-'}\t${f.authorEvidence ?? '-'}\t${f.finding.slice(0, 80).replace(/\n/g, ' ')}`)
    return 0
  }
  const outDir = a.out || join('/tmp/jev-severity', a.issue || createHash('sha256').update(a.file).digest('hex').slice(0, 8))
  const client = createClient({ apiKey: env.TYPESAFE_API_KEY, cacheDir: join(outDir, '.cache') })
  const results = await mapPool(findings, 4, async (f) => ({ ...f, jev: (await client.ask({ finding: f }, QUESTIONS)).answers }))
  mkdirSync(outDir, { recursive: true })
  const report = renderReport(label, results, client.usage)
  writeFileSync(join(outDir, 'report.md'), report)
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ label, mode, results, usage: client.usage }, null, 2))
  process.stdout.write(report)
  console.log(`Written: ${join(outDir, 'report.md')} and results.json`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1) })
}
