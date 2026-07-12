import { useEffect } from 'react'
import { queryClient } from '@renderer/lib/queryClient'
import { router } from '@renderer/router'
import { subscribeToMainEvents } from '@renderer/lib/api/events'

export function useServerStatus() {
  useEffect(() => subscribeToMainEvents({ queryClient, router }), [])
}
