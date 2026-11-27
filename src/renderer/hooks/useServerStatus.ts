import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { queryClient } from '@renderer/lib/queryClient'
import { queryKeys } from '@renderer/lib/queries'
import { invalidateAfterTagApply } from '@renderer/lib/api/tags'
import { invalidateNoteQueries } from '@renderer/lib/api/notes'
import { sessionQueryOptions } from '@renderer/lib/api/session'
import {
  followLaunchedBrowserPopOut,
  followLaunchedBrowserStatus
} from '@renderer/lib/api/launchedBrowser'
import { router } from '@renderer/router'
import type { Capture } from '@shared/types'

export function useServerStatus() {
  useEffect(() => {
    const unsubExtension = window.birdbrain.onExtensionConnection(({ connected }) => {
      useAppStore.getState().setConnectedToExtension(connected)
    })

    // The store starts Idle on every load, and main pushes only on a change, so a reload during a
    // Capture Session read Idle until a Case route activated (#815). The read always asks main,
    // and yields to a push, which is newer. It does not navigate: the start screen is the restore
    // hook's choice. A failed read leaves the store Idle; the query cache logs the failure.
    let pushed = false
    let unmounted = false
    queryClient
      .fetchQuery({ ...sessionQueryOptions(), staleTime: 0 })
      .then(({ sessionActive, activeCaseId }) => {
        if (pushed || unmounted) return
        const { setSessionActive, setActiveCaseId } = useAppStore.getState()
        setSessionActive(sessionActive)
        setActiveCaseId(activeCaseId)
      })
      .catch(() => {})

    const unsubSession = window.birdbrain.onSessionStateChanged((state) => {
      pushed = true
      const { sessionActive: wasActive, setSessionActive, setActiveCaseId } = useAppStore.getState()
      setSessionActive(state.sessionActive)
      setActiveCaseId(state.activeCaseId ?? null)
      // A stop still names its Case. Following it would pull an Operator who stopped the
      // Capture Session from the dashboard or Settings into that Case.
      if (wasActive && !state.sessionActive) return
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

    const unsubLaunchedBrowser = followLaunchedBrowserStatus(queryClient)
    const unsubPopOut = followLaunchedBrowserPopOut(queryClient)

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
      // An open Data screen reads the case through these two, and nothing else
      // refetched them, so a capture landing there never appeared (#1552).
      // Refetched rather than seeded: the inventory row and the chain entry
      // are the main process's account, not this event's.
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(capture.caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(capture.caseId) })
      // An active selector filter re-resolves, so a new capture that matches
      // it is not left out of the list under the filter's label (#1203).
      queryClient.invalidateQueries({
        queryKey: queryKeys.selectorMatchingCapturesAll(capture.caseId)
      })
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
      // The matrix backs the coverage strip and the rail's "Appears in" list
      // (#829). Leaving it out showed pre-rescan membership beside a count the
      // three keys above had already moved.
      queryClient.invalidateQueries({ queryKey: queryKeys.selectorCaptureMatrix(caseId) })
    })

    // A Shared Case moved in the main process (#1810, #1881): a join made a
    // Case this window has never listed, or a sync round brought a teammate's
    // Captures and chain entries. No mutation ran here, so nothing else refetches
    // the Case list or the Case's Captures, and a joined Case would not open
    // until the list went stale. Refetched rather than seeded, as the attach
    // routes are: what the operator reads comes from the database.
    const unsubSharingChanged = window.birdbrain.onSharingChanged(({ caseId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cases })
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
      // The Members tab and the sync pill read the roster and the sync state
      // (#1514); a join, an approval or a finished round moved both.
      queryClient.invalidateQueries({ queryKey: queryKeys.sharingMembers(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sharingSyncState(caseId) })
    })

    // Deep links (birdbrain://) from the extension popup route the window here.
    const unsubDeepLink = window.birdbrain.onDeepLinkNavigate((target) => {
      if (typeof target === 'object') {
        void router
          .navigate({
            to: '/cases/$caseId/captures',
            params: { caseId: target.caseId },
            search: { captureId: target.captureId }
          })
          .then(() => {
            useAppStore.getState().setSelectedCaptureId(target.captureId)
          })
      } else router.navigate({ to: target === 'settings' ? '/settings' : '/' })
    })

    return () => {
      unmounted = true
      unsubExtension()
      unsubSession()
      unsubLaunchedBrowser()
      unsubPopOut()
      unsubCapture()
      unsubNewCapture()
      unsubExtensionAttach()
      unsubSelectorRematched()
      unsubSharingChanged()
      unsubDeepLink()
    }
  }, [])
}
