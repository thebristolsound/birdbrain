// A window created with `show: false` is revealed on 'ready-to-show', which fires on the
// renderer's first meaningful paint. That is the flicker-free path and stays the primary
// one — but Electron 38+ regressed it under Wayland, where it can never fire at all,
// leaving the window hidden forever while the app is otherwise completely healthy: main
// process alive, renderer loaded, updater running, CPU idle, exit code 0.
//
// Upstream: electron/electron#48859, tracked to Chromium 479458083 (DidMeaningfulLayout
// never runs, and that is what gates ready-to-show). Still open as of Electron 42.
// 'did-finish-load' does still fire, so on Linux we reveal on whichever arrives first —
// the same fix FreeTube#8294 landed and an Electron maintainer pointed others to.
//
// The gate is the platform, not the ozone backend: Electron 38+ selects Wayland by
// itself, so there is no flag to test at runtime. Every other platform keeps
// 'ready-to-show' alone and is unaffected.

// Structural, not `BrowserWindow`, so the behaviour is testable without an Electron
// window. A real BrowserWindow satisfies it.
export interface RevealableWindow {
  on(event: 'ready-to-show', listener: () => void): unknown
  show(): void
  isDestroyed(): boolean
  webContents: {
    on(event: 'did-finish-load', listener: () => void): unknown
  }
}

// Reveals `win` exactly once, on the first event that says the renderer is up.
export function revealWhenReady(
  win: RevealableWindow,
  platform: NodeJS.Platform = process.platform
): void {
  let revealed = false
  const reveal = (): void => {
    // isDestroyed() guards the window closing between the event and this call — show()
    // on a destroyed window throws, and here that would be an unhandled exception in an
    // Electron event handler.
    if (revealed || win.isDestroyed()) return
    revealed = true
    win.show()
  }

  win.on('ready-to-show', reveal)
  if (platform === 'linux') {
    win.webContents.on('did-finish-load', reveal)
  }
}
