import { queryOptions } from '@tanstack/react-query'
import type { LaunchedBrowserOption } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

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
