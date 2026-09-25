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

// Real exports are kilobytes; a cap keeps an accidental pick of a large
// file from being read whole into the main process.
export const MAX_COOKIE_FILE_BYTES = 10 * 1024 * 1024

export const COOKIE_FILE_TOO_LARGE_MESSAGE =
  'This file is too large to be a cookie export. Only a Netscape cookies.txt export or a ' +
  'Cookie-Editor / EditThisCookie JSON export can be imported.'

export class UnsupportedCookieFileError extends Error {
  constructor(message = UNSUPPORTED_COOKIE_FILE_MESSAGE) {
    super(message)
    this.name = 'UnsupportedCookieFileError'
  }
}

const SQLITE_MAGIC = 'SQLite format 3\0'

// Reads and parses one cookie file. Throws UnsupportedCookieFileError for a
// directory, an SQLite database (Chrome's `Cookies`, Firefox's
// `cookies.sqlite`), a file named like one, or one over the size cap, before
// any byte is read.
// The bytes are read into memory for the parse and go nowhere else: the
// caller loads the cookies into a session and the buffer is dropped.
export function readCookieFile(path: string, nowSeconds: number): CookieParseResult {
  const stat = statSync(path)
  if (stat.isDirectory()) throw new UnsupportedCookieFileError()
  const name = basename(path).toLowerCase()
  if (name === 'cookies' || name.endsWith('.sqlite')) throw new UnsupportedCookieFileError()
  if (stat.size > MAX_COOKIE_FILE_BYTES) {
    throw new UnsupportedCookieFileError(COOKIE_FILE_TOO_LARGE_MESSAGE)
  }
  const bytes = readFileSync(path)
  if (bytes.subarray(0, SQLITE_MAGIC.length).toString('latin1') === SQLITE_MAGIC) {
    throw new UnsupportedCookieFileError()
  }
  const text = bytes.toString('utf8')
  return text.trimStart().startsWith('[')
    ? parseJsonCookies(text, nowSeconds)
    : parseNetscapeCookies(text, nowSeconds)
}
