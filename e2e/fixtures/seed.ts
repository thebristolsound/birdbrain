import { expect, type Page } from '@playwright/test'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

// Seeding helpers for specs that need a case and captures before they reach
// the screen under test. Older specs carry their own copies of these; new
// specs import them from here.

export { CAPTURE_SERVER_BASE_URL }

/**
 * Creates a case through the New Case form and returns its id. From inside a
 * case it leaves through the sidebar's Home button first: a hash change made
 * from a case workspace is put back to that workspace.
 */
export async function createCase(page: Page, name: string): Promise<string> {
  const home = page.getByRole('button', { name: 'Home', exact: true })
  if (await home.isVisible()) {
    await home.click()
    await page.getByTestId('dashboard').waitFor({ timeout: 10000 })
  }
  await page.evaluate(() => {
    window.location.hash = '/cases/new?blank=true'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  return page.url().match(/cases\/([^/]+)/)![1]
}

/** Reads the capture server token the way the extension does. */
export async function serverToken(page: Page): Promise<string> {
  return page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/status`)
    return (await r.json()).serverToken ?? ''
  }, CAPTURE_SERVER_BASE_URL)
}

// A 100x100 white PNG, for a capture that needs a screenshot. Generated via:
//   sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer()
export const SCREENSHOT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

/**
 * Wraps one HTML document as a Chrome-style MHTML file: a multipart/related body with a
 * single text/html part, which is the part data extraction reads. Pass it as `mhtml`.
 */
export function mhtmlPage(url: string, html: string): string {
  const boundary = '----MultipartBoundary--seed----'
  return [
    'From: <Saved by Blink>',
    `Snapshot-Content-Location: ${url}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: binary',
    `Content-Location: ${url}`,
    '',
    html,
    `--${boundary}--`,
    ''
  ].join('\r\n')
}

export type SeedCapture = {
  slug: string
  /** Defaults to `https://example.com/<slug>`. */
  url?: string
  title?: string
  text?: string
  /** The MHTML body, such as `mhtmlPage` builds. Defaults to the text inside a bare HTML page. */
  mhtml?: string
  /** A base64 PNG sent as the screenshot, such as SCREENSHOT_PNG_BASE64. */
  screenshot?: string
}

/** The capture server's answer to a manual upload. */
export type CaptureUploadResult = {
  status: string
  captureId: string
  hash: string
  manifestIndex: number
}

/**
 * Posts one manual capture to the local capture server, the route the
 * extension uses, and returns the server's answer whatever its status.
 */
export async function postCapture(
  page: Page,
  caseId: string,
  token: string,
  capture: SeedCapture
): Promise<CaptureUploadResult> {
  const text = capture.text ?? capture.slug
  return page.evaluate(
    async ({ base, caseId, token, url, title, text, mhtml, screenshot }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', url)
      form.append('title', title)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', text)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append('mhtml', new Blob([mhtml], { type: 'multipart/related' }), 'capture.mhtml')
      if (screenshot) {
        const bytes = Uint8Array.from(atob(screenshot), (c) => c.charCodeAt(0))
        form.append('screenshot', new Blob([bytes], { type: 'image/png' }), 'shot.png')
      }
      const r = await fetch(`${base}/api/captures`, {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return r.json()
    },
    {
      base: CAPTURE_SERVER_BASE_URL,
      caseId,
      token,
      url: capture.url ?? `https://example.com/${capture.slug}`,
      title: capture.title ?? `Capture ${capture.slug}`,
      text,
      mhtml: capture.mhtml ?? `<html><body>${text}</body></html>`,
      screenshot: capture.screenshot ?? null
    }
  )
}

/** Posts one manual capture, expects it accepted, and returns the new capture's id. */
export async function seedCapture(
  page: Page,
  caseId: string,
  token: string,
  capture: SeedCapture
): Promise<string> {
  const result = await postCapture(page, caseId, token, capture)
  expect(result.status).toBe('ok')
  return result.captureId
}

/**
 * Seeds a capture of `url` whose title is also its text, with a screenshot,
 * reading the server token itself.
 */
export async function seedTitledCapture(
  page: Page,
  caseId: string,
  url: string,
  title: string
): Promise<string> {
  return seedCapture(page, caseId, await serverToken(page), {
    slug: title,
    url,
    title,
    text: title,
    screenshot: SCREENSHOT_PNG_BASE64
  })
}
