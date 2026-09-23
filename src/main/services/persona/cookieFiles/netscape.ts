import type { CookieParseResult, ImportedCookie } from '@main/services/persona/cookieFiles/types'
import { isExpired } from '@main/services/persona/cookieFiles/types'

// Netscape `cookies.txt` (the "Get cookies.txt LOCALLY" extension, curl,
// yt-dlp): seven tab-separated fields per line —
//   domain  include-subdomains  path  secure  expiry  name  value
// Comment lines start with `#`, except the `#HttpOnly_` prefix curl writes on
// a domain to mark an HttpOnly cookie, which is data. `expiry` 0 is a session
// cookie. The format carries no SameSite, so every cookie is `unspecified`.
//
// The include-subdomains flag is not mapped: Chromium derives it from whether
// the domain starts with a dot, which is how the exporting browser wrote it.
const HTTP_ONLY_PREFIX = '#HttpOnly_'

export function parseNetscapeCookies(text: string, nowSeconds: number): CookieParseResult {
  const cookies: ImportedCookie[] = []
  const rejected: CookieParseResult['rejected'] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = index + 1
    if (raw.trim() === '') return
    let httpOnly = false
    let body = raw
    if (raw.startsWith(HTTP_ONLY_PREFIX)) {
      httpOnly = true
      body = raw.slice(HTTP_ONLY_PREFIX.length)
    } else if (raw.startsWith('#')) {
      return
    }
    const fields = body.split('\t')
    if (fields.length !== 7) {
      rejected.push({ line, reason: 'malformed' })
      return
    }
    const [domain, , path, secureField, expiryField, name, value] = fields
    const expiry = Number(expiryField)
    if (domain === '' || name === '' || !Number.isFinite(expiry) || expiry < 0) {
      rejected.push({ line, reason: 'malformed' })
      return
    }
    const cookie: ImportedCookie = {
      name,
      value,
      domain,
      path: path === '' ? '/' : path,
      secure: secureField.toUpperCase() === 'TRUE',
      httpOnly,
      sameSite: 'unspecified',
      ...(expiry > 0 ? { expirationDate: expiry } : {})
    }
    if (isExpired(cookie, nowSeconds)) {
      rejected.push({ line, reason: 'expired' })
      return
    }
    cookies.push(cookie)
  })
  return { cookies, rejected }
}
