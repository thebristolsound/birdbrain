import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useServerStatus() {
  const { setConnectedToExtension, setSessionActive, setActiveCaseId } = useAppStore()

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

    return () => {
      unsubExtension()
      unsubSession()
    }
  }, [setConnectedToExtension, setSessionActive, setActiveCaseId])
}
