/**
 * What the Case revision triggers cost (docs/plans/2026-10-10-case-investigation-
 * engine.md, CI-9's done-when): a whole-Case reprocess, a Case Archive import, and
 * the field build an import starts, each timed on a copy of the built profile with
 * the revision triggers and on a copy with every one of them removed by DROP
 * TRIGGER, with the change-log rows each wrote counted.
 *
 * Every run starts from a fresh copy, so no run reads a database an earlier
 * import grew, and the two variants alternate run by run, so a machine that
 * slows down part-way slows both.
 *
 * Run it with `pnpm eval:retrieval --eval-phase=revision-cost` after a `build`
 * phase. The copies live under `out/retrieval-eval/revision-cost/` and the
 * profile itself is left as it was. The report lands in
 * `out/retrieval-eval/revision-cost.md` and `revision-cost.json`.
 */

import { app } from 'electron'
import { cpus, platform, release } from 'os'
import { cpSync, rmSync } from 'fs'
import { join } from 'path'
import { performance } from 'perf_hooks'
import { getDb } from '@main/services/db/core'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { ensureCaseFields } from '@main/services/search/fieldIndex'

export const RUNS = 5

type Operation = 'reprocess' | 'import' | 'importFieldBuild'

export interface VariantResult {
  triggers: boolean
  // Milliseconds per run, in run order.
  ms: Record<Operation, number[]>
  // Change-log rows each run wrote.
  logRows: Record<Operation, number[]>
}

export interface RevisionCostReport {
  generatedAt: string
  toolVersion: string
  captures: number
  runs: number
  machine: { cpu: string; os: string; node: string; electron: string; sqlite: string }
  variants: VariantResult[]
}

function logCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM case_change_log').get() as { n: number }).n
}

function dropRevisionTriggers(): number {
  const triggers = getDb()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%\\_revision\\_%' ESCAPE '\\'"
    )
    .all() as Array<{ name: string }>
  for (const { name } of triggers) getDb().exec(`DROP TRIGGER ${name}`)
  return triggers.length
}

async function timed(run: () => Promise<unknown>): Promise<{ ms: number; logRows: number }> {
  const before = logCount()
  const t0 = performance.now()
  await run()
  return { ms: performance.now() - t0, logRows: logCount() - before }
}

/**
 * `open` opens a profile directory the way the build opens its own and `close`
 * closes it again, so this module does not repeat the build's setup.
 */
export async function measureRevisionCost(opts: {
  profileDir: string
  scratchDir: string
  caseId: string
  captures: number
  open: (dir: string) => Promise<void>
  close: () => void
}): Promise<RevisionCostReport> {
  const { profileDir, scratchDir, caseId, captures, open, close } = opts
  const variants: VariantResult[] = [true, false].map((triggers) => ({
    triggers,
    ms: { reprocess: [], import: [], importFieldBuild: [] },
    logRows: { reprocess: [], import: [], importFieldBuild: [] }
  }))
  let sqlite = ''
  for (let n = 0; n < RUNS; n++) {
    for (const result of variants) {
      const dir = join(scratchDir, result.triggers ? 'with-triggers' : 'without-triggers')
      rmSync(dir, { recursive: true, force: true })
      cpSync(profileDir, dir, { recursive: true })
      await open(dir)
      sqlite = (getDb().prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
      if (!result.triggers && dropRevisionTriggers() === 0) {
        throw new Error('the profile has no revision triggers to drop')
      }
      const lifecycle = createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
      const archive = join(dir, 'case.birdbrain')
      await exportCaseArchive(caseId, archive)
      const record = (operation: Operation, run: { ms: number; logRows: number }): void => {
        result.ms[operation].push(Math.round(run.ms))
        result.logRows[operation].push(run.logRows)
      }
      record('reprocess', await timed(() => lifecycle.reprocessCase(caseId)))
      let newCaseId = ''
      record(
        'import',
        await timed(async () => {
          newCaseId = (await importCaseArchive(archive)).newCaseId
        })
      )
      record('importFieldBuild', await timed(() => ensureCaseFields(newCaseId)))
      close()
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    toolVersion: app.getVersion(),
    captures,
    runs: RUNS,
    machine: {
      cpu: cpus()[0]?.model ?? 'unknown',
      os: `${platform()} ${release()}`,
      node: process.versions.node,
      electron: process.versions.electron ?? 'unknown',
      sqlite
    },
    variants
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

const LABELS: Record<Operation, string> = {
  reprocess: 'Whole-Case reprocess',
  import: 'Case Archive import',
  importFieldBuild: 'Field build after the import'
}

export function renderRevisionCost(report: RevisionCostReport): string {
  const [withTriggers, without] = report.variants
  const lines = [
    `# Case revision trigger cost, ${report.captures} Captures`,
    '',
    `${report.generatedAt}, Birdbrain ${report.toolVersion}, ${report.runs} runs each.`,
    `${report.machine.cpu}; ${report.machine.os}; Node ${report.machine.node}, ` +
      `Electron ${report.machine.electron}, SQLite ${report.machine.sqlite}.`,
    '',
    '| Operation | With triggers, median (ms) | Without, median (ms) | With triggers, each run (ms) | Without, each run (ms) | Change-log rows per run |',
    '| --- | --- | --- | --- | --- | --- |'
  ]
  for (const operation of Object.keys(LABELS) as Operation[]) {
    lines.push(
      `| ${LABELS[operation]} | ${median(withTriggers.ms[operation])} | ` +
        `${median(without.ms[operation])} | ${withTriggers.ms[operation].join(', ')} | ` +
        `${without.ms[operation].join(', ')} | ${withTriggers.logRows[operation].join(', ')} |`
    )
  }
  return `${lines.join('\n')}\n`
}
