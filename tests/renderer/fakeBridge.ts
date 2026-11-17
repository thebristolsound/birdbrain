import { vi } from 'vitest'
import { bridgePath, isEventChannel, type BirdbrainAPI } from '@shared/birdbrainApi'
import { IPC_CHANNELS } from '@shared/ipc'

type Overrides = Record<string, unknown>

// The bridge surface comes from the contract, as the preload's does: each
// channel's path names a namespace, an event subscription or a top-level
// method. This util still builds every namespace, so a missing test stub
// fails at the call site.
const NAMESPACES = new Set<string>()
const EVENTS: string[] = []
const TOP_LEVEL: string[] = []
for (const channel of Object.values(IPC_CHANNELS)) {
  const path = bridgePath(channel)
  if (isEventChannel(channel)) EVENTS.push(path)
  else if (path.includes('.')) NAMESPACES.add(path.slice(0, path.indexOf('.')))
  else TOP_LEVEL.push(path)
}

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([...NAMESPACES, ...EVENTS, ...TOP_LEVEL])

/**
 * Installs a typed stub at `window.birdbrain` and returns it.
 *
 * Every namespace method that a test has not stubbed rejects with a named
 * error rather than resolving `undefined`, so a missing stub fails loudly at
 * the call instead of surfacing as an unrelated assertion failure three lines
 * later. Event subscriptions default to a no-op returning an unsubscribe.
 */
export function fakeBridge(overrides: Overrides = {}): BirdbrainAPI {
  // An override for a key the bridge does not have would otherwise be dropped
  // in silence, leaving the test green against a namespace nothing can reach.
  for (const key of Object.keys(overrides)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`fakeBridge: "${key}" is not part of the bridge surface`)
    }
  }

  const bridge: Record<string, unknown> = {}

  for (const ns of NAMESPACES) {
    const stubbed = (overrides[ns] ?? {}) as Record<string, unknown>
    bridge[ns] = new Proxy(stubbed, {
      // Returns the throwing stub rather than calling it — invoking here would
      // throw at property-access time, before the test could await anything.
      get(target, method: string) {
        if (method in target) return target[method]
        return vi.fn(async () => {
          throw new Error(`fakeBridge: ${ns}.${method} called but not stubbed`)
        })
      }
    })
  }

  for (const evt of EVENTS) {
    bridge[evt] = overrides[evt] ?? vi.fn(() => () => {})
  }

  for (const fn of TOP_LEVEL) {
    bridge[fn] =
      overrides[fn] ??
      vi.fn(async () => {
        throw new Error(`fakeBridge: ${fn} called but not stubbed`)
      })
  }

  // Assigns the property rather than replacing globalThis.window: in the jsdom
  // project `window` is a getter and reassigning it fails.
  // Assembled key by key from the namespace lists above, so it is only ever a
  // partial stand-in for the full bridge — hence the widening cast.
  const typedBridge = bridge as unknown as BirdbrainAPI
  ;(window as unknown as { birdbrain: BirdbrainAPI }).birdbrain = typedBridge
  return typedBridge
}

/**
 * The `egress` stub for a test that contacts a site but is not about the VPN warning:
 * main answers that no warning is due, so the contact goes ahead.
 */
export function quietVpnWarning() {
  return {
    checkVpnWarning: vi.fn(async () => ({ caseId: '', warn: false, canMute: false }))
  }
}
