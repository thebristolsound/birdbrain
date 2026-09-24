import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'

const toastFns = {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn()
}
vi.mock('sonner', () => ({ toast: toastFns }))

const log = vi.fn().mockResolvedValue('cid-1')

beforeEach(() => {
  vi.clearAllMocks()
  fakeBridge({ diagnostics: { log } })
})

describe('notify', () => {
  it('raises a toast and writes a durable log entry for an error', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Could not save note', { code: 'mutation.failed' })

    expect(toastFns.error).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', code: 'mutation.failed' })
    )
  })

  it('never sends the toast text or the error message to the durable log', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Could not save note in Operation Blackbird', {
      code: 'mutation.failed',
      cause: new Error('ENOENT: no such file, open /home/tester/Operation Blackbird/x.mhtml')
    })

    const payload = JSON.stringify(log.mock.calls[0][0])
    expect(payload).not.toContain('Blackbird')
    expect(payload).not.toContain('tester')
    expect(payload).toContain('"error":"Error"')
  })

  it('does not write success toasts to the durable log', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.success('Case exported')

    expect(toastFns.success).toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('passes a success subtitle and action through to the toast', async () => {
    const { notify } = await import('@renderer/lib/notify')
    const onClick = vi.fn()
    notify.success('Archive saved', {
      description: '/tmp/case.bbcase',
      action: { label: 'Show in folder', onClick }
    })

    expect(toastFns.success).toHaveBeenCalledWith(
      'Archive saved',
      expect.objectContaining({
        description: '/tmp/case.bbcase',
        action: { label: 'Show in folder', onClick }
      })
    )
  })

  it('collapses a storm of identical errors onto one toast id', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Capture failed', { code: 'capture.failed' })
    notify.error('Capture failed', { code: 'capture.failed' })
    notify.error('Capture failed', { code: 'capture.failed' })

    const ids = toastFns.error.mock.calls.map((c) => c[1]?.id)
    expect(new Set(ids).size).toBe(1)
  })

  it('re-renders the toast with the correlation id once the log resolves', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Capture failed', { code: 'capture.failed' })
    await vi.waitFor(() => expect(toastFns.error).toHaveBeenCalledTimes(2))

    const [first, second] = toastFns.error.mock.calls
    expect(second[1].id).toBe(first[1].id)

    // Report this must cite the entry the tester is actually looking at.
    const dispatched = vi.fn()
    window.addEventListener('birdbrain:report', dispatched)
    second[1].action.onClick()
    expect(dispatched.mock.calls[0][0].detail).toEqual({ correlationId: 'cid-1' })
  })
})
