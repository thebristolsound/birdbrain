import { vi } from 'vitest'
import type { BirdbrainAPI } from '@shared/birdbrainApi'

type Overrides = Record<string, unknown>
type FunctionKey = {
  [K in keyof BirdbrainAPI]: BirdbrainAPI[K] extends (...args: never[]) => unknown ? K : never
}[keyof BirdbrainAPI]
type EventKey = Extract<FunctionKey, `on${string}`>
type TopLevelKey = Exclude<FunctionKey, EventKey>
type NamespaceKey = Exclude<keyof BirdbrainAPI, FunctionKey>

// The bridge surface mirrors the shared BirdbrainAPI contract. The preload
// literal is checked against the same contract, while this util still builds
// every namespace explicitly so a missing test stub fails at the call site.
const NAMESPACES = [
  'cases',
  'captures',
  'recapture',
  'tags',
  'persona',
  'selectors',
  'notes',
  'wayback',
  'annotations',
  'extension',
  'session',
  'settings',
  'export',
  'shell',
  'exhibits',
  'manifest',
  'staging',
  'app',
  'diagnostics',
  'updates',
  'db',
  'extractedData'
] as const satisfies readonly NamespaceKey[]

const EVENTS = [
  'onExportProgress',
  'onArchiveProgress',
  'onNewCapture',
  'onSessionStateChanged',
  'onExtensionConnection',
  'onExtensionAttach',
  'onCaptureActivity',
  'onLogEntry',
  'onSelectorRematched',
  'onDeepLinkNavigate',
  'onUpdateStatus',
  'onGuestFrameReplaced',
  'onGuestMouseDown'
] as const satisfies readonly EventKey[]

const TOP_LEVEL = ['search', 'testPipeline', 'testHttp'] as const satisfies readonly TopLevelKey[]

type ListedBridgeKey =
  (typeof NAMESPACES)[number] | (typeof EVENTS)[number] | (typeof TOP_LEVEL)[number]
type MissingBridgeKey = Exclude<keyof BirdbrainAPI, ListedBridgeKey>
type AssertNever<T extends never> = T
export type FakeBridgeKeysAreExhaustive = AssertNever<MissingBridgeKey>

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
