import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { HAS_JQ } from '../../helpers/jq'

// #1922: verify.sh reads a chain line as JSON only when JSON.parse, which the
// package verifier reads each line with, would too. jq accepts spellings that
// JSON.parse rejects, so the script checks the line's text with this filter.

const FILTER = VERIFY_SCRIPT.match(/^strict_filter='([^']*)'$/m)?.[1] ?? ''

const strict = (line: string): boolean =>
  execFileSync('jq', ['-Rr', FILTER], { input: line, encoding: 'utf-8' }).trim() === 'true'

const parses = (line: string): boolean => {
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}

// Lines JSON.parse rejects: a number spelled outside the JSON grammar, nan or
// Infinity in any case, or a second value on the line.
const LOOSE = [
  '{"index":01}',
  '{"index":00}',
  '{"index":-01}',
  '{"index":01.5}',
  '{"index":+1}',
  '{"index":1.}',
  '{"index":.5}',
  '{"index":1.e5}',
  '{"index":nan}',
  '{"index":NaN}',
  '{"index":-nan}',
  '{"index":Infinity}',
  '{"index":infinity}',
  '{"index":-Infinity}',
  '{"a":1}{"b":2}',
  '{"a":1} {"b":2}',
  '{"a":"\\\\"}{}',
  '[01]',
  '01'
]

// Lines JSON.parse accepts, the spellings above among them as text in strings.
const STRICT = [
  '{"index":1}',
  '{"a":1}\r',
  ' {"a":1} ',
  '{"a":"01 +1 .5 NaN Infinity -nan 1.e5 {}{}"}',
  '{"a":"x\\"01\\\\","b":[1,-0,0,0.5,1e5,1E+05,-1.5e-3,10]}',
  '{"a":true,"b":false,"c":null,"d":[],"e":{}}',
  '{"a":"é ✓ 😀"}',
  '[1,2]',
  '"x"',
  '-0'
]

describe('the strict-line filter of verify.sh', () => {
  it('is found in the shipped script', () => {
    expect(FILTER).toContain('def number_state')
  })

  it.skipIf(!HAS_JQ)('rejects each of those lines', () => {
    for (const line of LOOSE) {
      expect(parses(line), line).toBe(false)
      expect(strict(line), line).toBe(false)
    }
  })

  it.skipIf(!HAS_JQ)('accepts each line JSON.parse accepts', () => {
    for (const line of STRICT) {
      expect(parses(line), line).toBe(true)
      expect(strict(line), line).toBe(true)
    }
  })
})
