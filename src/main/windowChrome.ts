// Window chrome for the main window and the Capture Session pop-out: the OS title bar is
// hidden and a bar the renderer draws stands in for it, the way T3 Code and Zed draw theirs.
//
// macOS keeps its native traffic lights, inset so they sit in the top bar. Windows and
// Linux use Chromium's window-controls overlay, which paints native minimise, maximise
// and close buttons inside the web content; the overlay carries the top bar's colour so
// the buttons read as part of it. The renderer pads clear of them with the
// `titlebar-area-*` CSS environment variables (see TopBar.tsx).
//
// Kept out of index.ts so it is reachable by tests — index.ts is in the coverage exclude
// list and imports Electron at module scope.

import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'

export type WindowTheme = 'dark' | 'light'

// Matches the top bar's `h-12`, so the native buttons span exactly the header.
export const TITLE_BAR_HEIGHT = 48

// Mirrors --color-surface (the top bar's fill), --color-canvas (behind the renderer until
// first paint) and --color-text-muted in globals.css, and `tint` is --color-accent-subtle
// over --color-surface (the pop-out's bar). Hex because BrowserWindow takes a colour, not a
// token.
const THEME_COLORS: Record<
  WindowTheme,
  { surface: string; canvas: string; symbol: string; tint: string }
> = {
  dark: { surface: '#0e0e11', canvas: '#090a0b', symbol: '#a1a1aa', tint: '#1c1c35' },
  light: { surface: '#f4f4f5', canvas: '#fafafa', symbol: '#52525b', tint: '#e6e6f5' }
}

export function windowBackgroundColor(theme: WindowTheme): string {
  return THEME_COLORS[theme].canvas
}

// The overlay object for Windows and Linux; `null` on macOS, where the traffic lights
// are the controls and `setTitleBarOverlay` is unsupported.
export function titleBarOverlay(
  theme: WindowTheme,
  platform: NodeJS.Platform = process.platform
): TitleBarOverlay | null {
  if (platform === 'darwin') return null
  const { surface, symbol } = THEME_COLORS[theme]
  return { color: surface, symbolColor: symbol, height: TITLE_BAR_HEIGHT }
}

export function titleBarOptions(
  theme: WindowTheme,
  platform: NodeJS.Platform = process.platform
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      // Vertically centred in the 48px bar; x matches the bar's horizontal padding.
      trafficLightPosition: { x: 16, y: 16 }
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(theme, platform) ?? undefined,
    // No application menu is set, so this is Electron's default menu. Hidden, it keeps
    // its accelerators (reload, devtools, quit) and Alt still reveals it.
    autoHideMenuBar: true
  }
}

// The Capture Session panel popped out (`1g`). Its bar holds 28-pixel controls under a
// 2-pixel accent rule, so it is taller than the 26 pixels the canvas draws; CaptureSessionWindow
// draws it at this height.
export const POP_OUT_TITLE_BAR_HEIGHT = 32
export const POP_OUT_SIZE = { width: 300, height: 224 } as const

export function popOutBackgroundColor(theme: WindowTheme): string {
  return THEME_COLORS[theme].surface
}

export function popOutTitleBarOverlay(
  theme: WindowTheme,
  platform: NodeJS.Platform = process.platform
): TitleBarOverlay | null {
  if (platform === 'darwin') return null
  const { tint, symbol } = THEME_COLORS[theme]
  return { color: tint, symbolColor: symbol, height: POP_OUT_TITLE_BAR_HEIGHT }
}

// A fixed size, with no maximise or full screen: the panel's content is laid out for 300
// pixels. The page sets the Case into the title once it has read it.
export function popOutWindowOptions(
  theme: WindowTheme,
  platform: NodeJS.Platform = process.platform
): BrowserWindowConstructorOptions {
  const chrome: BrowserWindowConstructorOptions =
    platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 8 } }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: popOutTitleBarOverlay(theme, platform) ?? undefined,
          autoHideMenuBar: true
        }
  return {
    ...POP_OUT_SIZE,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Birdbrain · Capture Session',
    backgroundColor: popOutBackgroundColor(theme),
    ...chrome
  }
}
