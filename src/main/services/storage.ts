import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  statSync
} from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'

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

export function ensureCaseDir(caseId: string): string {
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
  type: 'html' | 'png' | 'txt' | 'mhtml'
): string {
  const ext = type === 'png' ? 'png' : type === 'txt' ? 'txt' : type === 'mhtml' ? 'mhtml' : 'html'
  return join(getStorageRoot(), caseId, `${captureId}.${ext}`)
}

export function readCaptureFile(
  caseId: string,
  captureId: string,
  type: 'html' | 'png' | 'txt' | 'mhtml'
): Buffer | null {
  const path = getCapturePath(caseId, captureId, type)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function deleteCaptureFiles(caseId: string, captureId: string): void {
  for (const ext of ['html', 'png', 'txt', 'mhtml'] as const) {
    const path = getCapturePath(caseId, captureId, ext)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }
  // Also delete thumbnail if it exists
  const thumbPath = join(getStorageRoot(), caseId, `${captureId}_thumb.jpg`)
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

// ~4:3 thumbnail box. Full-page recapture screenshots are very tall (e.g.
// 1280x11200); scaling the whole strip to 160px wide yields a 160x1400 sliver
// that renders as an arbitrary mid-page crop in the list's small box. A
// cover+top resize previews the top of the page at a fixed box size instead.
const THUMB_WIDTH = 160
const THUMB_HEIGHT = 120

export async function getThumbnail(caseId: string, captureId: string): Promise<Buffer | null> {
  const thumbPath = join(getStorageRoot(), caseId, `${captureId}_thumb.jpg`)

  // Return existing thumbnail if it exists
  if (existsSync(thumbPath)) {
    return readFile(thumbPath)
  }

  // Try to generate thumbnail from screenshot
  const screenshotPath = getCapturePath(caseId, captureId, 'png')
  if (!existsSync(screenshotPath)) {
    return null
  }

  try {
    // Async fs (this runs on the main-process thread, once per visible list item)
    // + a single sharp pipeline: cover-fit anchored to the top crops the page top
    // into the box without a separate metadata decode. sharp (libvips) handles
    // arbitrarily tall screenshots without loading a full GPU texture.
    const screenshot = await readFile(screenshotPath)
    const thumbBuffer = await sharp(screenshot)
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'top' })
      .jpeg({ quality: 75 })
      .toBuffer()

    await writeFile(thumbPath, thumbBuffer)
    return thumbBuffer
  } catch (error) {
    console.error(`Failed to generate thumbnail for ${captureId}:`, error)
    return null
  }
}
