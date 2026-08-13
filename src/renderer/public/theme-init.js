/* global document, localStorage */
// Applies persisted theme/motion/density state before first paint to avoid a
// flash. Loaded as an external classic script so the renderer CSP can drop
// script-src 'unsafe-inline' in production (see index.html + the strict-prod-csp
// plugin in electron.vite.config.ts).
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.classList.add('dark')
}
if (localStorage.getItem('reduceMotion') === 'true') {
  document.documentElement.classList.add('reduce-motion')
}
// An unset or unrecognised value falls back to the first-run density
// (DEFAULT_UI_DENSITY in src/shared/types.ts), duplicated here because this
// script is unbundled and cannot import it.
const storedDensity = localStorage.getItem('density')
document.documentElement.dataset.density =
  storedDensity === 'compact' || storedDensity === 'default' || storedDensity === 'comfortable'
    ? storedDensity
    : 'compact'
