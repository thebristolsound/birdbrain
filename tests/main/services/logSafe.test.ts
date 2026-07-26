import { describe, expect, it } from 'vitest'
import type { LogContext, LogValue } from '@main/services/logSafe'
import { code, context, ident, sanitizeError, sanitizeText, tag } from '@main/services/logSafe'

// logSafe decides dev-vs-packaged from `app.isPackaged`, reached through a
// defensive require('electron') so the module still loads outside an Electron
// runtime (these tests import it directly). vi.mock only intercepts ESM
// imports, so it cannot reach that require — seeding Node's module cache can.
// Nothing here touches NODE_ENV, which this repo never sets and which is
// exactly why the check no longer reads it.
// Shaped like the ids this app mints (uuid v4 in the db repos,
// crypto.randomUUID() for capture ids).
const CAPTURE_UUID = '3f2b9c14-7d8e-4a51-9b62-0c1d2e3f4a5b'

function withElectronStub<T>(stub: object, run: () => T): T {
  const id = require.resolve('electron')
  const cache = require.cache as unknown as Record<string, unknown>
  const original = cache[id]
  cache[id] = stub
  try {
    return run()
  } finally {
    if (original === undefined) delete cache[id]
    else cache[id] = original
  }
}

function asPackagedApp<T>(run: () => T): T {
  return withElectronStub({ exports: { app: { isPackaged: true } }, loaded: true }, run)
}

describe('ident', () => {
  it('accepts uuid-shaped ids', () => {
    expect(ident('a1b2-c3d4_EF')).toBe('a1b2-c3d4_EF')
  })

  it('throws outside production on a value with spaces or punctuation', () => {
    expect(() => ident('Operation Blackbird')).toThrow()
    expect(() => ident('https://example.com/x')).toThrow()
  })
})

describe('code', () => {
  it('accepts screaming snake case', () => {
    expect(code('ENOENT')).toBe('ENOENT')
  })

  it('rejects lowercase prose', () => {
    expect(() => code('no such file')).toThrow()
  })
})

describe('tag', () => {
  it('accepts a member of the named vocabulary', () => {
    expect(tag('mhtml', 'captureFormat')).toBe('mhtml')
  })

  it('rejects a non-member of the named vocabulary', () => {
    expect(() => tag('example.com', 'captureFormat')).toThrow()
  })

  it('a value from one vocabulary is rejected against a different vocabulary', () => {
    // 'html' is a real member of captureFormat, not childProcessType — proves
    // the vocabulary selection actually gates membership per-call, not just
    // "is this any known value anywhere".
    expect(() => tag('html', 'childProcessType')).toThrow()
  })

  it('accepts every documented Electron child-process type', () => {
    for (const type of ['Utility', 'Zygote', 'Sandbox helper', 'GPU', 'Unknown']) {
      expect(tag(type, 'childProcessType')).toBe(type)
    }
  })

  it('accepts every documented process-gone reason for both -gone vocabularies', () => {
    for (const reason of ['crashed', 'oom', 'killed', 'clean-exit']) {
      expect(tag(reason, 'childGoneReason')).toBe(reason)
      expect(tag(reason, 'renderGoneReason')).toBe(reason)
    }
  })

  it('throws on a rejection in development', () => {
    // The dev half of the pair below. Neither test reads NODE_ENV: it is set
    // nowhere in this repo, so a packaged app would have taken this throwing
    // branch — inside a crash handler — under the old `NODE_ENV !==
    // 'production'` check.
    expect(() => tag('example.com', 'captureFormat')).toThrow(/failed validation/)
  })

  it('falls back to the [invalid] sentinel instead of throwing in a packaged app', () => {
    expect(asPackagedApp(() => tag('example.com', 'captureFormat'))).toBe('[invalid]')
  })

  it('treats an unresolvable Electron as development rather than as packaged', () => {
    const broken = {
      loaded: true,
      get exports(): never {
        throw new Error('electron unavailable')
      }
    }
    // Loud is the safe direction when the runtime cannot be identified: a test
    // or script run should surface a bad call site, not silently swallow it.
    withElectronStub(broken, () => {
      expect(() => tag('example.com', 'captureFormat')).toThrow(/failed validation/)
    })
  })

  it('rejects an inherited Object.prototype name instead of crashing on it', () => {
    // TAG_VOCABULARIES is a plain object literal, so a bare lookup on an
    // inherited name returns a *function* — `?.` does not short-circuit and
    // `.includes` is missing, which used to surface as a raw TypeError thrown
    // from inside a crash handler.
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty']) {
      expect(() => {
        // @ts-expect-error - not a TAG_VOCABULARIES key; the runtime net has to
        // hold anyway, since the callers that matter here bypass the type
        tag('crashed', inherited)
      }).toThrow(/failed validation/)
    }
  })

  it('rejects a caller-supplied allowlist at compile time (no minting your own vocabulary), and throws rather than crashing at runtime', () => {
    const capturedUrl = 'https://target.example/secret'
    expect(() => {
      // @ts-expect-error - vocabulary must be a name from TAG_VOCABULARIES,
      // not an array a call site invents on the spot
      tag(capturedUrl, [capturedUrl])
    }).toThrow()
  })
})

