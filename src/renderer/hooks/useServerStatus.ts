import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { queryClient } from '@renderer/lib/queryClient'
import { queryKeys } from '@renderer/lib/queries'
import { invalidateAfterTagApply } from '@renderer/lib/api/tags'
import { invalidateNoteQueries } from '@renderer/lib/api/notes'
import { router } from '@renderer/router'
import type { Capture } from '@shared/types'

export function useServerStatus() {
  useEffect(() => {
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
      // A capture arriving while the dashboard is open must land in its
      // cross-case feed (#403); nothing else remounts it.
      queryClient.invalidateQueries({ queryKey: queryKeys.recentActivityAll })
    })

    // The extension attach routes write Tags and Notes through the repos, so
    // no mutation hook ran and nothing else tells an open case its data moved
    // (#852). Refetch rather than seed from the payload: what the operator
    // reads then comes from the database, not from this event's account of
    // what was written.
    const unsubExtensionAttach = window.birdbrain.onExtensionAttach(
      ({ kind, caseId, captureId }) => {
        if (kind === 'tag') invalidateAfterTagApply(queryClient, captureId)
        else invalidateNoteQueries(queryClient, caseId)
      }
    )

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
      unsubExtensionAttach()
      unsubSelectorRematched()
      unsubDeepLink()
    }
  }, [])
}
