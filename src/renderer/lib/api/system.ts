import type { ArchiveInspectReport } from '@shared/types'

// One-shot system commands (shell, dialogs, external browser). Plain typed
// wrappers, 1:1 with the bridge — no caching or invalidation involved.

export const openExternal = (url: string): Promise<void> =>
  window.birdbrain.captures.openExternal(url)

export const downloadCapture = (captureId: string): Promise<string | null> =>
  window.birdbrain.captures.download(captureId)

export const revealInFolder = (path: string): Promise<void> =>
  window.birdbrain.shell.showItemInFolder(path)

export const openPath = (path: string): Promise<string> => window.birdbrain.shell.openPath(path)

export const openExtensionFolder = (): Promise<void> => window.birdbrain.extension.openFolder()

export const chooseStoragePath = (): Promise<string | null> =>
  window.birdbrain.settings.chooseStoragePath()

export const inspectCaseArchive = (): Promise<ArchiveInspectReport | null> =>
  window.birdbrain.cases.inspectArchive()
