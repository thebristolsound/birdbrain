import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useServerStatus() {
  const { setConnectedToExtension, setSessionActive, setActiveCaseId, addCaptureEvent } =
    useAppStore()

  useEffect(() => {
    const unsubExtension = window.birdbrain.onExtensionConnection(({ connected }) => {
      setConnectedToExtension(connected)
    })

    const unsubSession = window.birdbrain.onSessionStateChanged((state) => {
      setSessionActive(state.sessionActive)
      if (state.activeCaseId) {
        setActiveCaseId(state.activeCaseId)
      }
    })

    const unsubCapture = window.birdbrain.onCaptureActivity((event) => {
      addCaptureEvent(event)
    })

    return () => {
      unsubExtension()
      unsubSession()
      unsubCapture()
    }
  }, [setConnectedToExtension, setSessionActive, setActiveCaseId, addCaptureEvent])
}
