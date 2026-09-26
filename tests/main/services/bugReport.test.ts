import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiagnosticsSnapshot, SessionRecord } from '@shared/types'

// defaultDeps() (the no-arg call path used by the real IPC handler) reads
// getLogDir/diagnosticsService/readSessions/getInstallationId itself, so
// exercising it needs these mocked rather than passed in like every other
// test in this file does.
let mockLogDir = ''
let mockSnapshot: DiagnosticsSnapshot = {} as DiagnosticsSnapshot
let mockSessions: SessionRecord[] = []
let mockInstallationId = ''

vi.mock('@main/services/logger', () => ({
  getLogDir: () => mockLogDir
}))
vi.mock('@main/services/diagnostics', () => ({
  diagnosticsService: { snapshot: () => mockSnapshot }
}))
vi.mock('@main/services/sessionLog', () => ({
  readSessions: () => mockSessions
}))
vi.mock('@main/services/installationId', () => ({
  getInstallationId: () => mockInstallationId
}))

import {
  buildBugReport,
  bugReportFilename,
  redactSnapshot,
  BUG_REPORT_ENTRIES
} from '@main/services/bugReport'

const SNAPSHOT = {
  generatedAt: '2026-07-25T10:00:00.000Z',
  app: {
    version: '1.0.1',
    electron: '39.8.10',
    chrome: '140',
    node: '22',
    platform: 'win32',
    arch: 'x64',
    packaged: true,
    installFormat: 'nsis'
  },
  uptimeSeconds: 120,
  processes: [],
  eventLoop: { currentLagMs: 0, maxLagLastMinuteMs: 0, stalls: [] },
  storage: {
    storageRoot: 'C:\\Users\\tester\\Birdbrain\\captures',
    dbPath: 'C:\\Users\\tester\\Birdbrain\\birdbrain.db',
    dbSizeBytes: 1,
    walSizeBytes: 0
  },
  data: {
    schemaVersion: 12,
    latestSchemaVersion: 12,
    cases: 1,
    captures: 2,
    notes: 0,
    selectors: 0,
    extractedData: 0
  },
  // captureLifecycle passes the captured page URL as slowOp detail — the most
  // sensitive value in the app. This fixture exists to prove it gets scrubbed.
  slowOps: [
    {
      at: '2026-07-25T09:30:00.000Z',
      kind: 'data-extraction',
      detail: 'https://target.example/case-file?id=9',
      ms: 812
    }
  ],
  keyProtection: { signingKey: 'protected', openRouterKey: 'not-set' },
  trustedTimestamping: { enabled: true }
} satisfies DiagnosticsSnapshot

const SESSIONS: SessionRecord[] = [
  {
    sessionId: 's1',
    startedAt: '2026-07-25T09:00:00.000Z',
    endedAt: null,
    version: '1.0.1',
    platform: 'win32',
    installFormat: 'nsis',
    cleanExit: false
  }
]

const deps = {
  snapshot: () => SNAPSHOT,
  sessions: () => SESSIONS,
  installationId: () => 'install-abc',
  readLog: (name: string) => (name === 'birdbrain.log' ? '{"level":"info"}\n' : null)
}

const INPUT = {
  whatYouDid: 'Captured a page',
  whatYouExpected: 'It saves',
  whatHappened: 'Nothing happened'
}

function entryNames(zip: Buffer): string[] {
  // Central-directory scan: entry names follow each 0x02014b50 signature.
  const names: string[] = []
  for (let i = 0; i < zip.length - 46; i++) {
    if (zip.readUInt32LE(i) === 0x02014b50) {
      const nameLen = zip.readUInt16LE(i + 28)
      names.push(zip.subarray(i + 46, i + 46 + nameLen).toString('utf8'))
    }
  }
  return names
}

