import { vi } from 'vitest'

type Birdbrain = Window['birdbrain']

// Namespaces and top-level methods mirror the real bridge in src/preload/index.ts.
const NAMESPACES = [
  'cases',
  'captures',
  'recapture',
  'tags',
  'selectors',
  'notes',
  'archive',
  'annotations',
  'extension',
  'settings',
  'export',
  'shell',
  'app',
  'updates',
  'db',
  'ai',
  'extractedData'
] as const

const TOP_LEVEL_METHODS = ['search', 'testPipeline', 'testHttp'] as const

const EVENT_METHODS = [
  'onExportProgress',
  'onArchiveProgress',
  'onNewCapture',
  'onSessionStateChanged',
  'onExtensionConnection',
  'onCaptureActivity',
  'onSelectorRematched',
  'onDeepLinkNavigate',
  'onUpdateStatus'
] as const

export function fakeBridge(
  overrides: Partial<{ [K in keyof Birdbrain]: Partial<Birdbrain[K]> }> = {}
): Birdbrain {
  const stub = (name: string) =>
    vi.fn(async () => {
      throw new Error(`fakeBridge: ${name} not stubbed`)
    })

  const bridge = Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      new Proxy(
        {},
        {
          get: (_target, method) =>
            (overrides[ns] as Record<string | symbol, unknown> | undefined)?.[method] ??
            stub(`${ns}.${String(method)}`)
        }
      )
    ])
  ) as Record<string, unknown>

  for (const method of TOP_LEVEL_METHODS) {
    bridge[method] = (overrides[method] as unknown) ?? stub(method)
  }
  for (const method of EVENT_METHODS) {
    bridge[method] = (overrides[method] as unknown) ?? vi.fn(() => () => {})
  }

  const typed = bridge as unknown as Birdbrain
  const g = globalThis as { window?: { birdbrain?: Birdbrain } }
  if (g.window) {
    g.window.birdbrain = typed
  } else {
    g.window = { birdbrain: typed }
  }
  return typed
}
