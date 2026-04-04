import { describe, it, expect } from 'vitest'
import { escapeCsvField, buildCsv } from '@main/services/csvEscape'

describe('escapeCsvField', () => {
  it('returns plain values unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello')
    expect(escapeCsvField('no-special-chars')).toBe('no-special-chars')
  })

  it('wraps values containing commas in double quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('wraps values containing double quotes and escapes inner quotes as ""', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('wraps values containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('renders null and undefined as empty string', () => {
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('stringifies numbers and booleans', () => {
    expect(escapeCsvField(42)).toBe('42')
    expect(escapeCsvField(true)).toBe('true')
    expect(escapeCsvField(false)).toBe('false')
  })
})

describe('buildCsv', () => {
  it('joins a header row and data rows with CRLF line endings', () => {
    const csv = buildCsv(
      ['name', 'age'],
      [
        ['alice', 30],
        ['bob', 25]
      ]
    )
    expect(csv).toBe('name,age\r\nalice,30\r\nbob,25\r\n')
  })

  it('escapes fields with special characters in both header and rows', () => {
    const csv = buildCsv(
      ['comma,col', 'quote"col'],
      [['a,b', 'he said "hi"']]
    )
    expect(csv).toBe('"comma,col","quote""col"\r\n"a,b","he said ""hi"""\r\n')
  })

  it('produces header-only output when rows is empty', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })
})
