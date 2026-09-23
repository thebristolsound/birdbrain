import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import type { CookieParseResult } from '@main/services/persona/cookieFiles/types'
import { parseJsonCookies } from '@main/services/persona/cookieFiles/json'
import { parseNetscapeCookies } from '@main/services/persona/cookieFiles/netscape'

export type { ImportedCookie, CookieParseResult } from '@main/services/persona/cookieFiles/types'

// One message for every refused shape, naming the two exports this build
// reads. Chrome's `Cookies` database is OS-encrypted and app-bound since
// Chrome 127, and no browser profile directory can be mounted as a session
// (plan, "Supported cookie formats"), so neither is a file to try harder on.
export const UNSUPPORTED_COOKIE_FILE_MESSAGE =
  'Only a Netscape cookies.txt export or a Cookie-Editor / EditThisCookie JSON export can be ' +
  'imported. A browser profile directory or its Cookies database cannot be read.'

export class UnsupportedCookieFileError extends Error {
  constructor() {
    super(UNSUPPORTED_COOKIE_FILE_MESSAGE)
    this.name = 'UnsupportedCookieFileError'
  }
}

const SQLITE_MAGIC = 'SQLite format 3\0'

// Reads and parses one cookie file. Throws UnsupportedCookieFileError for a
// directory, an SQLite database (Chrome's `Cookies`, Firefox's
// `cookies.sqlite`) or a file named like one, before any row is looked at.
// The bytes are read into memory for the parse and go nowhere else: the
// caller loads the cookies into a session and the buffer is dropped.
export function readCookieFile(path: string, nowSeconds: number): CookieParseResult {
  if (statSync(path).isDirectory()) throw new UnsupportedCookieFileError()
  const bytes = readFileSync(path)
  if (bytes.subarray(0, SQLITE_MAGIC.length).toString('latin1') === SQLITE_MAGIC) {
    throw new UnsupportedCookieFileError()
  }
  const name = basename(path).toLowerCase()
  if (name === 'cookies' || name.endsWith('.sqlite')) throw new UnsupportedCookieFileError()
  const text = bytes.toString('utf8')
  return text.trimStart().startsWith('[')
    ? parseJsonCookies(text, nowSeconds)
    : parseNetscapeCookies(text, nowSeconds)
}
