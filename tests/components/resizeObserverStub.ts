import { vi } from 'vitest'

// jsdom implements no ResizeObserver and the jsdom vitest project declares no
// setupFiles, so anything rendering react-resizable-panels throws a
// ReferenceError before a single assertion runs. Same shape as matchMediaStub.
export function stubResizeObserver() {
  class ResizeObserverStub {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub
  })
}