describe('sanitizeText', () => {
  it('strips windows paths', () => {
    const out = sanitizeText(String.raw`open 'C:\Users\matt\cases\x.mhtml'`, String.raw`C:\Users\matt`)
    expect(out).not.toContain('matt')
    expect(out).toContain('‹path›')
  })

  it('strips posix paths', () => {
    const out = sanitizeText('open /home/matt/cases/x.mhtml failed', '/home/matt')
    expect(out).not.toContain('matt')
    expect(out).toContain('‹path›')
  })

  it('strips urls', () => {
    const out = sanitizeText('fetch https://target.example/page?q=1 failed', '/home/matt')
    expect(out).not.toContain('target.example')
    expect(out).toContain('‹url›')
  })

  it('strips a windows path whose homeDir contains a space, with no leftover username or case name', () => {
    const homeDir = String.raw`C:\Users\John Doe`
    const out = sanitizeText(
      String.raw`open 'C:\Users\John Doe\cases\OperationBlackbird\x.mhtml' failed`,
      homeDir
    )
    expect(out).not.toContain('Doe')
    expect(out).not.toContain('OperationBlackbird')
    expect(out).toContain('‹path›')
  })

  it('strips a posix path whose homeDir contains a space, with no leftover username or case name', () => {
    const homeDir = '/home/john doe'
    const out = sanitizeText(
      'open /home/john doe/cases/OperationBlackbird/x.mhtml failed',
      homeDir
    )
    expect(out).not.toContain('doe')
    expect(out).not.toContain('OperationBlackbird')
    expect(out).toContain('‹path›')
  })

  it('strips a non-home windows path with a space in an intermediate folder', () => {
    const out = sanitizeText(
      String.raw`open D:\Evidence\Operation Blackbird\capture.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).not.toContain('capture.mhtml')
    expect(out).toContain('‹path›')
  })

  it('strips a UNC path', () => {
    const out = sanitizeText(
      String.raw`open \\server\share\cases\OperationBlackbird\x.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('server')
    expect(out).not.toContain('share')
    expect(out).not.toContain('OperationBlackbird')
    expect(out).toContain('‹path›')
  })

  it('does not swallow trailing prose after a windows path', () => {
    const out = sanitizeText(String.raw`open D:\Evidence\x.mhtml failed`, String.raw`C:\Users\matt`)
    expect(out).toContain('failed')
  })

  it('strips a windows path with a space in the FINAL segment (terminal case name)', () => {
    const out = sanitizeText(
      String.raw`open D:\Evidence\Operation Blackbird.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('failed')
  })

  it('strips a UNC path with a space in the FINAL segment (terminal case name)', () => {
    const out = sanitizeText(
      String.raw`open \\server\share\Operation Blackbird.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('failed')
  })

  it('strips a windows filename with a space before the extension', () => {
    const out = sanitizeText(
      String.raw`open D:\Evidence\Operation Blackbird\capture file.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('file.mhtml')
    expect(out).toContain('failed')
  })

  it('strips a drive-relative windows path (no backslash after the colon)', () => {
    const out = sanitizeText(
      String.raw`open D:Evidence\Operation Blackbird\x.mhtml failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
  })

  // Documented trade-off, not a bug: an UNQUOTED extensionless final segment
  // with a space has no reliable end-of-path signal, so the pattern falls
  // back to stopping at the first whitespace and the remainder survives. When
  // the same shape is quoted (as Node's own error messages usually are — see
  // the "quoted extensionless" tests below), the quote resolves it instead.
  it('pins the accepted limitation: an unquoted extensionless windows final segment with a space truncates at the first word', () => {
    const out = sanitizeText(
      String.raw`open D:\Evidence\Operation Blackbird failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).toContain('‹path›')
    expect(out).not.toContain('Operation')
    expect(out).toContain('Blackbird failed')
  })

  it('strips a quoted extensionless windows directory with a space — the quote is an unambiguous boundary', () => {
    const out = sanitizeText(
      String.raw`ENOENT: scandir 'D:\Evidence\Operation Blackbird'`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('‹path›')
  })

  it('strips a quoted extensionless UNC directory with a space', () => {
    const out = sanitizeText(
      String.raw`ENOENT: scandir '\\server\share\Operation Blackbird'`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('‹path›')
  })

  it('strips a posix path with a space in an intermediate folder and the final filename', () => {
    const out = sanitizeText(
      'open /mnt/evidence/Operation Blackbird/capture.mhtml failed',
      '/home/matt'
    )
    expect(out).not.toContain('Blackbird')
    expect(out).not.toContain('capture.mhtml')
    expect(out).toContain('failed')
  })

  it('strips a posix path with a space in the FINAL segment (terminal case name)', () => {
    const out = sanitizeText('open /mnt/evidence/Operation Blackbird.mhtml failed', '/home/matt')
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('failed')
  })

  // POSIX mirror of the windows accepted trade-off above.
  it('pins the accepted limitation: an unquoted extensionless posix final segment with a space truncates at the first word', () => {
    const out = sanitizeText('open /mnt/evidence/Operation Blackbird failed', '/home/matt')
    expect(out).toContain('‹path›')
    expect(out).not.toContain('Operation')
    expect(out).toContain('Blackbird failed')
  })

  it('strips a quoted extensionless posix directory with a space — the quote is an unambiguous boundary', () => {
    const out = sanitizeText("ENOENT: scandir '/mnt/evidence/Operation Blackbird'", '/home/matt')
    expect(out).not.toContain('Blackbird')
    expect(out).toContain('‹path›')
  })

  it('strips a quoted path even when homeDir is a prefix and the subdirectory has a space', () => {
    // This is the shape fix-1's homeDir-rooted regex still can't fully cover
    // on its own (flagged in the task report) — QUOTED_PATH picks it up
    // first, before that narrower regex gets a chance to stop at the space.
    const out = sanitizeText(
      String.raw`ENOENT: scandir 'C:\Users\matt\cases\Operation Blackbird'`,
      String.raw`C:\Users\matt`
    )
    expect(out).not.toContain('Blackbird')
    expect(out).not.toContain('matt')
    expect(out).toContain('‹path›')
  })
})

describe('sanitizeError', () => {
  it('keeps name and code but carries no message field at all', () => {
    const err = Object.assign(new Error(String.raw`ENOENT: open 'C:\Users\matt\a.mhtml'`), {
      code: 'ENOENT'
    })
    const out = sanitizeError(err, String.raw`C:\Users\matt`, String.raw`C:\Users\matt`)
    expect(out.name).toBe('Error')
    expect(out.code).toBe('ENOENT')
    expect(Object.hasOwn(out, 'message')).toBe(false)
  })

  it('drops the message entirely, so prose no regex could catch never reaches the entry', () => {
    // "Operation Blackbird" here is ordinary prose with no path or URL shape
    // for a regex to match — the old scrubbing approach could never have
    // caught this. It's kept out because there's no field left to put it in.
    const err = new Error('failed to parse Operation Blackbird')
    const out = sanitizeError(err)
    expect(Object.hasOwn(out, 'message')).toBe(false)
    expect(JSON.stringify(out)).not.toContain('Blackbird')
  })

  it('does not smuggle the message back in through the stack header line', () => {
    // A real (not hand-crafted) Error#stack begins with "name: message" —
    // dropping LoggedError.message buys nothing if that header line survives
    // into .stack. This uses a genuinely thrown error, not a manually
    // assigned .stack string, so it exercises V8's actual stack format.
    const err = new Error('failed to parse Operation Blackbird')
    const out = sanitizeError(err)
    expect(out.stack).not.toBeNull()
    expect(out.stack ?? '').not.toContain('Blackbird')
    expect(out.stack ?? '').not.toContain('failed to parse')
  })

  it('drops a frame-shaped line injected through a multi-line error message', () => {
    // V8 preserves newlines from Error.message, so this puts a line satisfying
    // the "    at " prefix into the real stack — prose with no path or URL
    // shape for sanitizeText to catch. It survives an `at`-prefix filter and
    // is dropped by a location-shaped one: '(case 7)' is not a location.
    const err = new Error('capture failed\n    at Operation Blackbird (case 7)')
    const out = sanitizeError(err)
    expect(out.stack).not.toBeNull()
    expect(out.stack ?? '').not.toContain('Blackbird')
    expect(out.stack ?? '').not.toContain('case 7')
  })

  it('keeps the four real V8 frame shapes', () => {
    const err = new Error('boom')
    err.stack = [
      'Error: boom',
      '    at Object.foo (/app/src/bar.js:10:5)',
      '    at /app/src/baz.js:3:1',
      '    at Array.forEach (<anonymous>)',
      '    at async qux (/app/src/quux.js:7:2)',
      '    at Operation Blackbird (case 7)'
    ].join('\n')
    const out = sanitizeError(err, '/app', '/home/matt')
    expect((out.stack ?? '').split('\n')).toHaveLength(4)
    expect(out.stack ?? '').toContain('<anonymous>')
    expect(out.stack ?? '').not.toContain('Blackbird')
  })

  it('rejects reading a message field at compile time (LoggedError has none)', () => {
    const out = sanitizeError(new Error('boom'))
    // @ts-expect-error - LoggedError has no `message` field
    const msg = out.message
    expect(msg).toBeUndefined()
  })

  it('records a recognized error name as-is', () => {
    const out = sanitizeError(new TypeError('boom'))
    expect(out.name).toBe('TypeError')
  })

  it('records an unrecognized error name as UnknownError', () => {
    const err = new Error('boom')
    err.name = 'TotallyMadeUpErrorType'
    const out = sanitizeError(err)
    expect(out.name).toBe('UnknownError')
  })

  // ReferenceError in particular is how an unexpected app crash usually
  // classifies, so collapsing it to UnknownError would blunt exactly the
  // diagnostics this module exists to produce.
  it.each(['ReferenceError', 'EvalError', 'AggregateError'])('preserves %s', (name) => {
    const err = new Error('boom')
    err.name = name
    expect(sanitizeError(err).name).toBe(name)
  })

  it('produces app-relative stack frames with no home directory, and drops the header line', () => {
    const appRoot = String.raw`C:\Users\matt\birdbrain`
    const err = new Error('boom')
    err.stack = [
      'Error: boom',
      String.raw`    at Object.foo (${appRoot}\src\main\services\bar.ts:10:5)`,
      '    at Module._compile (node:internal/modules/cjs/loader:1234:14)'
    ].join('\n')
    const out = sanitizeError(err, appRoot, String.raw`C:\Users\matt`)
    expect(out.stack).not.toContain('matt')
    expect(out.stack).not.toContain('boom')
    expect(out.stack).toContain(String.raw`src\main\services\bar.ts`)
  })

  it('caps the stack at 20 frames', () => {
    const err = new Error('boom')
    err.stack = [
      'Error: boom',
      ...Array.from({ length: 40 }, (_, i) => `    at f${i} (/a/b.js:1:1)`)
    ].join('\n')
    const out = sanitizeError(err, '/nonexistent/app/root', '/home/matt')
    expect((out.stack ?? '').split('\n').length).toBeLessThanOrEqual(20)
  })

  it('handles a thrown non-Error', () => {
    const out = sanitizeError('just a string', '/nonexistent/app/root', '/home/matt')
    expect(out.name).toBe('UnknownError')
    expect(out.code).toBeNull()
    expect(Object.hasOwn(out, 'message')).toBe(false)
  })

  it('nulls out the stack when the error has none', () => {
    const err = new Error('boom')
    err.stack = undefined
    const out = sanitizeError(err, '/nonexistent/app/root', '/home/matt')
    expect(out.stack).toBeNull()
  })

  it('nulls out the stack when the stack has no frame lines', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom'
    const out = sanitizeError(err, '/nonexistent/app/root', '/home/matt')
    expect(out.stack).toBeNull()
  })

  it('treats an empty appRoot as a no-op relativization, falling through to sanitizeText', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', String.raw`    at f (/home/matt/app/bar.js:1:1)`].join('\n')
    const out = sanitizeError(err, '', '/home/matt')
    expect(out.stack).not.toContain('matt')
  })

  it('defaults appRoot and homeDir to real OS values when omitted', () => {
    const out = sanitizeError(new Error('boom'))
    expect(out.name).toBe('Error')
  })
})

describe('context', () => {
  it('passes through a context object containing only allowed keys', () => {
    const out: LogContext = context({ captureId: ident(CAPTURE_UUID), bytes: 42 })
    expect(out).toEqual({ captureId: CAPTURE_UUID, bytes: 42 })
  })

  it('accepts numbers, booleans, null and tag-vocabulary strings', () => {
    const out = context({
      bytes: 42,
      packaged: true,
      exitCode: null,
      processType: tag('Sandbox helper', 'childProcessType')
    })
    // 'Sandbox helper' has a space, so IDENT alone would reject it — the
    // processType key's format is the vocabulary itself.
    expect(out).toEqual({
      bytes: 42,
      packaged: true,
      exitCode: null,
      processType: 'Sandbox helper'
    })
  })

  it('accepts the real format of every remaining string-shaped key', () => {
    const out = context({
      installationId: ident(CAPTURE_UUID),
      // The dashed form of app.getVersion(); ident() is what the plan's
      // session-start call site uses, and it rejects dots.
      version: ident('1-0-1-beta-17'),
      platform: ident('win32'),
      installFormat: ident('nsis'),
      errorCode: code('ENOENT'),
      format: tag('mhtml', 'captureFormat'),
      domain: ident('captures'),
      boundary: ident('CaseWorkspace'),
      channel: ident('captures-list')
    })
    expect(out).toEqual({
      installationId: CAPTURE_UUID,
      version: '1-0-1-beta-17',
      platform: 'win32',
      installFormat: 'nsis',
      errorCode: 'ENOENT',
      format: 'mhtml',
      domain: 'captures',
      boundary: 'CaseWorkspace',
      channel: 'captures-list'
    })
  })

  it('rejects a value under a key whose format it does not match', () => {
    // Each of these is a legal LogValue somewhere — just not under this key.
    const wrong: Array<Record<string, LogValue>> = [
      { caseId: ident('win32') }, // identifier-shaped, but not a UUID
      { platform: ident('plan9') }, // not a platform this app builds for
      { installFormat: ident('snap') }, // not a package format the code emits
      { version: ident('unreleased') }, // not dotted/dashed numeric
      { errorCode: ident('enoent') }, // errorCode is SCREAMING_SNAKE
      { ms: Number.NaN }, // a number, but not a finite one
      { packaged: 1 }, // a number under a boolean key
      { bytes: ident('4096') }, // a string under a numeric key
      { caseId: 4096 } // a number under a string key
    ]
    for (const entry of wrong) {
      expect(() => context(entry)).toThrow(/disallowed value/)
    }
  })

  it('rejects a single-token case name that ident() itself accepts', () => {
    // The reason a per-key format table exists. 'OperationBlackbird' is
    // identifier-shaped, so the generic rule brands it log-safe — and a case
    // name is exactly the investigation data that must never reach disk. Under
    // caseId it has to be a UUID, which a name cannot be.
    const caseName = 'OperationBlackbird'
    expect(ident(caseName)).toBe(caseName)
    expect(() => context({ caseId: ident(caseName) })).toThrow(/disallowed value/)
  })

  it('accepts the [invalid] sentinel a packaged-app rejection produces', () => {
    const rejected = asPackagedApp(() => tag('not-a-documented-reason', 'childGoneReason'))
    expect(rejected).toBe('[invalid]')
    // Otherwise a packaged build would drop the whole key rather than record
    // that a value was rejected.
    expect(context({ reason: rejected })).toEqual({ reason: '[invalid]' })
  })

  it('throws in development when an object contains a disallowed key', () => {
    const capturedUrl = 'https://target.example/secret-path'
    const poisoned: Record<string, LogValue> = { [capturedUrl]: true }
    expect(() => context(poisoned)).toThrow()
  })

  it('never echoes the disallowed key in the thrown error', () => {
    const capturedUrl = 'https://target.example/secret-path'
    const poisoned: Record<string, LogValue> = { [capturedUrl]: true }
    try {
      context(poisoned)
      throw new Error('context() should have thrown')
    } catch (err) {
      expect(String(err)).not.toContain('target.example')
    }
  })

  it('drops a disallowed key instead of throwing in a packaged app, keeping the allowed ones', () => {
    const capturedUrl = 'https://target.example/secret-path'
    const poisoned: Record<string, LogValue> = {
      [capturedUrl]: true,
      captureId: ident(CAPTURE_UUID)
    }
    expect(asPackagedApp(() => context(poisoned))).toEqual({ captureId: CAPTURE_UUID })
  })

  it('rejects a disallowed context key at compile time', () => {
    // @ts-expect-error - 'capturedUrl' is not a member of LogContextKey
    const bad: LogContext = { capturedUrl: ident('x') }
    expect(bad).toBeTruthy()
  })

  it('is not a general-purpose cast from raw string to log-safe', () => {
    // The whole point of the branding: written as a literal,
    // `const c: LogContext = { caseId: capture.caseName }` is a compile error.
    // Routing the same thing through context() must not launder it.
    const caseName = 'Operation Blackbird'
    expect(() => {
      // @ts-expect-error - a raw string is not a LogValue
      context({ caseId: caseName, bytes: 4096 })
    }).toThrow()
  })

  it('rejects an unbranded string value built dynamically, where no compile-time check ran', () => {
    // A cast (or plain JS) defeats the parameter type, so the runtime net has
    // to catch it too. A case name fails IDENT on its space.
    const dynamic = { caseId: 'Operation Blackbird' } as unknown as Record<string, LogValue>
    expect(() => context(dynamic)).toThrow()
  })

  it('never echoes the disallowed value in the thrown error', () => {
    const dynamic = { caseId: 'Operation Blackbird' } as unknown as Record<string, LogValue>
    let thrown: unknown = null
    try {
      context(dynamic)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toContain('Blackbird')
  })

  it('rejects a value that is neither a primitive nor a string', () => {
    const dynamic = { bytes: { toString: () => 'Operation Blackbird' } } as unknown as Record<
      string,
      LogValue
    >
    expect(() => context(dynamic)).toThrow()
  })

  it('drops a disallowed value instead of throwing in a packaged app, keeping the allowed ones', () => {
    const dynamic = { caseId: 'Operation Blackbird', bytes: 4096 } as unknown as Record<
      string,
      LogValue
    >
    expect(asPackagedApp(() => context(dynamic))).toEqual({ bytes: 4096 })
  })
})

// sanitizeError runs inside crash handlers, so a hostile or merely unusual
// Error must never make it throw — that would replace the failure being
// recorded with a second one and lose the original entirely.
describe('sanitizeError against hostile Error shapes', () => {
  it('survives a stack getter that throws', () => {
    const err = new Error('boom')
    Object.defineProperty(err, 'stack', {
      get() {
        throw new Error('lazy capture failed')
      }
    })
    expect(() => sanitizeError(err)).not.toThrow()
    expect(sanitizeError(err).stack).toBeNull()
  })

  it('survives a name getter that throws', () => {
    const err = new Error('boom')
    Object.defineProperty(err, 'name', {
      get() {
        throw new Error('nope')
      }
    })
    expect(sanitizeError(err).name).toBe('UnknownError')
  })

  it('ignores a truthy non-string stack', () => {
    const err = new Error('boom')
    Object.defineProperty(err, 'stack', { value: { toString: () => 'at fake' } })
    expect(() => sanitizeError(err)).not.toThrow()
    expect(sanitizeError(err).stack).toBeNull()
  })
})
