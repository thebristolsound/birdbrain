// Shared by the popup and the options page. The persisted value is what
// theme-preinit.js reads before first paint, so writing it here is what stops
// the next open flashing the previous theme.
export function applyExtensionTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem('bb-theme', theme)
  } catch {
    //
  }
}
