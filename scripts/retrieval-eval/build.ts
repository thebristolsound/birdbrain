/**
 * Builds the synthetic evaluation Case and measures Case search on it
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10, step 1).
 *
 * The Case is produced by the product's own pipeline, as the demo fixture is:
 * the target pages under `pages/` and the generated filler pages are served to
 * a real Chromium window over an intercepted https scheme, saved as MHTML, and
 * ingested through `ingestMhtmlCapture`. The extraction the app runs after an
 * ingest runs here too, because `ingestMhtmlCapture` alone does not run it.
 * Every page is fictional; see `targets.ts`.
 *
 * Run it with `pnpm eval:retrieval`, which bundles this file and hands it to
 * Electron. `--eval-captures=<n>` sets the Case size (target pages included),
 * and `--eval-phase=build|measure|all` runs one half: `measure` re-reads the
 * profile a previous `build` left in `out/retrieval-eval/profile`, so a later
 * slice can be measured on the same Case. The report lands in
 * `out/retrieval-eval/report.md` and `report.json`.
 */

import { app, BrowserWindow, session } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { performance } from 'perf_hooks'
import { fileURLToPath } from 'url'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import { initSettings, updateSettings } from '@main/services/settings'
import { getInstallationId, initInstallationId } from '@main/services/installationId'
import { initSigningKey } from '@main/services/signingKey'
import { initStorage } from '@main/services/storage'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import { extractData } from '@main/services/dataExtractor'
import { uploadToStaging } from '@main/services/staging'
import { fillerPage } from './filler'
import { QUERIES } from './queries'
import {
  percentile,
  renderReport,
  scoreQuery,
  type EvalReport,
  type IndexSize,
  type PathAnswer,
  type PathLatency,
  type ScoredQuery
} from './score'
import { POOLED_FILE, TARGET_PAGES, type TargetKey } from './targets'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const PAGES_DIR = join(HERE, 'pages')
const OUT_DIR = join(REPO_ROOT, 'out', 'retrieval-eval')
const PROFILE_DIR = join(OUT_DIR, 'profile')
const CASE_FILE = join(OUT_DIR, 'case.json')

const PARTITION = 'retrieval-eval'
const OPERATOR_NAME = 'Retrieval evaluation'
const CASE_NAME = 'Retrieval evaluation (synthetic)'
// A default for a quick run. The size the baseline is measured at is the
// maintainer's open question in the plan.
const DEFAULT_CAPTURES = 200
// One share of filler pages gets a Note, so the unreviewed count is not the
// whole Case. The target pages' own annotation is fixed in targets.ts.
const FILLER_NOTE_SHARE = 0.3
const SELECTOR_PATTERN = 'Workshop open day'
const TIMED_RUNS = 20
const INCREMENTAL_SAMPLES = 20

app.disableHardwareAcceleration()
app.setPath('userData', join(OUT_DIR, 'electron'))
app.on('window-all-closed', () => {})

function log(message: string): void {
  process.stdout.write(`[retrieval-eval] ${message}\n`)
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

interface CaseRecord {
  caseId: string
  captures: number
  fillers: number
  /** Capture id to target key, for the target pages only. */
  targets: Record<string, TargetKey>
  /** Capture URL to target key, for the extracted-data search, which answers with URLs. */
  targetUrls: Record<string, TargetKey>
}

async function openProfile(fresh: boolean): Promise<void> {
  if (fresh) rmSync(PROFILE_DIR, { recursive: true, force: true })
  mkdirSync(PROFILE_DIR, { recursive: true })
  await initDatabase(join(PROFILE_DIR, 'birdbrain.db'))
  initSettings(PROFILE_DIR)
  updateSettings({ operatorName: OPERATOR_NAME, operatorRole: '', operatorOrganization: '' })
  initInstallationId(PROFILE_DIR)
  // A throwaway profile under out/, so there is nothing for the OS credential
  // store to protect and the run stays non-interactive.
  initSigningKey(PROFILE_DIR, {
    isEncryptionAvailable: () => false,
    confirmUnprotectedKey: () => true
  })
  initStorage(join(PROFILE_DIR, 'captures'))
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

function bufferStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf))
      controller.close()
    }
  })
}

interface Rendered {
  mhtml: Buffer
  text: string
  title: string
  userAgent: string
}

async function render(win: BrowserWindow, url: string, scratch: string): Promise<Rendered> {
  await win.loadURL(url)
  const mhtmlPath = join(scratch, 'page.mhtml')
  await win.webContents.savePage(mhtmlPath, 'MHTML')
  const text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
  return {
    mhtml: readFileSync(mhtmlPath),
    text,
    title: win.webContents.getTitle(),
    userAgent: win.webContents.getUserAgent()
  }
}

