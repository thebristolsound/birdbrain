import { describe, it, expect, vi } from 'vitest'
import { revealWhenReady, type RevealableWindow } from '@main/windowReveal'

// Stands in for a BrowserWindow, capturing the listeners revealWhenReady registers so a
// test can fire either one — the point of the module is which events reveal the window,
// and on a real window neither event is under the test's control.
function fakeWindow(): {
  win: RevealableWindow
  show: ReturnType<typeof vi.fn>
  destroy: () => void
  fireReadyToShow: () => void
  fireDidFinishLoad: () => void
} {
  const show = vi.fn()
  let destroyed = false
  let readyToShow: (() => void) | null = null
  let didFinishLoad: (() => void) | null = null

  const win: RevealableWindow = {
    on(event, listener) {
      if (event === 'ready-to-show') readyToShow = listener
      return win
    },
    show,
    isDestroyed: () => destroyed,
    webContents: {
      on(event, listener) {
        if (event === 'did-finish-load') didFinishLoad = listener
        return win.webContents
      }
    }
  }

  return {
    win,
    show,
    destroy: () => {
      destroyed = true
    },
    fireReadyToShow: () => readyToShow?.(),
    // Throws rather than no-ops: a silent miss here would let the Linux fallback
    // regress to unregistered without failing a test.
    fireDidFinishLoad: () => {
      if (!didFinishLoad) throw new Error('did-finish-load listener was never registered')
      didFinishLoad()
    }
  }
}

describe('revealWhenReady', () => {
  it('shows the window on ready-to-show', () => {
    const w = fakeWindow()
    revealWhenReady(w.win, 'darwin')

    w.fireReadyToShow()

    expect(w.show).toHaveBeenCalledTimes(1)
  })

  it('does not show the window before either event fires', () => {
    const w = fakeWindow()
    revealWhenReady(w.win, 'linux')

    expect(w.show).not.toHaveBeenCalled()
  })

  // The #643 regression: on Wayland, Electron 38+ can never emit ready-to-show, so
  // did-finish-load is the only signal that arrives.
  it('shows the window on did-finish-load when ready-to-show never fires, on Linux', () => {
    const w = fakeWindow()
    revealWhenReady(w.win, 'linux')

    w.fireDidFinishLoad()

    expect(w.show).toHaveBeenCalledTimes(1)
  })

  // The fallback is deliberately Linux-only: elsewhere ready-to-show is reliable, and
  // revealing on did-finish-load would show an unpainted window — the flash that
  // `show: false` exists to prevent.
  it.each(['darwin', 'win32'] as const)(
    'does not register the did-finish-load fallback on %s',
    (platform) => {
      const w = fakeWindow()
      revealWhenReady(w.win, platform)

      expect(() => w.fireDidFinishLoad()).toThrow(/never registered/)
      expect(w.show).not.toHaveBeenCalled()
    }
  )

  it('shows the window only once when both events fire', () => {
    const w = fakeWindow()
    revealWhenReady(w.win, 'linux')

    w.fireReadyToShow()
    w.fireDidFinishLoad()
    w.fireReadyToShow()

    expect(w.show).toHaveBeenCalledTimes(1)
  })

  // show() throws on a destroyed window, and this runs inside an Electron event
  // handler, so an unguarded call would surface as an unhandled main-process exception.
  it('does not show a window destroyed between the event and the reveal', () => {
    const w = fakeWindow()
    revealWhenReady(w.win, 'linux')

    w.destroy()
    w.fireDidFinishLoad()

    expect(w.show).not.toHaveBeenCalled()
  })

  it('defaults to the current platform when none is given', () => {
    const w = fakeWindow()
    revealWhenReady(w.win)

    w.fireReadyToShow()

    expect(w.show).toHaveBeenCalledTimes(1)
  })
})