describe('buildBugReport', () => {
  it('contains exactly the allowed entries', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names.sort()).toEqual(
      [...BUG_REPORT_ENTRIES].filter((n) => n !== 'birdbrain.log.1').sort()
    )
  })

  it('includes the tester description and diagnostics', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).toContain('Captured a page')
    expect(zip).toContain('install-abc')
  })

  it('never includes a database, a capture, or a settings file', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names.some((n) => /\.(db|sqlite|mhtml|html|png)$/i.test(n))).toBe(false)
    expect(names.some((n) => /settings/i.test(n))).toBe(false)
  })

  it('never carries an api key through the diagnostics snapshot', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip.toLowerCase()).not.toContain('openrouterapikey')
    expect(zip).not.toContain('sk-or-')
  })

  // These four exist because an earlier draft asserted only the API-key case
  // and would have shipped every captured URL to the maintainer.
  it('never carries a captured url from slowOps into the bundle', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toContain('target.example')
    expect(zip).not.toContain('case-file')
  })

  it('never carries any url scheme into the bundle', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toMatch(/https?:\/\//)
  })

  it('never carries an absolute storage path or the operator username', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toContain('tester')
    expect(zip).not.toContain('C:\\Users')
  })

  it('keeps the structural fields that make the snapshot useful', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).toContain('data-extraction')
    expect(zip).toContain('812')
    expect(zip).toContain('birdbrain.db')
  })

  it('omits the backup log when it does not exist', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names).not.toContain('birdbrain.log.1')
  })

  it('records a correlation id line when the input carries one', () => {
    const zip = buildBugReport({ ...INPUT, correlationId: 'abc123' }, deps).toString('utf8')
    expect(zip).toContain('abc123')
  })

  it('falls back to placeholder text for blank description fields', () => {
    const zip = buildBugReport(
      { whatYouDid: '', whatYouExpected: '', whatHappened: '' },
      deps
    ).toString('utf8')
    expect(zip.match(/_not provided_/g)?.length).toBe(3)
  })
})

describe('bugReportFilename', () => {
  it('formats a stable, sortable timestamp with no separators', () => {
    expect(bugReportFilename(new Date('2026-07-25T10:05:00.000Z'))).toBe(
      'birdbrain-report-20260725-1005.zip'
    )
  })
})

describe('redactSnapshot', () => {
  it('keeps storage fields empty when they were never populated', () => {
    const redacted = redactSnapshot({
      ...SNAPSHOT,
      storage: { ...SNAPSHOT.storage, storageRoot: '', dbPath: '' }
    })
    expect(redacted.storage.storageRoot).toBe('')
    expect(redacted.storage.dbPath).toBe('')
  })
})

describe('buildBugReport with default deps', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-bugreport-'))
    mockLogDir = dir
    mockSnapshot = SNAPSHOT
    mockSessions = SESSIONS
    mockInstallationId = 'install-default'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the live log file from disk when no deps are injected', () => {
    writeFileSync(join(dir, 'birdbrain.log'), '{"level":"info"}\n')
    const names = entryNames(buildBugReport(INPUT))
    expect(names).toContain('birdbrain.log')
    expect(names).not.toContain('birdbrain.log.1')
    const zip = buildBugReport(INPUT).toString('utf8')
    expect(zip).toContain('install-default')
  })

  it('omits both log files when neither exists on disk', () => {
    const names = entryNames(buildBugReport(INPUT))
    expect(names).not.toContain('birdbrain.log')
    expect(names).not.toContain('birdbrain.log.1')
  })

  // Regression guard from the pre-merge review. slowOps[].detail used to be
  // run through sanitizeText — the regex approach this design abandoned — and
  // sanitizeText's URL pattern requires '://', so these three shapes went into
  // the bundle verbatim. detail is now dropped outright.
  it('drops slowOps detail entirely, including url shapes no regex catches', () => {
    const leaky = [
      'data:text/html,<h1>Operation Blackbird</h1>',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      'mailto:target@example.com',
      'https://target.example/page?q=secret'
    ]
    const snap = {
      ...SNAPSHOT,
      slowOps: leaky.map((detail, i) => ({ ...SNAPSHOT.slowOps[0], detail, op: `op-${i}` }))
    } as DiagnosticsSnapshot

    const out = redactSnapshot(snap)
    const serialized = JSON.stringify(out)

    for (const op of out.slowOps) expect(op.detail).toBe('')
    expect(serialized).not.toContain('Operation Blackbird')
    expect(serialized).not.toContain('target@example.com')
    expect(serialized).not.toContain('target.example')
    expect(serialized).not.toContain('base64')
  })
})
