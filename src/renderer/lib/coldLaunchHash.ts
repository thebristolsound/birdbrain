/**
 * Reset the window hash to `#/` on cold app launch so the app always opens at
 * the cases index, regardless of whatever hash was active when the window last
 * closed. A `sessionStorage` flag survives Vite HMR reloads (so devs aren't
 * bumped back to `/` mid-session) but is cleared when the Electron window
 * closes — which is exactly the cold-launch boundary we want.
 */
const COLD_LAUNCH_FLAG = 'bb:booted'

export function resetHashOnColdLaunch(): void {
  if (typeof window === 'undefined') return
  if (sessionStorage.getItem(COLD_LAUNCH_FLAG)) return
  window.location.hash = '#/'
  sessionStorage.setItem(COLD_LAUNCH_FLAG, '1')
}

// Exposed for tests only.
export const __COLD_LAUNCH_FLAG = COLD_LAUNCH_FLAG
