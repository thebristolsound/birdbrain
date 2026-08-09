// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fakeBridge } from './fakeBridge'

describe('fakeBridge', () => {
  it('installs the stub at window.birdbrain and returns the same object', () => {
    const bridge = fakeBridge()
    expect(window.birdbrain).toBe(bridge)
  })

  it('hands back the stub a test supplied', async () => {
    const openFolder = vi.fn(async () => undefined)
    const bridge = fakeBridge({ extension: { openFolder } })

    await bridge.extension.openFolder()

    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  // The whole point of the util: an unstubbed method must fail at the call
  // rather than resolve undefined and surface as a confusing assertion later.
  it('rejects an unstubbed namespace method with a named error', async () => {
    const bridge = fakeBridge({ db: { stats: vi.fn() } })

    await expect(bridge.db.vacuum()).rejects.toThrow('fakeBridge: db.vacuum called but not stubbed')
  })

  it('returns the throwing stub rather than invoking it on property access', () => {
    const bridge = fakeBridge()

    expect(() => bridge.captures.verify).not.toThrow()
    expect(typeof bridge.captures.verify).toBe('function')
  })

  it('defaults an event subscription to a no-op returning an unsubscribe', () => {
    const bridge = fakeBridge()

    const unsubscribe = bridge.onNewCapture(vi.fn())

    expect(typeof unsubscribe).toBe('function')
  })

  it('rejects an unstubbed top-level method with a named error', async () => {
    const bridge = fakeBridge()

    await expect(bridge.testHttp()).rejects.toThrow('fakeBridge: testHttp called but not stubbed')
  })

  // A typo'd or renamed namespace would otherwise be dropped in silence and
  // leave the test green against a bridge key nothing can reach.
  it('throws when an override names a key outside the bridge surface', () => {
    expect(() => fakeBridge({ archive: { lookup: vi.fn() } })).toThrow(
      'fakeBridge: "archive" is not part of the bridge surface'
    )
  })
})
