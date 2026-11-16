import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateStatus,
  installUpdate
} from '@renderer/lib/api/updates'

// Subscribes to update-delivery status. Fetches the current snapshot on mount,
// then folds in every main→renderer transition. Hook-local by design: only the
// Settings card and the TopBar indicator consume it, so no shared store is
// warranted (see the update-delivery design spec).
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    let active = true
    getUpdateStatus()
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
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  // check() resolves with a status even on failure (the main-process service folds
  // errors into an error-state snapshot), but guard the IPC boundary itself so a
  // rejected invoke never leaves the button stuck spinning or throws unhandled.
  // Also guard against calling setStatus after unmount (e.g. navigating away
  // while a manual check is in flight).
  const check = useCallback(
    () =>
      checkForUpdate()
        .then((s) => {
          if (mountedRef.current) setStatus(s)
        })
        .catch((err) => console.error('Failed to check for updates', err)),
    []
  )

  // Download/install progress and completion arrive via onUpdateStatus events;
  // these only kick the main process, so no local status update on resolve.
  const download = useCallback(
    () => downloadUpdate().catch((err) => console.error('Failed to download update', err)),
    []
  )

  const install = useCallback(
    () => installUpdate().catch((err) => console.error('Failed to install update', err)),
    []
  )

  return { status, check, download, install }
}
