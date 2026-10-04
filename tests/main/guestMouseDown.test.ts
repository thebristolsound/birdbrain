import { describe, it, expect, vi } from 'vitest'
import { forwardGuestMouseDown, type MouseForwardingGuest } from '@main/guestMouseDown'
import { IPC_CHANNELS } from '@shared/ipc'

// Stands in for a webview's WebContents, holding the listeners forwardGuestMouseDown
// registers so a test can raise the guest's mouse events and its destruction.
function fakeGuest(host: MouseForwardingGuest['hostWebContents']) {
  const mouse = new Set<(event: unknown, input: { type: string }) => void>()
  let destroyed: (() => void) | null = null
  const preventDefault = vi.fn()
  const guest: MouseForwardingGuest = {
    id: 7,
    hostWebContents: host,
    on: (_event, listener) => mouse.add(listener),
    off: (_event, listener) => mouse.delete(listener),
    once: (_event, listener) => {
      destroyed = listener
    }
  }
  return {
    guest,
    preventDefault,
    press: (type: string) => {
      for (const listener of mouse) listener({ preventDefault }, { type })
    },
    destroy: () => destroyed?.(),
    listeners: () => mouse.size
  }
}

function fakeHost() {
  return { send: vi.fn<(channel: string, ...args: unknown[]) => void>() }
}

describe('forwardGuestMouseDown', () => {
  it('tells the host of a press in the guest, naming the guest', () => {
    const host = fakeHost()
    const { guest, press } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    press('mouseDown')

    expect(host.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.GUEST_MOUSE_DOWN, {
      guestWebContentsId: 7
    })
  })

  it('forwards no other mouse event, and prevents none', () => {
    const host = fakeHost()
    const { guest, press, preventDefault } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    for (const type of ['mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel']) {
      press(type)
    }
    press('mouseDown')

    expect(host.send).toHaveBeenCalledOnce()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('sends nothing from a guest with no host', () => {
    const { guest, press } = fakeGuest(null)
    forwardGuestMouseDown(guest)

    expect(() => press('mouseDown')).not.toThrow()
  })

  it('removes its listener when the guest is destroyed', () => {
    const host = fakeHost()
    const { guest, press, destroy, listeners } = fakeGuest(host)
    forwardGuestMouseDown(guest)
    expect(listeners()).toBe(1)

    destroy()
    press('mouseDown')

    expect(listeners()).toBe(0)
    expect(host.send).not.toHaveBeenCalled()
  })
})
