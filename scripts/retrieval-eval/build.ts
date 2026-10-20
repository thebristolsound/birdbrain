/**
 * Builds the synthetic evaluation Case and measures Case search on it
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10, steps 1 and 6).
 *
 * The Case is produced by the product's own pipeline, as the demo fixture is:
 * the target pages under `pages/` and the generated filler pages are served to
 * a real Chromium window over an intercepted https scheme, saved as MHTML, and
 * ingested through `ingestMhtmlCapture`. The extraction and the field build the
 * app runs after an ingest run here too, because `ingestMhtmlCapture` alone
 * runs neither. Every page is fictional; see `targets.ts`.
 *
 * Run it with `pnpm eval:retrieval`, which bundles this file and hands it to
 * Electron. `--eval-captures=<n>` sets the Case size (target pages included),
 * and `--eval-phase=build|measure|all` runs one half: `measure` re-reads the
 * profile a previous `build` left in `out/retrieval-eval/profile`, so a later
 * slice can be measured on the same Case. The report lands in
 * `out/retrieval-eval/report.md` and `report.json`; a `measure` run over the
 * Case the last report measured keeps that report's latency as an earlier pass.
 * `--eval-phase=revision-cost` times the Case revision triggers on copies of
 * that profile (`revisionCost.ts`).
 */

import { app, BrowserWindow, session } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { performance } from 'perf_hooks'
import { fileURLToPath } from 'url'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as searchFieldRepo from '@main/services/db/searchFieldRepo'
import { listUnreviewedCaptures } from '@main/services/db/unreviewedRepo'
import { buildExhibitFields, rebuildAllFields } from '@main/services/search/fieldIndex'
import { checkFieldHit } from '@main/services/investigation/claimCheck'
import type { ClaimCheck } from '@shared/investigation'
import { initSettings, updateSettings } from '@main/services/settings'
import { getInstallationId, initInstallationId } from '@main/services/installationId'
import { initSigningKey } from '@main/services/signingKey'
import { initStorage } from '@main/services/storage'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import { extractData } from '@main/services/dataExtractor'
import { FIELD_EXTRACTOR_VERSION } from '@main/services/search/fieldExtractor'
import { uploadToStaging } from '@main/services/staging'
import { fillerPage } from './filler'
import { QUERIES } from './queries'
import {
  FIELD_SEARCH,
  measureUnreviewed,
  percentile,
  rankedKeys,
  renderReport,
  scoreQuery,
  spread,
  tallyChecks,
  type CheckTally,
  type EvalReport,
  type FieldIndexReport,
  type IndexSize,
  type PathAnswer,
  type PathLatency,
  type ScoredQuery
} from './score'
import { EXPECTED_PLACEMENTS, POOLED_FILE, TARGET_PAGES, type TargetKey } from './targets'
import { measureRevisionCost, renderRevisionCost } from './revisionCost'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const PAGES_DIR = join(HERE, 'pages')
const OUT_DIR = join(REPO_ROOT, 'out', 'retrieval-eval')
const PROFILE_DIR = join(OUT_DIR, 'profile')
const CASE_FILE = join(OUT_DIR, 'case.json')
const REPORT_FILE = join(OUT_DIR, 'report.json')

const PARTITION = 'retrieval-eval'
const OPERATOR_NAME = 'Retrieval evaluation'
const CASE_NAME = 'Retrieval evaluation (synthetic)'
// A default for a quick run. The plan's Ruling 5 measures at 1,000.
const DEFAULT_CAPTURES = 200
// The view's limit when it opens (Ruling 3).
const RARE_LIMIT = 2
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