async function build(size: number): Promise<CaseRecord> {
  if (size < TARGET_PAGES.length) {
    throw new Error(`--eval-captures must be at least ${TARGET_PAGES.length}, the target pages`)
  }
  await openProfile(true)
  const scratch = join(OUT_DIR, 'scratch')
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const evalCase = caseRepo.createCase({
    name: CASE_NAME,
    description: 'Synthetic Case for the retrieval evaluation. Every page in it is fictional.',
    type: 'custom'
  })

  const fillerCount = size - TARGET_PAGES.length
  const pages = [
    ...TARGET_PAGES.map((target) => ({
      url: target.url,
      html: readFileSync(join(PAGES_DIR, target.file), 'utf-8'),
      target
    })),
    ...Array.from({ length: fillerCount }, (_, index) => ({ ...fillerPage(index), target: null }))
  ]
  const htmlByUrl = new Map(pages.map((page) => [withoutTrailingSlash(page.url), page.html]))
  session.fromPartition(PARTITION).protocol.handle('https', (request) => {
    const html = htmlByUrl.get(withoutTrailingSlash(request.url))
    if (html === undefined) return new Response('Not found', { status: 404 })
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })

  // One hidden window for every page: the pages carry no scripts, and neither
  // savePage nor innerText needs the window on a display.
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: PARTITION
    }
  })

  const record: CaseRecord = {
    caseId: evalCase.id,
    captures: pages.length,
    fillers: fillerCount,
    targets: {},
    targetUrls: {}
  }
  const texts: Array<{ captureId: string; text: string }> = []
  const startedAt = performance.now()
  try {
    for (const [index, page] of pages.entries()) {
      const rendered = await render(win, page.url, scratch)
      const { capture } = await ingestMhtmlCapture(
        {
          caseId: evalCase.id,
          url: page.url,
          title: rendered.title,
          timestamp: new Date().toISOString(),
          stream: bufferStream(rendered.mhtml),
          textContent: rendered.text,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          browserVersion: process.versions.chrome,
          userAgent: rendered.userAgent,
          httpStatus: 200,
          operatorId: getInstallationId(),
          operatorName: OPERATOR_NAME,
          toolVersion: app.getVersion()
        },
        // Fictional hosts have no certificate to fetch.
        async () => null
      )
      // What runDataExtraction does after an app ingest.
      const html = readExtractionHtml(evalCase.id, capture.id)
      if (html) {
        extractedDataRepo.insertExtractedData(capture.id, evalCase.id, page.url, extractData(html))
      }
      texts.push({ captureId: capture.id, text: rendered.text })

      const annotated = page.target
        ? page.target.annotated
        : (index * 2654435761) % 1000 < FILLER_NOTE_SHARE * 1000
      if (annotated) {
        noteRepo.createNote({
          caseId: evalCase.id,
          captureId: capture.id,
          title: 'Read',
          body: 'Read this page; nothing new.'
        })
      }
      if (page.target) {
        record.targets[capture.id] = page.target.key
        record.targetUrls[page.url] = page.target.key
      }
      if ((index + 1) % 50 === 0) log(`ingested ${index + 1} of ${pages.length}`)
    }
  } finally {
    win.destroy()
  }
  log(`ingested ${pages.length} pages in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`)

  const selector = selectorRepo.createSelector({
    caseId: evalCase.id,
    pattern: SELECTOR_PATTERN,
    label: 'Open day',
    isRegex: false
  })
  selectorRepo.matchSelectorAgainstCaptures(selector.id, texts)

  const pooledPath = join(scratch, POOLED_FILE.name)
  writeFileSync(pooledPath, POOLED_FILE.text)
  await uploadToStaging(evalCase.id, [pooledPath])

  writeFileSync(CASE_FILE, `${JSON.stringify(record, null, 2)}\n`)
  rmSync(scratch, { recursive: true, force: true })
  return record
}

interface SearchPath {
  name: string
  answer: (query: string) => PathAnswer
}

function uniqueKeys(keys: Array<TargetKey | undefined>): TargetKey[] {
  return [...new Set(keys.filter((key): key is TargetKey => key !== undefined))]
}

function searchPaths(record: CaseRecord): SearchPath[] {
  return [
    {
      // The search bar's Capture results (`search:query`).
      name: 'Case search',
      answer: (query) => {
        const captures = captureRepo.searchCaptures(query, record.caseId)
        return {
          ranked: uniqueKeys(captures.map((capture) => record.targets[capture.id])),
          returned: captures.length
        }
      }
    },
    {
      // The Data screen's search over extracted values (`extractedData:search`). It
      // answers with values and the URLs they came from, in value order, not by rank.
      name: 'Data search',
      answer: (query) => {
        const rows = extractedDataRepo.searchExtractedData(record.caseId, query)
        return {
          ranked: uniqueKeys(
            rows.flatMap((row) => row.sourceUrls.map((u) => record.targetUrls[u]))
          ),
          returned: rows.length
        }
      }
    }
  ]
}

