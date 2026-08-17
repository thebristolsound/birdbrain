// Window geometry for the main window, and the one environment override that can change it.
//
// The override exists for the exploratory harness (scripts/exploratory-harness.mjs), which
// drives layout charters at deliberately chosen sizes. It is read only when the app is
// running unpackaged: a shipped build must not resize itself because a stray variable is set
// in the operator's environment, and no evidentiary output depends on window geometry either
// way (nothing here reaches a capture, hash, manifest entry or signature).
//
// Kept out of index.ts so it is reachable by tests — index.ts is in vitest.config.ts's
// coverage exclude list and imports Electron at module scope, so behaviour asserted there
// would be invisible to both the suite and the diff-coverage gate.

export interface WindowSize {
  width: number
  height: number
}

export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1200, height: 800 }

// Mirrors the minWidth/minHeight passed to BrowserWindow in index.ts.
export const MIN_WINDOW_SIZE: WindowSize = { width: 900, height: 600 }

// Above this a value is a typo rather than an intent; Electron would accept it and hand back
// a window clamped to the display anyway.
const MAX_WINDOW_DIMENSION = 10000

const SIZE_PATTERN = /^(\d+)x(\d+)$/

/**
 * Resolves the main window's requested size from `BIRDBRAIN_WINDOW_SIZE`.
 *
 * Falls back to `DEFAULT_WINDOW_SIZE` for anything it cannot honour, including sizes below
 * the BrowserWindow minimum — Electron enforces `minWidth`/`minHeight` at construction
 * (electron#49906), so a smaller request cannot produce the window the caller asked for and
 * would silently mislead a layout charter.
 *
 * The display clamps the result independently of this function: a 1600-wide request on a
 * 1440-wide screen yields a narrower window. Callers that care must read the realized size
 * back from the window.
 */
export function resolveWindowSize(value: string | undefined, allowOverride: boolean): WindowSize {
  if (!allowOverride) return { ...DEFAULT_WINDOW_SIZE }

  const match = value?.match(SIZE_PATTERN)
  if (!match) return { ...DEFAULT_WINDOW_SIZE }

  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  if (width < MIN_WINDOW_SIZE.width || height < MIN_WINDOW_SIZE.height) {
    return { ...DEFAULT_WINDOW_SIZE }
  }
  if (width > MAX_WINDOW_DIMENSION || height > MAX_WINDOW_DIMENSION) {
    return { ...DEFAULT_WINDOW_SIZE }
  }
  return { width, height }
}
