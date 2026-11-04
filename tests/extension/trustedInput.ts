import { vi } from 'vitest'

// jsdom cannot create a trusted event: isTrusted is a non-configurable own getter, and
// HTMLElement.click() dispatches isTrusted: false. These helpers stand in for operator input
// at unit level. The event still travels through the DOM, so capture order and stopPropagation
// behave as dispatched; only the 'mouseup' and 'click' listeners see isTrusted: true, and only
// for events sent through operatorMouseUp or operatorClick. A plain dispatchEvent or
// element.click() still arrives untrusted, the way page script's does.

const operatorEvents = new WeakSet<Event>()

// A Proxy rather than Object.create: jsdom rejects an Event method call whose receiver is not
// the real event, so through Object.create a listener calling stopPropagation() throws.
function asOperatorInput(event: Event): Event {
  return new Proxy(event, {
    get(target, property) {
      if (property === 'isTrusted') return true
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/**
 * Wraps the 'mouseup' and 'click' function listeners registered after it runs, so call it before
 * the module under test registers its own. A wrapped listener cannot be removed by its original
 * reference.
 */
export function installTrustedInput(): void {
  const addListener = EventTarget.prototype.addEventListener
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options
  ) {
    if ((type !== 'mouseup' && type !== 'click') || typeof listener !== 'function') {
      return addListener.call(this, type, listener, options)
    }
    const wrapped = function (this: EventTarget, event: Event): void {
      listener.call(this, operatorEvents.has(event) ? asOperatorInput(event) : event)
    }
    return addListener.call(this, type, wrapped, options)
  })
}

export function operatorMouseUp(target: EventTarget = document, init: MouseEventInit = {}): void {
  const event = new MouseEvent('mouseup', init)
  operatorEvents.add(event)
  target.dispatchEvent(event)
}

export function operatorClick(element: Element): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
  operatorEvents.add(event)
  element.dispatchEvent(event)
}
