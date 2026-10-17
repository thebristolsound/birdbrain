import { describe, it, expect } from 'vitest'
import { Base32Error, decodeBase32, encodeBase32 } from '@main/services/sharing/base32'

// RFC 4648 section 10 test vectors, and the refusals that give one byte
// string exactly one spelling per case (#1810).

const VECTORS: Array<[string, string]> = [
  ['', ''],
  ['f', 'MY======'],
  ['fo', 'MZXQ===='],
  ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======']
]

const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'utf-8'))
const text = (b: Uint8Array): string => Buffer.from(b).toString('utf-8')

describe('base32 (RFC 4648 section 6)', () => {
  it('encodes and decodes the section 10 vectors with padding', () => {
    for (const [input, encoded] of VECTORS) {
      expect(encodeBase32(bytes(input), { padding: true })).toBe(encoded)
      expect(text(decodeBase32(encoded, { padding: true }))).toBe(input)
    }
  })

  it('round-trips the vectors without padding, and in lower case', () => {
    for (const [input, encoded] of VECTORS) {
      const bare = encoded.replace(/=+$/, '')
      expect(encodeBase32(bytes(input))).toBe(bare)
      expect(text(decodeBase32(bare))).toBe(input)
      expect(text(decodeBase32(bare.toLowerCase()))).toBe(input)
      expect(text(decodeBase32(encoded.toLowerCase(), { padding: true }))).toBe(input)
    }
  })

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(decodeBase32(encodeBase32(all))).toEqual(all)
    expect(decodeBase32(encodeBase32(all, { padding: true }), { padding: true })).toEqual(all)
  })

  it('refuses a character outside the alphabet', () => {
    expect(() => decodeBase32('MZXW1===', { padding: true })).toThrow(Base32Error)
    expect(() => decodeBase32('MZXW8')).toThrow(/not base32/)
    expect(() => decodeBase32('MZ XQ')).toThrow(/not base32/)
    expect(() => decodeBase32('MZXQ-')).toThrow(/not base32/)
  })

  it('refuses padding in the wrong place, or in unpadded text', () => {
    expect(() => decodeBase32('MZ=Q====', { padding: true })).toThrow(/before the end/)
    expect(() => decodeBase32('=ZXQ====', { padding: true })).toThrow(/before the end/)
    expect(() => decodeBase32('MZXQ====')).toThrow(/padding in unpadded/)
    expect(() => decodeBase32('MZXQ===', { padding: true })).toThrow(/multiple of 8/)
  })

  it('refuses a length no byte count produces', () => {
    // 1, 3 and 6 characters past a whole group carry a fraction of a byte.
    expect(() => decodeBase32('M')).toThrow(/no byte count/)
    expect(() => decodeBase32('MZX')).toThrow(/no byte count/)
    expect(() => decodeBase32('MZXW6Y')).toThrow(/no byte count/)
    expect(() => decodeBase32('MZXW6YTBM')).toThrow(/no byte count/)
    expect(() => decodeBase32('M=======', { padding: true })).toThrow(/no byte count/)
  })

  it('refuses nonzero bits after the last whole byte', () => {
    // 'MZ' carries 10 bits: one byte and two trailing bits, which are zero in
    // 'MY' (0x66) and set in 'MZ'.
    expect(text(decodeBase32('MY'))).toBe('f')
    expect(() => decodeBase32('MZ')).toThrow(/nonzero bits/)
    expect(() => decodeBase32('MZXW7===', { padding: true })).toThrow(/nonzero bits/)
  })
})
