import { homedir } from 'node:os'
import type { LoggedError } from '@shared/types'

// The redaction boundary. Birdbrain logs are handed to the maintainer in bug
// reports, and captures are real investigation material, so URLs, case names
// and paths must never reach disk. LogSafe is branded: a raw string is a
// COMPILE error at every logger call site, and the validators below are the
// runtime second net.

declare const logSafeBrand: unique symbol
export type LogSafe = string & { readonly [logSafeBrand]: true }

export type LogValue = number | boolean | null | LogSafe
export type LogContext = Record<string, LogValue>

const IDENT = /^[A-Za-z0-9_-]{1,64}$/
const CODE = /^[A-Z][A-Z0-9_]{0,47}$/
const MAX_STACK_FRAMES = 20

function brand(value: string): LogSafe {
  return value as LogSafe
}

// Loud in dev so a bad call site is caught in review; inert in production so a
// logging mistake can never crash a tester's app. The offending value is never
// echoed — that would defeat the point of rejecting it.
function reject(kind: string): LogSafe {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`logSafe.${kind}: value failed validation and was not logged`)
  }
  return brand('[invalid]')
}

export function ident(value: string): LogSafe {
  return IDENT.test(value) ? brand(value) : reject('ident')
}

export function code(value: string): LogSafe {
  return CODE.test(value) ? brand(value) : reject('code')
}

export function tag(value: string, allowed: readonly string[]): LogSafe {
  return allowed.includes(value) ? brand(value) : reject('tag')
}

// Node embeds absolute paths in error messages ("ENOENT: ... open 'C:\Users\...'"),
// so errors are the one place branded types cannot reach. Order matters: URLs are
// replaced first because they contain '//' that the posix path pattern would
// otherwise chew into.
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const WIN_PATH = /[A-Za-z]:\\[^\s'"()]+/g
const POSIX_PATH = /(?<![\w-])\/(?:[\w.-]+\/)+[\w.-]*/g

export function sanitizeText(text: string, homeDir: string): string {
  let out = text
  out = out.replace(URL_LIKE, '‹url›')
  out = out.replace(WIN_PATH, '‹path›')
  out = out.replace(POSIX_PATH, '‹path›')
  // Fallback for any leftover literal homeDir occurrence the path patterns
  // didn't fully consume (e.g. a home dir containing spaces).
  if (homeDir) out = out.split(homeDir).join('‹home›')
  return out
}

export function sanitizeError(err: unknown, homeDir: string = homedir()): LoggedError {
  if (!(err instanceof Error)) {
    return {
      name: 'UnknownError',
      code: null,
      message: sanitizeText(String(err), homeDir),
      stack: null
    }
  }

  const raw = (err as { code?: unknown }).code
  const errCode = typeof raw === 'string' && CODE.test(raw) ? raw : null

  const stack = err.stack
    ? sanitizeText(err.stack, homeDir).split('\n').slice(0, MAX_STACK_FRAMES + 1).join('\n')
    : null

  return {
    name: err.name,
    code: errCode,
    message: sanitizeText(err.message, homeDir),
    stack
  }
}
