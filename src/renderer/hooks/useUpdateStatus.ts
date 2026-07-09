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
    window.birdbrain.updates
      .getStatus()
      .then((s) => {
        if (active) setStatus(s)
      })
      .catch((err) => {
        // A failed status fetch shouldn't crash the tree — the card just shows
        // the current version until the next main→renderer transition arrives.
        if (active) console.error('Failed to fetch update status', err)
      })
    const unsubscribe = window.birdbrain.onUpdateStatus((s) => setStatus(s))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // check() resolves with a status even on failure (the main-process service folds
  // errors into an error-state snapshot), but guard the IPC boundary itself so a
  // rejected invoke never leaves the button stuck spinning or throws unhandled.
  const check = useCallback(
    () =>
      window.birdbrain.updates
        .check()
        .then(setStatus)
        .catch((err) => console.error('Failed to check for updates', err)),
    []
  )

  return { status, check }
}
