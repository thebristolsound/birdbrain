import { describe, it, expect, vi } from 'vitest'
import { forwardGuestMouseDown, type MouseForwardingGuest } from '@main/guestMouseDown'
import { IPC_CHANNELS } from '@shared/ipc'

type Mouse = { type: string; button?: string; clickCount?: number }
type Key = {
  type: string
  key: string
  shift: boolean
  control: boolean
  alt: boolean
  meta: boolean
}
type Listener = (event: unknown, input: never) => void

// Holds the `before-input-event` and `blur` listeners registered on one webContents.
function keyEvents() {
  const keys = new Set<Listener>()
  const blurs = new Set<() => void>()
  return {
    keys,
    blurs,
    on: (event: string, listener: Listener) => {
      if (event === 'before-input-event') keys.add(listener)
      if (event === 'blur') blurs.add(listener as () => void)
    },
    off: (event: string, listener: Listener) => {
      if (event === 'before-input-event') keys.delete(listener)
      if (event === 'blur') blurs.delete(listener as () => void)
    }
  }
}

function fakeHost() {
  const { keys, blurs, on, off } = keyEvents()
  return { send: vi.fn<(channel: string, ...args: unknown[]) => void>(), on, off, keys, blurs }
}

function key(type: string, name: string, held: Partial<Key> = {}): Key {
  return { type, key: name, shift: false, control: false, alt: false, meta: false, ...held }
}

// Stands in for a webview's WebContents, holding the listeners forwardGuestMouseDown
// registers so a test can raise the guest's mouse and key events and its destruction.
function fakeGuest(host: ReturnType<typeof fakeHost> | null) {
  const mouse = new Set<Listener>()
  const guestKeys = keyEvents()
  let destroyed: (() => void) | null = null
  const preventDefault = vi.fn()
  const guest = {
    id: 7,
    hostWebContents: host,
    on: (event: string, listener: Listener) => {
      if (event === 'before-mouse-event') mouse.add(listener)
      guestKeys.on(event, listener)
    },
    off: (event: string, listener: Listener) => {
      if (event === 'before-mouse-event') mouse.delete(listener)
      guestKeys.off(event, listener)
    },
    once: (_event: string, listener: () => void) => {
      destroyed = listener
    }
  } as unknown as MouseForwardingGuest
  const raise = (listeners: Set<Listener>, input: Mouse | Key) => {
    for (const listener of listeners) listener({ preventDefault }, input as never)
  }
  return {
    guest,
    preventDefault,
    press: (type: string, input: Omit<Mouse, 'type'> = {}) => raise(mouse, { type, ...input }),
    guestKey: (input: Key) => raise(guestKeys.keys, input),
    hostKey: (input: Key) => host && raise(host.keys, input),
    guestBlur: () => guestKeys.blurs.forEach((listener) => listener()),
    hostBlur: () => host?.blurs.forEach((listener) => listener()),
    destroy: () => destroyed?.(),
    listeners: () =>
      mouse.size +
      guestKeys.keys.size +
      guestKeys.blurs.size +
      (host ? host.keys.size + host.blurs.size : 0)
  }
}

describe('forwardGuestMouseDown', () => {
  it('tells the host of a press in the guest, naming the guest and its button', () => {
    const host = fakeHost()
    const { guest, press } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    press('mouseDown', { button: 'middle' })

    expect(host.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.GUEST_MOUSE_DOWN, {
      guestWebContentsId: 7,
      button: 'middle'
    })
  })

  // #1735. The viewer pairs a release with the press before it to tell a click on a
  // link from a drag or a modified click.
  it('tells the host of a release, with its button and click count, and no keys held', () => {
    const host = fakeHost()
    const { guest, press } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    press('mouseUp', { button: 'left', clickCount: 2 })

    expect(host.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.GUEST_MOUSE_UP, {
      guestWebContentsId: 7,
      button: 'left',
      clickCount: 2,
      modifiers: []
    })
  })

  it('names the modifier keys held, from key events in the guest or its host', () => {
    const host = fakeHost()
    const { guest, press, guestKey, hostKey } = fakeGuest(host)
    forwardGuestMouseDown(guest)
    const released = () => host.send.mock.calls.at(-1)?.[1]

    guestKey(key('keyDown', 'Control', { control: true }))
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: ['control'] })

    hostKey(key('keyDown', 'Alt', { shift: true, alt: true, meta: true }))
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: ['shift', 'alt', 'meta'] })

    // A keyUp drops its own key even when its flags still name it.
    hostKey(key('keyUp', 'Alt', { shift: true, alt: true, meta: true }))
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: ['shift', 'meta'] })

    guestKey(key('keyUp', 'a'))
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: [] })
  })

  // #1735 review. A key let go while another window had focus is never seen to go up,
  // so it would stay held and make every later plain click a modified one.
  it('drops the held keys when the guest or its host loses focus', () => {
    const host = fakeHost()
    const { guest, press, guestKey, hostKey, guestBlur, hostBlur } = fakeGuest(host)
    forwardGuestMouseDown(guest)
    const released = () => host.send.mock.calls.at(-1)?.[1]

    hostKey(key('keyDown', 'Alt', { alt: true }))
    hostBlur()
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: [] })

    guestKey(key('keyDown', 'Meta', { meta: true }))
    guestBlur()
    press('mouseUp', { button: 'left' })
    expect(released()).toMatchObject({ modifiers: [] })
  })

  it('reports a press or release with no button or click count as such', () => {
    const host = fakeHost()
    const { guest, press } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    press('mouseDown', { button: 'back' })
    press('mouseUp')

    expect(host.send.mock.calls).toEqual([
      [IPC_CHANNELS.GUEST_MOUSE_DOWN, { guestWebContentsId: 7, button: null }],
      [
        IPC_CHANNELS.GUEST_MOUSE_UP,
        { guestWebContentsId: 7, button: null, clickCount: 0, modifiers: [] }
      ]
    ])
  })

  it('forwards no other mouse event, and prevents none, nor any key event', () => {
    const host = fakeHost()
    const { guest, press, guestKey, hostKey, preventDefault } = fakeGuest(host)
    forwardGuestMouseDown(guest)

    for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'mouseWheel', 'contextMenu']) {
      press(type)
    }
    press('mouseDown')
    press('mouseUp')
    guestKey(key('keyDown', 'Shift', { shift: true }))
    hostKey(key('keyDown', 'Shift', { shift: true }))

    expect(host.send.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.GUEST_MOUSE_DOWN,
      IPC_CHANNELS.GUEST_MOUSE_UP
    ])
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('sends nothing from a guest with no host', () => {
    const { guest, press, guestKey } = fakeGuest(null)
    forwardGuestMouseDown(guest)

    expect(() => guestKey(key('keyDown', 'Shift', { shift: true }))).not.toThrow()
    expect(() => press('mouseDown')).not.toThrow()
    expect(() => press('mouseUp')).not.toThrow()
  })

  it('removes its listeners from the guest and its host when the guest is destroyed', () => {
    const host = fakeHost()
    const { guest, press, destroy, listeners } = fakeGuest(host)
    forwardGuestMouseDown(guest)
    expect(listeners()).toBe(5)

    destroy()
    press('mouseDown')
    press('mouseUp')

    expect(listeners()).toBe(0)
    expect(host.send).not.toHaveBeenCalled()
  })
})
