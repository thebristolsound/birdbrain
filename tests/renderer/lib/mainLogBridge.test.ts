import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastFns = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }
vi.mock('sonner', () => ({ toast: toastFns }))

let listener: ((e: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  listener = null
  vi.stubGlobal('birdbrain', {
    onLogEntry: (cb: (e: unknown) => void) => {
      listener = cb
      return () => {}
    },
    diagnostics: { log: vi.fn() }
  })
})

function entry(level: string) {
  return { id: 'a1', sessionId: 's1', timestamp: '', level, source: 'captureServer', code: 'capture.failed' }
}

describe('mainLogBridge', () => {
  it('toasts main-process errors', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('error'))
    expect(toastFns.error).toHaveBeenCalled()
  })

  it('does not re-log a main entry back to main', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('error'))
    // The entry is already on disk — logging it again would loop.
    expect(window.birdbrain.diagnostics.log).not.toHaveBeenCalled()
  })

  it('ignores info entries', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('info'))
    expect(toastFns.info).not.toHaveBeenCalled()
  })

  it('ignores renderer-originated entries so they do not toast twice', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    // notify.error already toasted this one before sending it to main; main
    // wrote it and echoed it straight back out.
    listener?.({ ...entry('error'), source: 'renderer' })
    expect(toastFns.error).not.toHaveBeenCalled()
  })

  it('collapses a retry storm onto one toast while citing the newest entry', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.({ ...entry('error'), id: 'aaa' })
    listener?.({ ...entry('error'), id: 'bbb' })
    listener?.({ ...entry('error'), id: 'ccc' })

    const ids = toastFns.error.mock.calls.map((c) => c[1].id)
    expect(new Set(ids).size).toBe(1)

    const dispatched = vi.fn()
    window.addEventListener('birdbrain:report', dispatched)
    toastFns.error.mock.calls.at(-1)![1].action.onClick()
    expect(dispatched.mock.calls[0][0].detail).toEqual({ correlationId: 'ccc' })
  })
})
