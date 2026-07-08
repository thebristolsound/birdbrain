import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import sharp from 'sharp'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'

// ~4:3 thumbnail box. Full-page recapture screenshots are very tall (e.g.
// 1280x11200); scaling the whole strip to 160px wide yields a 160x1400 sliver
// that renders as an arbitrary mid-page crop in the list's small box. A
// cover+top resize previews the top of the page at a fixed box size instead.
const THUMB_WIDTH = 160
const THUMB_HEIGHT = 120

export async function getThumbnail(
  caseId: string,
  captureId: string,
  store: CaptureStore = defaultCaptureStore
): Promise<Buffer | null> {
  const thumbPath = store.thumbnailPaths(caseId, captureId).abs

  // Return existing thumbnail if it exists
  if (existsSync(thumbPath)) {
    return readFile(thumbPath)
  }

  // Try to generate thumbnail from screenshot
  const screenshotPath = store.artifactPaths(caseId, captureId, 'png').abs
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
