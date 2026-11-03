import { describe, expect, it } from 'vitest'
import { BROWSER_FLOOR_VERSION, identifyBrowser } from '@main/services/launchedBrowser/identify'
import type { CdpResult } from '@main/services/launchedBrowser/commands'

// What Chrome for Testing 149.0.7827.55 answered under xvfb on Linux, 2026-11-03.
function reported(product: string): CdpResult<'Browser.getVersion'> {
  return {
    protocolVersion: '1.3',
    product,
    revision: '@3188f8a607ae7e067593be8aab7f02d2451fec07',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36',
    jsVersion: '14.9.207.21'
  }
}

describe('identifyBrowser', () => {
  it('records the family Birdbrain started and the product split at the slash', () => {
    expect(
      identifyBrowser(
        { family: 'chrome-for-testing', label: 'Chrome for Testing' },
        reported('Chrome/149.0.7827.55')
      )
    ).toEqual({
      ok: true,
      identity: {
        family: 'chrome-for-testing',
        product: 'Chrome',
        version: '149.0.7827.55',
        userAgent: reported('').userAgent
      }
    })
  })

  // Chromium 154 and Brave Origin 155 on Linux answered with the same product name as Chrome,
  // so the family cannot come from it.
  it('keeps the family it was given when the product string names another', () => {
    for (const family of ['brave', 'chromium', 'chrome'] as const) {
      expect(
        identifyBrowser({ family, label: family }, reported('Chrome/155.0.8059.85'))
      ).toMatchObject({
        ok: true,
        identity: { family, product: 'Chrome', version: '155.0.8059.85' }
      })
    }
  })

  it('accepts the floor itself and refuses the build just below it', () => {
    const browser = { family: 'chrome' as const, label: 'Google Chrome' }
    expect(identifyBrowser(browser, reported(`Chrome/${BROWSER_FLOOR_VERSION}`)).ok).toBe(true)
    expect(identifyBrowser(browser, reported('Chrome/149.0.7827.54'))).toEqual({
      ok: false,
      code: 'below-floor',
      reported: 'Chrome/149.0.7827.54',
      message:
        'Google Chrome reported Chrome/149.0.7827.54, older than 149.0.7827.55, the oldest ' +
        'version Birdbrain supports. Update it or choose another browser.'
    })
  })

  it('compares each part of the version as a number', () => {
    const browser = { family: 'chromium' as const, label: 'Chromium' }
    expect(identifyBrowser(browser, reported('Chrome/149.0.10000.0')).ok).toBe(true)
    expect(identifyBrowser(browser, reported('Chrome/150.0.0.0')).ok).toBe(true)
    expect(identifyBrowser(browser, reported('Chrome/148.9.9999.999'))).toMatchObject({
      ok: false,
      code: 'below-floor'
    })
  })

  it('refuses a product name it does not recognize, naming what was reported', () => {
    const browser = { family: 'edge' as const, label: 'Microsoft Edge' }
    expect(identifyBrowser(browser, reported('HeadlessChrome/150.0.7871.181'))).toEqual({
      ok: false,
      code: 'unrecognized',
      reported: 'HeadlessChrome/150.0.7871.181',
      message:
        'Microsoft Edge reported HeadlessChrome/150.0.7871.181, a product Birdbrain does not ' +
        'recognize.'
    })
    expect(identifyBrowser(browser, reported('Edg/150.0.3000.1'))).toMatchObject({
      ok: false,
      code: 'unrecognized'
    })
  })

  it('refuses a product string it cannot read', () => {
    const browser = { family: 'chrome' as const, label: 'Google Chrome' }
    for (const product of ['', 'Chrome', 'Chrome/150', 'Chrome/150.0.7871', 'Chrome/150.0.x.1']) {
      expect(identifyBrowser(browser, reported(product))).toMatchObject({
        ok: false,
        code: 'unrecognized',
        reported: product
      })
    }
  })
})
