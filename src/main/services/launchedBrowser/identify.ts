import type { BrowserFamily } from '@shared/types'
import type { CdpResult } from '@main/services/launchedBrowser/commands'
import type { FoundBrowser } from '@main/services/launchedBrowser/discovery'

// Reading what a launched browser says it is (spec, "Browser discovery and launch"). Chrome,
// Chrome for Testing, Chromium and Brave all answered `Browser.getVersion` with the product name
// `Chrome`, so the family is the one Birdbrain started and the product string decides only
// whether the browser is recognized and new enough.

// The oldest build the stage-2 probe passed on: Chrome for Testing 149.0.7827.55.
export const BROWSER_FLOOR_VERSION = '149.0.7827.55'

const RECOGNIZED_PRODUCTS: readonly string[] = ['Chrome']
const PRODUCT = /^([A-Za-z]+)\/(\d+)\.(\d+)\.(\d+)\.(\d+)$/

export interface BrowserIdentity {
  family: BrowserFamily
  // `product` split at the slash, as a launched browser's capture entry records it.
  product: string
  version: string
  userAgent: string
}

export type Identification =
  | { ok: true; identity: BrowserIdentity }
  | { ok: false; code: 'unrecognized' | 'below-floor'; reported: string; message: string }

const FLOOR = BROWSER_FLOOR_VERSION.split('.').map(Number)

function belowFloor(parts: number[]): boolean {
  const differs = parts.findIndex((part, i) => part !== FLOOR[i])
  return differs !== -1 && parts[differs] < FLOOR[differs]
}

export function identifyBrowser(
  { family, label }: Pick<FoundBrowser, 'family' | 'label'>,
  { product: reported, userAgent }: CdpResult<'Browser.getVersion'>
): Identification {
  const match = PRODUCT.exec(reported)
  if (!match || !RECOGNIZED_PRODUCTS.includes(match[1])) {
    return {
      ok: false,
      code: 'unrecognized',
      reported,
      message: `${label} reported ${reported}, a product Birdbrain does not recognize.`
    }
  }
  const [, product, ...parts] = match
  if (belowFloor(parts.map(Number))) {
    return {
      ok: false,
      code: 'below-floor',
      reported,
      message:
        `${label} reported ${reported}, older than ${BROWSER_FLOOR_VERSION}, the oldest version ` +
        'Birdbrain supports. Update it or choose another browser.'
    }
  }
  return { ok: true, identity: { family, product, version: parts.join('.'), userAgent } }
}
