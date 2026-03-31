import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useServerStatus() {
  useEffect(() => {
    const unsubExtension = window.birdbrain.onExtensionConnection(({ connected }) => {
      useAppStore.getState().setConnectedToExtension(connected)
    })

    const unsubSession = window.birdbrain.onSessionStateChanged((state) => {
      useAppStore.getState().setSessionActive(state.sessionActive)
      if (state.activeCaseId) {
        useAppStore.getState().setActiveCaseId(state.activeCaseId)
      }
    })

    const unsubCapture = window.birdbrain.onCaptureActivity((event) => {
      useAppStore.getState().addCaptureEvent(event)
    })

    return () => {
      unsubExtension()
      unsubSession()
      unsubCapture()
    }
  }, [])
}
