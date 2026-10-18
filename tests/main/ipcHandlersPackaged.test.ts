import { describe, it, expect, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// tests/main/ipcHandlers.test.ts registers with app.isPackaged false, where the fake investigation
// engine serves its channels. This file registers as a packaged build does (ruling 63).
const registered = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
)
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.2.3', getPath: () => '', getAppMetrics: () => [] },
  ipcMain: {
    handle: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      registered.set(channel, fn)
    }
  },
  dialog: {},
  shell: {},
  nativeImage: {}
}))

import { IPC_CHANNELS } from '@shared/ipc'
import { registerIpcHandlers } from '@main/ipcHandlers'

describe('ipcHandlers in a packaged build', () => {
  it('registers no investigation channel, and every other declared invoke channel', () => {
    // Registration only wires handlers; none of these services is called.
    registerIpcHandlers({
      selectorLifecycle: {},
      captureLifecycle: {},
      recaptureService: {},
      updaterService: {},
      sessionService: {}
    } as unknown as Parameters<typeof registerIpcHandlers>[0])
    const invoke = Object.values(IPC_CHANNELS).filter((c) => !c.startsWith('event:'))
    const investigation = invoke.filter((c) => c.startsWith('investigation:'))
    expect(investigation).toHaveLength(18)
    expect(investigation.filter((c) => registered.has(c))).toEqual([])
    expect(invoke.filter((c) => !c.startsWith('investigation:') && !registered.has(c))).toEqual([])
  })
})
