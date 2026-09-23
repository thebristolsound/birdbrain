import type { CookieRejection } from '@shared/types'

export type CookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict'

// One cookie as Electron's `ses.cookies.set` wants it, minus `url`, which the
// session layer derives from `domain` and `secure`. `expirationDate` is
// seconds since the epoch, as Electron and both export formats use; absent
// means a session cookie.
export interface ImportedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: CookieSameSite
}

export interface CookieParseResult {
  cookies: ImportedCookie[]
  rejected: CookieRejection[]
}

export const SAME_SITE_VALUES: readonly CookieSameSite[] = [
  'unspecified',
  'no_restriction',
  'lax',
  'strict'
]

// A cookie whose expiry is already behind `nowSeconds` would be dropped by
// Chromium on set; rejecting it here is what lets the count say so.
export function isExpired(cookie: ImportedCookie, nowSeconds: number): boolean {
  return cookie.expirationDate !== undefined && cookie.expirationDate <= nowSeconds
}
