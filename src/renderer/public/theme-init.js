/* global document, localStorage */
// Applies persisted theme/motion classes before first paint to avoid a flash.
// Loaded as an external classic script so the renderer CSP can drop
// script-src 'unsafe-inline' in production (see index.html + the strict-prod-csp
// plugin in electron.vite.config.ts).
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.classList.add('dark')
}
if (localStorage.getItem('reduceMotion') === 'true') {
  document.documentElement.classList.add('reduce-motion')
}
