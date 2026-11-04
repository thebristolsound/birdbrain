import { queryOptions } from '@tanstack/react-query'
import type { LaunchedBrowserOption, LaunchedBrowserStatus } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The launched browser (#1831). Main pushes each status change, and useServerStatus writes it
// into this query, so the query fetches only to start from.
export const launchedBrowserStatusQueryOptions = queryOptions({
  queryKey: queryKeys.launchedBrowserStatus,
  queryFn: () => window.birdbrain.launchedBrowser.status()
})

// Discovery asks the file system and starts no browser.
export const launchedBrowsersQueryOptions = queryOptions({
  queryKey: queryKeys.launchedBrowsers,
  queryFn: () => window.birdbrain.launchedBrowser.list()
})

// Browsers left running from an earlier run (state 13). Read once at startup; Check again
// refetches it.
export const leftoverBrowsersQueryOptions = queryOptions({
  queryKey: queryKeys.leftoverBrowsers,
  queryFn: () => window.birdbrain.launchedBrowser.checkLeftovers(),
  staleTime: Infinity
})

// Main opens the file dialog and checks the file; null when the Operator cancels.
export function chooseBrowserExecutable(): Promise<LaunchedBrowserOption | null> {
  return window.birdbrain.launchedBrowser.chooseExecutable()
}

// Settles once the launched browser has exited, or Birdbrain has given up on it.
export function endLaunchedBrowserSession(): Promise<LaunchedBrowserStatus> {
  return window.birdbrain.launchedBrowser.endSession()
}

// How Birdbrain names the browser it launched, apart from the Operator's own (S4).
export function launchedBrowserName(label: string): string {
  return `Launched ${label}`
}
