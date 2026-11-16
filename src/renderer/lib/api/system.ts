// One-shot commands with no cache identity — a single bridge call each, no
// caching, no error handling, no logging. Callers already handle failures.

import { birdbrain } from '@renderer/lib/birdbrain'

export function openCaptureExternal(url: string): Promise<void> {
  return birdbrain.captures.openExternal(url)
}

export function downloadCapture(captureId: string): Promise<string | null> {
  return birdbrain.captures.download(captureId)
}

export function downloadCapturePdf(captureId: string): Promise<string | null> {
  return birdbrain.captures.downloadPdf(captureId)
}

export function downloadCaptureScreenshot(captureId: string): Promise<string | null> {
  return birdbrain.captures.downloadScreenshot(captureId)
}

export function revealInFolder(path: string): Promise<void> {
  return birdbrain.shell.showItemInFolder(path)
}

export function openPath(path: string): Promise<void> {
  return birdbrain.shell.openPath(path)
}

export function openExtensionFolder(): Promise<void> {
  return birdbrain.extension.openFolder()
}

export function chooseStoragePath(): Promise<string | null> {
  return birdbrain.settings.chooseStoragePath()
}
