import type { QueryClient } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'

// Structural router surface so this module doesn't import the app router
// (which drags the whole route tree into any test that imports this file).
// useServerStatus supplies the production router instance.
export interface MainEventRouter {
  state: { location: { pathname: string } }
  navigate: (opts: { to: string; params?: Record<string, string> }) => unknown
}

export interface MainEventDeps {
  queryClient: QueryClient
  router: MainEventRouter
}

// Event -> cache/store/router table for main-process push events. Returns a
// combined unsubscribe covering every channel.
export function subscribeToMainEvents({ queryClient, router }: MainEventDeps): () => void {
  const unsubExtension = window.birdbrain.onExtensionConnection(({ connected }) => {
    useAppStore.getState().setConnectedToExtension(connected)
  })

  const unsubSession = window.birdbrain.onSessionStateChanged((state) => {
    useAppStore.getState().setSessionActive(state.sessionActive)
    if (state.activeCaseId) {
      // Only navigate if we're not already viewing this case (e.g. extension
      // started capturing to a case the user isn't currently looking at)
      const currentPath = router.state.location.pathname
      const alreadyOnCase = currentPath.startsWith(`/cases/${state.activeCaseId}`)
      if (!alreadyOnCase) {
        router.navigate({
          to: '/cases/$caseId',
          params: { caseId: state.activeCaseId }
        })
      }
    }
  })

  const unsubCapture = window.birdbrain.onCaptureActivity((event) => {
    useAppStore.getState().addCaptureEvent(event)
  })

  const unsubNewCapture = window.birdbrain.onNewCapture((capture: Capture) => {
    queryClient.setQueryData<Capture[]>(queryKeys.captures(capture.caseId), (old) =>
      old ? [capture, ...old] : [capture]
    )
    queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
  })

  const unsubSelectorRematched = window.birdbrain.onSelectorRematched(({ caseId }) => {
    // Invalidate on both 'done' and 'error': retroactive matching can insert
    // partial results before failing, so caches are stale either way.
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCoverage(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchingCapturesAll(caseId) })
  })

  // Deep links (birdbrain://) from the extension popup route the window here.
  const unsubDeepLink = window.birdbrain.onDeepLinkNavigate((target) => {
    router.navigate({ to: target === 'settings' ? '/settings' : '/' })
  })

  return () => {
    unsubExtension()
    unsubSession()
    unsubCapture()
    unsubNewCapture()
    unsubSelectorRematched()
    unsubDeepLink()
  }
}
