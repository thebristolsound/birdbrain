import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import sharp from 'sharp'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

// The stored preview box, ~4:3. Every consumer draws it with object-cover
// anchored to the top into a box of its own, so what is stored has to be one
// fixed size rather than a fit of whatever shape a screenshot happens to be.
export const THUMB_WIDTH = 160
export const THUMB_HEIGHT = 120

// Scale the screenshot to the box width, then keep the top THUMB_HEIGHT rows.
// Screenshots vary wildly in shape: a full-page recapture can be 1280x11200,
// which scales to a 160x1400 sliver, and `trimTrailingBackground` leaves a page
// like example.com at roughly 1280x260. Scaling by width regardless makes both
// a preview of the page top at a predictable zoom.
//
// Deliberately not sharp's `fit: 'cover'`, which is what this used to do. Cover
// scales by whichever axis needs the larger factor, so it preserves the page
// width only while the screenshot is taller than the box. On a short, wide one
// it scales to the height and crops the width instead — and `position: 'top'`
// constrains the vertical crop only, so the horizontal crop lands in the middle
// and the preview becomes a zoomed centre column of body text (#470).
//
// A page shorter than the box after scaling is padded at the bottom by
// replicating its own bottom row, so the pad takes the page's background colour
// rather than a hardcoded white that would band across a dark page.
export async function renderThumbnail(screenshot: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(screenshot)
    .resize({ width: THUMB_WIDTH })
    .toBuffer({ resolveWithObject: true })

  const boxed = sharp(data)
  if (info.height > THUMB_HEIGHT) {
    boxed.extract({ left: 0, top: 0, width: info.width, height: THUMB_HEIGHT })
  } else if (info.height < THUMB_HEIGHT) {
    boxed.extend({ bottom: THUMB_HEIGHT - info.height, extendWith: 'copy' })
  }
  return boxed.jpeg({ quality: 75 }).toBuffer()
}

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
    // Async fs — this runs on the main-process thread, once per visible list
    // item. sharp (libvips) handles arbitrarily tall screenshots without
    // loading a full GPU texture.
    const screenshot = await readFile(screenshotPath)
    const thumbBuffer = await renderThumbnail(screenshot)

    await writeFile(thumbPath, thumbBuffer)
    return thumbBuffer
  } catch (error) {
    logger.error('thumbnails', 'thumbnails.generate_failed', { captureId: ident(captureId) }, error)
    return null
  }
}
