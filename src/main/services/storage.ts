import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  statSync
} from 'fs'
import { join } from 'path'
import { nativeImage } from 'electron'

let storageRoot: string

export function initStorage(root: string): void {
  storageRoot = root
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }
}

export function getStorageRoot(): string {
  if (!storageRoot) throw new Error('Storage not initialized')
  return storageRoot
}

function ensureCaseDir(caseId: string): string {
  const dir = join(getStorageRoot(), caseId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function saveCapture(
  caseId: string,
  captureId: string,
  html: string,
  screenshot?: Buffer,
  textContent?: string
): { htmlPath: string; screenshotPath?: string; textPath?: string } {
  const dir = ensureCaseDir(caseId)

  const htmlPath = join(caseId, `${captureId}.html`)
  writeFileSync(join(dir, `${captureId}.html`), html, 'utf-8')

  let screenshotPath: string | undefined
  if (screenshot) {
    screenshotPath = join(caseId, `${captureId}.png`)
    writeFileSync(join(dir, `${captureId}.png`), screenshot)
  }

  let textPath: string | undefined
  if (textContent) {
    textPath = join(caseId, `${captureId}.txt`)
    writeFileSync(join(dir, `${captureId}.txt`), textContent, 'utf-8')
  }

  return { htmlPath, screenshotPath, textPath }
}

export function updateCaptureHtml(caseId: string, captureId: string, html: string): void {
  const dir = ensureCaseDir(caseId)
  writeFileSync(join(dir, `${captureId}.html`), html, 'utf-8')
}

export function getCapturePath(
  caseId: string,
  captureId: string,
  type: 'html' | 'png' | 'txt'
): string {
  const ext = type === 'png' ? 'png' : type === 'txt' ? 'txt' : 'html'
  return join(getStorageRoot(), caseId, `${captureId}.${ext}`)
}

export function readCaptureFile(
  caseId: string,
  captureId: string,
  type: 'html' | 'png' | 'txt'
): Buffer | null {
  const path = getCapturePath(caseId, captureId, type)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function deleteCaptureFiles(caseId: string, captureId: string): void {
  for (const ext of ['html', 'png', 'txt'] as const) {
    const path = getCapturePath(caseId, captureId, ext)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }
  // Also delete thumbnail if it exists
  const thumbPath = join(getStorageRoot(), caseId, `${captureId}_thumb.webp`)
  if (existsSync(thumbPath)) {
    unlinkSync(thumbPath)
  }
}

export function getCaseStorageSize(caseId: string): number {
  const dir = join(getStorageRoot(), caseId)
  if (!existsSync(dir)) return 0

  let totalSize = 0
  const files = readdirSync(dir)
  for (const file of files) {
    const stat = statSync(join(dir, file))
    totalSize += stat.size
  }
  return totalSize
}

export function getThumbnail(caseId: string, captureId: string): Buffer | null {
  const thumbPath = join(getStorageRoot(), caseId, `${captureId}_thumb.webp`)

  // Return existing thumbnail if it exists
  if (existsSync(thumbPath)) {
    return readFileSync(thumbPath)
  }

  // Try to generate thumbnail from screenshot
  const screenshotPath = getCapturePath(caseId, captureId, 'png')
  if (!existsSync(screenshotPath)) {
    return null
  }

  try {
    const screenshot = readFileSync(screenshotPath)
    const image = nativeImage.createFromBuffer(screenshot)

    // Resize to ~160x100px thumbnail (maintaining aspect ratio)
    const size = image.getSize()
    const targetWidth = 160
    const targetHeight = Math.round((size.height / size.width) * targetWidth)

    const resized = image.resize({
      width: targetWidth,
      height: targetHeight,
      quality: 'good'
    })

    // Save as WebP for better compression
    const thumbBuffer = resized.toJPEG(75) // Use JPEG at 75% quality
    writeFileSync(thumbPath, thumbBuffer)

    return thumbBuffer
  } catch (error) {
    console.error(`Failed to generate thumbnail for ${captureId}:`, error)
    return null
  }
}
