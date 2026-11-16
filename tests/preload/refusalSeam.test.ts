import { describe, expect, it, vi } from 'vitest'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { adaptBridge } from '@shared/bridgeAdapter'
import { IPC_CHANNELS, refusalCode } from '@shared/ipc'

// A refusal followed across the whole seam: the real handle() wrapper in main,
// the real preload bridge, and the adapter the renderer calls the bridge
// through (src/renderer/lib/birdbrain.ts binds it to window.birdbrain). Electron
// itself is modelled by two rules, each stated where it is applied below.
const electronStub = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  exposed: null as Record<string, unknown> | null
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) {
      electronStub.handlers.set(channel, fn)
    }
  },
  contextBridge: {
    exposeInMainWorld(_key: string, api: Record<string, unknown>) {
      electronStub.exposed = api
    }
  },
  ipcRenderer: {
    // ipcRenderer.invoke clones the handler's reply, and turns a handler's
    // throw into a rejection that carries only a message.
    async invoke(channel: string, ...args: unknown[]) {
      const fn = electronStub.handlers.get(channel)
      if (!fn) throw new Error(`No handler registered for '${channel}'`)
      let reply: unknown
      try {
        reply = await fn({}, ...args)
      } catch (err) {
        throw new Error(`Error invoking remote method '${channel}': ${String(err)}`, {
          cause: err
        })
      }
      return structuredClone(reply)
    },
    on() {},
    removeListener() {}
  }
}))

const { handle, IpcFailure } = await import('@main/ipcWrap')
// Relative because src/preload has no path alias.
await import('../../src/preload/index')

type Leaf = (...args: unknown[]) => unknown

// The context bridge copies a rejection into the renderer's world: an Error
// arrives as a new Error with the same message and nothing else, and a plain
// object arrives whole.
function acrossContextBridge(api: Record<string, unknown>): Record<string, unknown> {
  const copyRejection = (err: unknown): unknown =>
    err instanceof Error ? new Error(err.message) : structuredClone(err)
  const wrap = (value: unknown): unknown => {
    if (typeof value === 'function') {
      return (...args: unknown[]) => {
        const result = (value as Leaf)(...args)
        if (!(result instanceof Promise)) return result
        return result.catch((err: unknown) => {
          throw copyRejection(err)
        })
      }
    }
    if (value !== null && typeof value === 'object') {
      return acrossContextBridge(value as Record<string, unknown>)
    }
    return value
  }
  return Object.fromEntries(Object.entries(api).map(([key, value]) => [key, wrap(value)]))
}

if (!electronStub.exposed) throw new Error('the preload exposed no bridge')
const inRenderer = acrossContextBridge(electronStub.exposed) as unknown as BirdbrainAPI
const birdbrain = adaptBridge(() => inRenderer)

describe('a refusal, from the handler to the renderer', () => {
  it('keeps the code main set, on a channel whose row branches on it', async () => {
    handle(IPC_CHANNELS.PERSONAS_IMPORT, () => {
      throw new IpcFailure(
        'Only a Netscape cookies.txt export can be imported.',
        'PERSONA_COOKIE_FILE_UNSUPPORTED'
      )
    })

    const refused = await birdbrain.persona.import('p-1').catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({
      message: 'Only a Netscape cookies.txt export can be imported.',
      code: 'PERSONA_COOKIE_FILE_UNSUPPORTED'
    })
    expect(refusalCode(refused, 'persona:import')).toBe('PERSONA_COOKIE_FILE_UNSUPPORTED')
  })

  it('keeps the code on a channel that names none', async () => {
    handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, () => {
      throw new IpcFailure('Invalid URL', 'INVALID_URL')
    })

    const refused = await birdbrain.captures.openExternal('nope').catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({ message: 'Invalid URL', code: 'INVALID_URL' })
  })

  it('keeps the code of a database refusal, which no channel names', async () => {
    handle(IPC_CHANNELS.PERSONAS_IMPORT, () => {
      throw Object.assign(new Error('UNIQUE constraint failed: personas.label'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    })

    const refused = await birdbrain.persona.import('p-1').catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({
      message: 'A record with that value already exists',
      code: 'SQLITE_CONSTRAINT_UNIQUE'
    })
    // Delivered, but not a code this channel's callers may branch on.
    expect(refusalCode(refused, 'persona:import')).toBeUndefined()
  })

  it('carries a refusal that has no code as an Error with its message', async () => {
    handle(IPC_CHANNELS.CASES_SET_AUTO_CAPTURE_POLICY, () => {
      throw new IpcFailure('Case not found')
    })

    const refused = await birdbrain.cases
      .setAutoCapturePolicy({ caseId: 'c1', exclusions: [], mode: 'stack' })
      .catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({ message: 'Case not found' })
    expect(refused).not.toHaveProperty('code')
  })

  it('leaves a defect an Error with no code', async () => {
    handle(IPC_CHANNELS.CASES_LIST, () => {
      throw new TypeError('rows is not iterable')
    })

    const thrown = await birdbrain.cases.list().catch((err: unknown) => err)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('rows is not iterable')
    expect(thrown).not.toHaveProperty('code')
  })

  it('resolves with the data a handler returns', async () => {
    handle(IPC_CHANNELS.APP_GET_VERSION, () => '0.9.0')

    await expect(birdbrain.app.getVersion()).resolves.toBe('0.9.0')
  })
})
