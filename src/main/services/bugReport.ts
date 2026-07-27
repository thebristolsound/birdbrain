import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sanitizeText } from '@main/services/logSafe'
import { createStoredZip } from '@main/services/zip'
import { diagnosticsService } from '@main/services/diagnostics'
import { getLogDir } from '@main/services/logger'
import { readSessions } from '@main/services/sessionLog'
import { getInstallationId } from '@main/services/installationId'
import type { BugReportInput, DiagnosticsSnapshot, SessionRecord } from '@shared/types'

// Everything in the bundle is enumerated here. Nothing is globbed off disk, so
// a capture, the database, or a settings file cannot be swept in by accident —
// which is what makes the "what's included" disclosure in the dialog truthful.
export const BUG_REPORT_ENTRIES = [
  'report.md',
  'diagnostics.json',
  'sessions.json',
  'birdbrain.log',
  'birdbrain.log.1'
] as const

export interface BugReportDeps {
  snapshot: () => DiagnosticsSnapshot
  sessions: () => SessionRecord[]
  installationId: () => string
  readLog: (name: string) => string | null
}

function defaultDeps(): BugReportDeps {
  const dir = getLogDir()
  return {
    snapshot: () => diagnosticsService.snapshot(),
    sessions: () => readSessions(dir),
    installationId: () => getInstallationId(),
    readLog: (name) => {
      try {
        return readFileSync(join(dir, name), 'utf8')
      } catch {
        return null
      }
    }
  }
}

function reportMarkdown(
  input: BugReportInput,
  snap: DiagnosticsSnapshot,
  installId: string
): string {
  return [
    '# Birdbrain bug report',
    '',
    `- **Version:** ${snap.app.version}`,
    `- **Platform:** ${snap.app.platform} ${snap.app.arch} (${snap.app.installFormat})`,
    `- **Electron:** ${snap.app.electron} · **Chrome:** ${snap.app.chrome}`,
    `- **Installation:** ${installId}`,
    `- **Generated:** ${snap.generatedAt}`,
    input.correlationId ? `- **Log entry:** ${input.correlationId}` : '',
    '',
    '## What I did',
    '',
    input.whatYouDid || '_not provided_',
    '',
    '## What I expected',
    '',
    input.whatYouExpected || '_not provided_',
    '',
    '## What happened',
    '',
    input.whatHappened || '_not provided_',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// node:path.basename is host-relative: on Linux CI it treats backslashes as
// ordinary characters, so basename('C:\\Users\\tester\\bb.db') returns the
// WHOLE string and the bundle ships the operator's username. A redaction
// helper must not depend on which OS is running it — split on both separators.
function fileName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

// DiagnosticsSnapshot is NOT safe to ship as-is. storageRoot and dbPath are
// absolute paths carrying the operator's username, and slowOps[].detail is
// populated by recordSlowOp('data-extraction', url, ...) in captureLifecycle —
// it is the captured page URL. Project, don't serialize.
export function redactSnapshot(snap: DiagnosticsSnapshot): DiagnosticsSnapshot {
  return {
    ...snap,
    storage: {
      ...snap.storage,
      storageRoot: snap.storage.storageRoot ? '‹path›' : '',
      dbPath: snap.storage.dbPath ? fileName(snap.storage.dbPath) : ''
    },
    slowOps: snap.slowOps.map((op) => ({ ...op, detail: sanitizeText(op.detail, homedir()) }))
  }
}

export function buildBugReport(input: BugReportInput, deps: BugReportDeps = defaultDeps()): Buffer {
  const snap = redactSnapshot(deps.snapshot())
  const entries: Array<{ name: string; data: string }> = [
    { name: 'report.md', data: reportMarkdown(input, snap, deps.installationId()) },
    { name: 'diagnostics.json', data: JSON.stringify(snap, null, 2) },
    { name: 'sessions.json', data: JSON.stringify(deps.sessions(), null, 2) }
  ]

  for (const name of ['birdbrain.log', 'birdbrain.log.1']) {
    const data = deps.readLog(name)
    if (data !== null) entries.push({ name, data })
  }

  return createStoredZip(entries)
}

export function bugReportFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return `birdbrain-report-${stamp}.zip`
}
