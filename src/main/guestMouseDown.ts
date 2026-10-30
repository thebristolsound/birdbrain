import { sendEvent } from '@main/ipcWrap'
import { IPC_CHANNELS, type GuestKeyModifier, type GuestMouseButton } from '@shared/ipc'

// Input inside a <webview> never reaches the document that embeds it, so a menu that
// document opened over the guest cannot see a click in the stored page (#1708), and
// the viewer cannot see a click on a link (#1735). The main process sees the guest's
// mouse events before the page does and tells the embedding renderer of each press
// and each release.

interface GuestMouse {
  type: string
  button?: string
  clickCount?: number
}

interface GuestKey {
  type: string
  key: string
  shift: boolean
  control: boolean
  alt: boolean
  meta: boolean
}

// Structural, not `WebContents`, so the forwarding is testable without a guest. A
// webview's WebContents satisfies it.
type MouseListener = (event: unknown, mouse: GuestMouse) => void
type KeyListener = (event: unknown, input: GuestKey) => void

interface KeyWatched {
  on(event: 'before-input-event', listener: KeyListener): unknown
  on(event: 'blur', listener: () => void): unknown
  off(event: 'before-input-event', listener: KeyListener): unknown
  off(event: 'blur', listener: () => void): unknown
}

export interface MouseForwardingGuest extends KeyWatched {
  readonly id: number
  readonly hostWebContents:
    ({ send(channel: string, ...args: unknown[]): void } & KeyWatched) | null
  on(event: 'before-mouse-event', listener: MouseListener): unknown
  on(event: 'before-input-event', listener: KeyListener): unknown
  on(event: 'blur', listener: () => void): unknown
  off(event: 'before-mouse-event', listener: MouseListener): unknown
  off(event: 'before-input-event', listener: KeyListener): unknown
  off(event: 'blur', listener: () => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

function buttonOf(button: string | undefined): GuestMouseButton | null {
  return button === 'left' || button === 'middle' || button === 'right' ? button : null
}

const KEY_MODIFIERS: readonly GuestKeyModifier[] = ['shift', 'control', 'alt', 'meta']
const KEY_NAMES: Record<string, GuestKeyModifier> = {
  Shift: 'shift',
  Control: 'control',
  Alt: 'alt',
  Meta: 'meta'
}

// The keys held, from the last key event either the guest or its host saw. A keyUp of
// a modifier drops that key whatever its own flags say.
function heldKeys(input: GuestKey): GuestKeyModifier[] {
  const held = KEY_MODIFIERS.filter((key) => input[key])
  return input.type === 'keyUp' ? held.filter((key) => key !== KEY_NAMES[input.key]) : held
}

/**
 * Sends `event:guestMouseDown` to the guest's host on every mouse press in the guest,
 * and `event:guestMouseUp` on every release. The events are read and never
 * prevented, so each still reaches the page.
 *
 * The release names the modifier keys held. Electron's `before-mouse-event` reports
 * none (the E2E spec pins that), so they are read from the key events the guest and
 * its host see, which are read and never prevented either. A key pressed while focus
 * was outside the app goes unseen, and so does a key let go there, so the held keys
 * are dropped whenever the guest or its host loses focus, which Electron also reports
 * on a switch to another window or app.
 */
export function forwardGuestMouseDown(guest: MouseForwardingGuest): void {
  let modifiers: GuestKeyModifier[] = []
  const onKey: KeyListener = (_event, input) => {
    modifiers = heldKeys(input)
  }
  const onBlur = () => {
    modifiers = []
  }
  const onMouse: MouseListener = (_event, { type, button, clickCount }) => {
    const host = guest.hostWebContents
    if (!host) return
    const guestWebContentsId = guest.id
    if (type === 'mouseDown') {
      sendEvent(host, IPC_CHANNELS.GUEST_MOUSE_DOWN, {
        guestWebContentsId,
        button: buttonOf(button)
      })
    } else if (type === 'mouseUp') {
      sendEvent(host, IPC_CHANNELS.GUEST_MOUSE_UP, {
        guestWebContentsId,
        button: buttonOf(button),
        clickCount: clickCount ?? 0,
        modifiers
      })
    }
  }
  const host = guest.hostWebContents
  guest.on('before-mouse-event', onMouse)
  guest.on('before-input-event', onKey)
  guest.on('blur', onBlur)
  host?.on('before-input-event', onKey)
  host?.on('blur', onBlur)
  guest.once('destroyed', () => {
    guest.off('before-mouse-event', onMouse)
    guest.off('before-input-event', onKey)
    guest.off('blur', onBlur)
    host?.off('before-input-event', onKey)
    host?.off('blur', onBlur)
  })
}
