import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'

const toastFns = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }
vi.mock('sonner', () => ({ toast: toastFns }))

let listener: ((e: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  listener = null
  fakeBridge({
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

  // Regression guard: recentEntries reads the tail of the log FILE, which spans
  // launches. Without a session filter the tester is greeted on every start by
  // toasts for failures from a previous run, whose "Report this" cites a
  // correlation id from a session the current bundle may not contain.
  it('replays only the current session, not failures from previous launches', async () => {
    const previous = { ...entry('error'), id: 'old', sessionId: 's0', code: 'capture.failed' }
    const current = { ...entry('error'), id: 'new', sessionId: 's1', code: 'ipc.handler_threw' }
    fakeBridge({
      onLogEntry: (cb: (e: unknown) => void) => {
        listener = cb
        return () => {}
      },
      diagnostics: {
        log: vi.fn(),
        // Newest first, matching readRecentEntries.
        recentEntries: vi.fn().mockResolvedValue([current, previous])
      }
    })

    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    await vi.waitFor(() => expect(toastFns.error).toHaveBeenCalled())

    expect(toastFns.error).toHaveBeenCalledTimes(1)
  })

  // The dedupe set is bounded, so a long-lived renderer under a retry loop does
  // not accumulate ids forever. Eviction is FIFO, so recent ids — the ones that
  // actually matter for replay/live overlap — stay covered.
  it('keeps deduplicating recent entries after far more than the bound', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()

    for (let i = 0; i < 500; i++) {
      listener?.({ ...entry('error'), id: `e${i}`, code: 'capture.failed' })
    }
    const afterFlood = toastFns.error.mock.calls.length

    // A just-seen id must still be recognised as a duplicate.
    listener?.({ ...entry('error'), id: 'e499', code: 'capture.failed' })
    expect(toastFns.error.mock.calls.length).toBe(afterFlood)
  })
})
