import { vi } from 'vitest'

type Birdbrain = Window['birdbrain']
type Overrides = Record<string, unknown>

const NAMESPACES = [
  'cases', 'captures', 'recapture', 'tags', 'selectors', 'notes', 'wayback',
  'annotations', 'extension', 'session', 'settings', 'export', 'shell', 'app',
  'diagnostics', 'updates', 'db', 'ai', 'extractedData'
] as const

const EVENTS = [
  'onExportProgress', 'onArchiveProgress', 'onNewCapture', 'onSessionStateChanged',
  'onExtensionConnection', 'onCaptureActivity', 'onSelectorRematched',
  'onDeepLinkNavigate', 'onUpdateStatus', 'onLogEntry'
] as const

const TOP_LEVEL = ['search', 'testPipeline', 'testHttp'] as const

export function fakeBridge(overrides: Overrides = {}): Birdbrain {
  const bridge: Record<string, unknown> = {}

  for (const ns of NAMESPACES) {
    const stubbed = (overrides[ns] ?? {}) as Record<string, unknown>
    bridge[ns] = new Proxy(stubbed, {
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

  vi.stubGlobal('birdbrain', bridge)
  return bridge as unknown as Birdbrain
}
