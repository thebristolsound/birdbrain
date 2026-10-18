// Base32 (RFC 4648, section 6 alphabet) written in the app, with no dependency
// (ruling 11 of 2026-10-10 on #1810). The invite string carries its CBOR map
// this way because the alphabet survives being read aloud, typed, or scanned
// from a QR code in alphanumeric mode. The decoder gives one byte string
// exactly one spelling per case: it refuses any character outside the
// alphabet, padding anywhere but the end, a length no byte count produces,
// and nonzero bits after the last whole byte.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PAD = '='

const VALUES = new Map<string, number>()
for (let i = 0; i < ALPHABET.length; i++) {
  VALUES.set(ALPHABET[i], i)
  VALUES.set(ALPHABET[i].toLowerCase(), i)
}

export class Base32Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base32Error'
  }
}

export interface Base32Options {
  // Whether the text carries (or must carry) the `=` padding of section 6.
  padding?: boolean
}

export function encodeBase32(bytes: Uint8Array, { padding = false }: Base32Options = {}): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31]
  if (padding) while (out.length % 8 !== 0) out += PAD
  return out
}

export function decodeBase32(text: string, { padding = false }: Base32Options = {}): Uint8Array {
  let body = text
  const firstPad = body.indexOf(PAD)
  if (padding) {
    if (body.length % 8 !== 0) {
      throw new Base32Error(`padded base32 length ${body.length} is not a multiple of 8`)
    }
    if (firstPad !== -1) {
      if (!/^=+$/.test(body.slice(firstPad))) {
        throw new Base32Error('base32 padding before the end of the text')
      }
      body = body.slice(0, firstPad)
    }
  } else if (firstPad !== -1) {
    throw new Base32Error('base32 padding in unpadded text')
  }
  // 8 characters carry 5 bytes; a remainder of 1, 3 or 6 characters would
  // carry a fraction of a byte, which no encoding produces.
  const remainder = body.length % 8
  if (remainder === 1 || remainder === 3 || remainder === 6) {
    throw new Base32Error(`base32 length ${body.length} is one no byte count produces`)
  }
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of body) {
    const value = VALUES.get(char)
    if (value === undefined) {
      throw new Base32Error(`character ${JSON.stringify(char)} is not base32`)
    }
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0 && buffer !== 0) {
    throw new Base32Error('nonzero bits after the last whole byte')
  }
  return Uint8Array.from(out)
}
