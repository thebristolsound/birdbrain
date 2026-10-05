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
    window.location.hash = '/cases/new'
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

export type SeedCapture = {
  slug: string
  title?: string
  text?: string
}

/**
 * Posts one manual capture to the local capture server, the route the
 * extension uses, and returns the new capture's id.
 */
export async function seedCapture(
  page: Page,
  caseId: string,
  token: string,
  capture: SeedCapture
): Promise<string> {
  const result = await page.evaluate(
    async ({ base, caseId, token, slug, title, text }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', title)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', text)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${text}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
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
      slug: capture.slug,
      title: capture.title ?? `Capture ${capture.slug}`,
      text: capture.text ?? capture.slug
    }
  )
  expect(result.status).toBe('ok')
  return result.captureId as string
}
