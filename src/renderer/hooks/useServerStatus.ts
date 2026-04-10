import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { queryClient } from '@renderer/lib/queryClient'
import { queryKeys } from '@renderer/lib/queries'
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
    })

    return () => {
      unsubExtension()
      unsubSession()
      unsubCapture()
      unsubNewCapture()
    }
  }, [])
}
