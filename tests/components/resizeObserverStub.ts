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

// The same stub, plus a way to report a width to every element still observed, for components
// that size themselves from the observer.
export function stubResizeObserverWithWidth(): (width: number) => void {
  const live = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>()
  class ResizeObserverStub {
    private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> }
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() }
      live.add(this.entry)
    }
    observe(target: Element) {
      this.entry.targets.add(target)
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target)
    }
    disconnect() {
      live.delete(this.entry)
    }
  }
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub
  })
  return (width) => {
    for (const { callback, targets } of [...live]) {
      const entries = [...targets].map(
        (target) => ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry
      )
      if (entries.length) callback(entries, {} as ResizeObserver)
    }
  }
}
