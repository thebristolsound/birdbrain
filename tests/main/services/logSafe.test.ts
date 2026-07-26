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
