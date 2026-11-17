import type { UpdateStatus } from '@shared/types'
import { birdbrain } from '@renderer/lib/birdbrain'

// Update delivery has no cache identity in the renderer: every transition
// after the mount snapshot arrives on the onUpdateStatus event channel, which
// useUpdateStatus folds into hook-local state. These are the four commands
// behind it. The subscription itself moves to events.ts (#229, PR 5).

export function getUpdateStatus(): Promise<UpdateStatus> {
  return birdbrain.updates.getStatus()
}

export function checkForUpdate(): Promise<UpdateStatus> {
  return birdbrain.updates.check()
}

export function downloadUpdate(): Promise<void> {
  return birdbrain.updates.download()
}

export function installUpdate(): Promise<void> {
  return birdbrain.updates.install()
}
