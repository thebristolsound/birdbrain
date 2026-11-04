import { queryOptions } from '@tanstack/react-query'
import type { LaunchedBrowserOption } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// Discovery asks the file system and starts no browser.
export const launchedBrowsersQueryOptions = queryOptions({
  queryKey: queryKeys.launchedBrowsers,
  queryFn: () => window.birdbrain.launchedBrowser.list()
})

// Main opens the file dialog and checks the file; null when the Operator cancels.
export function chooseBrowserExecutable(): Promise<LaunchedBrowserOption | null> {
  return window.birdbrain.launchedBrowser.chooseExecutable()
}
