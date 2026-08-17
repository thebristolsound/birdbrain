import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  createBugReport,
  diagnosticsQueryOptions,
  lastSession,
  logDiagnosticEvent,
  openStorageRoot,
  recentLogEntries,
  revealLogFile
} from '@renderer/lib/api/diagnostics'
import { queryKeys } from '@renderer/lib/api/keys'
import type { RendererLogPayload } from '@shared/ipc'

describe('diagnosticsQueryOptions', () => {
  it('reads the snapshot under the shared key and leaves polling to the caller', async () => {
    const get = vi.fn(async () => ({ appVersion: '1.0.0' }))
    fakeBridge({ diagnostics: { get } })

    expect(diagnosticsQueryOptions.queryKey).toEqual(queryKeys.diagnostics)
    expect(diagnosticsQueryOptions).not.toHaveProperty('refetchInterval')
    await expect(diagnosticsQueryOptions.queryFn?.({} as never)).resolves.toEqual({
      appVersion: '1.0.0'
    })
  })
})

describe('diagnostics commands', () => {
  it('forwards a renderer log payload and returns the entry id', async () => {
    const log = vi.fn(async () => 'entry-1')
    fakeBridge({ diagnostics: { log } })

    const payload: RendererLogPayload = { level: 'error', code: 'react.render_error' }
    await expect(logDiagnosticEvent(payload)).resolves.toBe('entry-1')
    expect(log).toHaveBeenCalledWith(payload)
  })

  it('passes the history limit through', async () => {
    const recentEntries = vi.fn(async () => [])
    fakeBridge({ diagnostics: { recentEntries } })

    await expect(recentLogEntries(200)).resolves.toEqual([])
    expect(recentEntries).toHaveBeenCalledWith(200)
  })

  it('reveals the log file', async () => {
    const revealLog = vi.fn(async () => undefined)
    fakeBridge({ diagnostics: { revealLog } })

    await revealLogFile()

    expect(revealLog).toHaveBeenCalledOnce()
  })

  it('opens the storage root without handing the bridge a path (#363)', async () => {
    const openStorageRootStub = vi.fn(async () => undefined)
    fakeBridge({ diagnostics: { openStorageRoot: openStorageRootStub } })

    await openStorageRoot()

    expect(openStorageRootStub).toHaveBeenCalledOnce()
    expect(openStorageRootStub).toHaveBeenCalledWith()
  })

  it('returns null when there is no unclean session to recover', async () => {
    const lastSessionStub = vi.fn(async () => null)
    fakeBridge({ diagnostics: { lastSession: lastSessionStub } })

    await expect(lastSession()).resolves.toBeNull()
  })

  it('returns null when the report save dialog is cancelled', async () => {
    const createReport = vi.fn(async () => null)
    fakeBridge({ diagnostics: { createReport } })

    const input = { whatYouDid: 'a', whatYouExpected: 'b', whatHappened: 'c' }
    await expect(createBugReport(input)).resolves.toBeNull()
    expect(createReport).toHaveBeenCalledWith(input)
  })
})
