import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DiagnosticsEnv } from '@main/services/diagnostics'

// The default env collector touches electron/db/storage; tests always inject a
// fake collector, so mock electron to keep the module import inert.
vi.mock('electron', () => ({ app: {} }))
vi.mock('@main/services/db/diagnosticsRepo', () => ({ getDbDiagnostics: vi.fn() }))
vi.mock('@main/services/storage', () => ({ getStorageRoot: vi.fn(() => '/storage') }))

import { createDiagnosticsService } from '@main/services/diagnostics'

const FAKE_ENV: DiagnosticsEnv = {
  app: {
    version: '1.2.3',
    electron: '39.0.0',
    chrome: '130.0.0',
    node: '22.0.0',
    platform: 'darwin',
    arch: 'x64',
    packaged: true,
    installFormat: 'mac'
  },
  processes: [{ type: 'Browser', pid: 42, cpuPercent: 1.5, memoryMB: 120 }],
  uptimeSeconds: 60,
  storage: { storageRoot: '/storage', dbPath: '/db/x.db', dbSizeBytes: 1024, walSizeBytes: 0 },
  data: {
    schemaVersion: 25,
    latestSchemaVersion: 25,
    cases: 2,
    captures: 10,
    notes: 3,
    selectors: 1,
    extractedData: 50
  }
}

function makeService() {
  return createDiagnosticsService({ now: Date.now, collectEnv: () => FAKE_ENV })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('diagnostics service — snapshot shape', () => {
  it('returns the collected environment plus empty logs initially', () => {
    const svc = makeService()
    const snap = svc.snapshot()
    expect(snap.app).toEqual(FAKE_ENV.app)
    expect(snap.processes).toEqual(FAKE_ENV.processes)
    expect(snap.storage).toEqual(FAKE_ENV.storage)
    expect(snap.data).toEqual(FAKE_ENV.data)
    expect(snap.eventLoop.stalls).toEqual([])
    expect(snap.slowOps).toEqual([])
  })
})

describe('diagnostics service — event-loop sampler', () => {
  it('records no stalls when ticks fire on schedule', () => {
    const svc = makeService()
    svc.start()
    vi.advanceTimersByTime(5_000)
    const snap = svc.snapshot()
    expect(snap.eventLoop.stalls).toEqual([])
    expect(snap.eventLoop.maxLagLastMinuteMs).toBe(0)
    svc.stop()
  })

  it('records a stall when a tick fires late (blocked event loop)', () => {
    const svc = makeService()
    svc.start()
    vi.advanceTimersByTime(1_000)
    // Simulate a 3s block: jump the clock without firing the interval, then
    // let the pending tick run. Fake timers fire it at scheduled-time+lag.
    vi.setSystemTime(Date.now() + 3_000)
    vi.advanceTimersByTime(250)
    const snap = svc.snapshot()
    expect(snap.eventLoop.stalls.length).toBeGreaterThanOrEqual(1)
    expect(snap.eventLoop.stalls[0].ms).toBeGreaterThanOrEqual(2_000)
    expect(snap.eventLoop.maxLagLastMinuteMs).toBeGreaterThanOrEqual(2_000)
    svc.stop()
  })

  it('start is idempotent and stop halts sampling', () => {
    const svc = makeService()
    svc.start()
    svc.start()
    svc.stop()
    vi.advanceTimersByTime(10_000)
    expect(svc.snapshot().eventLoop.maxLagLastMinuteMs).toBe(0)
  })
})

describe('diagnostics service — slow-op log', () => {
  it('records ops newest-first with rounded durations', () => {
    const svc = makeService()
    svc.recordSlowOp('data-extraction', 'https://a.example', 12.6)
    svc.recordSlowOp('data-extraction', 'https://b.example', 3400)
    const snap = svc.snapshot()
    expect(snap.slowOps.map((o) => o.detail)).toEqual(['https://b.example', 'https://a.example'])
    expect(snap.slowOps[1].ms).toBe(13)
  })

  it('caps the ring buffer at 50 entries', () => {
    const svc = makeService()
    for (let i = 0; i < 60; i++) svc.recordSlowOp('op', `detail-${i}`, i)
    const snap = svc.snapshot()
    expect(snap.slowOps).toHaveLength(50)
    expect(snap.slowOps[0].detail).toBe('detail-59')
    expect(snap.slowOps[49].detail).toBe('detail-10')
  })
})
