import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { HAS_JQ } from '../../helpers/jq'

// Step 4a of the shipped verify.sh finds blank chain lines and compares keys
// as src/shared/verify/sharedCase.ts does, by String.prototype.trim's
// whitespace. It does so without a jq regex builtin: a jq built without
// Oniguruma has none, and every Shared Case package would then fail on the
// tool rather than on anything the package holds.

const TEXT = VERIFY_SCRIPT.match(/def js_space:[\s\S]*?\ndef pem:[\s\S]*?end;/)?.[0] ?? ''

const jq = (program: string, args: string[] = []): unknown =>
  JSON.parse(execFileSync('jq', ['-n', ...args, program], { encoding: 'utf-8' }))

// Edge whitespace trim removes (no-break space, byte order mark, paragraph
// separator) and some it keeps (next line, a lone carriage return).
const SAMPLES = [
  '  key\r\nbody\r\n',
  '\u00a0\ufeffkey\u2029',
  '\u0085key\u0085',
  'a\r\r\nb\r',
  '',
  ' \t\n\u3000'
]

describe('the text helpers of verify.sh step 4a', () => {
  it('calls no jq builtin that takes a regular expression', () => {
    expect(TEXT).not.toBe('')
    // A call takes a string or a variable; prose such as "capture(s)" does not.
    expect(VERIFY_SCRIPT).not.toMatch(/\b(?:test|match|capture|scan|splits|sub|gsub)\(["$]/)
    // split takes a regular expression only with two arguments.
    expect(VERIFY_SCRIPT).not.toMatch(/\bsplit\([^()]*;/)
  })

  it.skipIf(!HAS_JQ)('counts as whitespace exactly the code points trim removes', () => {
    const removed: number[] = []
    for (let point = 0; point <= 0x10ffff; point++) {
      if (String.fromCodePoint(point).trim() === '') removed.push(point)
    }
    expect(jq(`${TEXT} [range(0; 1114112) | select(js_space)]`)).toEqual(removed)
  })

  it.skipIf(!HAS_JQ)('normalizes a key as samePem does', () => {
    for (const sample of SAMPLES) {
      expect(jq(`${TEXT} $s | pem`, ['--arg', 's', sample]), JSON.stringify(sample)).toBe(
        sample.replace(/\r\n/g, '\n').trim()
      )
    }
  })

  it.skipIf(!HAS_JQ)('finds a line blank as rawSegment does', () => {
    for (const sample of SAMPLES) {
      expect(jq(`${TEXT} $s | nonblank`, ['--arg', 's', sample]), JSON.stringify(sample)).toBe(
        sample.trim().length > 0
      )
    }
  })
})
