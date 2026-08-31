/**
 * Moves `navigator.platform`, the seam the accelerator hints read (#902).
 *
 * jsdom reports `''` for it, which is already the non-macOS answer, so only the
 * macOS path needs a stub. The property is configurable, so an own property
 * shadows jsdom's prototype getter and deleting it hands the getter back.
 */
export function stubPlatform(value: string): void {
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true })
}

/** Undoes `stubPlatform`. Safe to call when nothing was stubbed. */
export function restorePlatform(): void {
  Reflect.deleteProperty(window.navigator, 'platform')
}

/** The macOS value Chromium reports, including under Apple silicon. */
export const MAC_PLATFORM = 'MacIntel'
