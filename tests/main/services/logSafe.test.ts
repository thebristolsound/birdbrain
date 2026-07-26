import { describe, expect, it } from 'vitest'
import { code, ident, sanitizeError, sanitizeText, tag } from '@main/services/logSafe'

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
  it('accepts a member of the allowed set', () => {
    expect(tag('mhtml', ['html', 'mhtml'])).toBe('mhtml')
  })

  it('rejects a non-member', () => {
    expect(() => tag('example.com', ['html', 'mhtml'])).toThrow()
  })

  it('falls back to a placeholder instead of throwing in production', () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(tag('example.com', ['html', 'mhtml'])).toBe('[invalid]')
    } finally {
      process.env.NODE_ENV = original
    }
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

  // Documented trade-off, not a bug: an extensionless final segment with a
  // space and no surrounding quotes has no reliable end-of-path signal, so
  // the pattern falls back to stopping at the first whitespace — the same
  // way it always has — and the remainder of that one segment survives.
  it('pins the accepted limitation: an extensionless windows final segment with a space truncates at the first word', () => {
    const out = sanitizeText(
      String.raw`open D:\Evidence\Operation Blackbird failed`,
      String.raw`C:\Users\matt`
    )
    expect(out).toContain('‹path›')
    expect(out).not.toContain('Operation')
    expect(out).toContain('Blackbird failed')
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
  it('pins the accepted limitation: an extensionless posix final segment with a space truncates at the first word', () => {
    const out = sanitizeText('open /mnt/evidence/Operation Blackbird failed', '/home/matt')
    expect(out).toContain('‹path›')
    expect(out).not.toContain('Operation')
    expect(out).toContain('Blackbird failed')
  })
})

describe('sanitizeError', () => {
  it('keeps name and code but scrubs the message', () => {
    const err = Object.assign(new Error(String.raw`ENOENT: open 'C:\Users\matt\a.mhtml'`), {
      code: 'ENOENT'
    })
    const out = sanitizeError(err, String.raw`C:\Users\matt`)
    expect(out.name).toBe('Error')
    expect(out.code).toBe('ENOENT')
    expect(out.message).not.toContain('matt')
  })

  it('caps the stack at 20 frames', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', ...Array.from({ length: 40 }, (_, i) => `    at f${i} (/a/b.js:1:1)`)].join('\n')
    const out = sanitizeError(err, '/home/matt')
    expect((out.stack ?? '').split('\n').length).toBeLessThanOrEqual(21)
  })

  it('handles a thrown non-Error', () => {
    const out = sanitizeError('just a string', '/home/matt')
    expect(out.name).toBe('UnknownError')
    expect(out.code).toBeNull()
  })

  it('nulls out the stack when the error has none', () => {
    const err = new Error('boom')
    err.stack = undefined
    const out = sanitizeError(err, '/home/matt')
    expect(out.stack).toBeNull()
  })

  it('defaults homeDir to the OS home directory when omitted', () => {
    const out = sanitizeError(new Error('boom'))
    expect(out.name).toBe('Error')
  })
})
