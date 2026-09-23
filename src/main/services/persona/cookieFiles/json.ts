import type {
  CookieParseResult,
  CookieSameSite,
  ImportedCookie
} from '@main/services/persona/cookieFiles/types'
import { isExpired, SAME_SITE_VALUES } from '@main/services/persona/cookieFiles/types'

// JSON array export (Cookie-Editor, EditThisCookie). Each element maps 1:1 to
// Electron's Cookie object: `domain`, `name`, `value`, `path`, `secure`,
// `httpOnly`, `expirationDate` (seconds) and `sameSite`. Cookie-Editor writes
// `sameSite: null` for an unset value and EditThisCookie writes
// `"unspecified"`; both read as `unspecified`. Any other string is a value
// this build does not know how to set, so the row is rejected rather than
// guessed at. `line` in a rejection is the element's 1-based index.
//
// Chrome's own export dialogs do not produce JSON; the SQLite `Cookies` file
// is refused before this parser is reached (see `readCookieFile`).
export function parseJsonCookies(text: string, nowSeconds: number): CookieParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { cookies: [], rejected: [{ line: 1, reason: 'malformed' }] }
  }
  if (!Array.isArray(parsed)) {
    return { cookies: [], rejected: [{ line: 1, reason: 'malformed' }] }
  }
  const cookies: ImportedCookie[] = []
  const rejected: CookieParseResult['rejected'] = []
  parsed.forEach((entry, index) => {
    const line = index + 1
    const cookie = toCookie(entry)
    if (cookie === 'malformed' || cookie === 'unknown-same-site') {
      rejected.push({ line, reason: cookie })
      return
    }
    if (isExpired(cookie, nowSeconds)) {
      rejected.push({ line, reason: 'expired' })
      return
    }
    cookies.push(cookie)
  })
  return { cookies, rejected }
}

function toCookie(entry: unknown): ImportedCookie | 'malformed' | 'unknown-same-site' {
  if (!entry || typeof entry !== 'object') return 'malformed'
  const rec = entry as Record<string, unknown>
  const { name, value, domain } = rec
  if (typeof name !== 'string' || typeof value !== 'string' || typeof domain !== 'string') {
    return 'malformed'
  }
  if (name === '' || domain === '') return 'malformed'
  const sameSite = readSameSite(rec.sameSite)
  if (sameSite === undefined) return 'unknown-same-site'
  const expirationDate = readExpiry(rec)
  if (expirationDate === 'malformed') return 'malformed'
  return {
    name,
    value,
    domain,
    path: typeof rec.path === 'string' && rec.path !== '' ? rec.path : '/',
    secure: rec.secure === true,
    httpOnly: rec.httpOnly === true,
    sameSite,
    ...(expirationDate !== undefined ? { expirationDate } : {})
  }
}

function readSameSite(raw: unknown): CookieSameSite | undefined {
  if (raw === null || raw === undefined) return 'unspecified'
  if (typeof raw !== 'string') return undefined
  const lowered = raw.toLowerCase()
  return SAME_SITE_VALUES.find((v) => v === lowered)
}

// `session: true` (both exporters) wins over any expirationDate they also
// wrote. A non-numeric or negative expiry is malformed, not a session cookie.
function readExpiry(rec: Record<string, unknown>): number | undefined | 'malformed' {
  if (rec.session === true) return undefined
  const raw = rec.expirationDate
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 'malformed'
  return raw
}