async function openProfile(fresh: boolean, dir = PROFILE_DIR): Promise<void> {
  if (fresh) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await initDatabase(join(dir, 'birdbrain.db'))
  initSettings(dir)
  updateSettings({ operatorName: OPERATOR_NAME, operatorRole: '', operatorOrganization: '' })
  initInstallationId(dir)
  // A throwaway profile under out/, so there is nothing for the OS credential
  // store to protect and the run stays non-interactive.
  initSigningKey(dir, {
    isEncryptionAvailable: () => false,
    confirmUnprotectedKey: () => true
  })
  initStorage(join(dir, 'captures'))
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
  // A build that fails must not leave the last Case's ids beside the new profile for a measure run.
  rmSync(CASE_FILE, { force: true })
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
      // What runFieldBuild does next.
      buildExhibitFields(capture.id)
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

function searchPaths(record: CaseRecord): SearchPath[] {
  return [
    {
      // The search bar's Capture results (`search:query`).
      name: 'Case search',
      answer: (query) => {
        const captures = captureRepo.searchCaptures(query, record.caseId)
        return {
          ranked: rankedKeys(
            captures.map((capture) => capture.id),
            record.targets
          ),
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
          ranked: rankedKeys(
            rows.flatMap((row) => row.sourceUrls),
            record.targetUrls
          ),
          returned: rows.length
        }
      }
    },
    {
      // The slice's link and header search (`cases:searchFields`). It answers in capture
      // time order, newest first, not by relevance.
      name: FIELD_SEARCH,
      answer: (query) => {
        const { hits, unavailable, truncated } = searchFieldRepo.searchCaseFields(
          record.caseId,
          query
        )
        return {
          ranked: rankedKeys(
            hits.map((hit) => hit.exhibitId),
            record.targets
          ),
          returned: hits.length,
          truncated,
          unavailable: unavailable.length
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
           OR name LIKE 'extracted_data%' OR name LIKE '%exhibit_search%'
        GROUP BY name ORDER BY name`
    )
    .all() as IndexSize[]
}

// The exact check (step 5) on every Field search hit of every query. A query whose Field
// search threw has that error in its scored row and no hits to check.
async function checkEveryHit(record: CaseRecord, scored: ScoredQuery[]): Promise<CheckTally> {
  const perQuery: Array<{ queryId: string; checks: ClaimCheck[] }> = []
  for (const query of QUERIES) {
    const failed = scored.some(
      (row) => row.path === FIELD_SEARCH && row.queryId === query.id && row.error
    )
    const hits = failed ? [] : searchFieldRepo.searchCaseFields(record.caseId, query.text).hits
    const checks: ClaimCheck[] = []
    for (const hit of hits) checks.push((await checkFieldHit(hit.fieldId)).check)
    perQuery.push({ queryId: query.id, checks })
  }
  return tallyChecks(perQuery)
}

function earlierLatency(caseId: string): PathLatency[][] {
  if (!existsSync(REPORT_FILE)) return []
  const last = JSON.parse(readFileSync(REPORT_FILE, 'utf-8')) as Partial<EvalReport>
  if (last.caseId !== caseId || !last.latency) return []
  return [...(last.earlierLatency ?? []), last.latency]
}

function fieldCounts(): Pick<FieldIndexReport, 'outcomes' | 'records'> {
  const db = getDb()
  return {
    outcomes: db
      .prepare(
        `SELECT outcome, COUNT(*) AS builds FROM exhibit_search_builds
          GROUP BY outcome ORDER BY outcome`
      )
      .all() as FieldIndexReport['outcomes'],
    records: db
      .prepare(
        `SELECT field, COUNT(*) AS records FROM exhibit_search_fields
          GROUP BY field ORDER BY field`
      )
      .all() as FieldIndexReport['records']
  }
}

async function measure(record: CaseRecord, earlier: PathLatency[][]): Promise<EvalReport> {
  const paths = searchPaths(record)
  const scored: ScoredQuery[] = []
  const latency: PathLatency[] = []
  for (const path of paths) {
    for (const query of QUERIES) {
      const answer = attempt(path, query.text)
      scored.push(scoreQuery(query, path.name, answer))
      const samples: number[] = []
      if (!answer.error) {
        for (let run = 0; run < TIMED_RUNS; run += 1) {
          samples.push(timeMs(() => path.answer(query.text)))
        }
      }
      latency.push({
        path: path.name,
        queryId: query.id,
        medianMs: percentile(samples, 50),
        p95Ms: percentile(samples, 95),
        samples: samples.length
      })
    }
  }

  const db = getDb()
  const fullRebuildMs = timeMs(() =>
    db.exec("INSERT INTO captures_fts(captures_fts) VALUES ('rebuild')")
  )
  // The pass the Settings rebuild runs, yields between Captures included. build() built each
  // Capture's records after its ingest, so this pass replaces them.
  const fieldStart = performance.now()
  await rebuildAllFields()
  const fieldBuildMs = performance.now() - fieldStart
  const fieldTotals = fieldCounts()
  // Before the re-index samples below, which add index segments.
  const sizes = indexSizes()
  // An UPDATE fires capture_texts_au, which deletes and re-inserts the row's
  // index entries: the incremental cost of one Capture's text. The target pages
  // are ingested first, so the sample is spread across the Case.
  const reindex = db.prepare('UPDATE capture_texts SET content = content WHERE capture_id = ?')
  const captureIds = (
    db.prepare('SELECT capture_id FROM capture_texts ORDER BY id').all() as Array<{
      capture_id: string
    }>
  ).map((row) => row.capture_id)
  const sampled = spread(captureIds, INCREMENTAL_SAMPLES)
  const incremental = sampled.map((id) => timeMs(() => reindex.run(id)))
  const fieldIncremental = sampled.map((id) => timeMs(() => buildExhibitFields(id)))

  const checks = await checkEveryHit(record, scored)

  // Through the read the view calls, at the limit the view opens with.
  const view = listUnreviewedCaptures(record.caseId, RARE_LIMIT)
  const reads = Array.from({ length: TIMED_RUNS }, () =>
    timeMs(() => listUnreviewedCaptures(record.caseId, RARE_LIMIT))
  )
  return {
    generatedAt: new Date().toISOString(),
    toolVersion: app.getVersion(),
    caseId: record.caseId,
    captures: record.captures,
    targets: TARGET_PAGES.length,
    fillers: record.fillers,
    queries: QUERIES,
    scored,
    latency,
    earlierLatency: earlier,
    indexSizes: sizes,
    fullRebuildMs,
    incrementalMedianMs: percentile(incremental, 50),
    fieldIndex: {
      extractor: FIELD_EXTRACTOR_VERSION,
      fullBuildMs: fieldBuildMs,
      incrementalMedianMs: percentile(fieldIncremental, 50),
      ...fieldTotals
    },
    checks,
    unreviewed: measureUnreviewed(view, record.targets, EXPECTED_PLACEMENTS, percentile(reads, 50))
  }
}

async function run(): Promise<void> {
  const phase = argValue('eval-phase') ?? 'all'
  if (!['build', 'measure', 'all', 'revision-cost'].includes(phase)) {
    throw new Error(`--eval-phase must be build, measure, all or revision-cost, not ${phase}`)
  }
  if (phase === 'revision-cost') {
    const record = JSON.parse(readFileSync(CASE_FILE, 'utf-8')) as CaseRecord
    const report = await measureRevisionCost({
      profileDir: PROFILE_DIR,
      scratchDir: join(OUT_DIR, 'revision-cost'),
      caseId: record.caseId,
      captures: record.captures,
      open: (dir) => openProfile(false, dir),
      close: closeDatabase
    })
    const markdown = renderRevisionCost(report)
    writeFileSync(join(OUT_DIR, 'revision-cost.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(OUT_DIR, 'revision-cost.md'), markdown)
    process.stdout.write(markdown)
    return
  }
  const size = Number(argValue('eval-captures') ?? DEFAULT_CAPTURES)
  if (!Number.isInteger(size)) throw new Error('--eval-captures must be a whole number')
  mkdirSync(OUT_DIR, { recursive: true })

  let record: CaseRecord
  let earlier: PathLatency[][] = []
  if (phase === 'measure') {
    await openProfile(false)
    record = JSON.parse(readFileSync(CASE_FILE, 'utf-8')) as CaseRecord
    earlier = earlierLatency(record.caseId)
  } else {
    record = await build(size)
  }
  if (phase !== 'build') {
    const report = await measure(record, earlier)
    const markdown = renderReport(report)
    writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`)
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
