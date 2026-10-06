import { sendEvent } from '@main/ipcWrap'
import { IPC_CHANNELS } from '@shared/ipc'

// Input inside a <webview> never reaches the document that embeds it, so a menu that
// document opened over the guest cannot see a click in the stored page (#1708). The
// main process sees the guest's mouse events before the page does and tells the
// embedding renderer of each press.

// Structural, not `WebContents`, so the forwarding is testable without a guest. A
// webview's WebContents satisfies it.
type MouseListener = (event: unknown, mouse: { type: string }) => void

export interface MouseForwardingGuest {
  readonly id: number
  readonly hostWebContents: { send(channel: string, ...args: unknown[]): void } | null
  on(event: 'before-mouse-event', listener: MouseListener): unknown
  off(event: 'before-mouse-event', listener: MouseListener): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

/**
 * Sends `event:guestMouseDown` to the guest's host on every mouse press in the guest.
 * The event is read and never prevented, so the press still reaches the page.
 */
export function forwardGuestMouseDown(guest: MouseForwardingGuest): void {
  const onMouse: MouseListener = (_event, { type }) => {
    const host = guest.hostWebContents
    if (type !== 'mouseDown' || !host) return
    sendEvent(host, IPC_CHANNELS.GUEST_MOUSE_DOWN, { guestWebContentsId: guest.id })
  }
  guest.on('before-mouse-event', onMouse)
  guest.once('destroyed', () => guest.off('before-mouse-event', onMouse))
}
