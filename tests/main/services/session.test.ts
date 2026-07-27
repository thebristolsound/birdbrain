import { describe, it, expect, vi } from 'vitest'
import { createSessionService } from '@main/services/session'
import type { SessionStateEvent } from '@shared/ipc'

// A controllable clock keeps the heartbeat tests free of fake timers: the
// service reads `now()` on every check, so advancing the variable is enough.
function makeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    }
  }
}

function setup(overrides: Parameters<typeof createSessionService>[0] = {}) {
  const sessionChanges: SessionStateEvent[] = []
  const connectionChanges: boolean[] = []
  const clock = makeClock()
  const service = createSessionService({
    emitSessionChange: (s) => sessionChanges.push(s),
    emitExtensionConnection: (c) => connectionChanges.push(c),
    now: clock.now,
    ...overrides
  })
  return { service, sessionChanges, connectionChanges, clock }
}

describe('sessionService — state', () => {
  it('starts empty', () => {
    const { service } = setup()
    expect(service.snapshot()).toEqual({
      activeCaseId: null,
      sessionActive: false,
      captureCount: 0,
      extensionLastSeen: 0
    })
  })

  it('activating a case notifies with the new case id', () => {
    const { service, sessionChanges } = setup()
    service.activateCase('case-1')
    expect(service.snapshot().activeCaseId).toBe('case-1')
    expect(sessionChanges).toEqual([
      { sessionActive: false, activeCaseId: 'case-1', captureCount: 0 }
    ])
  })

  it('start sets the session active and zeroes the capture count', () => {
    const { service, sessionChanges } = setup()
    service.activateCase('case-1')
    service.countCapture()
    service.start()

    expect(service.snapshot()).toMatchObject({ sessionActive: true, captureCount: 0 })
    expect(sessionChanges.at(-1)).toEqual({
      sessionActive: true,
      activeCaseId: 'case-1',
      captureCount: 0
    })
  })

  it('stop clears the active flag but keeps the case and count', () => {
    const { service } = setup()
    service.activateCase('case-1')
    service.start()
    service.countCapture()
    service.countCapture()
    service.stop()

    expect(service.snapshot()).toMatchObject({
      sessionActive: false,
      activeCaseId: 'case-1',
      captureCount: 2
    })
  })

  // Pre-refactor behaviour, deliberately preserved: the count changes without
  // a notification, so the renderer sees it on the next session change.
  it('counting a capture does not notify', () => {
    const { service, sessionChanges } = setup()
    service.activateCase('case-1')
    const before = sessionChanges.length
    service.countCapture()
    expect(service.snapshot().captureCount).toBe(1)
    expect(sessionChanges.length).toBe(before)
  })

  it('reset returns every field to its initial value', () => {
    const { service } = setup()
    service.activateCase('case-1')
    service.start()
    service.countCapture()
    service.touchExtension()
    service.reset()

    expect(service.snapshot()).toEqual({
      activeCaseId: null,
      sessionActive: false,
      captureCount: 0,
      extensionLastSeen: 0
    })
  })

  it('snapshot is a copy, not a live handle on internal state', () => {
    const { service } = setup()
    const snap = service.snapshot()
    service.activateCase('case-1')
    expect(snap.activeCaseId).toBeNull()
  })
})

