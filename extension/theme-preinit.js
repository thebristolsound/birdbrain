/* global document, localStorage */
// Applies the persisted theme before first paint to prevent a flash.
// Must stay a classic, render-blocking script: MV3 CSP (script-src 'self')
// blocks inline scripts, and it must run before the popup body renders.
try {
  if (localStorage.getItem('bb-theme') !== 'light') {
    document.documentElement.classList.add('dark')
  }
} catch {
  // localStorage may be unavailable; default to dark
}
