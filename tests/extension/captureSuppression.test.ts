// The capture-UI suppression protocol (#386) is the extension's one new seam:
// these cover it without a browser — the page-side teardown registry, and the
// orchestration bracket's ordering, per-tab gating, and restore-on-failure.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  CaptureUiSuppressionError,
  createCaptureSuppression,
  registerCaptureUiTeardown,
  suppressCaptureUi,
  suppressCaptureUiOrThrow
} from '../../extension/src/captureSuppression'

const unregisterFns: Array<() => void> = []

function register(teardown: () => void): void {
  unregisterFns.push(registerCaptureUiTeardown(teardown))
}

afterEach(() => {
  while (unregisterFns.length > 0) unregisterFns.pop()!()
  vi.restoreAllMocks()
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

/** A deferred whose resolution the test drives, standing in for frame collection. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('capture UI teardown registry', () => {
  it('tears down every registered piece of UI in registration order', () => {
    const order: string[] = []
    register(() => order.push('toast'))
    register(() => order.push('highlights'))

    expect(suppressCaptureUi()).toEqual([])
    expect(order).toEqual(['toast', 'highlights'])
  })

  it('runs the remaining teardowns after one throws and reports the failure', () => {
    const later = vi.fn()
    const boom = new Error('toast host detached')
    register(() => {
      throw boom
    })
    register(later)

    expect(suppressCaptureUi()).toEqual([boom])
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('stops tearing down UI that has unregistered', () => {
    const gone = vi.fn()
    const unregister = registerCaptureUiTeardown(gone)
    unregister()

    suppressCaptureUi()
    expect(gone).not.toHaveBeenCalled()
  })

  it('throws for capture paths when the page cannot be proven clean', () => {
    register(() => {
      throw new Error('highlight removal failed')
    })

    expect(() => suppressCaptureUiOrThrow()).toThrow(CaptureUiSuppressionError)
    expect(() => suppressCaptureUiOrThrow()).toThrow(/highlight removal failed/)
  })

  it('does not throw when every teardown succeeds', () => {
    register(() => {})
    expect(() => suppressCaptureUiOrThrow()).not.toThrow()
  })
})

describe('capture suppression boundary', () => {
  it('suppresses before frames and restores after them', async () => {
    const order: string[] = []
    const suppression = createCaptureSuppression({
      suppress: async () => {
        order.push('suppress')
      },
      restore: async () => {
        order.push('restore')
      }
    })

    const value = await suppression.withSuppression(1, async ({ collectFrames }) => {
      const { frames, lastOnTab } = await collectFrames(async () => {
        order.push('frames')
        return 'png'
      })
      order.push('upload')
      expect(lastOnTab).toBe(true)
      return frames
    })

    expect(value).toBe('png')
    expect(order).toEqual(['suppress', 'frames', 'upload', 'restore'])
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })

  it('reports the tab as collecting only while frames are being taken', async () => {
    const suppression = createCaptureSuppression({
      suppress: async () => {},
      restore: async () => {}
    })
    const frames = deferred<string>()
    const upload = deferred<void>()

    const capture = suppression.withSuppression(1, async ({ collectFrames }) => {
      await collectFrames(() => frames.promise)
      await upload.promise
    })

    expect(suppression.isCollectingFrames(1)).toBe(true)
    frames.resolve('png')
    await Promise.resolve()
    await Promise.resolve()
    // Frames are done but the upload is still running: UI may go back on the page
    expect(suppression.isCollectingFrames(1)).toBe(false)

    upload.resolve()
    await capture
  })

  it('holds suppression until the last capture on the tab has its frames', async () => {
    const restored: number[] = []
    const suppression = createCaptureSuppression({
      suppress: async () => {},
      restore: async (tabId) => {
        restored.push(tabId)
      }
    })
    const first = deferred<string>()
    const second = deferred<string>()
    const lastFlags: boolean[] = []

    const captureA = suppression.withSuppression(1, async ({ collectFrames }) => {
      lastFlags.push((await collectFrames(() => first.promise)).lastOnTab)
    })
    const captureB = suppression.withSuppression(1, async ({ collectFrames }) => {
      lastFlags.push((await collectFrames(() => second.promise)).lastOnTab)
    })

    first.resolve('a')
    await captureA
    // B is still mid-frame, so A was not the last collector and the tab stays suppressed
    expect(lastFlags).toEqual([false])
    expect(suppression.isCollectingFrames(1)).toBe(true)

    second.resolve('b')
    await captureB
    expect(lastFlags).toEqual([false, true])
    expect(suppression.isCollectingFrames(1)).toBe(false)
    expect(restored).toEqual([1, 1])
  })

  it('refuses a second frame collection rather than releasing another capture', async () => {
    const suppression = createCaptureSuppression({
      suppress: async () => {},
      restore: async () => {}
    })
    const held = deferred<string>()

    // Capture B stays mid-frame throughout
    const captureB = suppression.withSuppression(1, async ({ collectFrames }) => {
      await collectFrames(() => held.promise)
    })

    // A mis-bracketed capture collecting twice would otherwise decrement B's
    // slot, reporting the tab idle while B is still collecting frames
    await expect(
      suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(async () => 'a')
        await collectFrames(async () => 'b')
      })
    ).rejects.toThrow(/collectFrames called twice/)

    expect(suppression.isCollectingFrames(1)).toBe(true)
    held.resolve('png')
    await captureB
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })

  it('gates per tab, so a capture on one tab does not suppress another', async () => {
    const suppression = createCaptureSuppression({
      suppress: async () => {},
      restore: async () => {}
    })
    const held = deferred<string>()

    const capture = suppression.withSuppression(1, async ({ collectFrames }) => {
      await collectFrames(() => held.promise)
    })

    expect(suppression.isCollectingFrames(1)).toBe(true)
    expect(suppression.isCollectingFrames(2)).toBe(false)

    const other = await suppression.withSuppression(2, async ({ collectFrames }) => {
      return (await collectFrames(async () => 'png')).lastOnTab
    })
    expect(other).toBe(true)

    held.resolve('png')
    await capture
  })

  it('restores and releases the tab when frame collection throws', async () => {
    const restore = vi.fn(async () => {})
    const suppression = createCaptureSuppression({ suppress: async () => {}, restore })
    const boom = new Error('captureVisibleTab failed')

    await expect(
      suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(() => Promise.reject(boom))
      })
    ).rejects.toBe(boom)

    expect(restore).toHaveBeenCalledWith(1)
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })

  it('restores and releases the tab when the upload throws after frames', async () => {
    const restore = vi.fn(async () => {})
    const suppression = createCaptureSuppression({ suppress: async () => {}, restore })
    const boom = new Error('server rejected the capture')

    await expect(
      suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(async () => 'png')
        throw boom
      })
    ).rejects.toBe(boom)

    expect(restore).toHaveBeenCalledWith(1)
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })

  it('restores and releases the tab when suppression itself fails', async () => {
    const restore = vi.fn(async () => {})
    const body = vi.fn()
    const boom = new Error('content script unreachable')
    const suppression = createCaptureSuppression({
      suppress: async () => {
        throw boom
      },
      restore
    })

    await expect(suppression.withSuppression(1, async () => body())).rejects.toBe(boom)

    expect(body).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledWith(1)
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })

  it('does not let a failing restore mask why the capture failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boom = new Error('server rejected the capture')
    const suppression = createCaptureSuppression({
      suppress: async () => {},
      restore: async () => {
        throw new Error('tab closed')
      }
    })

    await expect(
      suppression.withSuppression(1, async ({ collectFrames }) => {
        await collectFrames(async () => 'png')
        throw boom
      })
    ).rejects.toBe(boom)
    expect(suppression.isCollectingFrames(1)).toBe(false)
  })
})
