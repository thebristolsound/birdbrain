import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { LaunchedBrowserOption, LaunchedBrowserStatus } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { refusalError } from '@renderer/lib/api/sharing'

// The launched browser (#1831). Main pushes each status change, and useServerStatus writes it
// into this query, so the query fetches only to start from.
export const launchedBrowserStatusQueryOptions = queryOptions({
  queryKey: queryKeys.launchedBrowserStatus,
  queryFn: () => window.birdbrain.launchedBrowser.status()
})

// Main pushes each status change to every Birdbrain window, so the query is kept from the event,
// not refetched. An open browser has had its version saved, which the found-browsers list shows.
export function followLaunchedBrowserStatus(client: QueryClient): () => void {
  return window.birdbrain.onLaunchedBrowserStatus((status) => {
    client.setQueryData(queryKeys.launchedBrowserStatus, status)
    if (status.state === 'open') {
      void client.invalidateQueries({ queryKey: queryKeys.launchedBrowsers })
    }
  })
}

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

// Resolves once the browser is open and its Capture Session runs. A refusal rejects with an
// Error that keeps main's code, for the start dialog's cards.
export async function launchBrowser(executablePath: string): Promise<LaunchedBrowserStatus> {
  try {
    return await window.birdbrain.launchedBrowser.launch(executablePath)
  } catch (err) {
    throw refusalError(err)
  }
}

// The launch then fails as BROWSER_LAUNCH_CANCELLED.
export function cancelBrowserLaunch(): Promise<LaunchedBrowserStatus> {
  return window.birdbrain.launchedBrowser.cancelLaunch()
}

// Settles once the launched browser has exited, or Birdbrain has given up on it.
export function endLaunchedBrowserSession(): Promise<LaunchedBrowserStatus> {
  return window.birdbrain.launchedBrowser.endSession()
}

// Closes the pop-out; the panel returns to the main window.
export function dockPanel(): Promise<void> {
  return window.birdbrain.launchedBrowser.dock()
}

// How Birdbrain names the browser it launched, apart from the Operator's own (S4).
export function launchedBrowserName(label: string): string {
  return `Launched ${label}`
}
