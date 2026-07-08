import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

// Subscribes to update-delivery status. Fetches the current snapshot on mount,
// then folds in every main→renderer transition. Hook-local by design: only the
// Settings card and the TopBar indicator consume it, so no shared store is
// warranted (see the update-delivery design spec).
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let active = true
    window.birdbrain.updates.getStatus().then((s) => {
      if (active) setStatus(s)
    })
    const unsubscribe = window.birdbrain.onUpdateStatus((s) => setStatus(s))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(() => window.birdbrain.updates.check().then(setStatus), [])

  return { status, check }
}
