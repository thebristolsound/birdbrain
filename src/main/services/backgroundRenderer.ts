import { BrowserWindow, app } from 'electron'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { RenderPage, RenderedPage } from '@main/services/recapture'

const VIEWPORT = { width: 1280, height: 900 }
const SETTLE_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Renders a URL in a locked-down, invisible BrowserWindow with a fresh
// in-memory session (no persist: prefix = nothing touches disk, nothing is
// shared with the app or previous jobs). A hostile page runs in our process,
// so: sandboxed, isolated, no preload, no node, every permission denied,
// popups denied, window destroyed in finally.
export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) => {
  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `recapture-${randomUUID()}`,
      backgroundThrottling: false
    }
  })

  const tmpPath = join(app.getPath('temp'), `birdbrain-recapture-${randomUUID()}.mhtml`)
  let tmpWritten = false

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)), timeoutMs)
  )

  async function render(): Promise<RenderedPage> {
    const wc = win.webContents
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setAudioMuted(true)

    let httpStatus = 0
    wc.on('did-navigate', (_event, _navUrl, httpResponseCode) => {
      httpStatus = httpResponseCode
    })

    await wc.loadURL(url)
    await sleep(SETTLE_MS)

    // Scroll through the page to trigger lazy-loaded content, then back to top
    // so the screenshot starts at the origin.
    await wc.executeJavaScript(
      `(async () => {
        const step = window.innerHeight
        const max = Math.min(document.body?.scrollHeight ?? 0, step * 30)
        for (let y = 0; y < max; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 150))
        }
        window.scrollTo(0, 0)
      })()`,
      true
    )
    await sleep(SETTLE_MS)

    // Whole-page screenshot via CDP — captureBeyondViewport avoids stitching.
    wc.debugger.attach('1.3')
    let screenshot: Buffer
    try {
      const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      })) as { data: string }
      screenshot = Buffer.from(data, 'base64')
    } finally {
      wc.debugger.detach()
    }

    await wc.savePage(tmpPath, 'MHTML')
    tmpWritten = true

    const text = (await wc.executeJavaScript(
      'document.body ? document.body.innerText : ""'
    )) as string

    return {
      mhtmlStream: createReadStream(tmpPath) as unknown as AsyncIterable<Uint8Array>,
      screenshot,
      text,
      title: wc.getTitle(),
      finalUrl: wc.getURL(),
      httpStatus,
      userAgent: wc.getUserAgent(),
      browserVersion: `Chrome/${process.versions.chrome}`,
      cleanup: async () => {
        if (!win.isDestroyed()) win.destroy()
        if (tmpWritten) await unlink(tmpPath).catch(() => {})
      }
    }
  }

  try {
    return await Promise.race([render(), deadline])
  } catch (err) {
    if (!win.isDestroyed()) win.destroy()
    if (tmpWritten) await unlink(tmpPath).catch(() => {})
    throw err
  }
}
