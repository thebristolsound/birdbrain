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
    // The class itself, not a vi.fn() wrapping it: Vitest 5 constructs a mock
    // with Reflect.construct, and an arrow-function implementation is not
    // constructable, so `new ResizeObserver(...)` threw a TypeError.
    value: ResizeObserverStub
  })
}
