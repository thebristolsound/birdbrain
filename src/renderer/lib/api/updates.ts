import type { UpdateStatus } from '@shared/types'

// 1:1 wrappers over the update-delivery bridge; useUpdateStatus keeps the
// state machine and calls only these.

export const getUpdateStatus = (): Promise<UpdateStatus> => window.birdbrain.updates.getStatus()

export const checkForUpdates = (): Promise<UpdateStatus> => window.birdbrain.updates.check()

export const downloadUpdate = (): Promise<void> => window.birdbrain.updates.download()

export const installUpdate = (): Promise<void> => window.birdbrain.updates.install()

export const subscribeUpdateStatus = (callback: (status: UpdateStatus) => void): (() => void) =>
  window.birdbrain.onUpdateStatus(callback)
