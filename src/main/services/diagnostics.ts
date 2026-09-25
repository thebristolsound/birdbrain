import { app } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDbDiagnostics } from '@main/services/db/diagnosticsRepo'
import { getStorageRoot } from '@main/services/storage'
import { isSigningKeyProtected } from '@main/services/signingKey'
import { getOpenRouterKeyProtectionState, getSettings } from '@main/services/settings'
import type {
  DiagnosticsSlowOp,
  DiagnosticsSnapshot,
  DiagnosticsStall,
  DiagnosticsProcessInfo
} from '@shared/types'

// Runtime diagnostics behind Settings → Diagnostics. Two always-on collectors
// feed the snapshot:
//
// 1. An event-loop lag sampler on the MAIN process. Birdbrain runs SQLite and
//    the extraction pipeline on the main process, so a blocked event loop is
//    the whole app freezing (the macOS pinwheel). The sampler records every
//    blocked span over the stall threshold with a timestamp, turning "it
//    pinwheeled earlier" into an inspectable log.
// 2. A slow-operation ring buffer that instrumented call sites (per-capture
//    data extraction) push durations into via recordSlowOp().
//
// The sampler and recordSlowOp() are pure in-memory state; electron/fs/db are
// only touched inside snapshot(), via an injectable collector so unit tests
// don't need an initialized database or storage root.

const SAMPLE_INTERVAL_MS = 250
const STALL_THRESHOLD_MS = 250
const LAG_WINDOW_MS = 60_000
const MAX_STALLS = 20
const MAX_SLOW_OPS = 50

export interface DiagnosticsEnv {
  app: DiagnosticsSnapshot['app']
  processes: DiagnosticsProcessInfo[]
  uptimeSeconds: number
  storage: DiagnosticsSnapshot['storage']
  data: DiagnosticsSnapshot['data']
  keyProtection: DiagnosticsSnapshot['keyProtection']
  trustedTimestamping: DiagnosticsSnapshot['trustedTimestamping']
}

export interface DiagnosticsServiceDeps {
  // Wall-clock now; injectable for deterministic tests.
  now?: () => number
  // Collects everything environment-shaped (electron, fs, db). Invoked lazily
  // per snapshot; defaults to collectEnv() below.
  collectEnv?: () => DiagnosticsEnv
}

export interface DiagnosticsService {
  start(): void
  stop(): void
  recordSlowOp(kind: string, detail: string, ms: number): void
  snapshot(): DiagnosticsSnapshot
}

export function createDiagnosticsService(deps: DiagnosticsServiceDeps = {}): DiagnosticsService {
  const now = deps.now ?? Date.now
  const collect = deps.collectEnv ?? collectEnv

  // Rolling lag samples for the last-minute maximum, stall log, slow-op log.
  let samples: Array<{ t: number; lagMs: number }> = []
  let stalls: DiagnosticsStall[] = []
  let slowOps: DiagnosticsSlowOp[] = []
  let currentLagMs = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let lastTick = 0

  function onTick(): void {
    const t = now()
    // Lag = how much later than scheduled the interval actually fired.
    const lagMs = Math.max(0, t - lastTick - SAMPLE_INTERVAL_MS)
    lastTick = t
    currentLagMs = lagMs
    samples.push({ t, lagMs })
    const cutoff = t - LAG_WINDOW_MS
    samples = samples.filter((s) => s.t >= cutoff)
    if (lagMs >= STALL_THRESHOLD_MS) {
      stalls.push({ at: new Date(t).toISOString(), ms: Math.round(lagMs) })
      if (stalls.length > MAX_STALLS) stalls = stalls.slice(-MAX_STALLS)
    }
  }

  return {
    start() {
      if (timer) return
      lastTick = now()
      timer = setInterval(onTick, SAMPLE_INTERVAL_MS)
      // Never keep the process alive just to sample it.
      timer.unref?.()
    },

    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },

    recordSlowOp(kind, detail, ms) {
      slowOps.push({ at: new Date(now()).toISOString(), kind, detail, ms: Math.round(ms) })
      if (slowOps.length > MAX_SLOW_OPS) slowOps = slowOps.slice(-MAX_SLOW_OPS)
    },

    snapshot() {
      const env = collect()
      const maxLag = samples.reduce((max, s) => Math.max(max, s.lagMs), 0)
      return {
        generatedAt: new Date(now()).toISOString(),
        app: env.app,
        uptimeSeconds: env.uptimeSeconds,
        processes: env.processes,
        eventLoop: {
          currentLagMs: Math.round(currentLagMs),
          maxLagLastMinuteMs: Math.round(maxLag),
          stalls: [...stalls].reverse()
        },
        storage: env.storage,
        data: env.data,
        slowOps: [...slowOps].reverse(),
        keyProtection: env.keyProtection,
        trustedTimestamping: env.trustedTimestamping
      }
    }
  }
}

// --- Default environment collection (electron / fs / db) --------------------

export function detectInstallFormat(packaged: boolean): string {
  if (!packaged) return 'dev'
  switch (process.platform) {
    case 'win32':
      return 'nsis'
    case 'darwin':
      return 'mac'
    case 'linux': {
      if (process.env.APPIMAGE) return 'appimage'
      try {
        // Same marker the updater trusts: electron-builder embeds the target
        // package format into the app resources for package-manager installs.
        const t = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
        if (t) return t
      } catch {
        /* no package-type file */
      }
      return 'archive'
    }
    default:
      return 'unknown'
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function collectEnv(): DiagnosticsEnv {
  const db = getDbDiagnostics()

  let storageRoot = ''
  try {
    storageRoot = getStorageRoot()
  } catch {
    /* storage not initialized */
  }

  const processes: DiagnosticsProcessInfo[] = app.getAppMetrics().map((m) => ({
    type: m.type,
    pid: m.pid,
    cpuPercent: Math.round(m.cpu.percentCPUUsage * 10) / 10,
    memoryMB: Math.round((m.memory.workingSetSize ?? 0) / 1024)
  }))

  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      installFormat: detectInstallFormat(app.isPackaged)
    },
    processes,
    uptimeSeconds: Math.round(process.uptime()),
    storage: {
      storageRoot,
      dbPath: db.dbPath,
      dbSizeBytes: db.dbPath ? fileSize(db.dbPath) : 0,
      walSizeBytes: db.dbPath ? fileSize(db.dbPath + '-wal') : 0
    },
    data: {
      schemaVersion: db.schemaVersion,
      latestSchemaVersion: db.latestSchemaVersion,
      cases: db.cases,
      captures: db.captures,
      notes: db.notes,
      selectors: db.selectors,
      extractedData: db.extractedData
    },
    keyProtection: {
      signingKey: isSigningKeyProtected(),
      openRouterKey: getOpenRouterKeyProtectionState()
    },
    trustedTimestamping: { enabled: readTimestampingEnabled() }
  }
}

// Diagnostics is read before settings are initialized in some start-up orders,
// and an unreadable setting must not take the whole snapshot down. Unknown reads
// as enabled, matching the default — the panel would otherwise tell an operator
// nothing is sent to a timestamp authority on the strength of a failed read.
function readTimestampingEnabled(): boolean {
  try {
    return getSettings().tsaEnabled
  } catch {
    return true
  }
}

// Shared singleton: ipcHandlers starts it and serves snapshots; instrumented
// call sites (captureLifecycle) push slow-op durations into it.
export const diagnosticsService = createDiagnosticsService()

export function recordSlowOp(kind: string, detail: string, ms: number): void {
  diagnosticsService.recordSlowOp(kind, detail, ms)
}
