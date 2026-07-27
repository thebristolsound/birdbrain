// Capture-session state machine: which case is active, whether recording is on,
// how many captures this session has taken, and whether the companion extension
// is still talking to us.
//
// This module is pure state plus a heartbeat timer. It never touches a
// BrowserWindow — change notification is injected as callbacks, so the state
// machine is testable without Electron and the capture server stops owning
// broadcast responsibility for session events.

import type { SessionStateEvent } from '@shared/ipc'

// The extension is considered present if it has polled within this window.
const DEFAULT_EXTENSION_TIMEOUT_MS = 10_000
// How often the heartbeat monitor looks for an expired extension.
const DEFAULT_HEARTBEAT_POLL_MS = 5_000

export interface SessionSnapshot {
  activeCaseId: string | null
  sessionActive: boolean
  captureCount: number
  extensionLastSeen: number
}

export interface SessionServiceDeps {
  // Fired whenever active case / recording / capture count changes.
  emitSessionChange?: (state: SessionStateEvent) => void
  // Fired on the rising and falling edge of extension reachability only.
  emitExtensionConnection?: (connected: boolean) => void
  // Injection seams for tests; both default to the constants above.
  extensionTimeoutMs?: number
  heartbeatPollMs?: number
  now?: () => number
}

export interface SessionService {
  snapshot: () => SessionSnapshot
  activateCase: (caseId: string) => void
  start: () => void
  stop: () => void
  countCapture: () => void
  touchExtension: () => void
  // Falling-edge check. Called by the heartbeat monitor, and directly by tests.
  expireExtensionIfStale: () => void
  isExtensionConnected: () => boolean
  startHeartbeatMonitor: () => void
  stopHeartbeatMonitor: () => void
  reset: () => void
}

export function createSessionService(deps: SessionServiceDeps = {}): SessionService {
  const {
    emitSessionChange,
    emitExtensionConnection,
    extensionTimeoutMs = DEFAULT_EXTENSION_TIMEOUT_MS,
    heartbeatPollMs = DEFAULT_HEARTBEAT_POLL_MS,
    now = Date.now
  } = deps

  let activeCaseId: string | null = null
  let sessionActive = false
  let captureCount = 0
  let extensionLastSeen = 0
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null

  const snapshot = (): SessionSnapshot => ({
    activeCaseId,
    sessionActive,
    captureCount,
    extensionLastSeen
  })

  const notifyChange = (): void => {
    emitSessionChange?.({ sessionActive, activeCaseId, captureCount })
  }

  const isExtensionConnected = (): boolean =>
    extensionLastSeen > 0 && now() - extensionLastSeen < extensionTimeoutMs

  // Zeroing last-seen is what makes this edge-triggered: without it the monitor
  // would re-emit `false` on every tick, and the next extension poll would not
  // register as a rising edge.
  const expireExtensionIfStale = (): void => {
    if (!isExtensionConnected() && extensionLastSeen > 0) {
      emitExtensionConnection?.(false)
      extensionLastSeen = 0
    }
  }

  return {
    snapshot,

    activateCase: (caseId) => {
      activeCaseId = caseId
      notifyChange()
    },

    start: () => {
      sessionActive = true
      captureCount = 0
      notifyChange()
    },

    stop: () => {
      sessionActive = false
      notifyChange()
    },

    // Deliberately silent: the pre-refactor code incremented the count without
    // notifying, so the renderer learns the new count on the next session
    // change. Preserved exactly rather than "fixed" here.
    countCapture: () => {
      captureCount++
    },

    touchExtension: () => {
      const wasConnected = isExtensionConnected()
      extensionLastSeen = now()
      if (!wasConnected) emitExtensionConnection?.(true)
    },

    expireExtensionIfStale,

    isExtensionConnected,

    startHeartbeatMonitor: () => {
      if (heartbeatInterval) return
      heartbeatInterval = setInterval(expireExtensionIfStale, heartbeatPollMs)
    },

    stopHeartbeatMonitor: () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
    },

    reset: () => {
      activeCaseId = null
      sessionActive = false
      captureCount = 0
      extensionLastSeen = 0
    }
  }
}
