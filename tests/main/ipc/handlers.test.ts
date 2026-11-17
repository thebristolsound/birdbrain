import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { IpcHandlers } from '@main/ipc/handlers'

const registered = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      registered.set(channel, fn)
    }
  }
}))

const { IpcFailure } = await import('@main/ipcWrap')
const { registerHandlers } = await import('@main/ipc/handlers')

const sent: unknown[][] = []
const event = {
  sender: { send: (...args: unknown[]) => sent.push(args) }
} as unknown as IpcMainInvokeEvent

describe('registerHandlers', () => {
  beforeEach(() => {
    registered.clear()
    sent.length = 0
  })

  it('registers each handler of the table under its channel', () => {
    registerHandlers({
      'app:getVersion': () => '1.2.3',
      'shell:openPath': async () => {}
    })
    expect([...registered.keys()].sort()).toEqual(['app:getVersion', 'shell:openPath'])
  })

  it("passes the call's arguments on and wraps the result in the envelope", async () => {
    const openPath = vi.fn<(path: string) => Promise<void>>(async () => {})
    const table: IpcHandlers<'shell:openPath' | 'app:getVersion'> = {
      'shell:openPath': (_, path) => openPath(path),
      'app:getVersion': () => '1.2.3'
    }
    registerHandlers(table)

    await expect(registered.get('shell:openPath')?.(event, '/tmp/report.html')).resolves.toEqual({
      ok: true,
      data: undefined
    })
    expect(openPath).toHaveBeenCalledWith('/tmp/report.html')
    await expect(registered.get('app:getVersion')?.(event)).resolves.toEqual({
      ok: true,
      data: '1.2.3'
    })
  })

  it('turns a refusal into the refusal envelope', async () => {
    registerHandlers({
      'shell:openPath': () => {
        throw new IpcFailure('Path not permitted', 'FORBIDDEN_PATH')
      }
    })
    await expect(registered.get('shell:openPath')?.(event, '/etc/passwd')).resolves.toEqual({
      ok: false,
      error: 'Path not permitted',
      code: 'FORBIDDEN_PATH'
    })
  })

  it('gives a handler a caller that sends to the window that made the call', async () => {
    registerHandlers({
      'export:generate': (caller, caseId) => {
        caller.send('event:exportProgress', { caseId, step: 'Hashing', percent: 40 })
        return { canceled: true }
      }
    })
    await registered.get('export:generate')?.(event, 'case-1', { format: 'zip' })
    expect(sent).toEqual([
      ['event:exportProgress', { caseId: 'case-1', step: 'Hashing', percent: 40 }]
    ])
  })
})
