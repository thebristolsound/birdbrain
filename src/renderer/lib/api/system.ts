// One-shot commands with no cache identity — a single bridge call each, no
// caching, no error handling, no logging. Callers already handle failures.

export function openCaptureExternal(url: string): Promise<void> {
  return window.birdbrain.captures.openExternal(url)
}

export function downloadCapture(captureId: string): Promise<string | null> {
  return window.birdbrain.captures.download(captureId)
}

export function downloadCapturePdf(captureId: string): Promise<string | null> {
  return window.birdbrain.captures.downloadPdf(captureId)
}

export function downloadCaptureScreenshot(captureId: string): Promise<string | null> {
  return window.birdbrain.captures.downloadScreenshot(captureId)
}

export function revealInFolder(path: string): Promise<void> {
  return window.birdbrain.shell.showItemInFolder(path)
}

export function openPath(path: string): Promise<void> {
  return window.birdbrain.shell.openPath(path)
}

export function openExtensionFolder(): Promise<void> {
  return window.birdbrain.extension.openFolder()
}

export function chooseStoragePath(): Promise<string | null> {
  return window.birdbrain.settings.chooseStoragePath()
}
