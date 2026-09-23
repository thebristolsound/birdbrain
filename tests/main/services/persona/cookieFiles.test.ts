import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { parseNetscapeCookies } from '@main/services/persona/cookieFiles/netscape'
import { parseJsonCookies } from '@main/services/persona/cookieFiles/json'
import {
  readCookieFile,
  UnsupportedCookieFileError,
  UNSUPPORTED_COOKIE_FILE_MESSAGE
} from '@main/services/persona/cookieFiles'

const FIXTURES = join(process.cwd(), 'tests/fixtures/cookies')
// 2026-01-01T00:00:00Z: after the fixtures' expired rows (2001), before the
// live ones (2100).
const NOW = 1767225600

describe('parseNetscapeCookies', () => {
  const text = readFileSync(join(FIXTURES, 'netscape.txt'), 'utf8')

  it('accepts the live rows and rejects the expired and malformed ones by line', () => {
    const { cookies, rejected } = parseNetscapeCookies(text, NOW)
    expect(cookies.map((c) => c.name)).toEqual(['sid', 'auth', 'view'])
    expect(rejected).toEqual([
      { line: 7, reason: 'expired' },
      { line: 8, reason: 'malformed' },
      { line: 9, reason: 'malformed' }
    ])
  })

  it('maps every field, reads the #HttpOnly_ prefix as data and expiry 0 as a session cookie', () => {
    const { cookies } = parseNetscapeCookies(text, NOW)
    expect(cookies[0]).toEqual({
      name: 'sid',
      value: 'SENTINEL-NETSCAPE-9f3a',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'unspecified',
      expirationDate: 4102444800
    })
    expect(cookies[1]).toMatchObject({ name: 'auth', httpOnly: true, domain: '.example.com' })
    expect(cookies[2]).toEqual({
      name: 'view',
      value: 'session-only',
      domain: 'forum.example.org',
      path: '/threads',
      secure: false,
      httpOnly: false,
      sameSite: 'unspecified'
    })
  })

  it('skips comments and blank lines without counting them as rejections', () => {
    const { cookies, rejected } = parseNetscapeCookies('# just a comment\n\n\n', NOW)
    expect(cookies).toEqual([])
    expect(rejected).toEqual([])
  })

  it('rejects a row with an empty domain or name', () => {
    const rows = ['\tTRUE\t/\tTRUE\t0\tname\tv', '.a.com\tTRUE\t/\tTRUE\t0\t\tv'].join('\n')
    expect(parseNetscapeCookies(rows, NOW).rejected).toEqual([
      { line: 1, reason: 'malformed' },
      { line: 2, reason: 'malformed' }
    ])
  })

  it('defaults an empty path to / and tolerates CRLF line endings', () => {
    const { cookies } = parseNetscapeCookies('.a.com\tTRUE\t\tFALSE\t0\tn\tv\r\n', NOW)
    expect(cookies).toEqual([
      {
        name: 'n',
        value: 'v',
        domain: '.a.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: 'unspecified'
      }
    ])
  })
})