function attempt(path: SearchPath, query: string): PathAnswer {
  try {
    return path.answer(query)
  } catch (err) {
    return { ranked: [], returned: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

function timeMs(fn: () => unknown): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

function indexSizes(): IndexSize[] {
  return getDb()
    .prepare(
      `SELECT name, SUM(pgsize) AS bytes FROM dbstat
        WHERE name LIKE 'captures_fts%' OR name = 'capture_texts'
           OR name LIKE 'extracted_data%'
        GROUP BY name ORDER BY name`
    )
    .all() as IndexSize[]
}

function unreviewedCaptureIds(caseId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id FROM exhibits e
        WHERE e.case_id = ? AND e.kind = 'capture'
          AND NOT EXISTS (SELECT 1 FROM selector_matches m WHERE m.capture_id = e.id)
          AND NOT EXISTS (
            SELECT 1 FROM notes n
             WHERE n.case_id = e.case_id AND n.deleted_at IS NULL
               AND (n.capture_id = e.id OR instr(COALESCE(n.anchor_json, ''), e.id) > 0))
          AND NOT EXISTS (
            SELECT 1 FROM note_references r JOIN notes n ON n.id = r.note_id
             WHERE r.target_type = 'capture' AND r.target_id = e.id AND n.deleted_at IS NULL)`
    )
    .all(caseId) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

function measure(record: CaseRecord): EvalReport {
  const paths = searchPaths(record)
  const scored: ScoredQuery[] = []
  const latency: PathLatency[] = []
  for (const path of paths) {
    const samples: number[] = []
    for (const query of QUERIES) {
      const answer = attempt(path, query.text)
      scored.push(scoreQuery(query, path.name, answer))
      if (answer.error) continue
      for (let run = 0; run < TIMED_RUNS; run += 1) {
        samples.push(timeMs(() => path.answer(query.text)))
      }
    }
    latency.push({
      path: path.name,
      medianMs: percentile(samples, 50),
      p95Ms: percentile(samples, 95),
      samples: samples.length
    })
  }

  const db = getDb()
  const fullRebuildMs = timeMs(() =>
    db.exec("INSERT INTO captures_fts(captures_fts) VALUES ('rebuild')")
  )
  // An UPDATE fires capture_texts_au, which deletes and re-inserts the row's
  // index entries: the incremental cost of one Capture's text.
  const reindex = db.prepare('UPDATE capture_texts SET content = content WHERE capture_id = ?')
  const sampleIds = (
    db
      .prepare('SELECT capture_id FROM capture_texts ORDER BY id LIMIT ?')
      .all(INCREMENTAL_SAMPLES) as Array<{ capture_id: string }>
  ).map((row) => row.capture_id)
  const incremental = sampleIds.map((id) => timeMs(() => reindex.run(id)))

  const unreviewed = unreviewedCaptureIds(record.caseId)
  return {
    generatedAt: new Date().toISOString(),
    toolVersion: app.getVersion(),
    captures: record.captures,
    targets: TARGET_PAGES.length,
    fillers: record.fillers,
    queries: QUERIES,
    scored,
    latency,
    indexSizes: indexSizes(),
    fullRebuildMs,
    incrementalMedianMs: percentile(incremental, 50),
    unreviewedCaptures: unreviewed.length,
    unreviewedTargets: unreviewed.flatMap((id) => record.targets[id] ?? [])
  }
}

async function run(): Promise<void> {
  const phase = argValue('eval-phase') ?? 'all'
  if (!['build', 'measure', 'all'].includes(phase)) {
    throw new Error(`--eval-phase must be build, measure or all, not ${phase}`)
  }
  const size = Number(argValue('eval-captures') ?? DEFAULT_CAPTURES)
  if (!Number.isInteger(size)) throw new Error('--eval-captures must be a whole number')
  mkdirSync(OUT_DIR, { recursive: true })

  let record: CaseRecord
  if (phase === 'measure') {
    await openProfile(false)
    record = JSON.parse(readFileSync(CASE_FILE, 'utf-8')) as CaseRecord
  } else {
    record = await build(size)
  }
  if (phase !== 'build') {
    const report = measure(record)
    const markdown = renderReport(report)
    writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(OUT_DIR, 'report.md'), markdown)
    process.stdout.write(`${markdown}\n`)
  }
  closeDatabase()
}

app.whenReady().then(
  () =>
    run().then(
      () => app.exit(0),
      (err: unknown) => {
        process.stderr.write(`[retrieval-eval] FAILED: ${String(err)}\n`)
        app.exit(1)
      }
    ),
  (err: unknown) => {
    process.stderr.write(`[retrieval-eval] FAILED: ${String(err)}\n`)
    process.exit(1)
  }
)
