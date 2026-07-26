import { describe, expect, it } from 'vitest'
import type { LogContext } from '@main/services/logSafe'
import { code, context, ident, sanitizeError, sanitizeText, tag } from '@main/services/logSafe'

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

  it('falls back to a placeholder instead of throwing in production', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(tag('example.com', 'captureFormat')).toBe('[invalid]')
    } finally {
      process.env.NODE_ENV = original
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
    const out: LogContext = context({ captureId: ident('abc123'), bytes: 42 })
    expect(out).toEqual({ captureId: 'abc123', bytes: 42 })
  })

  it('throws outside production when an object contains a disallowed key', () => {
    const capturedUrl = 'https://target.example/secret-path'
    const poisoned: Record<string, unknown> = { [capturedUrl]: true }
    expect(() => context(poisoned)).toThrow()
  })

  it('never echoes the disallowed key in the thrown error', () => {
    const capturedUrl = 'https://target.example/secret-path'
    const poisoned: Record<string, unknown> = { [capturedUrl]: true }
    try {
      context(poisoned)
      throw new Error('context() should have thrown')
    } catch (err) {
      expect(String(err)).not.toContain('target.example')
    }
  })

  it('drops a disallowed key instead of throwing in production, keeping the allowed ones', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const capturedUrl = 'https://target.example/secret-path'
      const poisoned: Record<string, unknown> = { [capturedUrl]: true, captureId: 'abc123' }
      const out = context(poisoned)
      expect(out).toEqual({ captureId: 'abc123' })
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('rejects a disallowed context key at compile time', () => {
    // @ts-expect-error - 'capturedUrl' is not a member of LogContextKey
    const bad: LogContext = { capturedUrl: ident('x') }
    expect(bad).toBeTruthy()
  })
})
