import type { DeepLinkTarget } from '@shared/ipc'

// Custom URL scheme the app registers with the OS so the Chrome extension (and
// any birdbrain:// link) can hand off into the running desktop app.
export const DEEP_LINK_SCHEME = 'birdbrain'

// Maps a birdbrain:// URL to a renderer navigation target. Returns null for
// anything we don't recognise so the caller can fall back to just focusing the
// window. The host segment is the command (birdbrain://open, birdbrain://settings).
export function parseDeepLink(url: string): DeepLinkTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return null

  switch (parsed.hostname.toLowerCase()) {
    case 'open':
      return 'dashboard'
    case 'settings':
      return 'settings'
    default:
      return null
  }
}

// Pulls the first birdbrain:// URL out of a process argv list. Windows and Linux
// deliver deep links as a command-line argument (cold start via process.argv,
// while-running via the second-instance event); macOS uses the open-url event.
export function findDeepLinkInArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null
}
