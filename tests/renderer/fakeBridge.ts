import { vi } from 'vitest'

type Birdbrain = Window['birdbrain']
type Overrides = Record<string, unknown>

// The bridge surface, mirroring the BirdbrainAPI declaration in
// src/renderer/env.d.ts. That declaration — not the preload literal — is what
// the renderer compiles against and what this util hands back, so it is the
// shape a component under test actually reaches for.
//
// Known divergence, and the reason that distinction is worth stating: the
// preload literal (src/preload/index.ts) still exposes the wayback namespace
// under its pre-#256 name `archive`. Nothing typechecks preload against
// BirdbrainAPI, so the rename left it behind and no test can see it. Reported
// separately; out of scope for #229.
const NAMESPACES = [
  'cases',
  'captures',
  'recapture',
  'tags',
  'selectors',
  'notes',
  'wayback',
  'annotations',
  'extension',
  'session',
  'settings',
  'export',
  'shell',
  'app',
  'diagnostics',
  'updates',
  'db',
  'ai',
  'extractedData'
] as const

const EVENTS = [
  'onExportProgress',
  'onArchiveProgress',
  'onNewCapture',
  'onSessionStateChanged',
  'onExtensionConnection',
  'onCaptureActivity',
  'onLogEntry',
  'onSelectorRematched',
  'onDeepLinkNavigate',
  'onUpdateStatus'
] as const

const TOP_LEVEL = ['search', 'testPipeline', 'testHttp'] as const

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([...NAMESPACES, ...EVENTS, ...TOP_LEVEL])

/**
 * Installs a typed stub at `window.birdbrain` and returns it.
 *
 * Every namespace method that a test has not stubbed rejects with a named
 * error rather than resolving `undefined`, so a missing stub fails loudly at
 * the call instead of surfacing as an unrelated assertion failure three lines
 * later. Event subscriptions default to a no-op returning an unsubscribe.
 */
export function fakeBridge(overrides: Overrides = {}): Birdbrain {
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
  ;(window as unknown as { birdbrain: Birdbrain }).birdbrain = bridge as unknown as Birdbrain
  return bridge as unknown as Birdbrain
}