describe('sessionService — extension heartbeat', () => {
  it('first touch is a rising edge and reports connected', () => {
    const { service, connectionChanges } = setup()
    service.touchExtension()
    expect(connectionChanges).toEqual([true])
    expect(service.isExtensionConnected()).toBe(true)
  })

  it('touches inside the window do not re-notify', () => {
    const { service, connectionChanges, clock } = setup()
    service.touchExtension()
    clock.advance(1_000)
    service.touchExtension()
    clock.advance(1_000)
    service.touchExtension()
    expect(connectionChanges).toEqual([true])
  })

  it('goes stale once the timeout elapses', () => {
    const { service, clock } = setup()
    service.touchExtension()
    clock.advance(9_999)
    expect(service.isExtensionConnected()).toBe(true)
    clock.advance(2)
    expect(service.isExtensionConnected()).toBe(false)
  })

  it('expiry emits disconnected exactly once', () => {
    const { service, connectionChanges, clock } = setup()
    service.touchExtension()
    clock.advance(10_001)

    service.expireExtensionIfStale()
    service.expireExtensionIfStale()
    service.expireExtensionIfStale()

    expect(connectionChanges).toEqual([true, false])
    expect(service.snapshot().extensionLastSeen).toBe(0)
  })

  it('expiry does nothing when the extension was never seen', () => {
    const { service, connectionChanges } = setup()
    service.expireExtensionIfStale()
    expect(connectionChanges).toEqual([])
  })

  it('isExtensionConnected is false before any touch even when the clock starts at 0', () => {
    // Regression: without the extensionLastSeen > 0 sentinel guard,
    // now() - extensionLastSeen = 0 - 0 = 0 < timeout, incorrectly returning true.
    const service = createSessionService({ now: () => 0, extensionTimeoutMs: 10_000 })
    expect(service.isExtensionConnected()).toBe(false)
  })

  it('touchExtension fires a rising edge even when the clock starts at 0', () => {
    // Regression: without the sentinel guard, wasConnected would be true at
    // time 0 (because 0 - 0 = 0 < timeout), suppressing the rising-edge event.
    const connectionChanges: boolean[] = []
    const service = createSessionService({
      now: () => 0,
      extensionTimeoutMs: 10_000,
      emitExtensionConnection: (c) => connectionChanges.push(c)
    })
    service.touchExtension()
    expect(connectionChanges).toEqual([true])
  })

  it('a touch after expiry is a fresh rising edge', () => {
    const { service, connectionChanges, clock } = setup()
    service.touchExtension()
    clock.advance(10_001)
    service.expireExtensionIfStale()
    service.touchExtension()
    expect(connectionChanges).toEqual([true, false, true])
  })

  it('honours an injected timeout', () => {
    const { service, clock } = setup({ extensionTimeoutMs: 50 })
    service.touchExtension()
    clock.advance(51)
    expect(service.isExtensionConnected()).toBe(false)
  })
})

describe('sessionService — heartbeat monitor', () => {
  it('polls for expiry on the configured interval', () => {
    vi.useFakeTimers()
    try {
      const { service, connectionChanges, clock } = setup({ heartbeatPollMs: 100 })
      service.touchExtension()
      service.startHeartbeatMonitor()

      clock.advance(10_001)
      vi.advanceTimersByTime(100)

      expect(connectionChanges).toEqual([true, false])
      service.stopHeartbeatMonitor()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stopping the monitor halts polling', () => {
    vi.useFakeTimers()
    try {
      const { service, connectionChanges, clock } = setup({ heartbeatPollMs: 100 })
      service.touchExtension()
      service.startHeartbeatMonitor()
      service.stopHeartbeatMonitor()

      clock.advance(10_001)
      vi.advanceTimersByTime(1_000)

      expect(connectionChanges).toEqual([true])
    } finally {
      vi.useRealTimers()
    }
  })

  it('starting twice does not stack intervals', () => {
    vi.useFakeTimers()
    try {
      const { service, connectionChanges, clock } = setup({ heartbeatPollMs: 100 })
      service.touchExtension()
      service.startHeartbeatMonitor()
      service.startHeartbeatMonitor()

      clock.advance(10_001)
      vi.advanceTimersByTime(100)

      // Two stacked intervals would emit `false` twice on the same tick.
      expect(connectionChanges).toEqual([true, false])
      service.stopHeartbeatMonitor()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sessionService — notification is optional', () => {
  it('works with no callbacks injected', () => {
    const service = createSessionService()
    expect(() => {
      service.activateCase('case-1')
      service.start()
      service.touchExtension()
      service.stop()
    }).not.toThrow()
  })
})
