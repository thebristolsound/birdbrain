import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { logUncaughtErrors } from '@renderer/lib/globalErrorLog'

const log = vi.fn()
let stop: () => void = () => {}

beforeEach(() => {
  log.mockReset().mockResolvedValue('id1')
  fakeBridge({ diagnostics: { log } })
  stop = logUncaughtErrors()
})

afterEach(() => {
  stop()
})

function rejection(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason })
}

describe('logUncaughtErrors', () => {
  it('logs an uncaught error by its class name only', () => {
    window.dispatchEvent(
      new ErrorEvent('error', { error: new TypeError('Operation Blackbird failed') })
    )
    expect(log).toHaveBeenCalledWith({
      level: 'error',
      code: 'app.uncaught_exception',
      error: 'TypeError'
    })
  })

  it('logs a rejection nobody handled', () => {
    window.dispatchEvent(rejection(new RangeError('out of range')))
    expect(log).toHaveBeenCalledWith({
      level: 'error',
      code: 'app.unhandled_rejection',
      error: 'RangeError'
    })
  })

  it('names a thrown non-Error UnknownError, so its text never reaches the log', () => {
    window.dispatchEvent(rejection('Operation Blackbird'))
    expect(log).toHaveBeenCalledWith({
      level: 'error',
      code: 'app.unhandled_rejection',
      error: 'UnknownError'
    })
  })

  it('stops logging once unsubscribed', () => {
    stop()
    window.dispatchEvent(rejection(new Error('late')))
    expect(log).not.toHaveBeenCalled()
  })

  it('does not raise a rejection of its own when the log write fails', async () => {
    log.mockRejectedValue(new Error('main is gone'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    window.dispatchEvent(rejection(new Error('first')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
