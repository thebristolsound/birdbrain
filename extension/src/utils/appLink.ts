// Hand off to the desktop app via its registered birdbrain:// scheme. Opening a
// tab lets Chrome surface the external-protocol prompt and launch/focus the app;
// the app routes the renderer based on the host segment (open | settings).
// Shared by the popup footer and the options page footnote.
export function openInApp(target: 'open' | 'settings'): void {
  chrome.tabs.create({ url: `birdbrain://${target}` })
}