describe('parseJsonCookies', () => {
  const text = readFileSync(join(FIXTURES, 'cookie-editor.json'), 'utf8')

  it('accepts the live entries and rejects expired, unknown SameSite and malformed by index', () => {
    const { cookies, rejected } = parseJsonCookies(text, NOW)
    expect(cookies.map((c) => c.name)).toEqual(['sid', 'view', 'strict'])
    expect(rejected).toEqual([
      { line: 4, reason: 'expired' },
      { line: 5, reason: 'unknown-same-site' },
      { line: 6, reason: 'malformed' }
    ])
  })

  it('maps sameSite null to unspecified, lowercases a cased value and honours session: true', () => {
    const { cookies } = parseJsonCookies(text, NOW)
    expect(cookies[0]).toEqual({
      name: 'sid',
      value: 'SENTINEL-JSON-7c1d',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 4102444800
    })
    expect(cookies[1]).toEqual({
      name: 'view',
      value: 'session-only',
      domain: 'forum.example.org',
      path: '/threads',
      secure: false,
      httpOnly: false,
      sameSite: 'unspecified'
    })
    expect(cookies[2].sameSite).toBe('strict')
  })

  it('reports a file that is not JSON, or not an array, as one malformed row', () => {
    expect(parseJsonCookies('not json', NOW).rejected).toEqual([{ line: 1, reason: 'malformed' }])
    expect(parseJsonCookies('{"name":"x"}', NOW).rejected).toEqual([
      { line: 1, reason: 'malformed' }
    ])
  })

  it('rejects a non-object entry, a non-string sameSite and a negative expiry as malformed', () => {
    const rows = JSON.stringify([
      42,
      { name: 'a', value: 'v', domain: 'd', sameSite: 3 },
      { name: 'b', value: 'v', domain: 'd', expirationDate: -1 },
      { name: 'c', value: 'v', domain: 'd', expirationDate: '123' },
      { name: '', value: 'v', domain: 'd' }
    ])
    expect(parseJsonCookies(rows, NOW).rejected).toEqual([
      { line: 1, reason: 'malformed' },
      { line: 2, reason: 'unknown-same-site' },
      { line: 3, reason: 'malformed' },
      { line: 4, reason: 'malformed' },
      { line: 5, reason: 'malformed' }
    ])
  })

  it('treats a missing path as / and a missing expiry as a session cookie', () => {
    const { cookies } = parseJsonCookies(
      JSON.stringify([{ name: 'a', value: 'v', domain: 'd' }]),
      NOW
    )
    expect(cookies[0]).toEqual({
      name: 'a',
      value: 'v',
      domain: 'd',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'unspecified'
    })
  })
})

describe('readCookieFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-cookiefile-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('routes a file starting with [ to the JSON parser and anything else to Netscape', () => {
    expect(readCookieFile(join(FIXTURES, 'cookie-editor.json'), NOW).cookies).toHaveLength(3)
    expect(readCookieFile(join(FIXTURES, 'netscape.txt'), NOW).cookies).toHaveLength(3)
    const padded = join(dir, 'padded.json')
    writeFileSync(padded, '\n  [{"name":"a","value":"v","domain":"d"}]')
    expect(readCookieFile(padded, NOW).cookies).toHaveLength(1)
  })

  it('refuses a directory with the message naming the two supported exports', () => {
    const profile = join(dir, 'Default')
    mkdirSync(profile)
    expect(() => readCookieFile(profile, NOW)).toThrow(UnsupportedCookieFileError)
    expect(() => readCookieFile(profile, NOW)).toThrow(UNSUPPORTED_COOKIE_FILE_MESSAGE)
  })

  it("refuses Chrome's Cookies database by its bytes, whatever the file is called", () => {
    const chrome = join(dir, 'Cookies')
    const db = new Database(chrome)
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB)')
    db.close()
    expect(() => readCookieFile(chrome, NOW)).toThrow(UnsupportedCookieFileError)

    const renamed = join(dir, 'export.txt')
    writeFileSync(renamed, readFileSync(chrome))
    expect(() => readCookieFile(renamed, NOW)).toThrow(UnsupportedCookieFileError)
  })

  it('refuses a file named like a browser cookie database even when it is text', () => {
    const firefox = join(dir, 'cookies.sqlite')
    writeFileSync(firefox, '.a.com\tTRUE\t/\tTRUE\t0\tn\tv\n')
    expect(() => readCookieFile(firefox, NOW)).toThrow(UnsupportedCookieFileError)
    const chrome = join(dir, 'cookies')
    writeFileSync(chrome, '.a.com\tTRUE\t/\tTRUE\t0\tn\tv\n')
    expect(() => readCookieFile(chrome, NOW)).toThrow(UnsupportedCookieFileError)
  })
})
