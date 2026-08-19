import { describe, it, expect } from 'vitest'
import { safeFilename, MAX_FILENAME_STEM_LENGTH } from '@shared/safeFilename'

describe('safeFilename', () => {
  it('replaces every character Windows rejects in a path segment', () => {
    expect(safeFilename('Foo: bar | Site? <a> "b" c/d\\e*f')).toBe('Foo bar Site a b c d e f')
  })

  it('strips control characters', () => {
    expect(safeFilename('a b\tc\nde')).toBe('a b c d e')
  })

  it('collapses whitespace and trims trailing dots and spaces', () => {
    expect(safeFilename('  Report   v2. . ')).toBe('Report v2')
  })

  it('keeps unicode letters intact', () => {
    expect(safeFilename('Отчёт – 報告 — café')).toBe('Отчёт – 報告 — café')
  })

  it('falls back when nothing usable remains or the name is a reserved device', () => {
    expect(safeFilename('', 'capture')).toBe('capture')
    expect(safeFilename(null, 'capture')).toBe('capture')
    expect(safeFilename('???', 'capture')).toBe('capture')
    expect(safeFilename('CON', 'capture')).toBe('capture')
    expect(safeFilename('lpt3', 'capture')).toBe('capture')
    expect(safeFilename('Console', 'capture')).toBe('Console')
  })

  it('caps length at the stem limit', () => {
    const long = 'x'.repeat(500)
    expect(safeFilename(long).length).toBe(MAX_FILENAME_STEM_LENGTH)
    expect(safeFilename(long, 'f', 10)).toBe('xxxxxxxxxx')
  })
})
