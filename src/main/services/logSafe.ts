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
// so errors are the one place branded types cannot reach. Order matters: the
// homeDir-rooted path is replaced whole, in one pass, before the generic
// patterns run — a profile folder with a space in it (e.g. 'C:\Users\John Doe')
// would otherwise let WIN_PATH's space-terminated match chew off only part of
// homeDir, leaving the rest of the path (and anything after it, like a case
// name) exposed. URLs are replaced before the generic path patterns because a
// URL contains '//' that the posix path pattern would otherwise consume.
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
// Windows (drive-rooted 'D:\...', drive-relative 'D:...', or UNC
// '\\server\share\...') and POSIX paths share one shape, described once here
// — POSIX_PATH below is the mirror with '/' in place of '\'. A case file is
// exactly as likely to be named "Operation Blackbird.mhtml" as a case folder
// is to be named "Operation Blackbird", so both intermediate AND final
// segments need to tolerate an embedded space. Intermediate segments are
// unambiguous — each is anchored by a mandatory trailing separator — but the
// final segment is ambiguous with trailing prose ("...capture.mhtml failed")
// unless something else bounds it. A recognizable file extension is that
// bound: the final segment is matched lazily up to the first '.' plus a short
// alphanumeric run sitting at a whitespace/quote/paren/end-of-string
// boundary, so "Operation Blackbird.mhtml failed" stops cleanly before
// "failed" instead of swallowing it. When no such extension exists — an
// extensionless final segment containing a space, with no surrounding quotes
// — there is no reliable end-of-path signal short of consuming trailing
// prose, so the pattern falls back to stopping at the first
// whitespace/separator, same as the original design; that is an accepted,
// tested trade-off (see the "pinned" tests below), not an oversight. Every
// segment/final class excludes the separator itself, so each repetition
// consumes a disjoint run — no ambiguous overlapping splits for the engine to
// try — keeping both patterns linear regardless of the added lazy quantifier
// (verified empirically, see the task report).
//
// Windows requires zero or more intermediate segments (a bare 'C:\x.mhtml' or
// UNC share root is already unambiguous). POSIX requires at least one, kept
// from the original design, to avoid treating a bare '/2' (e.g. inside "1/2
// chance") as a path.
const WIN_PATH =
  /(?:[A-Za-z]:\\?|\\\\)(?:[^\\'"()]+\\)*(?:[^\\'"()]*?\.[A-Za-z0-9]{1,10}(?=[\s'"()]|$)|[^\\\s'"()]+)/g
const POSIX_PATH =
  /(?<![\w-])\/(?:[^/'"()]+\/)+(?:[^/'"()]*?\.[A-Za-z0-9]{1,10}(?=[\s'"()]|$)|[^/\s'"()]+)/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sanitizeText(text: string, homeDir: string): string {
  let out = text
  if (homeDir) {
    const homeRooted = new RegExp(`${escapeRegExp(homeDir)}[^\\s'"()]*`, 'g')
    out = out.replace(homeRooted, '‹path›')
  }
  out = out.replace(URL_LIKE, '‹url›')
  out = out.replace(WIN_PATH, '‹path›')
  out = out.replace(POSIX_PATH, '‹path›')
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
    // err.name is assumed to be a short class-like identifier (e.g. 'TypeError'),
    // not attacker/user-influenced content, so it is passed through unsanitized.
    name: err.name,
    code: errCode,
    message: sanitizeText(err.message, homeDir),
    stack
  }
}
