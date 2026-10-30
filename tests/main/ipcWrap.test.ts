import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'

const registered = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      registered.set(channel, fn)
    }
  }
}))

const { handle, IpcFailure, logIpcFailuresTo } = await import('@main/ipcWrap')

const log = { warn: vi.fn(), error: vi.fn() }
const event = {} as IpcMainInvokeEvent

// Registers `fn` on notes:update, whose contract the cast sidesteps: these
// tests exercise the wrapper, not the channel.
function invokeWith(fn: () => unknown): Promise<unknown> {
  handle(IPC_CHANNELS.NOTES_UPDATE, fn as never)
  const registeredFn = registered.get(IPC_CHANNELS.NOTES_UPDATE)
  if (!registeredFn) throw new Error('handler was not registered')
  return Promise.resolve(registeredFn(event))
}

describe('handle() failure logging', () => {
  beforeEach(() => {
    registered.clear()
    log.warn.mockReset()
    log.error.mockReset()
    logIpcFailuresTo(log)
  })

  it('logs nothing for a handler that returns', async () => {
    await expect(invokeWith(() => 'ok')).resolves.toEqual({ ok: true, data: 'ok' })
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('logs a refusal at warn with the channel and its code in log form', async () => {
    const failure = new IpcFailure('Not a Birdbrain invite', 'invite-malformed')
    await expect(
      invokeWith(() => {
        throw failure
      })
    ).resolves.toEqual({ ok: false, error: 'Not a Birdbrain invite', code: 'invite-malformed' })
    expect(log.warn).toHaveBeenCalledWith(
      'ipc',
      'ipc.request_refused',
      { channel: 'notes:update', errorCode: 'INVITE_MALFORMED' },
      failure
    )
    expect(log.error).not.toHaveBeenCalled()
  })

  it('logs a known SQLite error at warn, since the renderer receives it as a refusal', async () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    await expect(
      invokeWith(() => {
        throw busy
      })
    ).resolves.toMatchObject({ ok: false, code: 'SQLITE_BUSY' })
    expect(log.warn).toHaveBeenCalledWith(
      'ipc',
      'ipc.request_refused',
      { channel: 'notes:update', errorCode: 'SQLITE_BUSY' },
      busy
    )
  })

  it('leaves out a refusal code that has no log form', async () => {
    await invokeWith(() => {
      throw new IpcFailure('nope')
    })
    expect(log.warn).toHaveBeenCalledWith(
      'ipc',
      'ipc.request_refused',
      { channel: 'notes:update' },
      expect.any(IpcFailure)
    )
  })

  it('logs an unexpected throw at error with the error itself, and still rejects', async () => {
    const bug = new TypeError('x is undefined')
    await expect(
      invokeWith(() => {
        throw bug
      })
    ).rejects.toBe(bug)
    expect(log.error).toHaveBeenCalledWith(
      'ipc',
      'ipc.request_threw',
      { channel: 'notes:update' },
      bug
    )
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('names every contracted channel in a form the log accepts', async () => {
    const { channel } = await import('@main/services/logSafe')
    for (const name of Object.values(IPC_CHANNELS)) expect(() => channel(name)).not.toThrow()
  })
})
