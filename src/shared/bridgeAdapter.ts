import type { IpcRefusal } from '@shared/ipc'

// The renderer's half of how a refusal crosses the preload bridge. A refused
// call rejects at the bridge with a plain IpcRefusal, because the context
// bridge would strip `.code` from an Error (the preload's unwrapIpc). This
// rebuilds the Error on the renderer's side, code included; any other
// rejection passes through unchanged.
export function refusalError(err: unknown): unknown {
  if (err instanceof Error || typeof err !== 'object' || err === null) return err
  const { message, code } = err as Partial<IpcRefusal>
  if (typeof message !== 'string') return err
  const error = new Error(message)
  if (typeof code === 'string') Object.assign(error, { code })
  return error
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

// A view of the bridge whose every call rejects through refusalError. It reads
// the bridge on each access rather than once, so a test's fake installed after
// the caller's module loads is the one a call reaches.
export function adaptBridge<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const owner = read()
      const value: unknown = Reflect.get(owner, key)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, owner, args)
          if (!isThenable(result)) return result
          return Promise.resolve(result).catch((err: unknown) => {
            throw refusalError(err)
          })
        }
      }
      if (typeof value === 'object' && value !== null) return adaptBridge(() => value)
      return value
    }
  })
}
